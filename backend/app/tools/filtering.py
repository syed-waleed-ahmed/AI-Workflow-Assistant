"""Structured row filtering and calculated columns.

This replaces the original `filter_rows` tool, which passed a model-written string to
`DataFrame.query()`. Conditions are now data — a column, an operator from a fixed list and a
value — and are applied with ordinary pandas comparisons.
"""

from __future__ import annotations

from typing import Any, Literal

import pandas as pd
from pydantic import BaseModel, Field

from app.tools.expressions import evaluate_expression
from app.tools.types import ToolInputError, ToolResult
from app.utils.dataframe_utils import frame_to_table, pct, require_columns

FilterOp = Literal[
    "eq", "ne", "gt", "gte", "lt", "lte", "in", "not_in", "between",
    "contains", "starts_with", "ends_with", "is_null", "not_null",
]  # fmt: skip
FilterValue = str | float | int | bool | list[str | float | int] | None

MAX_FILTERS = 8
MAX_DERIVED = 4


class Filter(BaseModel):
    column: str
    op: FilterOp
    value: FilterValue = Field(
        default=None,
        description="Comparison value. A list for in/not_in, [low, high] for between. Omit for is_null/not_null.",
    )


class Derived(BaseModel):
    name: str = Field(description="Name of the new column.")
    expression: str = Field(
        description="Arithmetic over numeric columns using + - * / and numbers, e.g. `price * quantity`. "
        "Wrap column names containing spaces in backticks."
    )


def _coerce(series: pd.Series, value: Any, column: str) -> Any:
    """Convert a filter value to the column's type, with a readable error when it does not fit."""
    try:
        if pd.api.types.is_datetime64_any_dtype(series):
            return pd.Timestamp(value)
        if pd.api.types.is_bool_dtype(series):
            if isinstance(value, str):
                return value.strip().lower() in ("true", "1", "yes")
            return bool(value)
        if pd.api.types.is_numeric_dtype(series):
            return float(value)
    except (ValueError, TypeError) as exc:
        raise ToolInputError(f"Value {value!r} does not match the type of column '{column}' ({series.dtype}).") from exc
    return str(value).strip().casefold()


def _mask(df: pd.DataFrame, condition: Filter) -> pd.Series:
    require_columns(df, [condition.column])
    series = df[condition.column]
    op, value = condition.op, condition.value

    if op == "is_null":
        return series.isna()
    if op == "not_null":
        return series.notna()
    if value is None:
        raise ToolInputError(f"Filter '{op}' on '{condition.column}' needs a value.")

    is_text = not (
        pd.api.types.is_numeric_dtype(series)
        or pd.api.types.is_datetime64_any_dtype(series)
        or pd.api.types.is_bool_dtype(series)
    )
    # Text comparisons ignore case and surrounding whitespace.
    left = series.astype("string").str.strip().str.casefold() if is_text else series

    if op in ("in", "not_in"):
        values = value if isinstance(value, list) else [value]
        mask = left.isin([_coerce(series, item, condition.column) for item in values])
        return ~mask & series.notna() if op == "not_in" else mask
    if op == "between":
        if not isinstance(value, list) or len(value) != 2:
            raise ToolInputError("Filter 'between' needs a value of [low, high].")
        low, high = (_coerce(series, item, condition.column) for item in value)
        return (left >= low) & (left <= high)
    if isinstance(value, list):
        raise ToolInputError(f"Filter '{op}' takes a single value, not a list.")

    if op in ("contains", "starts_with", "ends_with"):
        text = series.astype("string").str.casefold()
        needle = str(value).casefold()
        if op == "contains":
            return text.str.contains(needle, regex=False).fillna(False).astype(bool)
        if op == "starts_with":
            return text.str.startswith(needle).fillna(False).astype(bool)
        return text.str.endswith(needle).fillna(False).astype(bool)

    target = _coerce(series, value, condition.column)
    if op == "eq":
        return (left == target).fillna(False).astype(bool)
    if op == "ne":
        return ((left != target) & series.notna()).fillna(False).astype(bool)
    if is_text:
        raise ToolInputError(f"Filter '{op}' is only supported on numeric and date columns.")
    comparisons = {"gt": left > target, "gte": left >= target, "lt": left < target, "lte": left <= target}
    return comparisons[op].fillna(False).astype(bool)


def apply_filters(df: pd.DataFrame, filters: list[Filter] | None) -> pd.DataFrame:
    """Return the rows of `df` matching every condition."""
    if not filters:
        return df
    if len(filters) > MAX_FILTERS:
        raise ToolInputError(f"At most {MAX_FILTERS} filters are supported per call.")
    mask = pd.Series(True, index=df.index)
    for condition in filters:
        mask &= _mask(df, condition)
    return df[mask]


def apply_derived(df: pd.DataFrame, derived: list[Derived] | None) -> pd.DataFrame:
    """Return a copy of `df` with the calculated columns added."""
    if not derived:
        return df
    if len(derived) > MAX_DERIVED:
        raise ToolInputError(f"At most {MAX_DERIVED} calculated columns are supported per call.")
    out = df.copy()
    for item in derived:
        name = item.name.strip()
        if not name or len(name) > 60:
            raise ToolInputError("Calculated column names must be 1-60 characters long.")
        if name in df.columns:
            raise ToolInputError(f"Calculated column '{name}' would overwrite an existing column.")
        out[name] = evaluate_expression(out, item.expression)
    return out


def prepare(df: pd.DataFrame, filters: list[Filter] | None, derived: list[Derived] | None = None) -> pd.DataFrame:
    """Add calculated columns, then filter (so filters may reference calculated columns)."""
    return apply_filters(apply_derived(df, derived), filters)


def describe_filters(filters: list[Filter] | None) -> str:
    if not filters:
        return ""
    parts = [f"{f.column} {f.op}" + ("" if f.op in ("is_null", "not_null") else f" {f.value}") for f in filters]
    return " where " + " and ".join(parts)


def filter_rows(
    df: pd.DataFrame,
    filters: list[Filter] | None = None,
    derived: list[Derived] | None = None,
    columns: list[str] | None = None,
    sort_by: str | None = None,
    descending: bool = True,
    limit: int = 20,
) -> ToolResult:
    """Return the rows matching `filters`, optionally sorted and restricted to some columns."""
    limit = max(1, min(limit, 50))
    matched = prepare(df, filters, derived)
    if sort_by:
        require_columns(matched, [sort_by])
        matched = matched.sort_values(sort_by, ascending=not descending, na_position="last")
    view = matched
    if columns:
        require_columns(matched, columns)
        view = matched[columns]
    elif matched.shape[1] > 12:
        view = matched.iloc[:, :12]
    return ToolResult(
        summary=f"{len(matched)} of {len(df)} rows match{describe_filters(filters)}.",
        scalars={
            "matched_rows": len(matched),
            "total_rows": len(df),
            "matched_pct": pct(len(matched), len(df)),
        },
        table=frame_to_table(view, max_rows=limit, total_rows=len(matched)),
        notes=["Only the first 12 columns are shown."] if view.shape[1] < matched.shape[1] and not columns else [],
    )
