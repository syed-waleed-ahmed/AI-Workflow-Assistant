from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, UTCDateTime, utcnow


class Dataset(Base):
    """An uploaded table, stored as Parquet in object storage and profiled at ingest."""

    __tablename__ = "datasets"
    __table_args__ = (Index("ix_datasets_user_created", "user_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(200))
    original_filename: Mapped[str] = mapped_column(String(255))
    file_format: Mapped[str] = mapped_column(String(10))
    sheet_name: Mapped[str | None] = mapped_column(String(255), default=None)
    storage_key: Mapped[str] = mapped_column(String(255), unique=True)
    original_size_bytes: Mapped[int] = mapped_column(BigInteger)
    stored_size_bytes: Mapped[int] = mapped_column(BigInteger)
    row_count: Mapped[int] = mapped_column(Integer)
    column_count: Mapped[int] = mapped_column(Integer)
    profile: Mapped[dict[str, Any]] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
