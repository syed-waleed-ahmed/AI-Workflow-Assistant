"""Report retrieval and export (Markdown, PDF, Excel, CSV)."""

from __future__ import annotations

import csv
import io
import re
import uuid
from dataclasses import dataclass
from pathlib import Path

from fpdf import FPDF
from fpdf.enums import XPos, YPos
from openpyxl import Workbook
from openpyxl.styles import Font
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.exceptions import NotFoundError, UnprocessableError
from app.models import Report
from app.schemas.report import EvidenceRecord, ReportContent, ReportOut, ReportSummary
from app.tools.types import Chart, Scalar, Table
from app.utils.markdown_utils import report_to_markdown

_FONT_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"
# A cell beginning with one of these is interpreted as a formula by spreadsheet applications.
_FORMULA_TRIGGERS = ("=", "+", "-", "@", "\t", "\r")
_INK = (24, 24, 27)
_MUTED = (113, 113, 122)
_ACCENT = (37, 99, 235)
_SERIES_COLOURS = [(37, 99, 235), (234, 88, 12), (22, 163, 74), (147, 51, 234), (219, 39, 119), (8, 145, 178)]


@dataclass
class ExportFile:
    content: bytes
    media_type: str
    filename: str


def get_report(db: Session, user_id: uuid.UUID, report_id: uuid.UUID) -> Report:
    """Fetch a report the user owns. Someone else's report is reported as not found."""
    report = db.scalar(select(Report).where(Report.id == report_id, Report.user_id == user_id))
    if report is None:
        raise NotFoundError("Report not found.")
    return report


def list_reports(db: Session, user_id: uuid.UUID, *, limit: int, offset: int) -> tuple[list[Report], int]:
    total = int(db.scalar(select(func.count()).select_from(Report).where(Report.user_id == user_id)) or 0)
    rows = db.scalars(
        select(Report).where(Report.user_id == user_id).order_by(Report.created_at.desc()).limit(limit).offset(offset)
    ).all()
    return list(rows), total


def delete_report(db: Session, report: Report) -> None:
    db.delete(report)
    db.commit()


def to_summary(report: Report) -> ReportSummary:
    return ReportSummary(
        id=str(report.id),
        analysis_id=str(report.analysis_id),
        turn=report.turn,
        title=report.title,
        dataset_name=report.dataset_name,
        question=report.question,
        executive_summary=str(report.content.get("executive_summary", "")),
        created_at=report.created_at,
    )


def to_out(report: Report) -> ReportOut:
    return ReportOut(**to_summary(report).model_dump(), content=ReportContent.model_validate(report.content))


def neutralise_formula(value: Scalar) -> Scalar:
    """Stop spreadsheet applications from executing a text cell as a formula.

    Dataset values are attacker-controlled: a cell such as `=HYPERLINK(...)` or `=cmd|...` would
    otherwise run when an exported file is opened. Text that starts with a trigger character is
    prefixed with an apostrophe, which spreadsheets treat as "literal text".
    """
    if isinstance(value, str) and value.startswith(_FORMULA_TRIGGERS):
        return "'" + value
    return value


def _slug(title: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:60]
    return slug or "report"


def _evidence(content: ReportContent, evidence_id: str) -> EvidenceRecord:
    record = next((item for item in content.methodology if item.id == evidence_id), None)
    if record is None or record.table is None:
        raise NotFoundError("That result has no table to export.")
    return record


def _table_to_csv(table: Table) -> bytes:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow([neutralise_formula(column) for column in table.columns])
    for row in table.rows:
        writer.writerow([neutralise_formula(value) for value in row])
    # The BOM makes Excel open the file as UTF-8.
    return ("﻿" + buffer.getvalue()).encode("utf-8")


