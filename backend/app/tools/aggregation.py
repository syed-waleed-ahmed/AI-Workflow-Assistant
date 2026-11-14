"""Group-by aggregation, pivots, rate metrics and segmentation — the business-analytics core."""

from __future__ import annotations

from typing import Literal

import pandas as pd
from pydantic import BaseModel, Field

from app.tools.filtering import Derived, Filter, apply_filters, describe_filters, prepare
from app.tools.types import Chart, ChartSeries, Table, ToolInputError, ToolResult
from app.utils.dataframe_utils import (
    clean_number,
    frame_to_table,
    pct,
    require_columns,
    require_numeric,
    to_scalar,
)

Agg = Literal["sum", "mean", "median", "min", "max", "count", "nunique", "std"]
NUMERIC_ONLY_AGGS = {"sum", "mean", "median", "std"}
MAX_GROUP_COLUMNS = 3
MAX_METRICS = 6


class Metric(BaseModel):
    column: str
    agg: Agg = Field(description="sum, mean, median, min, max, count (non-null), nunique or std.")


def _metric_name(metric: Metric) -> str:
    return f"{metric.agg}_{metric.column}"


def _group_label(frame: pd.DataFrame, group_by: list[str]) -> pd.Series:
    labels = frame[group_by[0]].map(lambda value: str(to_scalar(value)))
    for column in group_by[1:]:
        labels = labels + " / " + frame[column].map(lambda value: str(to_scalar(value)))
    return labels


def aggregate(
    df: pd.DataFrame,
    metrics: list[Metric],
    group_by: list[str] | None = None,
    filters: list[Filter] | None = None,
    derived: list[Derived] | None = None,
    sort_by: str | None = None,
    descending: bool = True,
    top_n: int = 20,
) -> ToolResult:
    """Aggregate metrics, optionally per group, with each group's share of every summed total."""
    group_by = group_by or []
    if not metrics:
        raise ToolInputError("Provide at least one metric, e.g. {'column': 'sales', 'agg': 'sum'}.")
    if len(metrics) > MAX_METRICS:
        raise ToolInputError(f"At most {MAX_METRICS} metrics per call.")
    if len(group_by) > MAX_GROUP_COLUMNS:
        raise ToolInputError(f"At most {MAX_GROUP_COLUMNS} group-by columns per call.")
    top_n = max(1, min(top_n, 50))

    data = prepare(df, filters, derived)
    require_columns(data, group_by + [metric.column for metric in metrics])
    for metric in metrics:
        if metric.agg in NUMERIC_ONLY_AGGS:
            require_numeric(data, metric.column)

    names = [_metric_name(metric) for metric in metrics]
    if len(set(names)) != len(names):
        raise ToolInputError("Each metric (column + aggregation) may appear only once.")

    if not group_by:
        row = [to_scalar(data[metric.column].agg(metric.agg)) for metric in metrics]
        scalars = dict(zip(names, row, strict=True))
        scalars["rows"] = len(data)
        return ToolResult(
            summary=f"Overall metrics over {len(data)} rows{describe_filters(filters)}.",
            scalars=scalars,
            table=Table(columns=["rows", *names], rows=[[len(data), *row]], total_rows=1),
        )

    grouped = data.groupby(group_by, dropna=False, observed=True)
    result = grouped.agg(**{name: (metric.column, metric.agg) for name, metric in zip(names, metrics, strict=True)})
    result.insert(0, "rows", grouped.size())
    result = result.reset_index()

    for name, metric in zip(names, metrics, strict=True):
        if metric.agg == "sum":
            total = float(result[name].sum())
            if total:
                result[f"share_pct_{metric.column}"] = (100.0 * result[name] / total).round(2)

    order = sort_by or names[0]
    if order not in result.columns:
        raise ToolInputError(f"Cannot sort by '{order}'. Sortable columns: {list(result.columns)}")
    result = result.sort_values(order, ascending=not descending, na_position="last")
    group_count = len(result)
    shown = result.head(top_n)

    chart_frame = shown.copy()
    chart_frame["group"] = _group_label(chart_frame, group_by)
    # Metrics share one axis, so only chart those on a similar scale to the first: a total in the
    # millions next to an average in the hundreds would flatten the smaller one to nothing.
    labels = {name: f"{metric.agg} of {metric.column}" for name, metric in zip(names, metrics, strict=True)}
    reference = float(shown[names[0]].abs().max() or 0)
    charted = [names[0]]
    for name in names[1:3]:
        peak = float(shown[name].abs().max() or 0)
        if reference and peak and 0.1 <= peak / reference <= 10:
            charted.append(name)
    title = ", ".join(labels[name] for name in charted)
    chart = Chart(
        type="bar",
        title=f"{title[0].upper()}{title[1:]} by {' / '.join(group_by)}",
        x_key="group",
        x_label=" / ".join(group_by),
        y_label=labels[charted[0]] if len(charted) == 1 else "",
        series=[ChartSeries(key=name, label=labels[name]) for name in charted],
        data=[
            {"group": record["group"], **{name: to_scalar(record[name]) for name in charted}}
            for record in chart_frame.to_dict("records")
        ],
    )

    notes: list[str] = []
    if group_count > len(shown):
        direction = "highest" if descending else "lowest"
        notes.append(f"Showing the {len(shown)} {direction} of {group_count} groups by {order}.")
    lead = shown.iloc[0]
    return ToolResult(
        summary=(
            f"{group_count} groups by {' / '.join(group_by)} over {len(data)} rows{describe_filters(filters)}. "
            f"Top by {order}: {_group_label(shown.head(1), group_by).iloc[0]} ({to_scalar(lead[order])})."
        ),
        scalars={"groups": group_count, "rows": len(data)},
        table=frame_to_table(shown, max_rows=top_n, total_rows=group_count),
        chart=chart,
        notes=notes,
    )


