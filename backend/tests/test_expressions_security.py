"""Calculated-column expressions must stay arithmetic. Anything else is rejected before evaluation."""

from __future__ import annotations

import pandas as pd
import pytest

from app.tools import aggregation, filtering
from app.tools.aggregation import Metric
from app.tools.expressions import evaluate_expression
from app.tools.filtering import Derived, Filter
from app.tools.types import ToolInputError


@pytest.fixture
def frame() -> pd.DataFrame:
    return pd.DataFrame(
        {"a": [1.0, 2.0, 3.0], "b": [10.0, 0.0, 30.0], "Unit Price": [5.0, 5.0, 5.0], "name": ["x", "y", "z"]}
    )


def test_arithmetic_is_evaluated(frame):
    assert evaluate_expression(frame, "a * b + 1").tolist() == [11.0, 1.0, 91.0]
    assert evaluate_expression(frame, "-(a - b) / 2").tolist() == [4.5, -1.0, 13.5]
    assert evaluate_expression(frame, "a * `Unit Price`").tolist() == [5.0, 10.0, 15.0]


def test_redundant_parentheses_are_harmless(frame):
    assert evaluate_expression(frame, "(" * 40 + "a" + ")" * 40).tolist() == [1.0, 2.0, 3.0]


def test_division_by_zero_becomes_missing(frame):
    assert evaluate_expression(frame, "a / b").isna().tolist() == [False, True, False]


@pytest.mark.parametrize(
    "expression",
    [
        "__import__('os').system('echo pwned')",
        "a.__class__",
        "a.__class__.__mro__[1].__subclasses__()",
        "open('/etc/passwd').read()",
        "eval('1+1')",
        "exec('import os')",
        "(lambda: 1)()",
        "a[0]",
        "[x for x in a]",
        "a if a else b",
        "a ** 999999",
        "a // b",
        "a % b",
        "a and b",
        "a == b",
        "a @ b",
        "'text' * 100000",
        "b'bytes'",
        "True",
        "None",
        "a; import os",
        "a\nimport os",
        "@pd.eval('1')",
        "pd.read_csv('x')",
        "df",
        "os",
        "name * 2",  # a real column, but not numeric
        "",
        "1 + 2",  # references no column
        "a + " * 60 + "a",
    ],
)
def test_everything_else_is_rejected(frame, expression):
    with pytest.raises(ToolInputError):
        evaluate_expression(frame, expression)


def test_rejected_expression_never_runs_side_effects(frame, tmp_path):
    marker = tmp_path / "pwned.txt"
    payload = f"__import__('pathlib').Path(r'{marker}').write_text('x')"
    with pytest.raises(ToolInputError):
        evaluate_expression(frame, payload)
    assert not marker.exists()


def test_backtick_names_cannot_smuggle_code(frame):
    with pytest.raises(ToolInputError, match="Unknown column"):
        evaluate_expression(frame, "`__import__('os')` + a")


def test_expression_length_is_bounded(frame):
    with pytest.raises(ToolInputError, match="characters long"):
        evaluate_expression(frame, "a + " * 100 + "a")


def test_calculated_column_cannot_overwrite_existing_data(frame):
    with pytest.raises(ToolInputError, match="overwrite"):
        filtering.apply_derived(frame, [Derived(name="a", expression="b * 2")])


def test_calculated_columns_do_not_mutate_the_shared_frame(frame):
    before = list(frame.columns)
    aggregation.aggregate(
        frame, [Metric(column="total", agg="sum")], derived=[Derived(name="total", expression="a * b")]
    )
    assert list(frame.columns) == before


@pytest.mark.parametrize(
    "value",
    ["x' or '1'='1", "@pd.eval('1')", "`a`; drop", "__import__('os')", 'x"; import os; "', "${7*7}", "{{7*7}}"],
)
def test_filter_values_are_compared_as_data_never_evaluated(frame, value):
    """The original tool passed model text to DataFrame.query(); filter values are now plain operands."""
    matched = filtering.apply_filters(frame, [Filter(column="name", op="eq", value=value)])
    assert len(matched) == 0
    contains = filtering.apply_filters(frame, [Filter(column="name", op="contains", value=value)])
    assert len(contains) == 0


def test_contains_treats_regex_metacharacters_literally():
    frame = pd.DataFrame({"name": ["a.c", "abc", "(x)+"]})
    assert len(filtering.apply_filters(frame, [Filter(column="name", op="contains", value="a.c")])) == 1
    assert len(filtering.apply_filters(frame, [Filter(column="name", op="contains", value="(x)+")])) == 1
    assert len(filtering.apply_filters(frame, [Filter(column="name", op="contains", value=".*")])) == 0


def test_unknown_filter_operator_is_rejected_by_the_schema():
    with pytest.raises(ValueError, match="Input should be"):
        Filter(column="a", op="query", value="1")  # type: ignore[arg-type]


def test_filter_and_derived_counts_are_capped(frame):
    with pytest.raises(ToolInputError, match="At most"):
        filtering.apply_filters(frame, [Filter(column="a", op="gt", value=0)] * 9)
    with pytest.raises(ToolInputError, match="At most"):
        filtering.apply_derived(frame, [Derived(name=f"c{i}", expression="a + 1") for i in range(5)])
