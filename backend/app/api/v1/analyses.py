from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Query, status

from app.api.deps import CurrentUser, DbSession, Pagination
from app.schemas.analysis import (
    AnalysisList,
    AnalysisOut,
    AnalysisSummary,
    CreateAnalysisRequest,
    EventOut,
    EventsOut,
    FollowUpRequest,
)
from app.services import analysis_service
from app.workers.analysis_worker import worker

router = APIRouter(prefix="/analyses", tags=["analyses"])


@router.post("", response_model=AnalysisOut, status_code=status.HTTP_202_ACCEPTED)
def create_analysis(payload: CreateAnalysisRequest, user: CurrentUser, db: DbSession) -> AnalysisOut:
    """Queue a new analysis of a dataset. Poll `/analyses/{id}/events` for progress."""
    analysis = analysis_service.create_analysis(db, user.id, dataset_id=payload.dataset_id, question=payload.question)
    worker.notify()
    return AnalysisOut.model_validate(analysis)


@router.post("/{analysis_id}/messages", response_model=AnalysisOut, status_code=status.HTTP_202_ACCEPTED)
def ask_follow_up(analysis_id: uuid.UUID, payload: FollowUpRequest, user: CurrentUser, db: DbSession) -> AnalysisOut:
    """Queue a follow-up question in an existing analysis conversation."""
    analysis = analysis_service.add_follow_up(db, user.id, analysis_id, question=payload.question)
    worker.notify()
    return AnalysisOut.model_validate(analysis)


@router.get("", response_model=AnalysisList)
def list_analyses(
    user: CurrentUser, db: DbSession, page: Pagination, dataset_id: Annotated[uuid.UUID | None, Query()] = None
) -> AnalysisList:
    items, total = analysis_service.list_analyses(
        db, user.id, limit=page.limit, offset=page.offset, dataset_id=dataset_id
    )
    reports = analysis_service.latest_report_ids(db, [item.id for item in items])
    return AnalysisList(
        items=[
            AnalysisSummary.model_validate(item).model_copy(update={"latest_report_id": reports.get(item.id)})
            for item in items
        ],
        total=total,
    )


@router.get("/{analysis_id}", response_model=AnalysisOut)
def get_analysis(analysis_id: uuid.UUID, user: CurrentUser, db: DbSession) -> AnalysisOut:
    return AnalysisOut.model_validate(analysis_service.get_analysis(db, user.id, analysis_id, with_messages=True))


@router.get("/{analysis_id}/events", response_model=EventsOut)
def get_events(
    analysis_id: uuid.UUID, user: CurrentUser, db: DbSession, after: Annotated[int, Query(ge=0)] = 0
) -> EventsOut:
    """Status of the current turn plus progress events newer than `after`."""
    analysis = analysis_service.get_analysis(db, user.id, analysis_id)
    events = analysis_service.list_events(db, analysis, after=after)
    return EventsOut(
        status=analysis.status,  # type: ignore[arg-type]
        turn=analysis.turn,
        error=analysis.error,
        events=[EventOut.model_validate(event) for event in events],
    )


@router.post("/{analysis_id}/cancel", response_model=AnalysisSummary)
def cancel_analysis(analysis_id: uuid.UUID, user: CurrentUser, db: DbSession) -> AnalysisSummary:
    """Cancel a queued or running turn. A running turn stops at its next checkpoint."""
    analysis = analysis_service.cancel(db, analysis_service.get_analysis(db, user.id, analysis_id))
    return AnalysisSummary.model_validate(analysis)


@router.delete("/{analysis_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_analysis(analysis_id: uuid.UUID, user: CurrentUser, db: DbSession) -> None:
    """Delete an analysis conversation together with its reports."""
    analysis_service.delete_analysis(db, analysis_service.get_analysis(db, user.id, analysis_id))