def pivot(
    df: pd.DataFrame,
    rows: str,
    columns: str,
    value: str,
    agg: Agg = "sum",
    filters: list[Filter] | None = None,
) -> ToolResult:
    """Cross-tabulate one metric across two dimensions (e.g. sales by region and channel)."""
    data = apply_filters(df, filters)
    require_columns(data, [rows, columns, value])
    if rows == columns:
        raise ToolInputError("'rows' and 'columns' must be different columns.")
    if agg in NUMERIC_ONLY_AGGS:
        require_numeric(data, value)

    table = pd.pivot_table(data, index=rows, columns=columns, values=value, aggfunc=agg, observed=True)
    # Keep the largest row and column groups so the result stays readable.
    column_order = table.abs().sum(axis=0).sort_values(ascending=False).index[:8]
    row_order = table.abs().sum(axis=1).sort_values(ascending=False).index[:25]
    trimmed = table.loc[row_order, column_order]
    out = trimmed.reset_index()
    out.columns = [str(to_scalar(column)) for column in out.columns]
    out[rows] = out[rows].map(lambda item: str(to_scalar(item)))
    series_keys = [column for column in out.columns if column != rows]

    notes: list[str] = []
    if table.shape[1] > len(column_order) or table.shape[0] > len(row_order):
        notes.append(
            f"Showing {len(row_order)} of {table.shape[0]} '{rows}' groups and "
            f"{len(column_order)} of {table.shape[1]} '{columns}' groups (largest by total)."
        )
    return ToolResult(
        summary=f"{agg} of {value} by {rows} (rows) and {columns} (columns) over {len(data)} rows{describe_filters(filters)}.",
        scalars={"row_groups": int(table.shape[0]), "column_groups": int(table.shape[1])},
        table=frame_to_table(out, max_rows=25, total_rows=int(table.shape[0])),
        chart=Chart(
            type="bar",
            title=f"{agg} of {value} by {rows} and {columns}",
            x_key=rows,
            x_label=rows,
            y_label=f"{agg} of {value}",
            series=[ChartSeries(key=key, label=key) for key in series_keys],
            data=[{key: to_scalar(item) for key, item in record.items()} for record in out.to_dict("records")],
        ),
        notes=notes,
    )


