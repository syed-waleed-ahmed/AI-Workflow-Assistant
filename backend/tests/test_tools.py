"""The analytical tools must return exactly what a hand calculation gives."""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest

from app.tools import (
    aggregation,
    column_statistics,
    correlation,
    filtering,
    missing_values,
    outlier_detection,
    time_series,
)
from app.tools.aggregation import Metric
from app.tools.dataset_overview import classify_column, profile_dataframe
from app.tools.filtering import Derived, Filter
from app.tools.types import ToolInputError


def rows_by_first_column(result) -> dict:
    assert result.table is not None
    return {row[0]: dict(zip(result.table.columns, row, strict=True)) for row in result.table.rows}


# ---------------------------------------------------------------- aggregation


def test_aggregate_sums_and_shares_by_group(sales):
    result = aggregation.aggregate(sales, [Metric(column="revenue", agg="sum")], ["region"])
    rows = rows_by_first_column(result)
    assert rows["NA"]["sum_revenue"] == 8200
    assert rows["EU"]["sum_revenue"] == 5400
    assert rows["APAC"]["sum_revenue"] == 3750
    assert rows["NA"]["share_pct_revenue"] == pytest.approx(47.26)
    assert sum(row["share_pct_revenue"] for row in rows.values()) == pytest.approx(100, abs=0.02)
    assert [row[0] for row in result.table.rows] == ["NA", "EU", "APAC"]  # sorted by the metric, descending
    assert result.chart and result.chart.type == "bar" and len(result.chart.data) == 3


def test_aggregate_overall_without_groups(sales):
    result = aggregation.aggregate(sales, [Metric(column="revenue", agg="sum"), Metric(column="units", agg="mean")])
    assert result.scalars["sum_revenue"] == 17350
    assert result.scalars["mean_units"] == pytest.approx(sales["units"].mean(), abs=1e-4)
    assert result.scalars["rows"] == 12


def test_aggregate_with_filter_and_calculated_column(sales):
    result = aggregation.aggregate(
        sales,
        [Metric(column="gross", agg="sum")],
        filters=[Filter(column="region", op="eq", value="na")],  # text filters ignore case
        derived=[Derived(name="gross", expression="units * price")],
    )
    assert result.scalars["sum_gross"] == 8200
    assert result.scalars["rows"] == 5


def test_aggregate_top_n_reports_truncation(sales):
    result = aggregation.aggregate(sales, [Metric(column="revenue", agg="sum")], ["order_id"], top_n=3)
    assert len(result.table.rows) == 3 and result.table.total_rows == 12 and result.table.truncated
    assert any("3" in note and "12" in note for note in result.notes)


def test_aggregate_rejects_bad_input(sales):
    with pytest.raises(ToolInputError, match="Unknown column"):
        aggregation.aggregate(sales, [Metric(column="nope", agg="sum")])
    with pytest.raises(ToolInputError, match="not numeric"):
        aggregation.aggregate(sales, [Metric(column="region", agg="sum")])
    with pytest.raises(ToolInputError, match="at least one metric"):
        aggregation.aggregate(sales, [])


def test_pivot_cross_tabulates(sales):
    result = aggregation.pivot(sales, "region", "channel", "revenue")
    rows = rows_by_first_column(result)
    assert rows["NA"]["Online"] == 5500 and rows["NA"]["Retail"] == 2700
    assert rows["EU"]["Online"] == 3200 and rows["EU"]["Retail"] == 2200


def test_rate_metric_share_of_rows(sales):
    result = aggregation.rate_metric(sales, "status", success_value="WON", group_by=["region"])
    rows = rows_by_first_column(result)
    assert rows["NA"]["rate_pct"] == 80.0  # 4 of 5
    assert rows["EU"]["rate_pct"] == 75.0  # 3 of 4
    assert result.scalars["overall_rate_pct"] == 75.0  # 9 of 12


def test_rate_metric_ratio_of_sums(sales):
    result = aggregation.rate_metric(sales, "revenue", denominator_column="units")
    assert result.scalars["ratio"] == pytest.approx(17350 / 124, abs=1e-4)


def test_rate_metric_requires_exactly_one_mode(sales):
    with pytest.raises(ToolInputError, match="exactly one"):
        aggregation.rate_metric(sales, "revenue")


def test_segment_by_entity_shows_concentration(sales):
    result = aggregation.segment(sales, "revenue", entity_column="region", segments=3)
    assert result.table.rows[0][0].startswith("Tier 1")
    assert result.table.rows[0][2] == 8200  # top tier is NA
    assert result.scalars["top_tier_share_pct"] == pytest.approx(47.26)


# ---------------------------------------------------------------- filtering


