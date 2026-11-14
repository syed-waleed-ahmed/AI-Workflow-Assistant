"""Shared fixtures.

The environment is configured before any application module is imported, so the app under test
uses SQLite, local-disk storage in a temp directory, no background worker threads and no model
key. Tests that run analyses call `worker.process_next()` themselves with a scripted gateway.
"""

from __future__ import annotations

import io
import os
import tempfile
from collections.abc import Callable, Iterator
from typing import Any

_TMP = tempfile.mkdtemp(prefix="awa-tests-")
os.environ.update(
    {
        "ENVIRONMENT": "test",
        # CI also runs the suite against PostgreSQL by setting TEST_DATABASE_URL.
        "DATABASE_URL": os.environ.get("TEST_DATABASE_URL", "sqlite://"),
        "STORAGE_BACKEND": "local",
        "LOCAL_STORAGE_DIR": os.path.join(_TMP, "storage"),
        "WORKER_ENABLED": "false",
        "SECRET_KEY": "test-secret-key-that-is-long-enough-for-signing",
        "GROQ_API_KEY": "",
        "RATE_LIMIT_AUTH_PER_MINUTE": "1000",
        "RATE_LIMIT_API_PER_MINUTE": "100000",
        "RATE_LIMIT_UPLOAD_PER_MINUTE": "1000",
        "LOG_LEVEL": "WARNING",
    }
)

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from langchain_core.messages import AIMessage, BaseMessage  # noqa: E402
from pydantic import BaseModel  # noqa: E402

from app.agents.llm import RunControl, Usage  # noqa: E402
from app.agents.state import Plan  # noqa: E402
from app.core.config import get_settings  # noqa: E402
from app.core.db import Base, get_engine  # noqa: E402
from app.core.rate_limit import rate_limiter  # noqa: E402
from app.main import app  # noqa: E402
from app.schemas.report import Finding, KeyMetric, Recommendation, ReportDraft  # noqa: E402
from app.services.dataset_service import frame_cache  # noqa: E402
from app.workers.analysis_worker import worker  # noqa: E402

PASSWORD = "correct-horse-battery-9"


@pytest.fixture(autouse=True)
def _clean_state() -> Iterator[None]:
    """Fresh database, cache and rate-limit counters for every test."""
    engine = get_engine()
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    rate_limiter.reset()
    frame_cache.clear()
    yield
    worker.gateway_factory = _no_gateway


def _no_gateway() -> Any:
    raise AssertionError("a test ran an analysis without installing a scripted gateway")


@pytest.fixture
def settings() -> Iterator[Any]:
    """Mutable settings; changes are undone after the test."""
    current = get_settings()
    snapshot = current.model_dump()
    yield current
    for key, value in snapshot.items():
        object.__setattr__(current, key, value)


class ApiClient:
    """TestClient that echoes the CSRF cookie in a header, as the browser frontend does."""

    def __init__(self) -> None:
        self.http = TestClient(app)

    def request(self, method: str, path: str, *, csrf: bool = True, **kwargs: Any) -> Any:
        headers = dict(kwargs.pop("headers", {}) or {})
        token = self.http.cookies.get("awa_csrf")
        if csrf and token:
            headers.setdefault("X-CSRF-Token", token)
        return self.http.request(method, "/api/v1" + path, headers=headers, **kwargs)

    def get(self, path: str, **kwargs: Any) -> Any:
        return self.request("GET", path, **kwargs)

    def post(self, path: str, **kwargs: Any) -> Any:
        return self.request("POST", path, **kwargs)

    def patch(self, path: str, **kwargs: Any) -> Any:
        return self.request("PATCH", path, **kwargs)

    def delete(self, path: str, **kwargs: Any) -> Any:
        return self.request("DELETE", path, **kwargs)

    def register(self, email: str, name: str = "Test User", password: str = PASSWORD) -> dict[str, Any]:
        response = self.post("/auth/register", json={"email": email, "password": password, "name": name})
        assert response.status_code == 201, response.text
        return response.json()

    def upload(self, content: bytes, filename: str = "sales.csv", **form: str) -> Any:
        return self.post("/datasets", files={"file": (filename, content)}, data=form)


@pytest.fixture
def anon() -> ApiClient:
    return ApiClient()


@pytest.fixture
def alice() -> ApiClient:
    client = ApiClient()
    client.register("alice@example.com", "Alice")
    return client


@pytest.fixture
def bob() -> ApiClient:
    client = ApiClient()
    client.register("bob@example.com", "Bob")
    return client


# ----------------------------------------------------------------------------- data


def make_sales_frame() -> pd.DataFrame:
    """Small dataset with values chosen so expected results are easy to compute by hand."""
    return pd.DataFrame(
        {
            "order_id": [f"O{i}" for i in range(1, 13)],
            "date": pd.to_datetime(
                [
                    "2025-01-05", "2025-01-20", "2025-02-03", "2025-02-18", "2025-03-07", "2025-03-22",
                    "2025-04-04", "2025-04-19", "2025-05-06", "2025-05-21", "2025-06-08", "2025-06-23",
                ]
            ),
            "region": ["NA", "EU", "NA", "APAC", "EU", "NA", "APAC", "EU", "NA", "EU", "NA", "APAC"],
            "channel": ["Online", "Retail", "Online", "Online", "Retail", "Retail", "Online", "Online", "Retail", "Online", "Online", "Retail"],
            "units": [10, 5, 20, 4, 6, 12, 8, 7, 15, 9, 25, 3],
            "price": [100.0, 200.0, 100.0, 250.0, 200.0, 100.0, 250.0, 200.0, 100.0, 200.0, 100.0, 250.0],
            "status": ["won", "won", "lost", "won", "won", "won", "lost", "won", "won", "lost", "won", "won"],
        }
    ).assign(revenue=lambda frame: frame["units"] * frame["price"])  # fmt: skip


