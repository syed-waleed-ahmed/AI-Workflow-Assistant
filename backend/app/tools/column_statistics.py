"""Descriptive statistics, frequency distributions and histograms."""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

from app.tools.filtering import Filter, apply_filters, describe_filters
from app.tools.types import Chart, ChartSeries, Table, ToolInputError, ToolResult
from app.utils.dataframe_utils import (
    clean_number,
    pct,
    require_columns,
    require_numeric,
    to_scalar,
)

MAX_STAT_COLUMNS = 10


def column_statistics(df: pd.DataFrame, columns: list[str], filters: list[Filter] | None = None) -> ToolResult:
    """Summary statistics for up to 10 columns (numeric and non-numeric)."""
    if not columns:
        raise ToolInputError("Provide at least one column.")
    if len(columns) > MAX_STAT_COLUMNS:
        raise ToolInputError(f"At most {MAX_STAT_COLUMNS} columns per call.")
    require_columns(df, columns)
    data = apply_filters(df, filters)

    header = [
        "column", "count", "missing", "unique", "mean", "median", "mode", "std", "variance",
        "min", "p25", "p75", "max", "skew",
    ]  # fmt: skip
    rows: list[list[object]] = []
    for name in columns:
        series = data[name]
        valid = series.dropna()
        mode = valid.mode()
        base: list[object] = [name, len(valid), int(series.isna().sum()), int(valid.nunique())]
        is_numeric = pd.api.types.is_numeric_dtype(series) and not pd.api.types.is_bool_dtype(series)
        if is_numeric and len(valid):
            values = valid.astype("float64")
            many = len(values) > 1
            rows.append(
                [
                    *base,
                    clean_number(values.mean()),
                    clean_number(values.median()),
                    to_scalar(mode.iloc[0]) if len(mode) else None,
                    clean_number(values.std()) if many else None,
                    clean_number(values.var()) if many else None,
                    clean_number(values.min()),
                    clean_number(values.quantile(0.25)),
                    clean_number(values.quantile(0.75)),
                    clean_number(values.max()),
                    clean_number(values.skew()) if len(values) > 2 else None,
                ]
            )
        else:
            lowest = to_scalar(valid.min()) if len(valid) and pd.api.types.is_datetime64_any_dtype(series) else None
            highest = to_scalar(valid.max()) if lowest is not None else None
            rows.append(
                [
                    *base,
                    None,
                    None,
                    to_scalar(mode.iloc[0]) if len(mode) else None,
                    None,
                    None,
                    lowest,
                    None,
                    None,
                    highest,
                    None,
                ]
            )

    return ToolResult(
        summary=f"Summary statistics for {', '.join(columns)} over {len(data)} rows{describe_filters(filters)}.",
        scalars={"rows_analysed": len(data)},
        table=Table(columns=header, rows=rows, total_rows=len(rows)),  # type: ignore[arg-type]
    )


def value_counts(df: pd.DataFrame, column: str, top_n: int = 10, filters: list[Filter] | None = None) -> ToolResult:
    """Frequency distribution of a column's values."""
    require_columns(df, [column])
    top_n = max(1, min(top_n, 30))
    data = apply_filters(df, filters)
    series = data[column]
    counts = series.value_counts(dropna=True)
    total = int(counts.sum())
    shown = counts.head(top_n)

    rows: list[list[object]] = [
        [to_scalar(value), int(count), pct(int(count), total)] for value, count in shown.items()
    ]
    notes: list[str] = []
    missing = int(series.isna().sum())
    if missing:
        notes.append(f"{missing} rows have no value for '{column}' and are excluded.")
    if len(counts) > len(shown):
        other = total - int(shown.sum())
        notes.append(f"{len(counts) - len(shown)} further values account for {other} rows ({pct(other, total)}%).")

    chart_data = [{column: str(row[0]), "count": row[1]} for row in rows]  # type: ignore[dict-item]
    chart = Chart(
        # A pie only reads well for a handful of slices that together make up the whole.
        type="pie" if len(counts) <= 5 and len(counts) == len(shown) else "bar",
        title=f"Rows by {column}",
        x_key=column,
        x_label=column,
        y_label="Rows",
        series=[ChartSeries(key="count", label="Rows")],
        data=chart_data,  # type: ignore[arg-type]
    )
    top = rows[0] if rows else None
    return ToolResult(
        summary=(
            f"'{column}' has {len(counts)} distinct values over {total} rows{describe_filters(filters)}."
            + (f" Most frequent: {top[0]} ({top[1]} rows, {top[2]}%)." if top else "")
        ),
        scalars={"distinct_values": len(counts), "rows_counted": total},
        table=Table(
            columns=[column, "count", "pct_of_rows"],
            rows=rows,  # type: ignore[arg-type]
            total_rows=len(counts),
            truncated=len(counts) > len(shown),
        ),
        chart=chart if rows else None,
        notes=notes,
    )


def _format_edge(value: float) -> str:
    if abs(value) >= 1000 or float(value).is_integer():
        return f"{value:,.0f}"
    return f"{value:,.2f}"


def distribution(
    df: pd.DataFrame, column: str, bins: int | None = None, filters: list[Filter] | None = None
) -> ToolResult:
    """Histogram and shape statistics (percentiles, skewness, kurtosis) for a numeric column."""
    values = require_numeric(apply_filters(df, filters), column).dropna().astype("float64")
    if len(values) < 2:
        raise ToolInputError(f"Column '{column}' has fewer than 2 numeric values to analyse.")
    if bins is None:
        bins = math.ceil(math.log2(len(values)) + 1)  # Sturges' rule
    bins = max(3, min(bins, 30))

    counts, edges = np.histogram(values, bins=bins)
    rows: list[list[object]] = []
    chart_data: list[dict[str, object]] = []
    for index, count in enumerate(counts):
        label = f"{_format_edge(edges[index])} – {_format_edge(edges[index + 1])}"
        rows.append([label, int(count), pct(int(count), len(values))])
        chart_data.append({"bin": label, "count": int(count)})

    skew = clean_number(values.skew()) if len(values) > 2 else None
    kurtosis = clean_number(values.kurt()) if len(values) > 3 else None
    shape = "roughly symmetric"
    if skew is not None and abs(float(skew)) >= 1:
        shape = "strongly right-skewed" if float(skew) > 0 else "strongly left-skewed"
    elif skew is not None and abs(float(skew)) >= 0.5:
        shape = "moderately right-skewed" if float(skew) > 0 else "moderately left-skewed"

    return ToolResult(
        summary=f"Distribution of '{column}' over {len(values)} values is {shape}.",
        scalars={
            "count": len(values),
            "mean": clean_number(values.mean()),
            "median": clean_number(values.median()),
            "std": clean_number(values.std()),
            "min": clean_number(values.min()),
            "p5": clean_number(values.quantile(0.05)),
            "p25": clean_number(values.quantile(0.25)),
            "p75": clean_number(values.quantile(0.75)),
            "p95": clean_number(values.quantile(0.95)),
            "max": clean_number(values.max()),
            "skewness": skew,
            "kurtosis": kurtosis,
        },
        table=Table(columns=["range", "count", "pct_of_values"], rows=rows, total_rows=len(rows)),  # type: ignore[arg-type]
        chart=Chart(
            type="histogram",
            title=f"Distribution of {column}",
            x_key="bin",
            x_label=column,
            y_label="Rows",
            series=[ChartSeries(key="count", label="Rows")],
            data=chart_data,  # type: ignore[arg-type]
        ),
    )