def rate_metric(
    df: pd.DataFrame,
    numerator_column: str,
    denominator_column: str | None = None,
    success_value: str | float | int | bool | None = None,
    group_by: list[str] | None = None,
    filters: list[Filter] | None = None,
) -> ToolResult:
    """Ratio KPIs such as conversion rate, margin or average order value.

    Two modes:
    - ratio of sums: sum(numerator_column) / sum(denominator_column), e.g. orders / visits.
    - share of rows: share of rows where numerator_column == success_value, e.g. status == "won".
    """
    group_by = group_by or []
    if len(group_by) > MAX_GROUP_COLUMNS:
        raise ToolInputError(f"At most {MAX_GROUP_COLUMNS} group-by columns per call.")
    if (denominator_column is None) == (success_value is None):
        raise ToolInputError("Provide exactly one of 'denominator_column' or 'success_value'.")
    data = apply_filters(df, filters)
    require_columns(data, [numerator_column, *group_by])

    work = data[group_by].copy() if group_by else pd.DataFrame(index=data.index)
    # A share of rows reads naturally as a percentage; a ratio of sums (average order value,
    # revenue per unit) is reported as the plain ratio.
    as_percentage = denominator_column is None
    key = "rate_pct" if as_percentage else "ratio"
    unit = "%" if as_percentage else ""
    label = "Rate (%)" if as_percentage else "Ratio"
    if denominator_column is not None:
        work["numerator"] = require_numeric(data, numerator_column).astype("float64")
        work["denominator"] = require_numeric(data, denominator_column).astype("float64")
        description = f"sum({numerator_column}) / sum({denominator_column})"
    else:
        series = data[numerator_column]
        if pd.api.types.is_numeric_dtype(series) or pd.api.types.is_bool_dtype(series):
            try:
                hits = series.astype("float64") == float(success_value)  # type: ignore[arg-type]
            except (TypeError, ValueError) as exc:
                raise ToolInputError(
                    f"'{success_value}' is not a valid value for numeric column '{numerator_column}'."
                ) from exc
        else:
            hits = series.astype("string").str.strip().str.casefold() == str(success_value).strip().casefold()
        work["numerator"] = hits.fillna(False).astype("float64")
        work["denominator"] = series.notna().astype("float64")
        description = f"share of rows where {numerator_column} = {success_value}"

    def _rate(numerator: float, denominator: float) -> float | None:
        if not denominator:
            return None
        return round(100.0 * numerator / denominator, 2) if as_percentage else round(numerator / denominator, 4)

    overall = _rate(float(work["numerator"].sum()), float(work["denominator"].sum()))
    if not group_by:
        return ToolResult(
            summary=f"{description} = {overall}{unit} over {len(data)} rows{describe_filters(filters)}.",
            scalars={
                key: overall,
                "numerator": clean_number(work["numerator"].sum()),
                "denominator": clean_number(work["denominator"].sum()),
            },
        )

    grouped = work.groupby(group_by, dropna=False, observed=True)[["numerator", "denominator"]].sum().reset_index()
    grouped[key] = [_rate(n, d) for n, d in zip(grouped["numerator"], grouped["denominator"], strict=True)]
    grouped = grouped.sort_values(key, ascending=False, na_position="last")
    shown = grouped.head(30).copy()
    shown["group"] = _group_label(shown, group_by)
    return ToolResult(
        summary=f"{description} by {' / '.join(group_by)}{describe_filters(filters)}. Overall: {overall}{unit}.",
        scalars={f"overall_{key}": overall, "groups": len(grouped)},
        table=frame_to_table(shown.drop(columns=["group"]), max_rows=30, total_rows=len(grouped)),
        chart=Chart(
            type="bar",
            title=f"{description} by {' / '.join(group_by)}",
            x_key="group",
            x_label=" / ".join(group_by),
            y_label=label,
            series=[ChartSeries(key=key, label=label)],
            data=[{"group": record["group"], key: to_scalar(record[key])} for record in shown.to_dict("records")],
        ),
    )


def segment(
    df: pd.DataFrame,
    value_column: str,
    entity_column: str | None = None,
    segments: int = 4,
    filters: list[Filter] | None = None,
) -> ToolResult:
    """Split records (or entities such as customers) into value tiers and compare the tiers.

    With `entity_column`, values are first summed per entity, so the tiers describe entities
    (e.g. customers ranked by total revenue). Tiers are quantile-based: each holds roughly the
    same number of members, which shows how concentrated the value is.
    """
    segments = max(2, min(segments, 10))
    data = apply_filters(df, filters)
    values = require_numeric(data, value_column).astype("float64")
    if entity_column:
        require_columns(data, [entity_column])
        per_member = values.groupby(data[entity_column], observed=True).sum()
        member_label = entity_column
    else:
        per_member = values.dropna()
        member_label = "rows"
    per_member = per_member.dropna()
    if len(per_member) < segments:
        raise ToolInputError(f"Only {len(per_member)} {member_label} available — too few for {segments} segments.")

    ranked = per_member.rank(method="first", ascending=False)
    tier_index = pd.qcut(ranked, q=segments, labels=False)
    total = float(per_member.sum())
    rows: list[list[object]] = []
    chart_data: list[dict[str, object]] = []
    for tier in range(segments):
        members = per_member[tier_index == tier]
        label = f"Tier {tier + 1}" + (" (highest)" if tier == 0 else " (lowest)" if tier == segments - 1 else "")
        tier_total = float(members.sum())
        rows.append(
            [
                label,
                len(members),
                clean_number(tier_total),
                pct(tier_total, total),
                clean_number(members.mean()),
                clean_number(members.min()),
                clean_number(members.max()),
            ]
        )
        chart_data.append({"segment": label, "share_of_value_pct": pct(tier_total, total)})

    top_share = rows[0][3]
    return ToolResult(
        summary=(
            f"{len(per_member)} {member_label} split into {segments} tiers by {value_column}. "
            f"The top tier holds {top_share}% of total {value_column}."
        ),
        scalars={"members": len(per_member), "total_value": clean_number(total), "top_tier_share_pct": top_share},  # type: ignore[dict-item]
        table=Table(
            columns=["segment", "members", "total_value", "share_of_value_pct", "mean_value", "min_value", "max_value"],
            rows=rows,  # type: ignore[arg-type]
            total_rows=len(rows),
        ),
        chart=Chart(
            type="bar",
            title=f"Share of {value_column} by tier",
            x_key="segment",
            x_label="Tier",
            y_label="Share of value (%)",
            series=[ChartSeries(key="share_of_value_pct", label="Share of value (%)")],
            data=chart_data,  # type: ignore[arg-type]
        ),
    )
