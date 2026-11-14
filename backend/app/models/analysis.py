from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, Boolean, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, UTCDateTime, utcnow


class AnalysisStatus(enum.StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


ACTIVE_STATUSES = (AnalysisStatus.QUEUED.value, AnalysisStatus.RUNNING.value)


class Analysis(Base):
    """A conversation about one dataset. Each user question is one turn, run as a background job.

    `status` describes the latest turn; at most one turn is active at a time.
    """

    __tablename__ = "analyses"
    __table_args__ = (
        Index("ix_analyses_user_created", "user_id", "created_at"),
        Index("ix_analyses_status_queued_at", "status", "queued_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    dataset_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("datasets.id", ondelete="SET NULL"), index=True, default=None
    )
    # Snapshot so history stays readable after the dataset is deleted.
    dataset_name: Mapped[str] = mapped_column(String(200))
    title: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(20), default=AnalysisStatus.QUEUED.value)
    turn: Mapped[int] = mapped_column(Integer, default=1)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    # How many times a worker has started the current turn (used to requeue once after a crash).
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text, default=None)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    queued_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
    # Refreshed by the worker while a turn runs; stale values mark jobs orphaned by a restart.
    heartbeat_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)

    messages: Mapped[list[AnalysisMessage]] = relationship(
        back_populates="analysis",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="AnalysisMessage.created_at",
    )


class AnalysisMessage(Base):
    __tablename__ = "analysis_messages"
    __table_args__ = (Index("ix_analysis_messages_analysis_created", "analysis_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    analysis_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("analyses.id", ondelete="CASCADE"))
    turn: Mapped[int] = mapped_column(Integer)
    role: Mapped[str] = mapped_column(String(20))  # "user" | "assistant"
    content: Mapped[str] = mapped_column(Text)
    report_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("reports.id", ondelete="SET NULL"), default=None)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    analysis: Mapped[Analysis] = relationship(back_populates="messages")


class AnalysisEvent(Base):
    """Progress events emitted by the worker and polled by the client."""

    __tablename__ = "analysis_events"
    __table_args__ = (Index("ix_analysis_events_analysis_id_id", "analysis_id", "id"),)

    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    analysis_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("analyses.id", ondelete="CASCADE"))
    turn: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(30))  # status | plan | tool | verification | error
    label: Mapped[str] = mapped_column(String(300))
    detail: Mapped[dict[str, Any] | None] = mapped_column(default=None)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
