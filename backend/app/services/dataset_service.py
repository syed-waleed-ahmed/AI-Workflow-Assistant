"""Dataset ingestion, retrieval and deletion. Every query is scoped to the owning user."""

from __future__ import annotations

import io
import logging
import threading
import uuid
from collections import OrderedDict
from typing import Any

import pandas as pd
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.exceptions import (
    NotFoundError,
    PayloadTooLargeError,
    QuotaExceededError,
    ServiceUnavailableError,
)
from app.models import Dataset
from app.services.storage_service import ObjectNotFoundError, StorageError, get_storage
from app.tools.dataset_overview import profile_dataframe
from app.utils.dataframe_utils import frame_to_table
from app.utils.file_validation import parse_upload, safe_display_name

logger = logging.getLogger(__name__)


class _FrameCache:
    """Small LRU cache of parsed datasets so consecutive tool calls do not re-read storage.

    Bounded by total in-memory size. Cached frames are shared and must be treated as read-only;
    every tool that needs to change data works on a copy.
    """

    def __init__(self, max_bytes: int = 160 * 1024 * 1024):
        self._max_bytes = max_bytes
        self._items: OrderedDict[str, tuple[pd.DataFrame, int]] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: str) -> pd.DataFrame | None:
        with self._lock:
            item = self._items.get(key)
            if item is None:
                return None
            self._items.move_to_end(key)
            return item[0]

    def put(self, key: str, frame: pd.DataFrame) -> None:
        size = int(frame.memory_usage(deep=True).sum())
        if size > self._max_bytes:
            return
        with self._lock:
            self._items[key] = (frame, size)
            self._items.move_to_end(key)
            while sum(item[1] for item in self._items.values()) > self._max_bytes:
                self._items.popitem(last=False)

    def evict(self, key: str) -> None:
        with self._lock:
            self._items.pop(key, None)

    def clear(self) -> None:
        with self._lock:
            self._items.clear()


frame_cache = _FrameCache()


def storage_used_bytes(db: Session, user_id: uuid.UUID) -> int:
    used = db.scalar(select(func.coalesce(func.sum(Dataset.stored_size_bytes), 0)).where(Dataset.user_id == user_id))
    return int(used or 0)


def dataset_count(db: Session, user_id: uuid.UUID) -> int:
    return int(db.scalar(select(func.count()).select_from(Dataset).where(Dataset.user_id == user_id)) or 0)


def get_dataset(db: Session, user_id: uuid.UUID, dataset_id: uuid.UUID) -> Dataset:
    """Fetch a dataset the user owns. Someone else's dataset is reported as not found."""
    dataset = db.scalar(select(Dataset).where(Dataset.id == dataset_id, Dataset.user_id == user_id))
    if dataset is None:
        raise NotFoundError("Dataset not found.")
    return dataset


