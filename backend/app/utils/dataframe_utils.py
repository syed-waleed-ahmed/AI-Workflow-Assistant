"""Helpers for turning pandas/numpy values into JSON-safe, consistently rounded Python values."""

from __future__ import annotations

import math
from datetime import date, datetime
from typing import Any

import numpy as np
import pandas as pd

from app.tools.types import Scalar, Table, ToolInputError

MAX_CELL_CHARS = 120


def clean_number(value: float | int, digits: int = 4) -> int | float | None:
    """Round floats for display; NaN/inf become None so results stay valid JSON."""
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int | np.integer):
        return int(value)
    number = float(value)
    if math.isnan(number) or math.isinf(number):
        return None
    if number.is_integer() and abs(number) < 1e15:
        return int(number)
    return round(number, digits)


def to_scalar(value: Any, digits: int = 4) -> Scalar:
    """Convert one cell to a JSON-safe scalar."""
    if value is None or value is pd.NA or value is pd.NaT:
        return None
    if isinstance(value, bool | np.bool_):
        return bool(value)
    if isinstance(value, int | float | np.integer | np.floating):
        return clean_number(value, digits)  # type: ignore[arg-type]
    if isinstance(value, pd.Timestamp | datetime):
        stamp = pd.Timestamp(value)
        if stamp is pd.NaT:
            return None
        if stamp.hour == stamp.minute == stamp.second == 0:
            return stamp.strftime("%Y-%m-%d")
        return stamp.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, pd.Period):
        return str(value)
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    text = str(value)
    return text if len(text) <= MAX_CELL_CHARS else text[: MAX_CELL_CHARS - 1] + "…"


def frame_to_table(df: pd.DataFrame, max_rows: int = 50, total_rows: int | None = None) -> Table:
    """Convert a DataFrame to a `Table`, keeping at most `max_rows` rows."""
    total = len(df) if total_rows is None else total_rows
    head = df.head(max_rows)
    rows = [[to_scalar(value) for value in record] for record in head.itertuples(index=False, name=None)]
    return Table(
        columns=[str(column) for column in df.columns],
        rows=rows,
        total_rows=total,
        truncated=total > len(rows),
    )


def require_columns(df: pd.DataFrame, columns: list[str]) -> None:
    """Raise a model-readable error naming the valid columns when one is unknown."""
    missing = [column for column in columns if column not in df.columns]
    if missing:
        available = ", ".join(str(column) for column in list(df.columns)[:40])
        raise ToolInputError(f"Unknown column(s) {missing}. Available columns: {available}")


def require_numeric(df: pd.DataFrame, column: str) -> pd.Series:
    require_columns(df, [column])
    series = df[column]
    if pd.api.types.is_bool_dtype(series):
        return series.astype("float64")
    if not pd.api.types.is_numeric_dtype(series):
        raise ToolInputError(f"Column '{column}' is not numeric (type: {series.dtype}). Choose a numeric column.")
    return series


def require_datetime(df: pd.DataFrame, column: str) -> pd.Series:
    require_columns(df, [column])
    series = df[column]
    if not pd.api.types.is_datetime64_any_dtype(series):
        raise ToolInputError(f"Column '{column}' is not a date column (type: {series.dtype}). Choose a date column.")
    return series


def numeric_columns(df: pd.DataFrame) -> list[str]:
    return [
        str(column)
        for column in df.columns
        if pd.api.types.is_numeric_dtype(df[column]) and not pd.api.types.is_bool_dtype(df[column])
    ]


def pct(part: float, whole: float) -> float | None:
    if not whole:
        return None
    return round(100.0 * part / whole, 2)
