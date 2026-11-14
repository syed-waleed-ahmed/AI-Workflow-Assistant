"""Verification of an analysis against the computations that back it.

Two deterministic checks, neither of which relies on the model grading itself:

1. Evidence sufficiency (before the report is written): were results actually computed?
2. Numeric grounding (after the report is written): every number stated in the report's factual
   sections must match a value produced by a tool, a fact from the dataset profile, or a number
   the user wrote in their question. Numbers that match nothing are reported as unverified.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from app.agents.evidence import EvidenceLedger
from app.schemas.report import Anomaly, Finding, KeyMetric, ReportDraft

# 1,234.5 | 12.3% | $4.2M | 1.5k — with an optional magnitude suffix.
_NUMBER = re.compile(
    r"(?<![\w.])[-+−]?\$?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s?"
    r"(%|[kKmMbB](?![a-zA-Z])|thousand|million|billion)?"
)
_DATE_LIKE = re.compile(r"\b\d{4}-\d{1,2}(?:-\d{1,2})?\b|\b\d{4}Q[1-4]\b|\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b")
_EVIDENCE_REF = re.compile(r"\bE\d+\b")
_MULTIPLIERS = {"k": 1e3, "thousand": 1e3, "m": 1e6, "million": 1e6, "b": 1e9, "billion": 1e9}


@dataclass
class StatedNumber:
    text: str
    value: float
    tolerance: float  # half a unit of the last digit shown, scaled by any magnitude suffix
    is_percent: bool


@dataclass
class GroundingResult:
    checked: int = 0
    unverified: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.unverified


def extract_numbers(text: str) -> list[StatedNumber]:
    """Find the numeric claims in a piece of prose, ignoring dates and evidence references."""
    cleaned = _EVIDENCE_REF.sub(" ", _DATE_LIKE.sub(" ", text))
    found: list[StatedNumber] = []
    for match in _NUMBER.finditer(cleaned):
        digits, suffix = match.group(1), (match.group(2) or "").lower()
        raw = digits.replace(",", "")
        decimals = len(raw.split(".")[1]) if "." in raw else 0
        multiplier = _MULTIPLIERS.get(suffix, 1.0)
        value = float(raw) * multiplier
        if match.group(0).lstrip().startswith(("-", "−")):
            value = -value
        found.append(
            StatedNumber(
                text=match.group(0).strip(),
                value=value,
                tolerance=0.5 * 10.0 ** (-decimals) * multiplier,
                is_percent=suffix == "%",
            )
        )
    return found


def _is_trivial(number: StatedNumber) -> bool:
    """Small counts ("top 3", "two regions") and calendar years are not statistical claims."""
    value = abs(number.value)
    is_integer = float(value).is_integer()
    return (is_integer and value <= 12) or (is_integer and not number.is_percent and 1900 <= value <= 2100)


def _collect(value: Any, out: set[float]) -> None:
    if isinstance(value, bool) or value is None:
        return
    if isinstance(value, int | float):
        out.add(float(value))
    elif isinstance(value, str):
        out.update(number.value for number in extract_numbers(value))
    elif isinstance(value, dict):
        for item in value.values():
            _collect(item, out)
    elif isinstance(value, list | tuple):
        for item in value:
            _collect(item, out)


def known_numbers(ledger: EvidenceLedger, profile: dict[str, Any], question: str) -> set[float]:
    """Every number the report is allowed to state."""
    known: set[float] = set()
    for evidence in ledger.successful:
        if evidence.result is None:
            continue
        _collect(evidence.result.model_dump(exclude={"chart"}), known)
        _collect(evidence.arguments, known)
    _collect({key: profile.get(key) for key in ("row_count", "column_count", "duplicate_rows", "quality")}, known)
    for column in profile.get("columns", []):
        _collect({key: column.get(key) for key in ("non_null", "missing", "missing_pct", "unique", "stats")}, known)
    _collect(question, known)
    return known


def _matches(number: StatedNumber, known: set[float]) -> bool:
    # A stated value is grounded when it equals a known value after rounding to the precision
    # shown, or within 0.5% (the model may abbreviate 1,234,567 as "1.23M"). The sign is
    # ignored because prose says "fell 12%" for -12. Fractions may be restated as percentages.
    target = abs(number.value)
    slack = max(number.tolerance * 1.0001, 0.005 * target)
    for candidate in known:
        magnitude = abs(candidate)
        if abs(magnitude - target) <= slack:
            return True
        if number.is_percent and abs(magnitude * 100.0 - target) <= slack:
            return True
    return False


def _factual_texts(draft: ReportDraft) -> list[str]:
    # Recommendations and limitations are advice and caveats, not findings, so they are exempt.
    texts = [draft.title, draft.executive_summary, *draft.data_quality]
    for metric in draft.key_metrics:
        texts += [metric.value, metric.context]
    for finding in draft.findings:
        texts += [finding.title, finding.detail]
    for anomaly in draft.anomalies:
        texts += [anomaly.title, anomaly.detail]
    return texts


def check_grounding(
    draft: ReportDraft, ledger: EvidenceLedger, profile: dict[str, Any], question: str
) -> GroundingResult:
    known = known_numbers(ledger, profile, question)
    result = GroundingResult()
    seen: set[str] = set()
    for text in _factual_texts(draft):
        for number in extract_numbers(text):
            if _is_trivial(number) or number.text in seen:
                continue
            seen.add(number.text)
            result.checked += 1
            if not _matches(number, known):
                result.unverified.append(number.text)
    return result


def check_evidence_references(draft: ReportDraft, ledger: EvidenceLedger) -> ReportDraft:
    """Drop references to evidence ids that do not exist, so provenance links are always real."""
    valid = ledger.ids()
    charts = {item.id for item in ledger.successful if item.result and item.result.chart}
    cited: list[KeyMetric | Finding | Anomaly] = [*draft.key_metrics, *draft.findings, *draft.anomalies]
    for item in cited:
        item.evidence_ids = [ref for ref in item.evidence_ids if ref in valid]
    draft.chart_evidence_ids = list(dict.fromkeys(ref for ref in draft.chart_evidence_ids if ref in charts))
    return draft


def evidence_gaps(ledger: EvidenceLedger) -> str | None:
    """Return a description of what is missing when the evidence cannot support a report."""
    successful = ledger.successful
    if not successful:
        failed = [item for item in ledger.items if not item.ok]
        if failed:
            return (
                "No tool call has succeeded yet. Fix the arguments using the error messages "
                "(check column names and types against the dataset description) and try again."
            )
        return "No analysis has been run yet. Call the tools needed to answer the question."
    return None
