"""Time-series analysis: trends, period-over-period change, rolling averages, anomalies."""

from __future__ import annotations

from typing import Literal

import numpy as np
import pandas as pd

from app.tools.aggregation import NUMERIC_ONLY_AGGS, Agg
from app.tools.filtering import Derived, Filter, apply_filters, describe_filters, prepare
from app.tools.types import Chart, ChartSeries, Table, ToolInputError, ToolResult
from app.utils.dataframe_utils import (
    clean_number,
    frame_to_table,
    require_columns,
    require_datetime,
    require_numeric,
    to_scalar,
)

Freq = Literal["D", "W", "M", "Q", "Y"]
FREQ_NAMES = {"D": "day", "W": "week", "M": "month", "Q": "quarter", "Y": "year"}
MAX_PERIODS = 400
MAX_SERIES_GROUPS = 6
MIN_FORECAST_PERIODS = 8
MIN_FORECAST_R2 = 0.5


def _period_label(period: pd.Period, freq: Freq) -> str:
    if freq == "W":
        return period.start_time.strftime("%Y-%m-%d")
    return str(period)


def _resample(data: pd.DataFrame, date_column: str, value_column: str, agg: Agg, freq: Freq) -> pd.Series:
    """Aggregate `value_column` per period, with empty periods filled in so gaps are visible."""
    dates = require_datetime(data, date_column)
    if agg in NUMERIC_ONLY_AGGS:
        require_numeric(data, value_column)
    valid = data[dates.notna()]
    if valid.empty:
        raise ToolInputError(f"Column '{date_column}' has no valid dates in the selected rows.")
    periods = valid[date_column].dt.to_period(freq)
    series = valid.groupby(periods)[value_column].agg(agg)
    full_index = pd.period_range(series.index.min(), series.index.max(), freq=freq)
    if len(full_index) > MAX_PERIODS:
        raise ToolInputError(
            f"That produces {len(full_index)} periods; use a coarser frequency (max {MAX_PERIODS} periods)."
        )
    # A period with no rows contributes nothing to a sum or count, but has no defined average.
    fill = 0 if agg in ("sum", "count", "nunique") else np.nan
    return series.reindex(full_index, fill_value=fill).astype("float64")


def _partial_period_notes(dates: pd.Series, index: pd.PeriodIndex, freq: Freq) -> list[str]:
    """Warn when the first or last period is only partly covered by the data.

    A half-finished month looks like a collapse in a trend line; saying so up front prevents
    the most common misreading of time-series results.
    """
    if freq == "D" or len(index) < 2:
        return []
    valid = dates.dropna()
    if valid.empty:
        return []
    notes: list[str] = []
    first, last = index[0], index[-1]
    earliest, latest = valid.min().normalize(), valid.max().normalize()
    length_days = max((first.end_time.normalize() - first.start_time.normalize()).days + 1, 1)
    if (earliest - first.start_time.normalize()).days > 0.2 * length_days:
        notes.append(
            f"The first {FREQ_NAMES[freq]} ({_period_label(first, freq)}) is incomplete: data starts on "
            f"{earliest:%Y-%m-%d}. Its value understates a full period."
        )
    length_days = max((last.end_time.normalize() - last.start_time.normalize()).days + 1, 1)
    if (last.end_time.normalize() - latest).days > 0.2 * length_days:
        notes.append(
            f"The last {FREQ_NAMES[freq]} ({_period_label(last, freq)}) is incomplete: data ends on "
            f"{latest:%Y-%m-%d}. Its value understates a full period."
        )
    return notes


def _linear_trend(values: np.ndarray) -> tuple[float, float, float] | None:
    """Least-squares line through the series: (slope per period, intercept, r squared)."""
    mask = ~np.isnan(values)
    if mask.sum() < 3:
        return None
    x = np.arange(len(values))[mask].astype("float64")
    y = values[mask]
    slope, intercept = np.polyfit(x, y, 1)
    fitted = slope * x + intercept
    total = float(((y - y.mean()) ** 2).sum())
    r_squared = 0.0 if total == 0 else 1.0 - float(((y - fitted) ** 2).sum()) / total
    return float(slope), float(intercept), r_squared


