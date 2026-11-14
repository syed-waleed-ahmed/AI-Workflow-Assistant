"""The Groq gateway's retry and rate-limit handling, and the storage backends."""

from __future__ import annotations

import io
import time
from typing import Any

import groq
import httpx
import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.agents.llm import (
    DeadlineExceeded,
    GroqGateway,
    LLMConfigurationError,
    LLMError,
    RunCancelled,
    RunControl,
    _retry_after_seconds,
    estimate_tokens,
)
from app.agents.state import Plan
from app.core.config import Settings
from app.services.storage_service import LocalStorage, ObjectNotFoundError, S3Storage, StorageError

REQUEST = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")


def status_error(kind: type, status: int, headers: dict[str, str] | None = None, message: str = "error") -> Exception:
    return kind(message, response=httpx.Response(status, headers=headers or {}, request=REQUEST), body=None)


def rate_limited(retry_after: str = "0.01") -> Exception:
    return status_error(groq.RateLimitError, 429, {"retry-after": retry_after})


class FakeClient:
    """Stands in for ChatGroq: replays a list of outcomes (exceptions are raised)."""

    def __init__(self, outcomes: list[Any]):
        self.outcomes = list(outcomes)
        self.calls = 0
        self.bound_tools: Any = None

    def bind_tools(self, tools: Any) -> FakeClient:
        self.bound_tools = tools
        return self

    def with_structured_output(self, schema: Any, **_kwargs: Any) -> FakeClient:
        return self

    def invoke(self, _messages: Any) -> Any:
        self.calls += 1
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


def make_gateway(outcomes: list[Any], **settings: Any) -> tuple[GroqGateway, FakeClient]:
    gateway = GroqGateway(Settings(_env_file=None, groq_api_key="gsk_test", **settings))
    client = FakeClient(outcomes)
    gateway._client = lambda max_tokens, timeout: client  # type: ignore[method-assign]
    return gateway, client


def control(seconds: float = 30, **kwargs: Any) -> RunControl:
    return RunControl(deadline=time.monotonic() + seconds, **kwargs)


def answer(text: str = "DONE") -> AIMessage:
    return AIMessage(content=text, usage_metadata={"input_tokens": 120, "output_tokens": 30, "total_tokens": 150})


MESSAGES = [HumanMessage("hi")]


def test_missing_api_key_is_a_configuration_error():
    with pytest.raises(LLMConfigurationError, match="GROQ_API_KEY"):
        GroqGateway(Settings(_env_file=None, groq_api_key=None))


def test_chat_returns_the_message_and_records_usage():
    gateway, client = make_gateway([answer()])
    tools = [{"type": "function", "function": {"name": "aggregate"}}]
    assert gateway.chat(MESSAGES, tools=tools, max_tokens=100, control=control()).content == "DONE"
    assert client.bound_tools == tools
    assert (gateway.usage.llm_calls, gateway.usage.prompt_tokens, gateway.usage.completion_tokens) == (1, 120, 30)
    assert gateway.usage.total_tokens == 150


def test_rate_limit_waits_for_the_requested_interval_then_retries():
    waits: list[float] = []
    gateway, client = make_gateway([rate_limited("0.01"), rate_limited("0.02"), answer()])
    result = gateway.chat(MESSAGES, tools=None, max_tokens=100, control=control(on_wait=waits.append))
    assert result.content == "DONE" and client.calls == 3
    assert waits == [pytest.approx(1.01), pytest.approx(1.02)]  # requested interval plus a one-second margin


def test_rate_limit_longer_than_the_allowed_wait_fails_fast():
    gateway, client = make_gateway([rate_limited("600")], llm_max_rate_limit_wait_seconds=90)
    with pytest.raises(LLMError, match="usage limit has been reached"):
        gateway.chat(MESSAGES, tools=None, max_tokens=100, control=control(300))
    assert client.calls == 1


def test_rate_limit_longer_than_the_remaining_deadline_fails_fast():
    gateway, _ = make_gateway([rate_limited("20")])
    with pytest.raises(LLMError, match="usage limit"):
        gateway.chat(MESSAGES, tools=None, max_tokens=100, control=control(5))


def test_cancellation_interrupts_a_rate_limit_wait():
    state = {"cancelled": False}

    def on_wait(_seconds: float) -> None:
        state["cancelled"] = True

    gateway, _ = make_gateway([rate_limited("30"), answer()])
    started = time.monotonic()
    with pytest.raises(RunCancelled):
        gateway.chat(
            MESSAGES,
            tools=None,
            max_tokens=100,
            control=control(120, is_cancelled=lambda: state["cancelled"], on_wait=on_wait),
        )
    assert time.monotonic() - started < 2


def test_expired_deadline_prevents_any_request():
    gateway, client = make_gateway([answer()])
    with pytest.raises(DeadlineExceeded):
        gateway.chat(MESSAGES, tools=None, max_tokens=100, control=control(-1))
    assert client.calls == 0


