"""Relationship analysis: correlation matrices and two-group significance tests.

p-values are computed from the Student t distribution using a small pure-Python implementation
of the regularised incomplete beta function, which avoids a SciPy dependency (roughly 100 MB
installed) on a memory-constrained host.
"""

from __future__ import annotations

import math
from typing import Literal

import numpy as np
import pandas as pd

from app.tools.dataset_overview import classify_column
from app.tools.filtering import Filter, apply_filters, describe_filters
from app.tools.types import Chart, Table, ToolInputError, ToolResult
from app.utils.dataframe_utils import clean_number, numeric_columns, require_columns, require_numeric, to_scalar

MAX_CORRELATION_COLUMNS = 12


def _betacf(a: float, b: float, x: float) -> float:
    """Continued fraction for the incomplete beta function (modified Lentz's method)."""
    tiny = 1e-300
    qab, qap, qam = a + b, a + 1.0, a - 1.0
    c = 1.0
    d = 1.0 - qab * x / qap
    d = 1.0 / (d if abs(d) > tiny else tiny)
    h = d
    for m in range(1, 300):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        d = 1.0 / (d if abs(d) > tiny else tiny)
        c = 1.0 + aa / c
        c = c if abs(c) > tiny else tiny
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        d = 1.0 / (d if abs(d) > tiny else tiny)
        c = 1.0 + aa / c
        c = c if abs(c) > tiny else tiny
        delta = d * c
        h *= delta
        if abs(delta - 1.0) < 1e-12:
            break
    return h


def regularized_incomplete_beta(a: float, b: float, x: float) -> float:
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    log_front = math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b) + a * math.log(x) + b * math.log1p(-x)
    front = math.exp(log_front)
    if x < (a + 1.0) / (a + b + 2.0):
        return front * _betacf(a, b, x) / a
    return 1.0 - front * _betacf(b, a, 1.0 - x) / b


def t_test_p_value(t_statistic: float, degrees_of_freedom: float) -> float:
    """Two-sided p-value of a t statistic."""
    if degrees_of_freedom <= 0 or math.isnan(t_statistic):
        return float("nan")
    if math.isinf(t_statistic):
        return 0.0
    x = degrees_of_freedom / (degrees_of_freedom + t_statistic * t_statistic)
    return regularized_incomplete_beta(degrees_of_freedom / 2.0, 0.5, x)


def _strength(r: float) -> str:
    magnitude = abs(r)
    if magnitude >= 0.7:
        return "strong"
    if magnitude >= 0.4:
        return "moderate"
    if magnitude >= 0.2:
        return "weak"
    return "negligible"


def correlation(
    df: pd.DataFrame,
    columns: list[str] | None = None,
    method: Literal["pearson", "spearman"] = "pearson",
    filters: list[Filter] | None = None,
) -> ToolResult:
    """Pairwise correlation between numeric columns, with sample size and p-value per pair."""
    data = apply_filters(df, filters)
    if columns:
        for column in columns:
            require_numeric(data, column)
        selected = list(dict.fromkeys(columns))
    else:
        selected = [c for c in numeric_columns(data) if classify_column(c, data[c], len(data)) == "numeric"]
    if len(selected) < 2:
        raise ToolInputError("Correlation needs at least two numeric columns with varying values.")
    notes: list[str] = []
    if len(selected) > MAX_CORRELATION_COLUMNS:
        notes.append(f"Limited to the first {MAX_CORRELATION_COLUMNS} of {len(selected)} numeric columns.")
        selected = selected[:MAX_CORRELATION_COLUMNS]

    numeric = data[selected].astype("float64")
    matrix = numeric.corr(method=method)
    pairs: list[list[object]] = []
    for i, left in enumerate(selected):
        for right in selected[i + 1 :]:
            r = matrix.loc[left, right]
            n = int((numeric[left].notna() & numeric[right].notna()).sum())
            if pd.isna(r) or n < 3:
                continue
            r = float(r)
            p_value = 0.0 if abs(r) >= 1.0 else t_test_p_value(r * math.sqrt((n - 2) / (1.0 - r * r)), n - 2)
            pairs.append([left, right, round(r, 3), n, round(p_value, 4), _strength(r)])
    pairs.sort(key=lambda row: abs(float(row[2])), reverse=True)  # type: ignore[arg-type]

    smallest_n = min((int(row[3]) for row in pairs), default=0)  # type: ignore[call-overload]
    if smallest_n and smallest_n < 30:
        notes.append(f"Some pairs rest on as few as {smallest_n} rows; small samples make correlations unstable.")
    notes.append("Correlation measures association, not causation.")

    heatmap = [
        {"x": left, "y": right, "value": clean_number(matrix.loc[left, right], 3)}
        for left in selected
        for right in selected
    ]
    top = pairs[0] if pairs else None
    return ToolResult(
        summary=(
            f"{method.capitalize()} correlation across {len(selected)} numeric columns over {len(data)} rows"
            f"{describe_filters(filters)}."
            + (f" Strongest: {top[0]} vs {top[1]} (r = {top[2]}, {top[5]})." if top else "")
        ),
        scalars={"columns": len(selected), "pairs": len(pairs)},
        table=Table(
            columns=["column_a", "column_b", "r", "n", "p_value", "strength"],
            rows=pairs[:20],  # type: ignore[arg-type]
            total_rows=len(pairs),
            truncated=len(pairs) > 20,
        ),
        chart=Chart(type="heatmap", title=f"{method.capitalize()} correlation matrix", x_key="x", data=heatmap),  # type: ignore[arg-type]
        notes=notes,
    )


