"""Render a structured report as Markdown."""

from __future__ import annotations

from app.schemas.report import ReportContent
from app.tools.types import Scalar, Table


def _escape_cell(value: Scalar) -> str:
    if value is None:
        return ""
    if isinstance(value, float):
        text = f"{value:,.4f}".rstrip("0").rstrip(".")
    elif isinstance(value, int) and not isinstance(value, bool):
        text = f"{value:,}"
    else:
        text = str(value)
    return text.replace("|", "\\|").replace("\n", " ")


def table_to_markdown(table: Table, max_rows: int = 25) -> str:
    header = "| " + " | ".join(_escape_cell(column) for column in table.columns) + " |"
    divider = "| " + " | ".join("---" for _ in table.columns) + " |"
    rows = ["| " + " | ".join(_escape_cell(value) for value in row) + " |" for row in table.rows[:max_rows]]
    lines = [header, divider, *rows]
    if table.total_rows > min(len(table.rows), max_rows):
        lines.append(f"\n_Showing {min(len(table.rows), max_rows)} of {table.total_rows} rows._")
    return "\n".join(lines)


def _refs(evidence_ids: list[str]) -> str:
    return f" _[{', '.join(evidence_ids)}]_" if evidence_ids else ""


def report_to_markdown(report: ReportContent) -> str:
    overview = report.dataset_overview
    lines: list[str] = [
        f"# {report.title}",
        "",
        f"**Question:** {report.question}",
        "",
        f"**Dataset:** {overview.name} — {overview.rows:,} rows × {overview.columns} columns · "
        f"data quality score {overview.quality_score}/100",
        "",
        "## Executive summary",
        "",
        report.executive_summary,
        "",
    ]
    if report.key_metrics:
        lines += ["## Key metrics", "", "| Metric | Value | Context | Source |", "| --- | --- | --- | --- |"]
        for metric in report.key_metrics:
            lines.append(
                f"| {_escape_cell(metric.label)} | {_escape_cell(metric.value)} | "
                f"{_escape_cell(metric.context)} | {', '.join(metric.evidence_ids)} |"
            )
        lines.append("")
    if report.findings:
        lines += ["## Findings", ""]
        for index, finding in enumerate(report.findings, 1):
            lines += [
                f"### {index}. {finding.title}",
                "",
                f"{finding.detail}{_refs(finding.evidence_ids)}",
                "",
                f"_Significance: {finding.significance}_",
                "",
            ]
    if report.anomalies:
        lines += ["## Anomalies", ""]
        lines += [f"- **{item.title}** — {item.detail}{_refs(item.evidence_ids)}" for item in report.anomalies]
        lines.append("")
    if report.data_quality:
        lines += ["## Data quality", ""] + [f"- {note}" for note in report.data_quality] + [""]
    if report.recommendations:
        lines += ["## Recommendations", ""]
        for index, item in enumerate(report.recommendations, 1):
            lines.append(f"{index}. **{item.action}** ({item.priority} priority) — {item.rationale}")
        lines.append("")
    if report.limitations:
        lines += ["## Limitations", ""] + [f"- {note}" for note in report.limitations] + [""]

    lines += ["## Methodology", ""]
    if report.plan:
        lines += ["**Plan**", ""] + [f"{index}. {step}" for index, step in enumerate(report.plan, 1)] + [""]
    lines += [
        "Every figure above was computed by a deterministic analysis tool. The computations are "
        "listed below with the ids used as references in this report.",
        "",
    ]
    for record in report.methodology:
        lines += [f"### {record.id} — {record.label}", "", record.summary, ""]
        if record.table:
            lines += [table_to_markdown(record.table), ""]
        lines += [f"> {note}" for note in record.notes]
        if record.notes:
            lines.append("")

    verification = report.verification
    status = "All figures verified" if verification.status == "verified" else "Partially verified"
    lines += [
        "## Verification",
        "",
        f"**{status}.** {verification.numbers_checked} figures were checked against computed results.",
    ]
    if verification.unverified_numbers:
        lines.append(f"Unverified: {', '.join(verification.unverified_numbers)}.")
    lines += ["", f"_Generated {report.generated_at:%Y-%m-%d %H:%M} UTC with {report.model}._", ""]
    return "\n".join(lines)
