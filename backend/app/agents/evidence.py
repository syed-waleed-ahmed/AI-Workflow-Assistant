"""The evidence ledger: every tool result of a run, with its rendering for the model.

Dataset contents are untrusted. Before any cell value reaches a prompt it is flattened to a
single line, truncated and stripped of markup-like characters, and every tool result is wrapped
in a delimited block that the system prompt declares to be data, never instructions.
"""

from __future__ import annotations

import json
import re
from typing import Any

from pydantic import BaseModel, Field

from app.schemas.report import EvidenceRecord
from app.tools.types import Scalar, ToolResult

MAX_TEXT_CELL_CHARS = 60
_CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f  ]+")


def sanitize_text(value: str, limit: int = MAX_TEXT_CELL_CHARS) -> str:
    """Neutralise a string that originated in the user's data before it is shown to the model."""
    text = _CONTROL.sub(" ", value).replace("<", "‹").replace(">", "›").replace("`", "'")
    text = re.sub(r"\s{2,}", " ", text).strip()
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _cell(value: Scalar) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int | float):
        return repr(value)
    text = sanitize_text(str(value))
    return f'"{text}"' if "," in text else text


class Evidence(BaseModel):
    id: str
    tool: str
    label: str
    arguments: dict[str, Any]
    ok: bool
    error: str | None = None
    result: ToolResult | None = None

    def signature(self) -> str:
        return self.tool + ":" + json.dumps(self.arguments, sort_keys=True, default=str)

    def render(self, max_rows: int = 12) -> str:
        """Compact text form of the result for the model."""
        header = f'<tool_result id="{self.id}" tool="{self.tool}">'
        if not self.ok or self.result is None:
            return f"{header}\nERROR: {sanitize_text(self.error or 'failed', 400)}\n</tool_result>"
        result = self.result
        lines = [header, sanitize_text(result.summary, 400)]
        if result.scalars:
            lines.append("values: " + "; ".join(f"{key}={_cell(value)}" for key, value in result.scalars.items()))
        if result.table and max_rows > 0:
            table = result.table
            shown = table.rows[:max_rows]
            lines.append(f"table ({len(shown)} of {table.total_rows} rows):")
            lines.append(",".join(sanitize_text(column) for column in table.columns))
            lines.extend(",".join(_cell(value) for value in row) for row in shown)
        for note in result.notes[:3]:
            lines.append("note: " + sanitize_text(note, 300))
        lines.append("</tool_result>")
        return "\n".join(lines)

    def to_record(self) -> EvidenceRecord:
        result = self.result
        return EvidenceRecord(
            id=self.id,
            tool=self.tool,
            label=self.label,
            arguments=self.arguments,
            ok=self.ok,
            summary=(result.summary if result else self.error) or "",
            scalars=result.scalars if result else {},
            table=result.table if result else None,
            notes=result.notes if result else [],
        )


class EvidenceLedger(BaseModel):
    items: list[Evidence] = Field(default_factory=list)

    def next_id(self) -> str:
        return f"E{len(self.items) + 1}"

    def add(self, evidence: Evidence) -> None:
        self.items.append(evidence)

    def find_duplicate(self, tool: str, arguments: dict[str, Any]) -> Evidence | None:
        signature = tool + ":" + json.dumps(arguments, sort_keys=True, default=str)
        return next((item for item in self.items if item.signature() == signature), None)

    @property
    def successful(self) -> list[Evidence]:
        return [item for item in self.items if item.ok]

    def ids(self) -> set[str]:
        return {item.id for item in self.items if item.ok}

    def render(self, token_budget: int) -> str:
        """Render successful evidence, shrinking tables until the text fits the token budget."""
        from app.agents.llm import estimate_tokens

        for max_rows in (12, 8, 5, 3, 0):
            text = "\n".join(item.render(max_rows) for item in self.successful)
            if estimate_tokens(text) <= token_budget:
                return text
        # Still too large: keep the most recent results that fit.
        kept: list[str] = []
        used = 0
        for item in reversed(self.successful):
            block = item.render(0)
            used += estimate_tokens(block)
            if used > token_budget:
                break
            kept.append(block)
        return "\n".join(reversed(kept))