def compare_groups(
    df: pd.DataFrame,
    value_column: str,
    group_column: str,
    group_a: str | None = None,
    group_b: str | None = None,
    filters: list[Filter] | None = None,
) -> ToolResult:
    """Test whether a numeric column differs between two groups (Welch's unequal-variance t-test).

    When the groups are not named, the two most frequent values of `group_column` are compared.
    """
    data = apply_filters(df, filters)
    values = require_numeric(data, value_column).astype("float64")
    require_columns(data, [group_column])
    keys = data[group_column].astype("string").str.strip()

    if group_a is None or group_b is None:
        common = keys.value_counts().index.tolist()
        if len(common) < 2:
            raise ToolInputError(f"Column '{group_column}' needs at least two groups to compare.")
        group_a, group_b = str(common[0]), str(common[1])

    def _sample(name: str) -> pd.Series:
        sample = values[keys.str.casefold() == name.strip().casefold()].dropna()
        if sample.empty:
            available = ", ".join(str(to_scalar(v)) for v in keys.dropna().unique()[:15])
            raise ToolInputError(f"No rows where {group_column} = '{name}'. Available values: {available}")
        return sample

    a, b = _sample(group_a), _sample(group_b)
    mean_a, mean_b = float(a.mean()), float(b.mean())
    scalars: dict[str, object] = {
        "group_a": group_a,
        "group_b": group_b,
        "n_a": len(a),
        "n_b": len(b),
        "mean_a": clean_number(mean_a),
        "mean_b": clean_number(mean_b),
        "median_a": clean_number(a.median()),
        "median_b": clean_number(b.median()),
        "mean_difference": clean_number(mean_a - mean_b),
    }
    notes: list[str] = []
    verdict = "not testable"
    if len(a) < 2 or len(b) < 2:
        notes.append("Each group needs at least 2 values for a significance test.")
    else:
        var_a, var_b = float(a.var()), float(b.var())
        standard_error = math.sqrt(var_a / len(a) + var_b / len(b))
        if standard_error == 0:
            notes.append("Both groups have zero variance, so a t-test is not defined.")
        else:
            t_statistic = (mean_a - mean_b) / standard_error
            numerator = (var_a / len(a) + var_b / len(b)) ** 2
            denominator = (var_a / len(a)) ** 2 / (len(a) - 1) + (var_b / len(b)) ** 2 / (len(b) - 1)
            dof = numerator / denominator if denominator else float(len(a) + len(b) - 2)
            p_value = t_test_p_value(t_statistic, dof)
            pooled = math.sqrt((var_a + var_b) / 2.0)
            scalars.update(
                {
                    "t_statistic": round(t_statistic, 3),
                    "degrees_of_freedom": round(dof, 1),
                    "p_value": round(p_value, 4),
                    "cohens_d": round((mean_a - mean_b) / pooled, 3) if pooled else None,
                }
            )
            verdict = (
                "statistically significant at the 5% level"
                if p_value < 0.05
                else "not statistically significant at the 5% level"
            )
            if min(len(a), len(b)) < 10:
                notes.append(
                    f"Small samples (n = {len(a)} and {len(b)}): the test has little power and "
                    "assumes roughly normal data, so treat the result as indicative only."
                )
    scalars["verdict"] = verdict
    return ToolResult(
        summary=(
            f"Mean {value_column}: {group_a} = {clean_number(mean_a)} (n={len(a)}) vs "
            f"{group_b} = {clean_number(mean_b)} (n={len(b)}){describe_filters(filters)}. Difference is {verdict}."
        ),
        scalars=scalars,  # type: ignore[arg-type]
        notes=notes,
    )


def scatter(df: pd.DataFrame, x_column: str, y_column: str, filters: list[Filter] | None = None) -> ToolResult:
    """Relationship between two numeric columns: correlation, fitted line and a scatter sample."""
    data = apply_filters(df, filters)
    x = require_numeric(data, x_column).astype("float64")
    y = require_numeric(data, y_column).astype("float64")
    both = pd.DataFrame({"x": x, "y": y}).dropna()
    if len(both) < 3:
        raise ToolInputError("Fewer than 3 rows have both values; a relationship cannot be assessed.")
    r = float(both["x"].corr(both["y"]))
    scalars: dict[str, object] = {"n": len(both), "r": round(r, 3) if not math.isnan(r) else None}
    notes = ["Correlation measures association, not causation."]
    if not math.isnan(r) and both["x"].nunique() > 1:
        slope, intercept = np.polyfit(both["x"], both["y"], 1)
        scalars.update(
            {
                "slope": clean_number(float(slope)),
                "intercept": clean_number(float(intercept)),
                "r_squared": round(r * r, 3),
                "strength": _strength(r),
            }
        )
    # A deterministic sample keeps the chart payload small while preserving the overall shape.
    sample = both if len(both) <= 300 else both.sample(300, random_state=0)
    if len(both) > 300:
        notes.append(f"Chart shows a random sample of 300 of {len(both)} points; statistics use all points.")
    return ToolResult(
        summary=f"{y_column} vs {x_column} over {len(both)} rows{describe_filters(filters)}: r = {scalars['r']}.",
        scalars=scalars,  # type: ignore[arg-type]
        chart=Chart(
            type="scatter",
            title=f"{y_column} vs {x_column}",
            x_key=x_column,
            x_label=x_column,
            y_label=y_column,
            data=[
                {x_column: clean_number(px), y_column: clean_number(py)}
                for px, py in zip(sample["x"], sample["y"], strict=True)
            ],
        ),
        notes=notes,
    )
