"""Graph state and the per-run dependencies shared by the nodes."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Annotated, Any, TypedDict

import pandas as pd
from langchain_core.messages import BaseMessage
from langgraph.graph.message import add_messages
from pydantic import BaseModel, ConfigDict, Field

from app.agents.evidence import EvidenceLedger
from app.agents.llm import ModelGateway, RunControl
from app.schemas.report import ReportDraft


class Plan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    objective: str = Field(description="One sentence restating what will be answered.")
    steps: list[str] = Field(description="2-5 short analytical steps, each naming the columns involved.")
    tools: list[str] = Field(description="Names of the tools the steps need.")


class AgentState(TypedDict, total=False):
    """State carried between nodes.

    `messages` is the ReAct transcript (system, user, assistant and tool messages), exactly as in
    the original CLI agent; the remaining keys track the stages added around that loop.
    """

    messages: Annotated[Sequence[BaseMessage], add_messages]
    plan: Plan
    rounds: int
    verify_attempts: int
    draft: ReportDraft
    report_feedback: str
    grounding_attempts: int
    unverified_numbers: list[str]
    numbers_checked: int


@dataclass
class RunLimits:
    max_tool_calls: int
    max_agent_rounds: int
    request_token_budget: int


@dataclass
class RunDeps:
    """Everything a run needs that is not graph state. Built per analysis, never shared."""

    question: str
    dataset_name: str
    frame: pd.DataFrame  # the only data the tools can reach
    profile: dict[str, Any]
    history: list[dict[str, str]]
    gateway: ModelGateway
    control: RunControl
    limits: RunLimits
    emit: Callable[[str, str, dict[str, Any] | None], None]
    ledger: EvidenceLedger = field(default_factory=EvidenceLedger)
    tool_calls: int = 0


class AnalysisFailed(RuntimeError):
    """The run ended without a report. The message is safe to show to the user."""