def _to_xlsx(content: ReportContent) -> bytes:
    workbook = Workbook()
    bold = Font(bold=True)

    summary = workbook.active
    assert summary is not None
    summary.title = "Summary"
    rows: list[list[Scalar]] = [
        ["Report", content.title],
        ["Question", content.question],
        ["Dataset", content.dataset_overview.name],
        ["Rows", content.dataset_overview.rows],
        ["Columns", content.dataset_overview.columns],
        ["Generated (UTC)", content.generated_at.strftime("%Y-%m-%d %H:%M")],
        ["Verification", content.verification.status.replace("_", " ")],
        [],
        ["Executive summary", content.executive_summary],
        [],
        ["Key metric", "Value", "Context", "Sources"],
    ]
    rows += [[m.label, m.value, m.context, ", ".join(m.evidence_ids)] for m in content.key_metrics]
    rows += [[], ["Finding", "Detail", "Significance", "Sources"]]
    rows += [[f.title, f.detail, f.significance, ", ".join(f.evidence_ids)] for f in content.findings]
    rows += [[], ["Recommendation", "Rationale", "Priority"]]
    rows += [[r.action, r.rationale, r.priority] for r in content.recommendations]
    for row in rows:
        summary.append([neutralise_formula(value) for value in row])
    for cell in summary["A"]:
        cell.font = bold
    summary.column_dimensions["A"].width = 28
    summary.column_dimensions["B"].width = 70

    for record in content.methodology:
        if record.table is None:
            continue
        sheet = workbook.create_sheet(title=record.id)
        sheet.append([neutralise_formula(f"{record.id} — {record.label}")])
        sheet.append([neutralise_formula(record.summary)])
        sheet.append([])
        sheet.append([neutralise_formula(column) for column in record.table.columns])
        for cell in sheet[4]:
            cell.font = bold
        for row in record.table.rows:
            sheet.append([neutralise_formula(value) for value in row])
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


