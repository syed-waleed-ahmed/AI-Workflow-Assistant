"""The agent's tool catalogue.

Each entry pairs a deterministic function from `app.tools` with the argument schema the model
sees. Tools never receive a path or dataset id from the model: the executor binds them to the
one DataFrame the analysis was authorised for, so the model cannot reach any other data.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal

import pandas as pd
from langchain_core.utils.function_calling import convert_to_openai_tool
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.tools import (
    aggregation,
    column_statistics,
    correlation,
    filtering,
    missing_values,
    outlier_detection,
    time_series,
)
from app.tools.aggregation import Agg, Metric
from app.tools.filtering import Derived, Filter
from app.tools.time_series import Freq
from app.tools.types import ToolInputError, ToolResult

BATCH_TOOL_NAME = "run_batch"
MAX_BATCH_CALLS = 8


class _Args(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ColumnStatisticsArgs(_Args):
    """Summary statistics (count, missing, unique, mean, median, mode, std, variance, min, quartiles, max, skew) for up to 10 columns."""

    columns: list[str]
    filters: list[Filter] | None = None


class ValueCountsArgs(_Args):
    """Frequency distribution of a column's values (counts and % of rows)."""

    column: str
    top_n: int = 10
    filters: list[Filter] | None = None


class DistributionArgs(_Args):
    """Histogram, percentiles, skewness and kurtosis of a numeric column."""

    column: str
    bins: int | None = None
    filters: list[Filter] | None = None


class AggregateArgs(_Args):
    """Group-by aggregation with share of total; omit group_by for overall KPIs. Use for totals, rankings, regional/product/customer comparisons."""

    metrics: list[Metric]
    group_by: list[str] | None = None
    filters: list[Filter] | None = None
    derived: list[Derived] | None = Field(default=None, description="Calculated columns to add before aggregating.")
    sort_by: str | None = Field(
        default=None, description="Output column to sort by, e.g. sum_sales. Defaults to the first metric."
    )
    descending: bool = True
    top_n: int = 20


class PivotArgs(_Args):
    """Cross-tabulate one metric across two categorical columns."""

    rows: str
    columns: str
    value: str
    agg: Agg = "sum"
    filters: list[Filter] | None = None


class RateMetricArgs(_Args):
    """Ratio KPI, overall or per group. Either sum(numerator_column)/sum(denominator_column), or the share of rows where numerator_column equals success_value (conversion rate)."""

    numerator_column: str
    denominator_column: str | None = None
    success_value: str | float | int | bool | None = None
    group_by: list[str] | None = None
    filters: list[Filter] | None = None


class SegmentArgs(_Args):
    """Split rows — or entities such as customers when entity_column is given — into value tiers and show each tier's share of the total (concentration / segmentation)."""

    value_column: str
    entity_column: str | None = None
    segments: int = 4
    filters: list[Filter] | None = None


class TimeSeriesArgs(_Args):
    """Metric over time: per-period values, period-over-period change, growth, trend direction, optional rolling average and linear forecast. With group_by, one series per group."""

    date_column: str
    value_column: str
    agg: Agg = "sum"
    freq: Freq = Field(default="M", description="D=day, W=week, M=month, Q=quarter, Y=year.")
    group_by: str | None = None
    rolling_window: int | None = None
    forecast_periods: int = 0
    filters: list[Filter] | None = None
    derived: list[Derived] | None = None


class ComparePeriodsArgs(_Args):
    """Growth of a metric between two date ranges, overall or per group. The result is always the change from the earlier range to the later one. Dates are YYYY-MM-DD, inclusive. Prefer ranges of equal length."""

    date_column: str
    value_column: str
    period_a_start: str
    period_a_end: str
    period_b_start: str
    period_b_end: str
    agg: Agg = "sum"
    group_by: str | None = None
    filters: list[Filter] | None = None