@pytest.mark.parametrize(
    ("condition", "expected"),
    [
        (Filter(column="revenue", op="gt", value=2000), 1),
        (Filter(column="revenue", op="gte", value=2000), 3),
        (Filter(column="revenue", op="between", value=[1000, 1200]), 5),
        (Filter(column="region", op="in", value=["na", "APAC"]), 8),
        (Filter(column="region", op="not_in", value=["NA"]), 7),
        (Filter(column="region", op="ne", value="NA"), 7),
        (Filter(column="order_id", op="starts_with", value="o1"), 4),
        (Filter(column="channel", op="contains", value="tail"), 5),
        (Filter(column="date", op="gte", value="2025-04-01"), 6),
        (Filter(column="date", op="between", value=["2025-02-01", "2025-02-28"]), 2),
    ],
)
def test_filter_operators(sales, condition, expected):
    assert len(filtering.apply_filters(sales, [condition])) == expected


def test_null_filters():
    frame = pd.DataFrame({"a": [1.0, None, 3.0], "b": ["x", None, "z"]})
    assert len(filtering.apply_filters(frame, [Filter(column="a", op="is_null")])) == 1
    assert len(filtering.apply_filters(frame, [Filter(column="b", op="not_null")])) == 2


def test_filters_combine_with_and(sales):
    matched = filtering.apply_filters(
        sales, [Filter(column="region", op="eq", value="NA"), Filter(column="channel", op="eq", value="Online")]
    )
    assert matched["revenue"].sum() == 5500


def test_filter_errors_are_explained(sales):
    with pytest.raises(ToolInputError, match="does not match the type"):
        filtering.apply_filters(sales, [Filter(column="revenue", op="gt", value="lots")])
    with pytest.raises(ToolInputError, match="only supported on numeric and date"):
        filtering.apply_filters(sales, [Filter(column="region", op="gt", value="A")])
    with pytest.raises(ToolInputError, match="needs a value"):
        filtering.apply_filters(sales, [Filter(column="region", op="eq")])


def test_filter_rows_sorts_and_limits(sales):
    result = filtering.filter_rows(sales, sort_by="revenue", columns=["order_id", "revenue"], limit=2)
    assert result.table.rows == [["O11", 2500], ["O3", 2000]]
    assert result.scalars["matched_rows"] == 12


# ---------------------------------------------------------------- statistics


def test_column_statistics_matches_pandas(sales):
    result = column_statistics.column_statistics(sales, ["revenue", "region"])
    rows = rows_by_first_column(result)
    assert rows["revenue"]["mean"] == pytest.approx(sales["revenue"].mean(), abs=1e-4)
    assert rows["revenue"]["median"] == sales["revenue"].median()
    assert rows["revenue"]["std"] == pytest.approx(sales["revenue"].std(), abs=1e-4)
    assert rows["revenue"]["min"] == 750 and rows["revenue"]["max"] == 2500
    assert rows["region"]["unique"] == 3 and rows["region"]["mode"] == "NA" and rows["region"]["mean"] is None


def test_value_counts(sales):
    result = column_statistics.value_counts(sales, "region")
    assert result.table.rows[0] == ["NA", 5, pytest.approx(41.67)]
    assert result.chart.type == "pie"  # three slices that make up the whole


def test_distribution_bins_cover_every_value(big_frame):
    result = column_statistics.distribution(big_frame, "x", bins=10)
    assert sum(row[1] for row in result.table.rows) == len(big_frame)
    assert result.scalars["median"] == pytest.approx(big_frame["x"].median(), abs=1e-4)
    assert result.chart.type == "histogram"


def test_outliers_iqr_flags_the_planted_value():
    frame = pd.DataFrame({"v": [10, 11, 12, 11, 10, 12, 11, 10, 12, 500], "id": range(10)})
    result = outlier_detection.outliers(frame, "v")
    assert result.scalars["outliers"] == 1 and result.scalars["high_outliers"] == 1
    assert result.table.rows[0][0] == 500
    assert any("unreliable" in note for note in result.notes)  # small-sample caveat


def test_data_quality_counts(sales):
    frame = pd.concat([sales, sales.iloc[[0]]], ignore_index=True)
    frame.loc[1, "price"] = np.nan
    frame["constant"] = 1
    result = missing_values.data_quality(frame)
    assert result.scalars["duplicate_rows"] == 1
    assert result.scalars["missing_cells"] == 1
    assert any("constant" in note.lower() for note in result.notes)


# ---------------------------------------------------------------- relationships