@pytest.mark.parametrize(
    ("kind", "status"),
    [(groq.AuthenticationError, 401), (groq.PermissionDeniedError, 403), (groq.NotFoundError, 404)],
)
def test_rejected_credentials_or_model_are_not_retried(kind, status):
    gateway, client = make_gateway([status_error(kind, status, message="invalid api key gsk_live_secret")])
    with pytest.raises(LLMConfigurationError) as error:
        gateway.chat(MESSAGES, tools=None, max_tokens=100, control=control())
    assert client.calls == 1 and "gsk_live_secret" not in str(error.value)


def test_server_errors_are_retried_with_backoff_then_surface(monkeypatch):
    monkeypatch.setattr(RunControl, "sleep", lambda self, seconds: None)
    server_error = status_error(groq.InternalServerError, 503)
    gateway, client = make_gateway([server_error, answer()])
    assert gateway.chat(MESSAGES, tools=None, max_tokens=100, control=control()).content == "DONE"

    gateway, client = make_gateway([server_error, server_error, server_error, answer()])
    with pytest.raises(LLMError, match="returned an error"):
        gateway.chat(MESSAGES, tools=None, max_tokens=100, control=control())
    assert client.calls == 3


def test_malformed_tool_call_response_is_retried(monkeypatch):
    monkeypatch.setattr(RunControl, "sleep", lambda self, seconds: None)
    gateway, client = make_gateway([status_error(groq.BadRequestError, 400, message="tool_use_failed"), answer()])
    assert gateway.chat(MESSAGES, tools=None, max_tokens=100, control=control()).content == "DONE"
    assert client.calls == 2


def test_request_too_large_is_reported_without_retrying():
    gateway, client = make_gateway([status_error(groq.APIStatusError, 413)])
    with pytest.raises(LLMError, match="too large"):
        gateway.chat(MESSAGES, tools=None, max_tokens=100, control=control())
    assert client.calls == 1


def test_connection_failures_are_retried(monkeypatch):
    monkeypatch.setattr(RunControl, "sleep", lambda self, seconds: None)
    dropped = groq.APIConnectionError(request=REQUEST)
    gateway, _ = make_gateway([dropped, groq.APITimeoutError(request=REQUEST), answer()])
    assert gateway.chat(MESSAGES, tools=None, max_tokens=100, control=control()).content == "DONE"
    gateway, _ = make_gateway([dropped, dropped, dropped])
    with pytest.raises(LLMError, match="could not be reached"):
        gateway.chat(MESSAGES, tools=None, max_tokens=100, control=control())


def test_structured_output_is_validated_and_retried_once():
    plan = Plan(objective="o", steps=["s"], tools=["aggregate"])
    gateway, _ = make_gateway([{"raw": answer(), "parsed": plan, "parsing_error": None}])
    assert gateway.structured(MESSAGES, Plan, max_tokens=100, control=control()) == plan

    as_dict = {"raw": answer(), "parsed": plan.model_dump(), "parsing_error": None}
    gateway, _ = make_gateway([as_dict])
    assert gateway.structured(MESSAGES, Plan, max_tokens=100, control=control()) == plan

    broken = {"raw": answer(), "parsed": None, "parsing_error": ValueError("bad json")}
    gateway, client = make_gateway([broken, {"raw": answer(), "parsed": plan, "parsing_error": None}])
    assert gateway.structured(MESSAGES, Plan, max_tokens=100, control=control()) == plan
    assert client.calls == 2 and gateway.usage.llm_calls == 2

    wrong_shape = {"raw": answer(), "parsed": {"objective": "o"}, "parsing_error": None}
    gateway, client = make_gateway([wrong_shape, broken])
    with pytest.raises(LLMError, match="well-formed"):
        gateway.structured(MESSAGES, Plan, max_tokens=100, control=control())
    assert client.calls == 2


def test_retry_interval_is_read_from_header_or_message():
    assert _retry_after_seconds(rate_limited("12.5")) == 12.5
    from_message = status_error(groq.RateLimitError, 429, message="Rate limit reached. Please try again in 1m7.5s.")
    assert _retry_after_seconds(from_message) == 67.5
    assert _retry_after_seconds(status_error(groq.RateLimitError, 429, message="try again in 840ms")) == 10.0
    assert _retry_after_seconds(status_error(groq.RateLimitError, 429)) == 10.0


def test_token_estimate_is_conservative():
    text = "The quick brown fox jumps over the lazy dog. " * 40
    assert estimate_tokens(text) >= len(text.split()) * 1.2


# ---------------------------------------------------------------- storage


def test_local_storage_round_trip_and_key_validation(tmp_path):
    storage = LocalStorage(str(tmp_path))
    key = "datasets/5f0c1a52-0000-4000-8000-000000000001/5f0c1a52-0000-4000-8000-000000000002.parquet"
    storage.put(key, b"PAR1data")
    assert storage.get(key) == b"PAR1data"
    storage.delete(key)
    storage.delete(key)  # deleting twice is fine
    with pytest.raises(ObjectNotFoundError):
        storage.get(key)
    storage.check()