class TimeAnomaliesArgs(_Args):
    """Flag periods whose aggregated value is unusually high or low (robust modified z-score)."""

    date_column: str
    value_column: str
    agg: Agg = "sum"
    freq: Freq = "D"
    threshold: float = 3.5
    filters: list[Filter] | None = None


class CorrelationArgs(_Args):
    """Pairwise correlation between numeric columns with sample size and p-value. Omit columns to use all numeric columns."""

    columns: list[str] | None = None
    method: Literal["pearson", "spearman"] = "pearson"
    filters: list[Filter] | None = None


class CompareGroupsArgs(_Args):
    """Welch t-test: does a numeric column differ significantly between two groups? Omit the group names to compare the two largest groups."""

    value_column: str
    group_column: str
    group_a: str | None = None
    group_b: str | None = None
    filters: list[Filter] | None = None


class ScatterArgs(_Args):
    """Relationship between two numeric columns: correlation, fitted line, scatter chart."""

    x_column: str
    y_column: str
    filters: list[Filter] | None = None


class OutliersArgs(_Args):
    """Unusually low/high values in a numeric column (IQR fences or z-score), with the most extreme rows."""

    column: str
    method: Literal["iqr", "zscore"] = "iqr"
    filters: list[Filter] | None = None


class DataQualityArgs(_Args):
    """Missing values per column, duplicated rows, constant and empty columns."""


class FilterRowsArgs(_Args):
    """Return individual rows matching conditions, optionally sorted (top/bottom records). Not for totals — use aggregate."""

    filters: list[Filter] | None = None
    derived: list[Derived] | None = None
    columns: list[str] | None = None
    sort_by: str | None = None
    descending: bool = True
    limit: int = 20


def _names(metrics: list[Metric]) -> str:
    return ", ".join(f"{metric.agg} of {metric.column}" for metric in metrics[:3])


@dataclass(frozen=True)
class ToolSpec:
    name: str
    args_schema: type[BaseModel]
    function: Callable[..., ToolResult]
    catalog: str  # one line shown to the planner
    label: Callable[[Any], str]  # user-facing progress message for a call


TOOLS: dict[str, ToolSpec] = {
    spec.name: spec
    for spec in [
        ToolSpec("aggregate", AggregateArgs, aggregation.aggregate,
                 "totals/averages/counts overall or per group, share of total, rankings",
                 lambda a: f"Calculating {_names(a.metrics)}" + (f" by {', '.join(a.group_by)}" if a.group_by else "")),
        ToolSpec("time_series", TimeSeriesArgs, time_series.time_series,
                 "metric over time: trend, period-over-period growth, rolling average, forecast",
                 lambda a: f"Analysing {a.value_column} over time" + (f" by {a.group_by}" if a.group_by else "")),
        ToolSpec("compare_periods", ComparePeriodsArgs, time_series.compare_periods,
                 "compare a metric between two date ranges, overall or per group",
                 lambda a: f"Comparing {a.value_column} between two periods"),
        ToolSpec("time_anomalies", TimeAnomaliesArgs, time_series.time_anomalies,
                 "detect unusual periods in a metric over time",
                 lambda a: f"Checking {a.value_column} for unusual periods"),
        ToolSpec("pivot", PivotArgs, aggregation.pivot,
                 "cross-tabulate a metric across two categorical columns",
                 lambda a: f"Cross-tabulating {a.value} by {a.rows} and {a.columns}"),
        ToolSpec("rate_metric", RateMetricArgs, aggregation.rate_metric,
                 "ratio KPIs: conversion rate, margin, average order value, per group",
                 lambda a: f"Calculating rate for {a.numerator_column}"),
        ToolSpec("segment", SegmentArgs, aggregation.segment,
                 "value tiers / customer segmentation and concentration",
                 lambda a: f"Segmenting by {a.value_column}"),
        ToolSpec("column_statistics", ColumnStatisticsArgs, column_statistics.column_statistics,
                 "descriptive statistics for columns",
                 lambda a: f"Summarising {', '.join(a.columns[:3])}"),
        ToolSpec("value_counts", ValueCountsArgs, column_statistics.value_counts,
                 "frequency of each value in a column",
                 lambda a: f"Counting values of {a.column}"),
        ToolSpec("distribution", DistributionArgs, column_statistics.distribution,
                 "histogram and shape of a numeric column",
                 lambda a: f"Examining the distribution of {a.column}"),
        ToolSpec("correlation", CorrelationArgs, correlation.correlation,
                 "correlation matrix between numeric columns with p-values",
                 lambda a: "Measuring correlations between numeric columns"),
        ToolSpec("scatter", ScatterArgs, correlation.scatter,
                 "relationship between two numeric columns",
                 lambda a: f"Relating {a.y_column} to {a.x_column}"),
        ToolSpec("compare_groups", CompareGroupsArgs, correlation.compare_groups,
                 "statistical significance test of a metric between two groups",
                 lambda a: f"Testing whether {a.value_column} differs across {a.group_column}"),
        ToolSpec("outliers", OutliersArgs, outlier_detection.outliers,
                 "outlier detection in a numeric column",
                 lambda a: f"Looking for outliers in {a.column}"),
        ToolSpec("data_quality", DataQualityArgs, lambda df: missing_values.data_quality(df),
                 "missing values, duplicates, constant columns",
                 lambda a: "Checking data quality"),
        ToolSpec("filter_rows", FilterRowsArgs, filtering.filter_rows,
                 "list individual rows matching conditions (top/bottom records)",
                 lambda a: "Retrieving matching rows"),
    ]
}  # fmt: skip