def test_t_distribution_p_values_match_reference_tables():
    assert correlation.t_test_p_value(2.0, 10) == pytest.approx(0.07339, abs=1e-4)
    assert correlation.t_test_p_value(2.228, 10) == pytest.approx(0.05, abs=5e-4)
    assert correlation.t_test_p_value(1.96, 1e6) == pytest.approx(0.05, abs=1e-3)
    assert correlation.t_test_p_value(0.0, 5) == pytest.approx(1.0)


def test_correlation_finds_the_linear_relationship(big_frame):
    result = correlation.correlation(big_frame)
    top = result.table.rows[0]
    assert {top[0], top[1]} == {"x", "y"}
    assert top[2] == pytest.approx(big_frame["x"].corr(big_frame["y"]), abs=1e-3)
    assert top[4] < 0.001 and top[5] == "strong"
    weak = next(row for row in result.table.rows if {row[0], row[1]} == {"x", "noise"})
    assert weak[5] in ("negligible", "weak")
    assert result.chart.type == "heatmap" and len(result.chart.data) == 9
    assert any("causation" in note for note in result.notes)


def test_correlation_ignores_identifier_columns():
    frame = pd.DataFrame({"customer_id": range(100), "a": np.arange(100) * 2.0, "b": np.arange(100)[::-1] * 1.0})
    result = correlation.correlation(frame)
    assert result.scalars["columns"] == 2


def test_compare_groups_welch_test():
    frame = pd.DataFrame({"g": ["a"] * 6 + ["b"] * 6, "v": [1, 2, 3, 4, 5, 6, 4, 5, 6, 7, 8, 9]})
    result = correlation.compare_groups(frame, "v", "g", "a", "b")
    assert result.scalars["mean_difference"] == -3
    assert result.scalars["t_statistic"] == pytest.approx(-2.777, abs=1e-3)
    assert result.scalars["p_value"] == pytest.approx(0.0195, abs=1e-3)
    assert "statistically significant" in result.scalars["verdict"] and "not" not in result.scalars["verdict"]
    assert any("Small samples" in note for note in result.notes)


def test_compare_groups_refuses_to_test_without_variance():
    frame = pd.DataFrame({"g": ["a", "b"], "v": [1.0, 2.0]})
    result = correlation.compare_groups(frame, "v", "g")
    assert result.scalars["verdict"] == "not testable" and "p_value" not in result.scalars


def test_scatter_reports_fit(big_frame):
    result = correlation.scatter(big_frame, "x", "y")
    assert result.scalars["slope"] == pytest.approx(2.0, abs=0.05)
    assert len(result.chart.data) == 300  # sampled for the chart; statistics use every point


# ---------------------------------------------------------------- time series


def test_time_series_monthly_values_and_changes(sales):
    result = time_series.time_series(sales, "date", "revenue", freq="M")
    values = {row[0]: row[1] for row in result.table.rows}
    assert values == {
        "2025-01": 2000,
        "2025-02": 3000,
        "2025-03": 2400,
        "2025-04": 3400,
        "2025-05": 3300,
        "2025-06": 3250,
    }
    changes = {row[0]: row[2] for row in result.table.rows}
    assert changes["2025-01"] is None and changes["2025-02"] == 50.0 and changes["2025-03"] == -20.0
    assert result.scalars["change_pct_first_to_last_period"] == 62.5
    assert result.scalars["highest_period"] == "2025-04"
    assert result.chart.type == "line"


def test_time_series_fills_missing_periods():
    frame = pd.DataFrame({"d": pd.to_datetime(["2025-01-10", "2025-03-10"]), "v": [5, 7]})
    result = time_series.time_series(frame, "d", "v", freq="M")
    assert [row[1] for row in result.table.rows] == [5, 0, 7]


def test_time_series_flags_incomplete_last_period():
    days = pd.date_range("2025-01-01", "2025-03-10", freq="D")
    result = time_series.time_series(pd.DataFrame({"d": days, "v": 1}), "d", "v", freq="M")
    assert any("incomplete" in note and "2025-03" in note for note in result.notes)


def test_time_series_declines_to_forecast_short_history(sales):
    result = time_series.time_series(sales, "date", "revenue", freq="M", forecast_periods=3)
    assert not any(key.startswith("forecast_") for key in result.scalars)
    assert any("No forecast" in note for note in result.notes)


def test_time_series_forecasts_a_clear_trend():
    frame = pd.DataFrame(
        {"d": pd.date_range("2024-01-01", periods=12, freq="MS"), "v": [100 + 10 * i for i in range(12)]}
    )
    result = time_series.time_series(frame, "d", "v", freq="M", forecast_periods=2)
    assert result.scalars["trend_direction"] == "upward"
    assert result.scalars["forecast_2025-01"] == pytest.approx(220, abs=0.01)
    assert result.scalars["forecast_2025-02"] == pytest.approx(230, abs=0.01)
    assert any("extrapolation" in note for note in result.notes)


