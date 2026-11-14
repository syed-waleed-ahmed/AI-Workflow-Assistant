"""Outlier detection for a numeric column."""

from __future__ import annotations

from typing import Literal

import pandas as pd

from app.tools.filtering import Filter, apply_filters, describe_filters
from app.tools.types import ToolInputError, ToolResult
from app.utils.dataframe_utils import clean_number, frame_to_table, pct, require_numeric


def outliers(
    df: pd.DataFrame,
    column: str,
    method: Literal["iqr", "zscore"] = "iqr",
    filters: list[Filter] | None = None,
) -> ToolResult:
    """Find unusually low or high values.

    - iqr: outside [Q1 - 1.5 * IQR, Q3 + 1.5 * IQR] (Tukey's fences; robust to skew).
    - zscore: more than 3 standard deviations from the mean (assumes roughly normal data).
    """
    data = apply_filters(df, filters)
    values = require_numeric(data, column).astype("float64")
    valid = values.dropna()
    if len(valid) < 4:
        raise ToolInputError(f"Column '{column}' has only {len(valid)} values — too few to assess outliers.")

    if method == "iqr":
        q1, q3 = float(valid.quantile(0.25)), float(valid.quantile(0.75))
        spread = q3 - q1
        lower, upper = q1 - 1.5 * spread, q3 + 1.5 * spread
        rule = "1.5 × IQR beyond the quartiles"
    else:
        mean, std = float(valid.mean()), float(valid.std())
        lower, upper = mean - 3.0 * std, mean + 3.0 * std
        rule = "more than 3 standard deviations from the mean"

    low_mask = values < lower
    high_mask = values > upper
    flagged = data[low_mask | high_mask]
    count = len(flagged)

    notes: list[str] = []
    if len(valid) < 20:
        notes.append(f"Only {len(valid)} values: outlier rules are unreliable on samples this small.")
    table = None
    if count:
        # Show the most extreme rows first, with the measured column leading.
        distance = (values[flagged.index] - valid.median()).abs()
        ordered = flagged.loc[distance.sort_values(ascending=False).index]
        other_columns = [c for c in ordered.columns if c != column][:7]
        table = frame_to_table(ordered[[column, *other_columns]], max_rows=10, total_rows=count)

    return ToolResult(
        summary=(
            f"{count} outliers in '{column}' out of {len(valid)} values ({pct(count, len(valid))}%)"
            f"{describe_filters(filters)}, using {rule}."
        ),
        scalars={
            "outliers": count,
            "outliers_pct": pct(count, len(valid)),
            "low_outliers": int(low_mask.sum()),
            "high_outliers": int(high_mask.sum()),
            "lower_bound": clean_number(lower),
            "upper_bound": clean_number(upper),
            "median": clean_number(valid.median()),
            "values_checked": len(valid),
        },
        table=table,
        notes=notes,
    )
