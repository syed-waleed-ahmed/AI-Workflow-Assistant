"""Safe arithmetic expressions for calculated columns.

The model may ask for a derived column such as ``price * quantity``. The expression is parsed
with `ast` and evaluated by walking the tree ourselves: only numbers, column references and the
operators + - * / are accepted. Nothing is ever passed to `eval`, `exec` or `DataFrame.query`,
so attribute access, calls, subscripts, comprehensions and names that are not columns are all
rejected before any evaluation happens.
"""

from __future__ import annotations

import ast
import re

import numpy as np
import pandas as pd

from app.tools.types import ToolInputError
from app.utils.dataframe_utils import require_numeric

MAX_EXPRESSION_CHARS = 200
MAX_NODES = 40
_BACKTICK = re.compile(r"`([^`]+)`")
_BINARY_OPS = {
    ast.Add: lambda a, b: a + b,
    ast.Sub: lambda a, b: a - b,
    ast.Mult: lambda a, b: a * b,
    ast.Div: lambda a, b: a / b,
}


def evaluate_expression(df: pd.DataFrame, expression: str) -> pd.Series:
    """Evaluate an arithmetic expression over numeric columns of `df`.

    Column names that are not valid identifiers are written in backticks: ``\\`Unit Price\\` * Qty``.
    """
    if not expression or len(expression) > MAX_EXPRESSION_CHARS:
        raise ToolInputError(f"Expression must be 1-{MAX_EXPRESSION_CHARS} characters long.")

    placeholders: dict[str, str] = {}

    def _swap(match: re.Match[str]) -> str:
        token = f"__col{len(placeholders)}__"
        placeholders[token] = match.group(1)
        return token

    source = _BACKTICK.sub(_swap, expression)
    try:
        tree = ast.parse(source, mode="eval")
    except SyntaxError as exc:
        raise ToolInputError("Expression is not valid arithmetic. Use numbers, column names and + - * / only.") from exc
    if sum(1 for _ in ast.walk(tree)) > MAX_NODES:
        raise ToolInputError("Expression is too complex.")

    def _eval(node: ast.AST) -> pd.Series | float:
        if isinstance(node, ast.Expression):
            return _eval(node.body)
        if isinstance(node, ast.BinOp) and type(node.op) in _BINARY_OPS:
            return _BINARY_OPS[type(node.op)](_eval(node.left), _eval(node.right))
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub | ast.UAdd):
            operand = _eval(node.operand)
            return -operand if isinstance(node.op, ast.USub) else operand
        if isinstance(node, ast.Constant) and type(node.value) in (int, float):
            return float(node.value)
        if isinstance(node, ast.Name):
            column = placeholders.get(node.id, node.id)
            return require_numeric(df, column).astype("float64")
        raise ToolInputError("Expression may only contain numbers, column names and the operators + - * /.")

    result = _eval(tree)
    if not isinstance(result, pd.Series):
        raise ToolInputError("Expression must reference at least one column.")
    return result.replace([np.inf, -np.inf], np.nan)
