from __future__ import annotations

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, File, Form, Query, Request, UploadFile, status
from fastapi.responses import JSONResponse

from app.api.deps import CurrentUser, DbSession, Pagination, get_current_user
from app.core.config import get_settings
from app.core.exceptions import AuthenticationError, PayloadTooLargeError
from app.core.logging import request_id_var
from app.core.rate_limit import rate_limiter
from app.core.security import UPLOAD_TICKET_TTL_SECONDS, issue_upload_ticket, verify_upload_ticket
from app.models import Dataset, User
from app.schemas.dataset import (
    DatasetList,
    DatasetOut,
    DatasetPreview,
    DatasetSummary,
    RenameDatasetRequest,
    SuggestedQuestions,
    UploadTicket,
    summary_from_model,
)
from app.services import dataset_service
from app.utils.file_validation import SheetSelectionRequired
from app.utils.suggestions import suggest_questions

router = APIRouter(prefix="/datasets", tags=["datasets"])
_CHUNK = 1024 * 1024


def _out(dataset: Dataset) -> DatasetOut:
    return DatasetOut.model_validate({**summary_from_model(dataset), "profile": dataset.profile})


def _upload_user_id(request: Request, db: DbSession) -> uuid.UUID:
    """Authenticate an upload by upload ticket (direct browser-to-API) or by session cookie."""
    scheme, _, credential = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() == "bearer" and credential:
        user_id = verify_upload_ticket(credential)
        if user_id is None or db.get(User, user_id) is None:
            raise AuthenticationError("The upload link has expired. Please try again.", code="invalid_upload_ticket")
        return user_id
    return get_current_user(request, db).id


async def _read_limited(upload: UploadFile, limit: int) -> bytes:
    """Read the upload in chunks, stopping as soon as it exceeds the size limit."""
    chunks: list[bytes] = []
    size = 0
    while chunk := await upload.read(_CHUNK):
        size += len(chunk)
        if size > limit:
            raise PayloadTooLargeError(f"Files are limited to {limit // (1024 * 1024)} MB.", code="file_too_large")
        chunks.append(chunk)
    return b"".join(chunks)


@router.post("/upload-ticket", response_model=UploadTicket)
def create_upload_ticket(user: CurrentUser) -> UploadTicket:
    """Issue a short-lived credential for uploading a file directly to the API host."""
    return UploadTicket(ticket=issue_upload_ticket(user.id), expires_in=UPLOAD_TICKET_TTL_SECONDS)


@router.post(
    "",
    response_model=DatasetOut,
    status_code=status.HTTP_201_CREATED,
    responses={409: {"description": "The workbook has several sheets; resend with `sheet`."}},
)
async def upload_dataset(
    request: Request,
    db: DbSession,
    file: Annotated[UploadFile, File(description="A .csv, .tsv, .xlsx or .xls file.")],
    sheet: Annotated[str | None, Form(max_length=255)] = None,
    name: Annotated[str | None, Form(max_length=200)] = None,
) -> Any:
    """Upload a dataset. It is validated, parsed, profiled and stored as Parquet."""
    user_id = _upload_user_id(request, db)
    settings = get_settings()
    rate_limiter.check(f"upload:{user_id}", settings.rate_limit_upload_per_minute)
    content = await _read_limited(file, settings.max_upload_bytes)
    try:
        # Parsing is CPU-bound; run it off the event loop.
        from starlette.concurrency import run_in_threadpool

        dataset = await run_in_threadpool(
            dataset_service.create_dataset,
            db,
            user_id,
            filename=file.filename,
            content=content,
            sheet=sheet or None,
            name=name,
        )
    except SheetSelectionRequired as exc:
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={
                "error": {
                    "code": "sheet_selection_required",
                    "message": "This workbook has several sheets. Choose the one to import.",
                    "request_id": request_id_var.get(),
                    "details": {"sheets": exc.sheets[:100]},
                }
            },
        )
    return _out(dataset)


@router.get("", response_model=DatasetList)
def list_datasets(user: CurrentUser, db: DbSession, page: Pagination) -> DatasetList:
    items, total = dataset_service.list_datasets(db, user.id, page.limit, page.offset)
    return DatasetList(items=[DatasetSummary.model_validate(summary_from_model(item)) for item in items], total=total)


@router.get("/{dataset_id}", response_model=DatasetOut)
def get_dataset(dataset_id: uuid.UUID, user: CurrentUser, db: DbSession) -> DatasetOut:
    return _out(dataset_service.get_dataset(db, user.id, dataset_id))


@router.get("/{dataset_id}/preview", response_model=DatasetPreview)
def preview_dataset(
    dataset_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> DatasetPreview:
    """A page of rows from the dataset."""
    dataset = dataset_service.get_dataset(db, user.id, dataset_id)
    return DatasetPreview.model_validate(dataset_service.preview(dataset, limit, offset))


@router.get("/{dataset_id}/suggestions", response_model=SuggestedQuestions)
def suggested_questions(dataset_id: uuid.UUID, user: CurrentUser, db: DbSession) -> SuggestedQuestions:
    """Starter questions derived from the dataset's columns."""
    dataset = dataset_service.get_dataset(db, user.id, dataset_id)
    return SuggestedQuestions(questions=suggest_questions(dataset.profile))


@router.patch("/{dataset_id}", response_model=DatasetOut)
def rename_dataset(
    dataset_id: uuid.UUID, payload: RenameDatasetRequest, user: CurrentUser, db: DbSession
) -> DatasetOut:
    dataset = dataset_service.get_dataset(db, user.id, dataset_id)
    return _out(dataset_service.rename_dataset(db, dataset, payload.name))


@router.delete("/{dataset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_dataset(dataset_id: uuid.UUID, user: CurrentUser, db: DbSession) -> None:
    """Delete the dataset and its stored file. Existing reports remain readable."""
    dataset_service.delete_dataset(db, dataset_service.get_dataset(db, user.id, dataset_id))