def _pct_change(current: float, previous: float) -> float | None:
    if previous is None or np.isnan(previous) or np.isnan(current) or previous == 0:
        return None
    return round(100.0 * (current - previous) / abs(previous), 2)


def time_series(
    df: pd.DataFrame,
    date_column: str,
    value_column: str,
    agg: Agg = "sum",
    freq: Freq = "M",
    group_by: str | None = None,
    rolling_window: int | None = None,
    forecast_periods: int = 0,
    filters: list[Filter] | None = None,
    derived: list[Derived] | None = None,
) -> ToolResult:
    """Aggregate a metric over time and describe its trend.

    Without `group_by`: one row per period with period-over-period change, an optional rolling
    average, overall growth and a fitted linear trend. A linear forecast is produced only when
    the history is long and regular enough to justify one.
    With `group_by`: one column per group (largest groups first) plus growth per group.
    """
    data = prepare(df, filters, derived)
    require_columns(data, [date_column, value_column])
    period_name = FREQ_NAMES[freq]
    metric = f"{agg}_{value_column}"

    if group_by:
        return _grouped_series(data, date_column, value_column, agg, freq, group_by, filters)

    series = _resample(data, date_column, value_column, agg, freq)
    values = series.to_numpy()
    labels = [_period_label(period, freq) for period in series.index]
    frame = pd.DataFrame({"period": labels, metric: values})
    frame["change_pct"] = [None] + [_pct_change(values[i], values[i - 1]) for i in range(1, len(values))]

    chart_series = [ChartSeries(key=metric, label=metric.replace("_", " "))]
    if rolling_window and rolling_window >= 2:
        window = min(rolling_window, len(values))
        rolling_key = f"rolling_mean_{window}"
        frame[rolling_key] = series.rolling(window, min_periods=window).mean().to_numpy()
        chart_series.append(ChartSeries(key=rolling_key, label=f"{window}-{period_name} rolling average"))

    notes: list[str] = _partial_period_notes(data[date_column], series.index, freq)
    scalars: dict[str, object] = {"periods": len(values), "first_period": labels[0], "last_period": labels[-1]}
    valid = values[~np.isnan(values)]
    if len(valid):
        first, last = float(valid[0]), float(valid[-1])
        best, worst = int(np.nanargmax(values)), int(np.nanargmin(values))
        scalars.update(
            {
                "first_value": clean_number(first),
                "last_value": clean_number(last),
                "change_pct_first_to_last_period": _pct_change(last, first),
                "mean_per_period": clean_number(valid.mean()),
                "highest_period": labels[best],
                "highest_value": clean_number(values[best]),
                "lowest_period": labels[worst],
                "lowest_value": clean_number(values[worst]),
            }
        )
        if len(valid) >= 2 and first > 0 and last > 0:
            # Compound growth rate per period between the first and last observation.
            scalars["compound_growth_pct_per_period"] = round(
                100.0 * ((last / first) ** (1.0 / (len(valid) - 1)) - 1.0), 2
            )

    trend = _linear_trend(values)
    direction = "undetermined (fewer than 3 periods)"
    if trend:
        slope, intercept, r_squared = trend
        mean = float(np.nanmean(values))
        relative = abs(slope) / abs(mean) if mean else 0.0
        direction = "no clear trend" if r_squared < 0.2 or relative < 0.005 else "upward" if slope > 0 else "downward"
        scalars.update(
            {
                "trend_direction": direction,
                "trend_slope_per_period": clean_number(slope),
                "trend_r_squared": round(r_squared, 3),
            }
        )
        if forecast_periods > 0:
            horizon = min(forecast_periods, 6)
            if len(valid) >= MIN_FORECAST_PERIODS and r_squared >= MIN_FORECAST_R2:
                future = pd.period_range(series.index[-1] + 1, periods=horizon, freq=freq)
                projected = [slope * (len(values) + step) + intercept for step in range(horizon)]
                forecast_rows = pd.DataFrame(
                    {"period": [_period_label(period, freq) for period in future], "forecast": projected}
                )
                frame = pd.concat([frame, forecast_rows], ignore_index=True)
                chart_series.append(ChartSeries(key="forecast", label="Linear forecast"))
                for label, value in zip(forecast_rows["period"], projected, strict=True):
                    scalars[f"forecast_{label}"] = clean_number(value)
                notes.append(
                    f"Forecast is a straight-line extrapolation of the fitted trend (R² = {r_squared:.2f}). "
                    "It ignores seasonality and external factors; treat it as indicative only."
                )
            else:
                notes.append(
                    f"No forecast produced: it needs at least {MIN_FORECAST_PERIODS} periods and a trend fit "
                    f"of R² ≥ {MIN_FORECAST_R2} (found {len(valid)} periods, R² = {r_squared:.2f})."
                )
    if len(valid) < 4:
        notes.append(f"Only {len(valid)} {period_name}s of data: too few to call any change a trend.")

    chart_data = [
        {key: to_scalar(value) for key, value in record.items() if key != "change_pct"}
        for record in frame.to_dict("records")
    ]
    return ToolResult(
        summary=(
            f"{metric} per {period_name} from {labels[0]} to {labels[-1]} ({len(values)} periods)"
            f"{describe_filters(filters)}. Trend: {direction}."
        ),
        scalars=scalars,  # type: ignore[arg-type]
        table=frame_to_table(frame, max_rows=60),
        chart=Chart(
            type="line",
            title=f"{metric.replace('_', ' ')} per {period_name}",
            x_key="period",
            x_label=period_name.capitalize(),
            y_label=metric.replace("_", " "),
            series=chart_series,
            data=chart_data,
        ),
        notes=notes,
    )