@pytest.mark.parametrize(
    "key",
    [
        "../outside.parquet",
        "datasets/../../etc/passwd",
        "/etc/passwd",
        "datasets/a/../../b.parquet",
        "C:\\windows\\system32\\x.parquet",
        "datasets\\a\\b.parquet",
        "datasets/a/b",
        "datasets/a b/c.parquet",
        "datasets/a/b.parquet\x00.txt",
        "",
    ],
)
def test_storage_rejects_keys_that_are_not_application_generated(tmp_path, key):
    storage = LocalStorage(str(tmp_path / "root"))
    for operation in (lambda: storage.put(key, b"x"), lambda: storage.get(key), lambda: storage.delete(key)):
        with pytest.raises(StorageError, match="invalid storage key"):
            operation()
    assert not (tmp_path / "outside.parquet").exists()


class FakeS3:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}
        self.available = True

    def _error(self, code: str, operation: str) -> Exception:
        from botocore.exceptions import ClientError

        return ClientError({"Error": {"Code": code, "Message": "secret-internal-detail"}}, operation)

    def put_object(self, Bucket: str, Key: str, Body: bytes, ContentType: str) -> None:
        if not self.available:
            raise self._error("ServiceUnavailable", "PutObject")
        self.objects[(Bucket, Key)] = Body

    def get_object(self, Bucket: str, Key: str) -> dict[str, Any]:
        if not self.available:
            raise self._error("ServiceUnavailable", "GetObject")
        if (Bucket, Key) not in self.objects:
            raise self._error("NoSuchKey", "GetObject")
        return {"Body": io.BytesIO(self.objects[(Bucket, Key)])}

    def delete_object(self, Bucket: str, Key: str) -> None:
        if not self.available:
            raise self._error("ServiceUnavailable", "DeleteObject")
        self.objects.pop((Bucket, Key), None)

    def head_bucket(self, Bucket: str) -> None:
        if not self.available:
            raise self._error("ServiceUnavailable", "HeadBucket")


@pytest.fixture
def s3(monkeypatch) -> tuple[S3Storage, FakeS3, dict[str, Any]]:
    fake, captured = FakeS3(), {}

    def client(service: str, **kwargs: Any) -> FakeS3:
        captured.update(kwargs, service=service)
        return fake

    monkeypatch.setattr("boto3.client", client)
    settings = Settings(
        _env_file=None,
        storage_backend="s3",
        s3_endpoint_url="https://project.storage.supabase.co/storage/v1/s3",
        s3_region="eu-central-1",
        s3_access_key_id="key",
        s3_secret_access_key="secret",
        s3_bucket="datasets",
    )
    return S3Storage(settings), fake, captured


def test_s3_storage_round_trip(s3):
    storage, fake, captured = s3
    key = "datasets/user/file.parquet"
    storage.put(key, b"PAR1")
    assert fake.objects == {("datasets", key): b"PAR1"}
    assert storage.get(key) == b"PAR1"
    storage.delete(key)
    with pytest.raises(ObjectNotFoundError):
        storage.get(key)
    storage.check()
    assert captured["service"] == "s3" and captured["endpoint_url"].endswith("/storage/v1/s3")
    assert captured["config"].s3 == {"addressing_style": "path"} and captured["config"].signature_version == "s3v4"


def test_s3_failures_become_storage_errors_without_provider_details(s3):
    storage, fake, _ = s3
    fake.available = False
    for operation in (
        lambda: storage.put("datasets/u/f.parquet", b"x"),
        lambda: storage.get("datasets/u/f.parquet"),
        lambda: storage.delete("datasets/u/f.parquet"),
        storage.check,
    ):
        with pytest.raises(StorageError) as error:
            operation()
        assert "secret-internal-detail" not in str(error.value)
        assert not isinstance(error.value, ObjectNotFoundError)


def test_s3_storage_validates_keys_before_calling_the_provider(s3):
    storage, fake, _ = s3
    with pytest.raises(StorageError, match="invalid storage key"):
        storage.put("../../other-bucket/x.parquet", b"x")
    assert fake.objects == {}


def test_upload_fails_cleanly_when_storage_is_down(alice, sales_csv, monkeypatch):
    def unavailable(_key: str, _data: bytes) -> None:
        raise StorageError("could not store object")

    from app.services.storage_service import get_storage

    monkeypatch.setattr(get_storage(), "put", unavailable)
    response = alice.upload(sales_csv)
    assert response.status_code == 503 and response.json()["error"]["code"] == "service_unavailable"
    assert alice.get("/datasets").json()["total"] == 0  # no half-created dataset


def test_missing_stored_file_is_reported_not_crashed(alice, sales_csv):
    from sqlalchemy import select

    from app.core.db import session_scope
    from app.models import Dataset
    from app.services.dataset_service import frame_cache
    from app.services.storage_service import get_storage

    dataset_id = alice.upload(sales_csv).json()["id"]
    with session_scope() as db:
        get_storage().delete(db.scalar(select(Dataset.storage_key)))
    frame_cache.clear()
    response = alice.get(f"/datasets/{dataset_id}/preview")
    assert response.status_code == 404 and "no longer available" in response.json()["error"]["message"]
