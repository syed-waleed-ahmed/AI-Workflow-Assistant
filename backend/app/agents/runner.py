"""Entry point for running one analysis turn and assembling the stored report."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from langgraph.errors import GraphRecursionError

from app.agents.evidence import EvidenceLedger
from app.agents.graph import build_graph, recursion_limit
from app.agents.state import AnalysisFailed, Plan, RunDeps
from app.schemas.report import (
    DatasetOverview,
    ReportContent,
    ReportDraft,
    Verification,
    Visualization,
)

MAX_VISUALIZATIONS = 6


@dataclass
class RunResult:
    report: ReportContent
    llm_calls: int
    tool_calls: int
    total_tokens: int


def _visualizations(draft: ReportDraft, ledger: EvidenceLedger) -> list[Visualization]:
    """Charts chosen by the model, falling back to charts of the evidence its findings cite."""
    charts = {item.id: item.result.chart for item in ledger.successful if item.result and item.result.chart}
    order = list(draft.chart_evidence_ids)
    if not order:
        cited = [ref for finding in draft.findings for ref in finding.evidence_ids]
        cited += [ref for metric in draft.key_metrics for ref in metric.evidence_ids]
        order = list(dict.fromkeys(cited))
    return [Visualization(evidence_id=ref, chart=charts[ref]) for ref in order if ref in charts and charts[ref].data][
        :MAX_VISUALIZATIONS
    ]


def assemble_report(
    draft: ReportDraft,
    *,
    deps: RunDeps,
    plan: Plan | None,
    unverified: list[str],
    numbers_checked: int,
) -> ReportContent:
    """Combine the model's draft with server-side facts, charts, provenance and verification."""
    profile = deps.profile
    limitations = list(draft.limitations)
    notes = [
        "Every figure in the summary, key metrics, findings and anomalies was compared with the "
        "values computed by the analysis tools."
    ]
    if unverified:
        limitations.append(
            "Some figures could not be traced to a computed result and should be checked before use: "
            + ", ".join(unverified[:15])
            + "."
        )
        notes.append("Figures listed as unverified did not match any computed value.")
    return ReportContent(
        title=draft.title.strip()[:300] or "Analysis report",
        question=deps.question,
        executive_summary=draft.executive_summary,
        dataset_overview=DatasetOverview(
            name=deps.dataset_name,
            rows=profile["row_count"],
            columns=profile["column_count"],
            column_kinds=profile.get("kind_counts", {}),
            quality_score=profile["quality"]["score"],
            missing_cells_pct=profile["quality"]["missing_cells_pct"],
            duplicate_rows=profile["duplicate_rows"],
        ),
        key_metrics=draft.key_metrics,
        findings=draft.findings,
        anomalies=draft.anomalies,
        data_quality=draft.data_quality,
        visualizations=_visualizations(draft, deps.ledger),
        recommendations=draft.recommendations,
        limitations=limitations,
        plan=plan.steps if plan else [],
        methodology=[item.to_record() for item in deps.ledger.successful],
        verification=Verification(
            status="partially_verified" if unverified else "verified",
            numbers_checked=numbers_checked,
            unverified_numbers=unverified,
            notes=notes,
        ),
        model=deps.gateway.model_name,
        generated_at=datetime.now(UTC),
    )


def run_analysis(deps: RunDeps) -> RunResult:
    """Run the workflow to completion.

    Raises `AnalysisFailed`, `LLMError`, `DeadlineExceeded` or `RunCancelled`; the worker maps
    each to a final analysis status.
    """
    graph = build_graph(deps)
    try:
        state: dict[str, Any] = graph.invoke(
            {"messages": []}, config={"recursion_limit": recursion_limit(deps.limits.max_agent_rounds)}
        )
    except GraphRecursionError as exc:
        raise AnalysisFailed("The analysis did not converge within its step limit. Try a narrower question.") from exc

    draft = state.get("draft")
    if draft is None:
        raise AnalysisFailed("The analysis finished without producing a report. Please try again.")
    report = assemble_report(
        draft,
        deps=deps,
        plan=state.get("plan"),
        unverified=state.get("unverified_numbers", []),
        numbers_checked=state.get("numbers_checked", 0),
    )
    return RunResult(
        report=report,
        llm_calls=deps.gateway.usage.llm_calls,
        tool_calls=deps.tool_calls,
        total_tokens=deps.gateway.usage.total_tokens,
    )
