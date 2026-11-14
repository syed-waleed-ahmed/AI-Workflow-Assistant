"""Result types shared by every analytical tool.

Tools return validated, JSON-safe structures. The LLM reads a compact text rendering of them;
the API and the frontend read the structures themselves, so chart and table values always come
from a computation and never from model output.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

Scalar = int | float | str | bool | None


class Table(BaseModel):
    columns: list[str]
    rows: list[list[Scalar]]
    total_rows: int
    truncated: bool = False


class ChartSeries(BaseModel):
    key: str
    label: str


class Chart(BaseModel):
    """A chart specification the frontend can render directly.

    For `heatmap`, each data point is `{"x": ..., "y": ..., "value": ...}`. For every other type,
    each data point holds the `x_key` value plus one value per series key.
    """

    type: Literal["bar", "line", "pie", "histogram", "scatter", "heatmap"]
    title: str
    x_key: str
    x_label: str = ""
    y_label: str = ""
    series: list[ChartSeries] = Field(default_factory=list)
    data: list[dict[str, Scalar]] = Field(default_factory=list)


class ToolResult(BaseModel):
    summary: str
    scalars: dict[str, Scalar] = Field(default_factory=dict)
    table: Table | None = None
    chart: Chart | None = None
    notes: list[str] = Field(default_factory=list)


class ToolInputError(ValueError):
    """The tool arguments are invalid for this dataset. The message is shown to the model."""


JsonDict = dict[str, Any]
