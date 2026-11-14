"""Starter questions for a dataset, derived deterministically from its profile."""

from __future__ import annotations

from typing import Any

_METRIC_HINTS = (
    "revenue",
    "sales",
    "amount",
    "total",
    "profit",
    "income",
    "spend",
    "cost",
    "price",
    "value",
    "qty",
    "quantity",
    "units",
)


def _pick_metric(numeric: list[str]) -> str | None:
    for hint in _METRIC_HINTS:
        for name in numeric:
            if hint in name.lower():
                return name
    return numeric[0] if numeric else None


def suggest_questions(profile: dict[str, Any]) -> list[str]:
    columns = profile.get("columns", [])
    by_kind: dict[str, list[str]] = {}
    for column in columns:
        by_kind.setdefault(column["kind"], []).append(column["name"])
    numeric = by_kind.get("numeric", [])
    categorical = by_kind.get("categorical", [])
    dates = by_kind.get("datetime", [])
    metric = _pick_metric(numeric)

    questions: list[str] = []
    if metric and categorical:
        questions.append(
            f"Compare {metric} across {categorical[0]}: which groups lead, which underperform, and by how much?"
        )
    if metric and dates:
        questions.append(f"How has {metric} changed over time? Identify the trend, growth and any unusual periods.")
    if metric and dates and categorical:
        questions.append(f"Which {categorical[0]} groups are growing or declining in {metric} over time?")
    if metric and len(categorical) >= 2:
        questions.append(
            f"Break down {metric} by {categorical[0]} and {categorical[1]} and highlight the strongest combinations."
        )
    if len(numeric) >= 2 and metric:
        questions.append(f"Which numeric factors are most strongly related to {metric}?")
    if metric:
        questions.append(f"Are there outliers or anomalies in {metric} that I should look into?")
    if not metric and categorical:
        questions.append(f"What is the distribution of records across {categorical[0]}?")
    questions.append("Give me an overview of this dataset, its key metrics and its data quality.")
    return questions[:5]