def test_time_series_grouped_labels_the_periods_compared(sales):
    result = time_series.time_series(sales, "date", "revenue", freq="Q", group_by="region")
    assert result.scalars["first_period"] == "2025Q1" and result.scalars["last_period"] == "2025Q2"
    assert result.scalars["first_period_value[NA]"] == 4200 and result.scalars["last_period_value[NA]"] == 4000
    assert result.scalars["change_pct_first_to_last_period[NA]"] == pytest.approx(-4.76)
    assert "2025Q1" in result.summary and "2025Q2" in result.summary


def test_compare_periods_always_measures_earlier_to_later(sales):
    q1, q2 = ("2025-01-01", "2025-03-31"), ("2025-04-01", "2025-06-30")
    forward = time_series.compare_periods(sales, "date", "revenue", *q1, *q2)
    reversed_args = time_series.compare_periods(sales, "date", "revenue", *q2, *q1)
    for result in (forward, reversed_args):
        assert result.scalars["earlier_value"] == 7400 and result.scalars["later_value"] == 9950
        assert result.scalars["change_pct"] == pytest.approx(34.46)
        assert result.scalars["earlier_period"].startswith("2025-01-01")


def test_compare_periods_by_group(sales):
    result = time_series.compare_periods(
        sales, "date", "revenue", "2025-01-01", "2025-03-31", "2025-04-01", "2025-06-30", group_by="region"
    )
    rows = rows_by_first_column(result)
    assert rows["NA"]["earlier"] == 4200 and rows["NA"]["later"] == 4000
    assert rows["EU"]["change_pct"] == pytest.approx(45.45)


def test_compare_periods_warns_about_unequal_lengths(sales):
    result = time_series.compare_periods(
        sales, "date", "revenue", "2025-01-01", "2025-01-31", "2025-02-01", "2025-06-30"
    )
    assert any("differ in length" in note for note in result.notes)


def test_time_anomalies_finds_the_spike():
    values = [100, 102, 98, 101, 99, 103, 97, 100, 500, 101, 99, 100]
    frame = pd.DataFrame({"d": pd.date_range("2025-01-01", periods=12, freq="D"), "v": values})
    result = time_series.time_anomalies(frame, "d", "v", freq="D")
    assert result.scalars["anomalies"] == 1
    assert result.table.rows[0][0] == "2025-01-09" and result.table.rows[0][5] == "high"


def test_time_anomalies_needs_enough_history(sales):
    result = time_series.time_anomalies(sales, "date", "revenue", freq="M")
    assert result.scalars["anomalies"] == 0 and "too few" in result.summary


def test_time_series_requires_a_date_column(sales):
    with pytest.raises(ToolInputError, match="not a date column"):
        time_series.time_series(sales, "region", "revenue")


# ---------------------------------------------------------------- profiling


def test_profile_classifies_columns(sales):
    profile = profile_dataframe(sales)
    kinds = {column["name"]: column["kind"] for column in profile["columns"]}
    assert kinds == {
        "order_id": "identifier",
        "date": "datetime",
        "region": "categorical",
        "channel": "categorical",
        "units": "numeric",
        "price": "numeric",
        "status": "categorical",
        "revenue": "numeric",
    }
    assert profile["row_count"] == 12 and profile["quality"]["score"] == 100


def test_integer_keys_are_identifiers_not_measures():
    series = pd.Series([1, 2, 2, 3, 3, 3] * 10)
    assert classify_column("customer_id", series, 60) == "identifier"
    assert classify_column("units", series, 60) == "numeric"


def test_profile_quality_penalises_missing_and_duplicates():
    frame = pd.DataFrame({"a": [1, 1, None, None], "b": ["x", "x", None, "y"], "c": [1, 1, 1, 1]})
    profile = profile_dataframe(frame)
    assert profile["duplicate_rows"] == 1
    assert profile["quality"]["score"] < 80
    messages = " ".join(issue["message"] for issue in profile["quality"]["issues"])
    assert "missing" in messages and "single value" in messages and "duplicated" in messages


def test_results_never_contain_nan_or_inf():
    frame = pd.DataFrame({"g": ["a", "a", "b"], "v": [1.0, np.nan, np.inf], "z": [0.0, 0.0, 0.0]})
    result = aggregation.aggregate(frame, [Metric(column="v", agg="mean")], ["g"], derived=None)
    payload = result.model_dump_json()
    assert "NaN" not in payload and "Infinity" not in payload
    ratio = aggregation.aggregate(
        frame, [Metric(column="r", agg="sum")], derived=[Derived(name="r", expression="v / z")]
    )
    assert not any(isinstance(value, float) and math.isinf(value) for value in ratio.scalars.values())