def _grouped_series(
    data: pd.DataFrame,
    date_column: str,
    value_column: str,
    agg: Agg,
    freq: Freq,
    group_by: str,
    filters: list[Filter] | None,
) -> ToolResult:
    require_columns(data, [group_by])
    if agg in NUMERIC_ONLY_AGGS:
        require_numeric(data, value_column)
        sizes = data.groupby(group_by, observed=True)[value_column].sum().abs()
    else:
        sizes = data.groupby(group_by, observed=True).size()
    groups = list(sizes.sort_values(ascending=False).index[:MAX_SERIES_GROUPS])
    if not groups:
        raise ToolInputError(f"Column '{group_by}' has no values in the selected rows.")

    columns: dict[str, pd.Series] = {}
    for group in groups:
        columns[str(to_scalar(group))] = _resample(data[data[group_by] == group], date_column, value_column, agg, freq)
    wide = pd.DataFrame(columns)
    full_index = pd.period_range(wide.index.min(), wide.index.max(), freq=freq)
    wide = wide.reindex(full_index)
    frame = wide.reset_index(drop=True)
    frame.insert(0, "period", [_period_label(period, freq) for period in full_index])

    first_label, last_label = str(frame["period"].iloc[0]), str(frame["period"].iloc[-1])
    growth_rows: list[str] = []
    scalars: dict[str, object] = {
        "periods": len(frame),
        "groups_shown": len(groups),
        "first_period": first_label,
        "last_period": last_label,
    }
    for name in columns:
        valid = wide[name].dropna()
        if len(valid) >= 2:
            change = _pct_change(float(valid.iloc[-1]), float(valid.iloc[0]))
            scalars[f"change_pct_first_to_last_period[{name}]"] = change
            scalars[f"first_period_value[{name}]"] = clean_number(valid.iloc[0])
            scalars[f"last_period_value[{name}]"] = clean_number(valid.iloc[-1])
            growth_rows.append(f"{name}: {change}%")

    notes = _partial_period_notes(data[date_column], full_index, freq)
    if len(sizes) > len(groups):
        notes.append(f"Showing the {len(groups)} largest of {len(sizes)} '{group_by}' groups.")
    period_name = FREQ_NAMES[freq]
    notes.append(
        f"The change figures compare only the single first {period_name} ({first_label}) with the single "
        f"last {period_name} ({last_label}); individual periods can be noisy. Use compare_periods for "
        "growth between longer ranges."
    )
    return ToolResult(
        summary=(
            f"{agg}_{value_column} per {period_name} by {group_by} ({len(frame)} periods){describe_filters(filters)}. "
            f"Change from the first {period_name} ({first_label}) to the last {period_name} ({last_label}): "
            f"{'; '.join(growth_rows) or 'not enough periods'}."
        ),
        scalars=scalars,  # type: ignore[arg-type]
        table=frame_to_table(frame, max_rows=60),
        chart=Chart(
            type="line",
            title=f"{agg} of {value_column} per {period_name} by {group_by}",
            x_key="period",
            x_label=period_name.capitalize(),
            y_label=f"{agg} of {value_column}",
            series=[ChartSeries(key=name, label=name) for name in columns],
            data=[{key: to_scalar(value) for key, value in record.items()} for record in frame.to_dict("records")],
        ),
        notes=notes,
    )


