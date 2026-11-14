from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Status = Literal["queued", "running", "completed", "failed", "cancelled"]


def _clean_question(value: str) -> str:
    cleaned = " ".join(value.split())
    if len(cleaned) < 3:
        raise ValueError("Ask a question of at least 3 characters.")
    return cleaned


class CreateAnalysisRequest(BaseModel):
    dataset_id: uuid.UUID
    question: str = Field(max_length=2000)

    _question = field_validator("question")(_clean_question)


class FollowUpRequest(BaseModel):
    question: str = Field(max_length=2000)

    _question = field_validator("question")(_clean_question)


class AnalysisSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    dataset_id: uuid.UUID | None
    dataset_name: str
    title: str
    status: Status
    turn: int
    error: str | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    turn: int
    role: Literal["user", "assistant"]
    content: str
    report_id: uuid.UUID | None
    created_at: datetime


class AnalysisOut(AnalysisSummary):
    messages: list[MessageOut]


class AnalysisList(BaseModel):
    items: list[AnalysisSummary]
    total: int


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    turn: int
    kind: str
    label: str
    detail: dict[str, Any] | None
    created_at: datetime


class EventsOut(BaseModel):
    status: Status
    turn: int
    error: str | None
    events: list[EventOut]
