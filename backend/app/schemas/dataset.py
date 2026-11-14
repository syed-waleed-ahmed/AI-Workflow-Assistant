from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.tools.types import Scalar


class DatasetSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    original_filename: str
    file_format: str
    sheet_name: str | None
    original_size_bytes: int
    stored_size_bytes: int
    row_count: int
    column_count: int
    quality_score: int
    created_at: datetime


class ColumnProfile(BaseModel):
    name: str
    dtype: str
    kind: str
    non_null: int
    missing: int
    missing_pct: float
    unique: int
    sample_values: list[Scalar] = Field(default_factory=list)
    stats: dict[str, Scalar] | None = None
    top_values: list[dict[str, Scalar]] | None = None


class QualityIssue(BaseModel):
    severity: str
    column: str | None = None
    message: str


class DatasetQuality(BaseModel):
    score: int
    missing_cells: int
    missing_cells_pct: float
    issues: list[QualityIssue]


class DatasetProfile(BaseModel):
    row_count: int
    column_count: int
    memory_bytes: int
    duplicate_rows: int
    kind_counts: dict[str, int]
    columns: list[ColumnProfile]
    quality: DatasetQuality
    ingest_notes: list[str] = Field(default_factory=list)


class DatasetOut(DatasetSummary):
    profile: DatasetProfile


class DatasetList(BaseModel):
    items: list[DatasetSummary]
    total: int


class DatasetPreview(BaseModel):
    columns: list[str]
    rows: list[list[Scalar]]
    total_rows: int
    offset: int


class RenameDatasetRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class UploadTicket(BaseModel):
    ticket: str
    expires_in: int


class SuggestedQuestions(BaseModel):
    questions: list[str]


def summary_from_model(dataset: Any) -> dict[str, Any]:
    """Field values for `DatasetSummary`/`DatasetOut`, lifting the quality score out of the profile."""
    return {
        "id": dataset.id,
        "name": dataset.name,
        "original_filename": dataset.original_filename,
        "file_format": dataset.file_format,
        "sheet_name": dataset.sheet_name,
        "original_size_bytes": dataset.original_size_bytes,
        "stored_size_bytes": dataset.stored_size_bytes,
        "row_count": dataset.row_count,
        "column_count": dataset.column_count,
        "quality_score": int(dataset.profile.get("quality", {}).get("score", 0)),
        "created_at": dataset.created_at,
    }