def compare_periods(
    df: pd.DataFrame,
    date_column: str,
    value_column: str,
    period_a_start: str,
    period_a_end: str,
    period_b_start: str,
    period_b_end: str,
    agg: Agg = "sum",
    group_by: str | None = None,
    filters: list[Filter] | None = None,
) -> ToolResult:
    """Compare a metric between two date ranges, overall or per group.

    The two ranges may be given in either order: the result always measures the change from the
    chronologically earlier range to the later one, and labels its columns `earlier` and `later`,
    so the direction of a change cannot be misread.
    """
    data = apply_filters(df, filters)
    dates = require_datetime(data, date_column)
    require_columns(data, [value_column] + ([group_by] if group_by else []))
    if agg in NUMERIC_ONLY_AGGS:
        require_numeric(data, value_column)
    try:
        ranges = [
            (pd.Timestamp(period_a_start), pd.Timestamp(period_a_end)),
            (pd.Timestamp(period_b_start), pd.Timestamp(period_b_end)),
        ]
    except (ValueError, TypeError) as exc:
        raise ToolInputError("Period boundaries must be dates such as 2025-01-31.") from exc
    if any(pd.isna(start) or pd.isna(end) or start > end for start, end in ranges):
        raise ToolInputError("Each period needs a valid start date that is not after its end date.")
    (early_start, early_end), (late_start, late_end) = sorted(ranges, key=lambda item: item[0])

    # End dates are inclusive of the whole day.
    day = pd.Timedelta(days=1)
    earlier = data[(dates >= early_start) & (dates < early_end + day)]
    later = data[(dates >= late_start) & (dates < late_end + day)]
    early_label = f"{early_start:%Y-%m-%d} to {early_end:%Y-%m-%d}"
    late_label = f"{late_start:%Y-%m-%d} to {late_end:%Y-%m-%d}"
    notes = [f"Earlier period: {early_label} ({len(earlier)} rows). Later period: {late_label} ({len(later)} rows)."]
    if late_start <= early_end:
        notes.append("The two periods overlap, so some rows are counted in both.")
    if earlier.empty or later.empty:
        notes.append("One of the periods contains no rows, so the comparison is not meaningful.")
    early_days, late_days = (early_end - early_start).days + 1, (late_end - late_start).days + 1
    if agg in ("sum", "count") and abs(early_days - late_days) > 0.1 * max(early_days, late_days):
        notes.append(
            f"The periods differ in length ({early_days} vs {late_days} days), which by itself changes a {agg}."
        )

    def _value(frame: pd.DataFrame) -> float:
        return float(frame[value_column].agg(agg)) if len(frame) else float("nan")

    metric = f"{agg} of {value_column}"
    if not group_by:
        early_value, late_value = _value(earlier), _value(later)
        change = _pct_change(late_value, early_value)
        return ToolResult(
            summary=(
                f"{metric} went from {clean_number(early_value)} in the earlier period ({early_label}) to "
                f"{clean_number(late_value)} in the later period ({late_label}): {change}% change."
            ),
            scalars={
                "earlier_period": early_label,
                "later_period": late_label,
                "earlier_value": clean_number(early_value),
                "later_value": clean_number(late_value),
                "absolute_change": clean_number(late_value - early_value),
                "change_pct": change,
            },
            notes=notes,
        )

    early_series = earlier.groupby(group_by, observed=True)[value_column].agg(agg).rename("earlier")
    late_series = later.groupby(group_by, observed=True)[value_column].agg(agg).rename("later")
    table = pd.concat([early_series, late_series], axis=1).reset_index()
    table["absolute_change"] = table["later"] - table["earlier"]
    table["change_pct"] = [
        _pct_change(float(late), float(early)) if pd.notna(early) and pd.notna(late) else None
        for early, late in zip(table["earlier"], table["later"], strict=True)
    ]
    table = table.sort_values("change_pct", ascending=False, na_position="last")
    labelled = table.copy()
    labelled[group_by] = labelled[group_by].map(lambda item: str(to_scalar(item)))
    return ToolResult(
        summary=(
            f"{metric} by {group_by}, change from the earlier period ({early_label}) to the later period "
            f"({late_label}). Positive change_pct means growth over time."
        ),
        scalars={"groups": len(table), "earlier_period": early_label, "later_period": late_label},
        table=frame_to_table(labelled, max_rows=30),
        chart=Chart(
            type="bar",
            title=f"{metric} by {group_by}: earlier vs later period",
            x_key=group_by,
            x_label=group_by,
            y_label=metric,
            series=[
                ChartSeries(key="earlier", label=f"Earlier: {early_label}"),
                ChartSeries(key="later", label=f"Later: {late_label}"),
            ],
            data=[
                {
                    group_by: record[group_by],
                    "earlier": to_scalar(record["earlier"]),
                    "later": to_scalar(record["later"]),
                }
                for record in labelled.head(30).to_dict("records")
            ],
        ),
        notes=notes,
    )


