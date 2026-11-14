"""Command-line entry point — the original interface of this project, on the new engine.

    python -m app.cli --data ../data/sample_data.csv --task "Analyze regional sales performance."

It runs the same LangGraph workflow as the web platform against a local CSV or Excel file and
prints the report as Markdown. No database or account is involved.
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
from pathlib import Path
from typing import Any

from app.agents.llm import GroqGateway, LLMError, RunControl
from app.agents.runner import run_analysis
from app.agents.state import AnalysisFailed, RunDeps, RunLimits
from app.core.config import get_settings
from app.core.exceptions import AppError
from app.tools.dataset_overview import profile_dataframe
from app.utils.file_validation import SheetSelectionRequired, parse_upload
from app.utils.markdown_utils import report_to_markdown


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="AI Workflow Assistant — analyse a CSV or Excel file.")
    parser.add_argument("--data", required=True, help="Path to a .csv, .tsv, .xlsx or .xls file.")
    parser.add_argument("--task", default="Generate a general analytical report for this dataset.")
    parser.add_argument("--sheet", default=None, help="Sheet name, for workbooks with several sheets.")
    parser.add_argument("--output", default=None, help="Write the Markdown report to this file.")
    parser.add_argument("--json", default=None, help="Also write the structured report as JSON to this file.")
    parser.add_argument("--verbose", action="store_true", help="Log rejected tool calls and model retries.")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO if args.verbose else logging.WARNING, stream=sys.stderr)

    settings = get_settings()
    path = Path(args.data)
    if not path.is_file():
        print(f"File not found: {path}", file=sys.stderr)
        return 2
    try:
        parsed = parse_upload(
            path.name,
            path.read_bytes(),
            sheet=args.sheet,
            max_rows=settings.max_rows,
            max_columns=settings.max_columns,
            max_cells=settings.max_cells,
        )
    except SheetSelectionRequired as exc:
        print(f"This workbook has several sheets; pass --sheet with one of: {', '.join(exc.sheets)}", file=sys.stderr)
        return 2
    except AppError as exc:
        print(exc.message, file=sys.stderr)
        return 2

    def emit(kind: str, label: str, detail: dict[str, Any] | None) -> None:
        if kind == "tool" and (detail or {}).get("state") != "done":
            return
        print(f"  [{kind}] {label}", file=sys.stderr)

    deps = RunDeps(
        question=args.task,
        dataset_name=path.name,
        frame=parsed.frame,
        profile=profile_dataframe(parsed.frame, parsed.notes),
        history=[],
        gateway=GroqGateway(settings),
        control=RunControl(
            deadline=time.monotonic() + settings.analysis_timeout_seconds,
            on_wait=lambda seconds: emit("status", f"Waiting {seconds:.0f}s for model capacity", None),
        ),
        limits=RunLimits(
            max_tool_calls=settings.max_tool_calls,
            max_agent_rounds=settings.max_agent_rounds,
            request_token_budget=settings.llm_request_token_budget,
        ),
        emit=emit,
    )
    try:
        result = run_analysis(deps)
    except (AnalysisFailed, LLMError) as exc:
        print(f"Analysis failed: {exc}", file=sys.stderr)
        return 1

    if args.json:
        Path(args.json).write_text(result.report.model_dump_json(indent=2), encoding="utf-8")
    markdown = report_to_markdown(result.report)
    if args.output:
        Path(args.output).write_text(markdown, encoding="utf-8")
        print(f"Report written to {args.output}", file=sys.stderr)
    else:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
        print(markdown)
    print(
        f"  [{result.llm_calls} model calls, {result.tool_calls} tool calls, {result.total_tokens} tokens]",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
