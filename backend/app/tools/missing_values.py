"""Data-quality inspection: missing values, duplicates and uninformative columns."""

from __future__ import annotations

import pandas as pd

from app.tools.dataset_overview import classify_column
from app.tools.types import Chart, ChartSeries, Table, ToolResult
from app.utils.dataframe_utils import pct


def data_quality(df: pd.DataFrame) -> ToolResult:
    """Per-column completeness plus duplicate-row and constant-column checks."""
    rows = len(df)
    records: list[list[object]] = []
    for name in df.columns:
        series = df[name]
        missing = int(series.isna().sum())
        records.append(
            [
                str(name),
                classify_column(str(name), series, rows),
                missing,
                pct(missing, rows) or 0.0,
                int(series.nunique(dropna=True)),
            ]
        )
    records.sort(key=lambda record: record[2], reverse=True)  # type: ignore[arg-type,return-value]

    duplicate_rows = int(df.duplicated().sum()) if rows else 0
    missing_cells = int(df.isna().sum().sum())
    cells = max(rows * max(df.shape[1], 1), 1)
    incomplete_rows = int(df.isna().any(axis=1).sum()) if rows else 0
    constant = [record[0] for record in records if record[1] == "constant"]
    empty = [record[0] for record in records if record[1] == "empty"]
    with_missing = [record for record in records if record[2]]

    notes: list[str] = []
    if constant:
        notes.append(f"Constant columns (single value): {', '.join(map(str, constant))}.")
    if empty:
        notes.append(f"Empty columns: {', '.join(map(str, empty))}.")

    return ToolResult(
        summary=(
            f"{missing_cells} missing cells ({pct(missing_cells, cells) or 0}%) across "
            f"{len(with_missing)} of {df.shape[1]} columns; {duplicate_rows} duplicated rows; "
            f"{incomplete_rows} of {rows} rows have at least one missing value."
        ),
        scalars={
            "rows": rows,
            "columns": int(df.shape[1]),
            "missing_cells": missing_cells,
            "missing_cells_pct": pct(missing_cells, cells) or 0.0,
            "columns_with_missing": len(with_missing),
            "rows_with_missing": incomplete_rows,
            "duplicate_rows": duplicate_rows,
            "duplicate_rows_pct": pct(duplicate_rows, rows) or 0.0,
        },
        table=Table(
            columns=["column", "kind", "missing", "missing_pct", "unique"],
            rows=records[:40],  # type: ignore[arg-type]
            total_rows=len(records),
            truncated=len(records) > 40,
        ),
        chart=Chart(
            type="bar",
            title="Missing values by column",
            x_key="column",
            x_label="Column",
            y_label="Missing (%)",
            series=[ChartSeries(key="missing_pct", label="Missing (%)")],
            data=[{"column": record[0], "missing_pct": record[3]} for record in with_missing[:20]],  # type: ignore[dict-item]
        )
        if with_missing
        else None,
        notes=notes,
    )
