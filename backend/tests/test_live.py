"""Opt-in tests against the real Groq API.

Deselected by default because they spend real model quota:

    GROQ_API_KEY=... pytest -m live

They check what mocks cannot: that the configured model exists, accepts the tool schemas, returns
structured output the schemas can parse, and that a real run ends in a verified report.
"""

from __future__ import annotations

import os
import time

import pytest

from app.agents import toolkit
from app.agents.llm import GroqGateway, RunControl
from app.agents.runner import run_analysis
from app.agents.state import Plan, RunDeps, RunLimits
from app.core.config import Settings
from app.tools.dataset_overview import profile_dataframe
from tests.conftest import make_sales_frame

LIVE_KEY = os.environ.get("LIVE_GROQ_API_KEY") or ""
pytestmark = [
    pytest.mark.live,
    pytest.mark.skipif(not LIVE_KEY, reason="set LIVE_GROQ_API_KEY to run tests against the real Groq API"),
]


@pytest.fixture
def live_settings() -> Settings:
    return Settings(
        _env_file=None, groq_api_key=LIVE_KEY, groq_model=os.environ.get("LIVE_GROQ_MODEL", "openai/gpt-oss-120b")
    )


def test_model_accepts_tool_schemas_and_structured_output(live_settings):
    from langchain_core.messages import HumanMessage

    gateway = GroqGateway(live_settings)
    control = RunControl(deadline=time.monotonic() + 120)
    plan = gateway.structured(
        [
            HumanMessage(
                "Dataset columns: region (text), revenue (number). Plan how to find the top region. Tools: aggregate."
            )
        ],
        Plan,
        max_tokens=500,
        control=control,
    )
    assert plan.steps and gateway.usage.total_tokens > 0
    reply = gateway.chat(
        [HumanMessage("Call the aggregate tool to sum the revenue column grouped by region.")],
        tools=toolkit.tool_schemas(["aggregate"]),
        max_tokens=500,
        control=control,
    )
    assert reply.tool_calls and reply.tool_calls[0]["name"] in ("aggregate", "run_batch")


def test_real_analysis_produces_a_grounded_report(live_settings):
    frame = make_sales_frame()
    events: list[str] = []
    deps = RunDeps(
        question="Which region has the highest total revenue, and what share of revenue does it hold?",
        dataset_name="sales.csv",
        frame=frame,
        profile=profile_dataframe(frame),
        history=[],
        gateway=GroqGateway(live_settings),
        control=RunControl(deadline=time.monotonic() + 300),
        limits=RunLimits(
            max_tool_calls=12, max_agent_rounds=4, request_token_budget=live_settings.llm_request_token_budget
        ),
        emit=lambda kind, label, detail: events.append(label),
    )
    result = run_analysis(deps)
    report = result.report
    computed = [value for record in report.methodology if record.table for row in record.table.rows for value in row]
    assert 8200 in computed, "the NA revenue total must come from a tool result"
    assert "NA" in report.executive_summary or "North America" in report.executive_summary
    assert report.verification.numbers_checked > 0
    assert report.verification.status == "verified", report.verification.unverified_numbers