@pytest.fixture
def sales() -> pd.DataFrame:
    return make_sales_frame()


@pytest.fixture
def sales_csv() -> bytes:
    return make_sales_frame().to_csv(index=False, date_format="%Y-%m-%d").encode()


def make_xlsx(sheets: dict[str, pd.DataFrame]) -> bytes:
    buffer = io.BytesIO()
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        for name, frame in sheets.items():
            frame.to_excel(writer, sheet_name=name, index=False)
    return buffer.getvalue()


@pytest.fixture
def big_frame() -> pd.DataFrame:
    rng = np.random.default_rng(1)
    n = 400
    x = rng.normal(50, 10, n)
    return pd.DataFrame(
        {
            "day": pd.date_range("2024-01-01", periods=n, freq="D"),
            "group": rng.choice(["a", "b"], n),
            "x": x,
            "y": x * 2 + rng.normal(0, 1, n),
            "noise": rng.normal(0, 1, n),
        }
    )


# ----------------------------------------------------------------------------- scripted model


def tool_call(name: str, args: dict[str, Any], call_id: str = "call_1") -> AIMessage:
    return AIMessage(content="", tool_calls=[{"name": name, "args": args, "id": call_id, "type": "tool_call"}])


def batch(*calls: tuple[str, dict[str, Any]], call_id: str = "call_1") -> AIMessage:
    return tool_call("run_batch", {"calls": [{"tool": name, "args": args} for name, args in calls]}, call_id)


DONE = AIMessage(content="DONE")


def simple_draft(summary: str = "NA leads on revenue.", **overrides: Any) -> ReportDraft:
    fields: dict[str, Any] = {
        "title": "Regional revenue",
        "executive_summary": summary,
        "key_metrics": [KeyMetric(label="Top region revenue", value="8200", context="NA", evidence_ids=["E1"])],
        "findings": [
            Finding(title="NA leads", detail="NA has revenue of 8200.", significance="high", evidence_ids=["E1"])
        ],
        "anomalies": [],
        "data_quality": [],
        "chart_evidence_ids": ["E1"],
        "recommendations": [Recommendation(action="Invest in NA", rationale="It leads.", priority="medium")],
        "limitations": ["Small sample."],
    }
    fields.update(overrides)
    return ReportDraft(**fields)


class ScriptedGateway:
    """A `ModelGateway` that replays prepared responses and records what it was asked."""

    model_name = "scripted-test-model"

    def __init__(
        self,
        chat: list[AIMessage | Callable[[list[BaseMessage]], AIMessage]] | None = None,
        drafts: list[ReportDraft] | None = None,
        plan: Plan | Exception | None = None,
        on_chat: Callable[[RunControl], None] | None = None,
    ):
        self.usage = Usage()
        self._chat = list(chat if chat is not None else [DONE])
        self._drafts = list(drafts if drafts is not None else [simple_draft()])
        self._plan = plan or Plan(
            objective="Answer the question", steps=["Aggregate revenue by region"], tools=["aggregate"]
        )
        self._on_chat = on_chat
        self.chat_requests: list[list[BaseMessage]] = []
        self.chat_tools: list[list[dict[str, Any]] | None] = []
        self.structured_requests: list[tuple[type, list[BaseMessage]]] = []

    def _tick(self) -> None:
        self.usage.llm_calls += 1
        self.usage.prompt_tokens += 100
        self.usage.completion_tokens += 20

    def chat(self, messages: list[BaseMessage], *, tools: Any, max_tokens: int, control: RunControl) -> AIMessage:
        control.check()
        if self._on_chat:
            self._on_chat(control)
        self._tick()
        self.chat_requests.append(list(messages))
        self.chat_tools.append(tools)
        response = self._chat.pop(0) if len(self._chat) > 1 else self._chat[0]
        return response(messages) if callable(response) else response

    def structured(
        self, messages: list[BaseMessage], schema: type[BaseModel], *, max_tokens: int, control: RunControl
    ) -> Any:
        control.check()
        self._tick()
        self.structured_requests.append((schema, list(messages)))
        if schema is Plan:
            if isinstance(self._plan, Exception):
                raise self._plan
            return self._plan.model_copy(deep=True)
        draft = self._drafts.pop(0) if len(self._drafts) > 1 else self._drafts[0]
        return draft.model_copy(deep=True)


AGGREGATE_BY_REGION = ("aggregate", {"metrics": [{"column": "revenue", "agg": "sum"}], "group_by": ["region"]})


@pytest.fixture
def scripted() -> Callable[..., ScriptedGateway]:
    """Install a scripted gateway on the worker and return it."""

    def _install(**kwargs: Any) -> ScriptedGateway:
        kwargs.setdefault("chat", [batch(AGGREGATE_BY_REGION), DONE])
        gateway = ScriptedGateway(**kwargs)
        worker.gateway_factory = lambda: gateway
        return gateway

    return _install