class _ReportPDF(FPDF):
    def __init__(self) -> None:
        super().__init__(format="A4")
        self.set_auto_page_break(auto=True, margin=18)
        self.set_margins(18, 18, 18)
        self.add_font("DejaVu", "", str(_FONT_DIR / "DejaVuSans.ttf"))
        self.add_font("DejaVu", "B", str(_FONT_DIR / "DejaVuSans-Bold.ttf"))
        self.add_font("DejaVu", "I", str(_FONT_DIR / "DejaVuSans-Oblique.ttf"))

    def footer(self) -> None:
        self.set_y(-12)
        self.set_font("DejaVu", "", 8)
        self.set_text_color(*_MUTED)
        self.cell(0, 6, f"AI Workflow Assistant · page {self.page_no()}", align="C")

    def heading(self, text: str) -> None:
        self.ln(3)
        self.set_font("DejaVu", "B", 13)
        self.set_text_color(*_INK)
        self.multi_cell(0, 7, text, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        self.ln(1)

    def paragraph(self, text: str, *, style: str = "", size: float = 10, colour: tuple[int, int, int] = _INK) -> None:
        self.set_font("DejaVu", style, size)
        self.set_text_color(*colour)
        self.multi_cell(0, 5.2, text, new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    def bullet(self, text: str) -> None:
        self.set_font("DejaVu", "", 10)
        self.set_text_color(*_INK)
        self.cell(5, 5.2, "•")
        self.multi_cell(0, 5.2, text, new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    def data_table(self, table: Table, max_rows: int = 20, max_columns: int = 7) -> None:
        columns = table.columns[:max_columns]
        rows = [row[:max_columns] for row in table.rows[:max_rows]]
        self.set_font("DejaVu", "", 8)
        self.set_text_color(*_INK)
        with self.table(
            first_row_as_headings=True, line_height=5, text_align="LEFT", borders_layout="HORIZONTAL_LINES"
        ) as pdf_table:
            pdf_table.row([str(column) for column in columns])
            for row in rows:
                pdf_table.row([_format_cell(value) for value in row])
        shown_note = []
        if table.total_rows > len(rows):
            shown_note.append(f"{len(rows)} of {table.total_rows} rows")
        if len(table.columns) > len(columns):
            shown_note.append(f"{len(columns)} of {len(table.columns)} columns")
        if shown_note:
            self.paragraph("Showing " + " and ".join(shown_note) + ".", style="I", size=8, colour=_MUTED)

    def chart(self, chart: Chart) -> None:
        """Draw bar and line charts with vector primitives (no plotting library on the server)."""
        keys = [series.key for series in chart.series][:6]
        points = chart.data[:40]
        values = [float(p[k]) for p in points for k in keys if isinstance(p.get(k), int | float)]  # type: ignore[arg-type]
        if chart.type not in ("bar", "line", "histogram", "pie") or not keys or not values:
            return
        width, height = self.epw, 58.0
        if self.get_y() + height + 22 > self.h - 18:
            self.add_page()
        self.set_font("DejaVu", "B", 9)
        self.set_text_color(*_INK)
        self.multi_cell(0, 5, chart.title, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        left, top = self.l_margin + 14, self.get_y() + 2
        plot_width = width - 16
        low, high = min(0.0, min(values)), max(0.0, max(values))
        span = (high - low) or 1.0

        def _y(value: float) -> float:
            return top + height - (value - low) / span * height

        self.set_draw_color(212, 212, 216)
        self.set_line_width(0.2)
        self.set_font("DejaVu", "", 6.5)
        self.set_text_color(*_MUTED)
        for step in range(5):
            level = low + span * step / 4
            self.line(left, _y(level), left + plot_width, _y(level))
            self.text(self.l_margin, _y(level) + 1, _compact(level))

        slot = plot_width / max(len(points), 1)
        if chart.type == "line":
            self.set_line_width(0.5)
            for index, key in enumerate(keys):
                self.set_draw_color(*_SERIES_COLOURS[index % len(_SERIES_COLOURS)])
                previous: tuple[float, float] | None = None
                for position, point in enumerate(points):
                    value = point.get(key)
                    if not isinstance(value, int | float) or isinstance(value, bool):
                        previous = None
                        continue
                    current = (left + slot * (position + 0.5), _y(float(value)))
                    if previous:
                        self.line(previous[0], previous[1], current[0], current[1])
                    previous = current
        else:
            bar = slot * 0.8 / len(keys)
            for position, point in enumerate(points):
                for index, key in enumerate(keys):
                    value = point.get(key)
                    if not isinstance(value, int | float) or isinstance(value, bool):
                        continue
                    self.set_fill_color(*_SERIES_COLOURS[index % len(_SERIES_COLOURS)])
                    x = left + slot * position + slot * 0.1 + bar * index
                    y = _y(max(float(value), 0.0))
                    self.rect(x, y, bar, abs(_y(float(value)) - _y(0.0)), style="F")

        self.set_text_color(*_MUTED)
        every = max(1, len(points) // 8)
        for position, point in enumerate(points):
            if position % every == 0:
                label = str(point.get(chart.x_key, ""))[:14]
                self.text(left + slot * position + 0.5, top + height + 4, label)
        self.set_y(top + height + 7)
        if len(keys) > 1:
            self.set_font("DejaVu", "", 7)
            for index, series in enumerate(chart.series[: len(keys)]):
                self.set_fill_color(*_SERIES_COLOURS[index % len(_SERIES_COLOURS)])
                self.rect(self.get_x(), self.get_y() + 1.2, 2.5, 2.5, style="F")
                self.set_x(self.get_x() + 3.5)
                self.cell(self.get_string_width(series.label[:28]) + 5, 5, series.label[:28])
            self.ln(6)
        self.ln(2)


def _compact(value: float) -> str:
    magnitude = abs(value)
    if magnitude >= 1e9:
        return f"{value / 1e9:.1f}B"
    if magnitude >= 1e6:
        return f"{value / 1e6:.1f}M"
    if magnitude >= 1e3:
        return f"{value / 1e3:.1f}k"
    return f"{value:.0f}" if magnitude >= 10 or float(value).is_integer() else f"{value:.2f}"


def _format_cell(value: Scalar) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, int):
        return f"{value:,}"
    if isinstance(value, float):
        return f"{value:,.2f}"
    return str(value)[:60]


def _to_pdf(content: ReportContent) -> bytes:
    pdf = _ReportPDF()
    pdf.set_title(content.title)
    pdf.set_creator("AI Workflow Assistant")
    pdf.add_page()

    pdf.set_font("DejaVu", "B", 19)
    pdf.set_text_color(*_INK)
    pdf.multi_cell(0, 9, content.title, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    overview = content.dataset_overview
    pdf.ln(1)
    pdf.paragraph(
        f"{overview.name} · {overview.rows:,} rows × {overview.columns} columns · "
        f"generated {content.generated_at:%Y-%m-%d %H:%M} UTC",
        size=9,
        colour=_MUTED,
    )
    pdf.ln(2)
    pdf.paragraph(f"Question: {content.question}", style="I", size=10, colour=_MUTED)

    pdf.heading("Executive summary")
    pdf.paragraph(content.executive_summary)

    if content.key_metrics:
        pdf.heading("Key metrics")
        for metric in content.key_metrics:
            pdf.set_font("DejaVu", "B", 11)
            pdf.set_text_color(*_ACCENT)
            pdf.multi_cell(0, 6, metric.value, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            detail = metric.label + (f" — {metric.context}" if metric.context else "")
            if metric.evidence_ids:
                detail += f"  [{', '.join(metric.evidence_ids)}]"
            pdf.paragraph(detail, size=9, colour=_MUTED)
            pdf.ln(1)

    if content.findings:
        pdf.heading("Findings")
        for index, finding in enumerate(content.findings, 1):
            pdf.paragraph(f"{index}. {finding.title}", style="B")
            refs = f"  [{', '.join(finding.evidence_ids)}]" if finding.evidence_ids else ""
            pdf.paragraph(finding.detail + refs)
            pdf.paragraph(f"Significance: {finding.significance}", style="I", size=8, colour=_MUTED)
            pdf.ln(2)

    if content.visualizations:
        pdf.heading("Charts")
        for visual in content.visualizations:
            pdf.chart(visual.chart)

    if content.anomalies:
        pdf.heading("Anomalies")
        for anomaly in content.anomalies:
            pdf.bullet(f"{anomaly.title}: {anomaly.detail}")
    if content.data_quality:
        pdf.heading("Data quality")
        for note in content.data_quality:
            pdf.bullet(note)
    if content.recommendations:
        pdf.heading("Recommendations")
        for index, item in enumerate(content.recommendations, 1):
            pdf.paragraph(f"{index}. {item.action} ({item.priority} priority)", style="B")
            pdf.paragraph(item.rationale)
            pdf.ln(1)
    if content.limitations:
        pdf.heading("Limitations")
        for note in content.limitations:
            pdf.bullet(note)

    pdf.heading("Methodology")
    pdf.paragraph(
        "Every figure in this report was computed by a deterministic analysis tool. The computations "
        "are listed below with the ids used as references above.",
        size=9,
        colour=_MUTED,
    )
    for record in content.methodology:
        pdf.ln(2)
        pdf.paragraph(f"{record.id} — {record.label}", style="B", size=9.5)
        pdf.paragraph(record.summary, size=9)
        if record.table and record.table.rows:
            pdf.ln(1)
            pdf.data_table(record.table)
        for note in record.notes:
            pdf.paragraph(note, style="I", size=8, colour=_MUTED)

    pdf.heading("Verification")
    verification = content.verification
    status = "All figures verified." if verification.status == "verified" else "Partially verified."
    pdf.paragraph(f"{status} {verification.numbers_checked} figures were checked against computed results.")
    if verification.unverified_numbers:
        pdf.paragraph("Unverified: " + ", ".join(verification.unverified_numbers) + ".")
    pdf.paragraph(f"Model: {content.model}", size=8, colour=_MUTED)
    return bytes(pdf.output())


def export(report: Report, export_format: str, evidence_id: str | None = None) -> ExportFile:
    content = ReportContent.model_validate(report.content)
    name = _slug(report.title)
    if export_format == "md":
        return ExportFile(report_to_markdown(content).encode("utf-8"), "text/markdown; charset=utf-8", f"{name}.md")
    if export_format == "pdf":
        return ExportFile(_to_pdf(content), "application/pdf", f"{name}.pdf")
    if export_format == "xlsx":
        return ExportFile(
            _to_xlsx(content),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            f"{name}.xlsx",
        )
    if export_format == "csv":
        if not evidence_id:
            raise UnprocessableError("Choose which result table to export.", code="evidence_id_required")
        record = _evidence(content, evidence_id)
        assert record.table is not None
        return ExportFile(_table_to_csv(record.table), "text/csv; charset=utf-8", f"{name}-{record.id.lower()}.csv")
    raise UnprocessableError("Unsupported export format.", code="unsupported_format")
