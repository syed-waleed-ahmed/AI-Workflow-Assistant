"""Dataset profiling: dimensions, column classification, summary statistics and data quality."""

from __future__ import annotations

from typing import Any

import pandas as pd

from app.utils.dataframe_utils import clean_number, pct, to_scalar

PROFILE_VERSION = 1
MAX_PROFILED_COLUMNS = 200
_ID_NAME_HINTS = ("id", "uuid", "guid", "key", "code", "sku", "number", "no")


def classify_column(name: str, series: pd.Series, row_count: int) -> str:
    """Assign a semantic kind used by the UI and by the agent to pick suitable analyses.

    Kinds: numeric, datetime, boolean, categorical, text, identifier, constant, empty.
    """
    non_null = int(series.notna().sum())
    if non_null == 0:
        return "empty"
    unique = int(series.nunique(dropna=True))
    if unique == 1:
        return "constant"
    if pd.api.types.is_bool_dtype(series):
        return "boolean"
    if pd.api.types.is_datetime64_any_dtype(series):
        return "datetime"

    lowered = name.lower().replace("-", "_").replace(" ", "_")
    looks_like_id = any(lowered == hint or lowered.endswith("_" + hint) for hint in _ID_NAME_HINTS)
    all_unique = unique == non_null

    if pd.api.types.is_numeric_dtype(series):
        # Integer keys (order_id, customer_id) are labels, not quantities: averaging or
        # correlating them is meaningless, so they are kept out of numeric analyses.
        if pd.api.types.is_integer_dtype(series) and looks_like_id:
            return "identifier"
        return "numeric"
    # A text column whose values never repeat labels rows rather than grouping them: a key if
    # it is named like one (or is short and the table is big enough to judge), free text otherwise.
    if all_unique:
        short = series.astype("string").str.len().mean() <= 40
        return "identifier" if looks_like_id or (row_count >= 20 and short) else "text"
    if unique <= 50 or unique <= 0.05 * non_null:
        return "categorical"
    return "text"


def _column_profile(name: str, series: pd.Series, row_count: int) -> dict[str, Any]:
    non_null = int(series.notna().sum())
    kind = classify_column(name, series, row_count)
    info: dict[str, Any] = {
        "name": name,
        "dtype": str(series.dtype),
        "kind": kind,
        "non_null": non_null,
        "missing": row_count - non_null,
        "missing_pct": pct(row_count - non_null, row_count) or 0.0,
        "unique": int(series.nunique(dropna=True)),
        "sample_values": [to_scalar(value) for value in series.dropna().head(3).tolist()],
    }
    if non_null == 0:
        return info
    if kind == "numeric":
        values = series.astype("float64")
        info["stats"] = {
            "min": clean_number(values.min()),
            "max": clean_number(values.max()),
            "mean": clean_number(values.mean()),
            "median": clean_number(values.median()),
            "std": clean_number(values.std()) if non_null > 1 else None,
            "sum": clean_number(values.sum()),
        }
    elif kind == "datetime":
        info["stats"] = {"min": to_scalar(series.min()), "max": to_scalar(series.max())}
    elif kind in ("categorical", "boolean", "constant"):
        counts = series.value_counts(dropna=True).head(8)
        info["top_values"] = [{"value": to_scalar(value), "count": int(count)} for value, count in counts.items()]
    return info


def _quality(df: pd.DataFrame, columns: list[dict[str, Any]], duplicate_rows: int) -> dict[str, Any]:
    """Heuristic data-quality assessment: a 0-100 score plus the issues that reduced it."""
    rows = len(df)
    cells = max(rows * max(df.shape[1], 1), 1)
    missing_cells = int(df.isna().sum().sum())
    issues: list[dict[str, Any]] = []

    for column in columns:
        if column["kind"] == "empty":
            issues.append({"severity": "high", "column": column["name"], "message": "Column has no values."})
        elif column["missing_pct"] >= 50:
            issues.append(
                {
                    "severity": "high",
                    "column": column["name"],
                    "message": f"{column['missing_pct']}% of values are missing.",
                }
            )
        elif column["missing_pct"] >= 5:
            issues.append(
                {
                    "severity": "medium",
                    "column": column["name"],
                    "message": f"{column['missing_pct']}% of values are missing.",
                }
            )
        if column["kind"] == "constant":
            issues.append(
                {
                    "severity": "low",
                    "column": column["name"],
                    "message": "Column holds a single value and carries no information.",
                }
            )
    if duplicate_rows:
        issues.append(
            {
                "severity": "medium" if duplicate_rows / max(rows, 1) >= 0.01 else "low",
                "column": None,
                "message": f"{duplicate_rows} fully duplicated rows ({pct(duplicate_rows, rows)}%).",
            }
        )

    missing_penalty = min(45.0, 100.0 * missing_cells / cells * 1.5)
    duplicate_penalty = min(20.0, 100.0 * duplicate_rows / max(rows, 1))
    structure_penalty = min(15.0, 5.0 * sum(1 for c in columns if c["kind"] in ("constant", "empty")))
    score = max(0, round(100 - missing_penalty - duplicate_penalty - structure_penalty))
    return {
        "score": score,
        "missing_cells": missing_cells,
        "missing_cells_pct": pct(missing_cells, cells) or 0.0,
        "issues": issues,
    }


def profile_dataframe(df: pd.DataFrame, ingest_notes: list[str] | None = None) -> dict[str, Any]:
    """Build the profile stored with a dataset and shown in the dataset workspace."""
    rows = len(df)
    columns = [_column_profile(str(name), df[name], rows) for name in list(df.columns)[:MAX_PROFILED_COLUMNS]]
    duplicate_rows = int(df.duplicated().sum()) if rows else 0
    kinds: dict[str, int] = {}
    for column in columns:
        kinds[column["kind"]] = kinds.get(column["kind"], 0) + 1
    return {
        "version": PROFILE_VERSION,
        "row_count": rows,
        "column_count": int(df.shape[1]),
        "memory_bytes": int(df.memory_usage(deep=True).sum()),
        "duplicate_rows": duplicate_rows,
        "kind_counts": kinds,
        "columns": columns,
        "quality": _quality(df, columns, duplicate_rows),
        "ingest_notes": ingest_notes or [],
    }
