from __future__ import annotations

import uuid
from typing import Annotated, Literal
from urllib.parse import quote

from fastapi import APIRouter, Query, Response, status

from app.api.deps import CurrentUser, DbSession, Pagination
from app.schemas.report import ReportList, ReportOut
from app.services import report_service

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("", response_model=ReportList)
def list_reports(user: CurrentUser, db: DbSession, page: Pagination) -> ReportList:
    items, total = report_service.list_reports(db, user.id, limit=page.limit, offset=page.offset)
    return ReportList(items=[report_service.to_summary(item) for item in items], total=total)


@router.get("/{report_id}", response_model=ReportOut)
def get_report(report_id: uuid.UUID, user: CurrentUser, db: DbSession) -> ReportOut:
    return report_service.to_out(report_service.get_report(db, user.id, report_id))


@router.get(
    "/{report_id}/export",
    responses={200: {"content": {"application/octet-stream": {}}, "description": "The exported file."}},
)
def export_report(
    report_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
    export_format: Annotated[Literal["md", "pdf", "xlsx", "csv"], Query(alias="format")],
    evidence_id: Annotated[str | None, Query(pattern=r"^E\d{1,3}$")] = None,
) -> Response:
    """Download a report as Markdown, PDF or Excel, or one of its result tables as CSV."""
    exported = report_service.export(report_service.get_report(db, user.id, report_id), export_format, evidence_id)
    return Response(
        content=exported.content,
        media_type=exported.media_type,
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(exported.filename)}"},
    )


@router.delete("/{report_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_report(report_id: uuid.UUID, user: CurrentUser, db: DbSession) -> None:
    report_service.delete_report(db, report_service.get_report(db, user.id, report_id))