def list_datasets(db: Session, user_id: uuid.UUID, limit: int, offset: int) -> tuple[list[Dataset], int]:
    total = dataset_count(db, user_id)
    rows = db.scalars(
        select(Dataset)
        .where(Dataset.user_id == user_id)
        .order_by(Dataset.created_at.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return list(rows), total


def create_dataset(
    db: Session,
    user_id: uuid.UUID,
    *,
    filename: str | None,
    content: bytes,
    sheet: str | None = None,
    name: str | None = None,
) -> Dataset:
    """Validate, parse, profile and store an uploaded file as a new dataset."""
    settings = get_settings()
    if len(content) > settings.max_upload_bytes:
        raise PayloadTooLargeError(f"Files are limited to {settings.max_upload_mb} MB.", code="file_too_large")
    if dataset_count(db, user_id) >= settings.max_datasets_per_user:
        raise QuotaExceededError(
            f"You have reached the limit of {settings.max_datasets_per_user} datasets. Delete one to upload another.",
            code="dataset_limit_reached",
        )

    display_name = safe_display_name(filename)
    parsed = parse_upload(
        display_name,
        content,
        sheet=sheet,
        max_rows=settings.max_rows,
        max_columns=settings.max_columns,
        max_cells=settings.max_cells,
    )
    buffer = io.BytesIO()
    parsed.frame.to_parquet(buffer, engine="pyarrow", compression="zstd", index=False)
    payload = buffer.getvalue()

    if storage_used_bytes(db, user_id) + len(payload) > settings.user_storage_quota_bytes:
        raise QuotaExceededError(
            f"This upload would exceed your {settings.user_storage_quota_mb} MB storage quota. "
            "Delete a dataset to free space.",
            code="storage_quota_exceeded",
        )

    dataset_id = uuid.uuid4()
    storage_key = f"datasets/{user_id}/{dataset_id}.parquet"
    try:
        get_storage().put(storage_key, payload)
    except StorageError as exc:
        logger.exception("dataset upload could not be stored")
        raise ServiceUnavailableError("File storage is temporarily unavailable. Please try again.") from exc

    stem = display_name.rsplit(".", 1)[0] or display_name
    label = safe_display_name(name) if name and name.strip() else stem
    if parsed.sheet_name and not (name and name.strip()):
        label = f"{stem} — {parsed.sheet_name}"
    dataset = Dataset(
        id=dataset_id,
        user_id=user_id,
        name=label[:200],
        original_filename=display_name,
        file_format=parsed.file_format,
        sheet_name=parsed.sheet_name,
        storage_key=storage_key,
        original_size_bytes=len(content),
        stored_size_bytes=len(payload),
        row_count=len(parsed.frame),
        column_count=int(parsed.frame.shape[1]),
        profile=profile_dataframe(parsed.frame, parsed.notes),
    )
    db.add(dataset)
    try:
        db.commit()
    except Exception:
        db.rollback()
        _delete_object(storage_key)
        raise
    frame_cache.put(storage_key, parsed.frame)
    logger.info(
        "dataset created",
        extra={"dataset_id": str(dataset_id), "rows": dataset.row_count, "columns": dataset.column_count},
    )
    return dataset


def load_frame(dataset: Dataset) -> pd.DataFrame:
    """Load a dataset's rows. The returned frame is shared: do not modify it in place."""
    cached = frame_cache.get(dataset.storage_key)
    if cached is not None:
        return cached
    try:
        payload = get_storage().get(dataset.storage_key)
    except ObjectNotFoundError as exc:
        raise NotFoundError("The file for this dataset is no longer available.") from exc
    except StorageError as exc:
        raise ServiceUnavailableError("File storage is temporarily unavailable. Please try again.") from exc
    frame = pd.read_parquet(io.BytesIO(payload), engine="pyarrow")
    frame_cache.put(dataset.storage_key, frame)
    return frame


def preview(dataset: Dataset, limit: int, offset: int) -> dict[str, Any]:
    frame = load_frame(dataset)
    window = frame.iloc[offset : offset + limit]
    table = frame_to_table(window, max_rows=limit, total_rows=len(frame))
    return {"columns": table.columns, "rows": table.rows, "total_rows": len(frame), "offset": offset}


def rename_dataset(db: Session, dataset: Dataset, name: str) -> Dataset:
    dataset.name = safe_display_name(name)[:200]
    db.commit()
    return dataset


def _delete_object(storage_key: str) -> None:
    frame_cache.evict(storage_key)
    try:
        get_storage().delete(storage_key)
    except StorageError:
        # The database row is the source of truth; an orphaned object only wastes space.
        logger.warning("could not delete stored object", extra={"storage_key": storage_key})


def delete_dataset(db: Session, dataset: Dataset) -> None:
    storage_key = dataset.storage_key
    db.delete(dataset)
    db.commit()
    _delete_object(storage_key)


def delete_all_for_user(db: Session, user_id: uuid.UUID) -> None:
    """Remove every stored object belonging to a user (rows are removed by cascade)."""
    keys = db.scalars(select(Dataset.storage_key).where(Dataset.user_id == user_id)).all()
    for key in keys:
        _delete_object(key)
