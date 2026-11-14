"""Analysis conversations: queueing turns, reading progress, cancelling and deleting.

Creating a turn only writes rows; the background worker picks the turn up and runs it, so HTTP
requests never wait on the model or on pandas.
"""

from __future__ import annotations

import logging
import uuid

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session, selectinload

from app.core.config import get_settings
from app.core.db import utcnow
from app.core.exceptions import ConflictError, NotFoundError, QuotaExceededError
from app.models import Analysis, AnalysisEvent, AnalysisMessage, AnalysisStatus, Dataset
from app.models.analysis import ACTIVE_STATUSES
from app.services import auth_service, dataset_service

logger = logging.getLogger(__name__)


def _enforce_limits(db: Session, user_id: uuid.UUID) -> None:
    settings = get_settings()
    active = db.scalar(
        select(func.count())
        .select_from(Analysis)
        .where(Analysis.user_id == user_id, Analysis.status.in_(ACTIVE_STATUSES))
    )
    if int(active or 0) >= settings.max_concurrent_analyses_per_user:
        raise ConflictError(
            "You already have an analysis in progress. Wait for it to finish or cancel it first.",
            code="analysis_in_progress",
        )
    if auth_service.analyses_in_window(db, user_id) >= settings.daily_analysis_limit:
        raise QuotaExceededError(
            f"You have used all {settings.daily_analysis_limit} analyses available in a 24-hour period. "
            "Please try again later.",
            code="daily_limit_reached",
        )


def get_analysis(db: Session, user_id: uuid.UUID, analysis_id: uuid.UUID, *, with_messages: bool = False) -> Analysis:
    """Fetch an analysis the user owns. Someone else's analysis is reported as not found."""
    statement = select(Analysis).where(Analysis.id == analysis_id, Analysis.user_id == user_id)
    if with_messages:
        statement = statement.options(selectinload(Analysis.messages))
    analysis = db.scalar(statement)
    if analysis is None:
        raise NotFoundError("Analysis not found.")
    return analysis


def create_analysis(db: Session, user_id: uuid.UUID, *, dataset_id: uuid.UUID, question: str) -> Analysis:
    dataset = dataset_service.get_dataset(db, user_id, dataset_id)
    _enforce_limits(db, user_id)
    analysis = Analysis(
        user_id=user_id,
        dataset_id=dataset.id,
        dataset_name=dataset.name,
        title=question[:120],
        status=AnalysisStatus.QUEUED.value,
        turn=1,
    )
    analysis.messages.append(AnalysisMessage(turn=1, role="user", content=question))
    db.add(analysis)
    db.commit()
    logger.info("analysis queued", extra={"analysis_id": str(analysis.id), "turn": 1})
    return get_analysis(db, user_id, analysis.id, with_messages=True)


def add_follow_up(db: Session, user_id: uuid.UUID, analysis_id: uuid.UUID, *, question: str) -> Analysis:
    analysis = get_analysis(db, user_id, analysis_id)
    if analysis.status in ACTIVE_STATUSES:
        raise ConflictError("This analysis is still running.", code="analysis_in_progress")
    if analysis.dataset_id is None or db.get(Dataset, analysis.dataset_id) is None:
        raise ConflictError(
            "The dataset for this analysis has been deleted, so it cannot be continued.", code="dataset_deleted"
        )
    _enforce_limits(db, user_id)
    analysis.turn += 1
    analysis.status = AnalysisStatus.QUEUED.value
    analysis.error = None
    analysis.cancel_requested = False
    analysis.attempts = 0
    analysis.queued_at = utcnow()
    analysis.started_at = None
    analysis.finished_at = None
    db.add(AnalysisMessage(analysis_id=analysis.id, turn=analysis.turn, role="user", content=question))
    db.commit()
    logger.info("analysis queued", extra={"analysis_id": str(analysis.id), "turn": analysis.turn})
    return get_analysis(db, user_id, analysis.id, with_messages=True)


def list_analyses(
    db: Session, user_id: uuid.UUID, *, limit: int, offset: int, dataset_id: uuid.UUID | None = None
) -> tuple[list[Analysis], int]:
    conditions = [Analysis.user_id == user_id]
    if dataset_id is not None:
        conditions.append(Analysis.dataset_id == dataset_id)
    total = int(db.scalar(select(func.count()).select_from(Analysis).where(*conditions)) or 0)
    rows = db.scalars(
        select(Analysis).where(*conditions).order_by(Analysis.created_at.desc()).limit(limit).offset(offset)
    ).all()
    return list(rows), total


def list_events(db: Session, analysis: Analysis, *, after: int) -> list[AnalysisEvent]:
    """Progress events of the current turn that are newer than event id `after`."""
    return list(
        db.scalars(
            select(AnalysisEvent)
            .where(
                AnalysisEvent.analysis_id == analysis.id,
                AnalysisEvent.turn == analysis.turn,
                AnalysisEvent.id > after,
            )
            .order_by(AnalysisEvent.id)
            .limit(200)
        ).all()
    )


def cancel(db: Session, analysis: Analysis) -> Analysis:
    if analysis.status == AnalysisStatus.QUEUED.value:
        # Not picked up yet: cancel directly. The guard keeps this safe against a worker
        # claiming the job at the same moment.
        result = db.execute(
            update(Analysis)
            .where(Analysis.id == analysis.id, Analysis.status == AnalysisStatus.QUEUED.value)
            .values(status=AnalysisStatus.CANCELLED.value, finished_at=utcnow(), error="Cancelled.")
        )
        db.commit()
        if result.rowcount:  # type: ignore[attr-defined]
            db.refresh(analysis)
            return analysis
        db.refresh(analysis)
    if analysis.status == AnalysisStatus.RUNNING.value:
        analysis.cancel_requested = True
        db.commit()
    return analysis


def delete_analysis(db: Session, analysis: Analysis) -> None:
    if analysis.status in ACTIVE_STATUSES:
        raise ConflictError("Cancel the analysis before deleting it.", code="analysis_in_progress")
    db.delete(analysis)
    db.commit()
