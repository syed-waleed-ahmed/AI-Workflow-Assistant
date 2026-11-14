"""Structured report schemas.

`ReportDraft` is what the model writes: prose plus references to evidence ids. `ReportContent`
is what is stored and served: the draft combined with material the server attaches itself —
dataset facts from the profile, charts and tables from tool results, and the verification
outcome. The model never supplies chart or table values.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.tools.types import Chart, Scalar, Table

Level = Literal["high", "medium", "low"]


class _Strict(BaseModel):
    # Groq's strict JSON-schema mode needs every object closed and every field required.
    model_config = ConfigDict(extra="forbid")


class KeyMetric(_Strict):
    label: str = Field(description="Short name of the metric, e.g. 'Total revenue'.")
    value: str = Field(description="The value exactly as computed by a tool, formatted for reading.")
    context: str = Field(description="One short clause of context, or an empty string.")
    evidence_ids: list[str] = Field(description="Ids of the tool results this value comes from.")


class Finding(_Strict):
    title: str
    detail: str = Field(description="2-4 sentences. Every number must come from the cited evidence.")
    significance: Level
    evidence_ids: list[str]


class Anomaly(_Strict):
    title: str
    detail: str
    evidence_ids: list[str]


class Recommendation(_Strict):
    action: str
    rationale: str = Field(description="Why, tied to a finding. Do not introduce new statistics here.")
    priority: Level


class ReportDraft(_Strict):
    title: str
    executive_summary: str = Field(description="3-5 sentences answering the user's question directly.")
    key_metrics: list[KeyMetric]
    findings: list[Finding]
    anomalies: list[Anomaly]
    data_quality: list[str] = Field(description="Data-quality observations that affect the conclusions.")
    chart_evidence_ids: list[str] = Field(description="Ids of the evidence charts worth showing, most useful first.")
    recommendations: list[Recommendation]
    limitations: list[str] = Field(description="What the data cannot support, e.g. small samples or missing fields.")


class EvidenceRecord(BaseModel):
    """One executed tool call: the provenance for the numbers in a report."""

    id: str
    tool: str
    label: str
    arguments: dict[str, Any]
    ok: bool
    summary: str
    scalars: dict[str, Scalar] = Field(default_factory=dict)
    table: Table | None = None
    notes: list[str] = Field(default_factory=list)


class Visualization(BaseModel):
    evidence_id: str
    chart: Chart


class DatasetOverview(BaseModel):
    name: str
    rows: int
    columns: int
    column_kinds: dict[str, int]
    quality_score: int
    missing_cells_pct: float
    duplicate_rows: int


class Verification(BaseModel):
    status: Literal["verified", "partially_verified"]
    numbers_checked: int
    unverified_numbers: list[str] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)


class ReportContent(BaseModel):
    title: str
    question: str
    executive_summary: str
    dataset_overview: DatasetOverview
    key_metrics: list[KeyMetric]
    findings: list[Finding]
    anomalies: list[Anomaly]
    data_quality: list[str]
    visualizations: list[Visualization]
    recommendations: list[Recommendation]
    limitations: list[str]
    plan: list[str]
    methodology: list[EvidenceRecord]
    verification: Verification
    model: str
    generated_at: datetime


class ReportSummary(BaseModel):
    id: str
    analysis_id: str
    turn: int
    title: str
    dataset_name: str
    question: str
    executive_summary: str
    created_at: datetime


class ReportOut(ReportSummary):
    content: ReportContent


class ReportList(BaseModel):
    items: list[ReportSummary]
    total: int