def time_anomalies(
    df: pd.DataFrame,
    date_column: str,
    value_column: str,
    agg: Agg = "sum",
    freq: Freq = "D",
    threshold: float = 3.5,
    filters: list[Filter] | None = None,
) -> ToolResult:
    """Flag periods whose value is unusually far from the typical level.

    Uses the modified z-score (median and median absolute deviation), which stays reliable when
    the anomalies themselves would distort a mean and standard deviation.
    """
    data = apply_filters(df, filters)
    series = _resample(data, date_column, value_column, agg, freq)
    values = series.dropna()
    period_name = FREQ_NAMES[freq]
    metric = f"{agg}_{value_column}"
    if len(values) < 8:
        return ToolResult(
            summary=f"Only {len(values)} {period_name}s of data — too few to detect anomalies reliably.",
            scalars={"periods": len(values), "anomalies": 0},
            notes=["Anomaly detection needs at least 8 periods."],
        )
    threshold = max(2.0, min(float(threshold), 10.0))
    median = float(values.median())
    mad = float((values - median).abs().median())
    if mad == 0:
        return ToolResult(
            summary=f"{metric} per {period_name} is constant for most periods; no anomaly score can be computed.",
            scalars={"periods": len(values), "anomalies": 0, "median": clean_number(median)},
            notes=["More than half of the periods share the same value, so the spread (MAD) is zero."],
        )
    scores = 0.6745 * (values - median) / mad
    flagged = scores[scores.abs() > threshold].sort_values(key=lambda s: s.abs(), ascending=False)
    rows: list[list[object]] = [
        [
            _period_label(period, freq),
            clean_number(values[period]),
            clean_number(median),
            round(100.0 * (values[period] - median) / abs(median), 2) if median else None,
            round(float(score), 2),
            "high" if score > 0 else "low",
        ]
        for period, score in flagged.head(25).items()
    ]
    flagged_labels = {row[0] for row in rows}
    return ToolResult(
        summary=(
            f"{len(flagged)} anomalous {period_name}s out of {len(values)} for {metric}"
            f"{describe_filters(filters)} (modified z-score > {threshold})."
        ),
        scalars={
            "periods": len(values),
            "anomalies": len(flagged),
            "median": clean_number(median),
            "threshold": threshold,
        },
        table=Table(
            columns=["period", metric, "typical_value", "deviation_pct", "modified_z", "direction"],
            rows=rows,  # type: ignore[arg-type]
            total_rows=len(flagged),
            truncated=len(flagged) > len(rows),
        )
        if rows
        else None,
        chart=Chart(
            type="line",
            title=f"{metric.replace('_', ' ')} per {period_name} with anomalies",
            x_key="period",
            x_label=period_name.capitalize(),
            y_label=metric.replace("_", " "),
            series=[
                ChartSeries(key=metric, label=metric.replace("_", " ")),
                ChartSeries(key="anomaly", label="Anomaly"),
            ],
            data=[
                {
                    "period": (label := _period_label(period, freq)),
                    metric: clean_number(value),
                    "anomaly": clean_number(value) if label in flagged_labels else None,
                }
                for period, value in values.items()
            ],
        ),
    )
