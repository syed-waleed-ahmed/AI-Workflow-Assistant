# src/tools.py
from __future__ import annotations
import os
from typing import List

import pandas as pd
from langchain_core.tools import tool

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")


def _load_csv(path: str) -> pd.DataFrame:
    full_path = path
    if not os.path.isabs(full_path):
        full_path = os.path.join(DATA_DIR, path)

    if not os.path.exists(full_path):
        raise FileNotFoundError(
            f"CSV file not found: {full_path}. "
            f"Put your data in the 'data/' directory or provide an absolute path."
        )

    return pd.read_csv(full_path)


@tool
def load_csv_overview(path: str) -> str:
    """
    Load a CSV file and return a high-level overview:
    - shape
    - column names + types
    - first few rows
    """
    df = _load_csv(path)

    info = []
    info.append(f"Rows: {df.shape[0]}, Columns: {df.shape[1]}")
    info.append("\nColumn summary:")
    info.append(df.dtypes.to_string())

    info.append("\n\nSample rows (head):")
    info.append(df.head(5).to_markdown())

    return "\n".join(info)


@tool
def describe_column(path: str, column: str) -> str:
    """
    Describe a numeric column in a CSV:
    - count, mean, std, min, quartiles, max
    """
    df = _load_csv(path)

    if column not in df.columns:
        return f"Column '{column}' not found. Available columns: {list(df.columns)}"

    if not pd.api.types.is_numeric_dtype(df[column]):
        return f"Column '{column}' is not numeric. dtype={df[column].dtype}"

    desc = df[column].describe().to_frame().to_markdown()
    return f"Statistics for column '{column}':\n{desc}"


@tool
def filter_rows(path: str, condition: str, max_rows: int = 20) -> str:
    """
    Filter rows in a CSV using a pandas query expression, e.g.:

    condition="sales > 1000 and region == 'EMEA'"

    Returns the number of matched rows plus a small sample.
    """
    df = _load_csv(path)

    try:
        filtered = df.query(condition)
    except Exception as e:
        return f"Failed to apply condition '{condition}': {e}"

    out = []
    out.append(
        f"Condition '{condition}' matched {filtered.shape[0]} rows "
        f"out of {df.shape[0]}."
    )
    if filtered.shape[0] > 0:
        out.append("\nSample:")
        out.append(filtered.head(max_rows).to_markdown())

    return "\n".join(out)


# Export the tools list for easy binding in the graph
all_tools: List = [load_csv_overview, describe_column, filter_rows]