# Bound when the planner did not choose, or chose nothing usable.
DEFAULT_TOOLS = ["aggregate", "time_series", "column_statistics", "value_counts", "filter_rows"]


class BatchCall(BaseModel):
    tool: str = Field(description="Name of one of the other tools.")
    args: dict[str, Any] = Field(description="Arguments for that tool.")


class RunBatchArgs(BaseModel):
    """Run several tool calls at once. Prefer this whenever you need more than one result."""

    calls: list[BatchCall]


def catalog_text() -> str:
    return "\n".join(f"- {spec.name}: {spec.catalog}" for spec in TOOLS.values())


def tool_schemas(names: list[str]) -> list[dict[str, Any]]:
    """OpenAI-format schemas for the chosen tools plus the batch wrapper."""
    schemas = []
    for name in names:
        spec = TOOLS[name]
        schema = convert_to_openai_tool(spec.args_schema)
        schema["function"]["name"] = name
        schemas.append(schema)
    batch = convert_to_openai_tool(RunBatchArgs)
    batch["function"]["name"] = BATCH_TOOL_NAME
    schemas.append(batch)
    return schemas


@dataclass
class ParsedCall:
    name: str
    args: BaseModel
    label: str


def parse_call(name: str, raw_args: dict[str, Any]) -> ParsedCall:
    """Validate a model-issued call. Raises `ToolInputError` with a message the model can act on."""
    spec = TOOLS.get(name)
    if spec is None:
        raise ToolInputError(f"Unknown tool '{name}'. Available tools: {', '.join(TOOLS)}.")
    try:
        args = spec.args_schema.model_validate(raw_args or {})
    except ValidationError as exc:
        problems = "; ".join(
            f"{'.'.join(str(part) for part in error['loc'])}: {error['msg']}" for error in exc.errors()[:4]
        )
        raise ToolInputError(f"Invalid arguments for {name}: {problems}") from exc
    return ParsedCall(name=name, args=args, label=spec.label(args))


def execute(call: ParsedCall, df: pd.DataFrame) -> ToolResult:
    """Run a validated call against the analysis's DataFrame."""
    spec = TOOLS[call.name]
    kwargs = {field: getattr(call.args, field) for field in type(call.args).model_fields}
    return spec.function(df, **kwargs)
