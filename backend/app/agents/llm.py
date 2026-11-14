"""Model gateway: the single place where the application talks to an LLM.

The graph depends on the small `ModelGateway` protocol rather than on a provider SDK, so tests
drive the real graph with a scripted gateway and no network access.

The Groq implementation handles the provider's rate limits explicitly. On the free tier the
tokens-per-minute allowance is small, so a 429 is an expected event, not a failure: the gateway
waits for the interval the provider asks for (reporting the wait to the user) and retries,
within the run's deadline.
"""

from __future__ import annotations

import logging
import re
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol, TypeVar

from langchain_core.messages import AIMessage, BaseMessage
from pydantic import BaseModel, ValidationError

from app.core.config import Settings

logger = logging.getLogger(__name__)
SchemaT = TypeVar("SchemaT", bound=BaseModel)


class LLMError(RuntimeError):
    """The model could not be reached or did not return a usable answer."""


class LLMConfigurationError(LLMError):
    """The model is not configured (missing key, unknown model). Not worth retrying."""


class DeadlineExceeded(RuntimeError):
    pass


class RunCancelled(RuntimeError):
    pass


def estimate_tokens(text: str) -> int:
    """Conservative token estimate (about 3.3 characters per token for mixed prose and JSON)."""
    return int(len(text) / 3.3) + 1


def estimate_message_tokens(messages: list[BaseMessage], tools: list[dict[str, Any]] | None = None) -> int:
    total = 0
    for message in messages:
        total += estimate_tokens(str(message.content)) + 6
        for call in getattr(message, "tool_calls", None) or []:
            total += estimate_tokens(str(call.get("args", ""))) + 12
    if tools:
        total += estimate_tokens(str(tools))
    return total


@dataclass
class Usage:
    llm_calls: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens


@dataclass
class RunControl:
    """Deadline, cancellation and progress hooks shared by everything in one analysis run."""

    deadline: float  # time.monotonic() value
    is_cancelled: Callable[[], bool] = lambda: False
    on_wait: Callable[[float], None] = lambda _seconds: None

    def check(self) -> None:
        if self.is_cancelled():
            raise RunCancelled()
        if time.monotonic() >= self.deadline:
            raise DeadlineExceeded()

    def remaining(self) -> float:
        return self.deadline - time.monotonic()

    def sleep(self, seconds: float) -> None:
        """Sleep in short steps so cancellation and the deadline stay responsive."""
        end = time.monotonic() + seconds
        while (left := end - time.monotonic()) > 0:
            self.check()
            time.sleep(min(1.0, left))
        self.check()


class ModelGateway(Protocol):
    model_name: str
    usage: Usage

    def chat(
        self, messages: list[BaseMessage], *, tools: list[dict[str, Any]] | None, max_tokens: int, control: RunControl
    ) -> AIMessage: ...

    def structured(
        self, messages: list[BaseMessage], schema: type[SchemaT], *, max_tokens: int, control: RunControl
    ) -> SchemaT: ...


_RETRY_HINT = re.compile(r"try again in (?:(\d+)m)?([\d.]+)s", re.IGNORECASE)


def _retry_after_seconds(error: Any) -> float:
    headers = getattr(getattr(error, "response", None), "headers", None) or {}
    try:
        if value := headers.get("retry-after"):
            return float(value)
    except (TypeError, ValueError):
        pass
    if match := _RETRY_HINT.search(str(error)):
        return float(match.group(1) or 0) * 60 + float(match.group(2))
    return 10.0


class GroqGateway:
    """Groq-hosted chat models through LangChain's `ChatGroq`."""

    def __init__(self, settings: Settings):
        if not settings.groq_api_key:
            raise LLMConfigurationError("GROQ_API_KEY is not configured.")
        self.model_name = settings.groq_model
        self.usage = Usage()
        self._settings = settings

    def _client(self, max_tokens: int, timeout: float) -> Any:
        from langchain_groq import ChatGroq

        kwargs: dict[str, Any] = {}
        if self.model_name.startswith("openai/gpt-oss"):
            kwargs["reasoning_effort"] = self._settings.llm_reasoning_effort
        return ChatGroq(
            model=self.model_name,
            api_key=self._settings.groq_api_key,  # type: ignore[arg-type]
            temperature=0.1,
            max_tokens=max_tokens,
            max_retries=0,  # retries are handled here so waits respect the deadline and are visible
            timeout=timeout,
            **kwargs,
        )

    def _record(self, message: AIMessage | None) -> None:
        self.usage.llm_calls += 1
        metadata = getattr(message, "usage_metadata", None) or {}
        self.usage.prompt_tokens += int(metadata.get("input_tokens", 0))
        self.usage.completion_tokens += int(metadata.get("output_tokens", 0))

    def _call(self, invoke: Callable[[Any], Any], max_tokens: int, control: RunControl) -> Any:
        import groq

        transient_failures = 0
        while True:
            control.check()
            timeout = max(5.0, min(90.0, control.remaining()))
            try:
                return invoke(self._client(max_tokens, timeout))
            except groq.RateLimitError as exc:
                wait = _retry_after_seconds(exc) + 1.0
                if wait > self._settings.llm_max_rate_limit_wait_seconds or wait >= control.remaining():
                    raise LLMError(
                        "The AI model's usage limit has been reached. Please try again in a little while."
                    ) from exc
                logger.info("llm rate limited", extra={"wait_seconds": round(wait, 1)})
                control.on_wait(wait)
                control.sleep(wait)
            except (groq.AuthenticationError, groq.PermissionDeniedError, groq.NotFoundError) as exc:
                logger.error("llm configuration rejected", extra={"status": getattr(exc, "status_code", None)})
                raise LLMConfigurationError("The AI model is not available with the current configuration.") from exc
            except groq.APIStatusError as exc:
                status = getattr(exc, "status_code", 0)
                if status == 413:
                    raise LLMError("The analysis context grew too large for the AI model's request limit.") from exc
                # Groq reports a tool call the model formatted badly as a 400; one retry usually fixes it.
                transient_failures += 1
                if (status < 500 and status != 400) or transient_failures > 2:
                    logger.warning("llm request failed", extra={"status": status})
                    raise LLMError("The AI model returned an error. Please try again.") from exc
                control.sleep(2.0 * transient_failures)
            except (groq.APIConnectionError, groq.APITimeoutError) as exc:
                transient_failures += 1
                if transient_failures > 2:
                    raise LLMError("The AI model could not be reached. Please try again.") from exc
                control.sleep(2.0 * transient_failures)

    def chat(
        self, messages: list[BaseMessage], *, tools: list[dict[str, Any]] | None, max_tokens: int, control: RunControl
    ) -> AIMessage:
        def _invoke(client: Any) -> Any:
            return (client.bind_tools(tools) if tools else client).invoke(messages)

        response = self._call(_invoke, max_tokens, control)
        self._record(response)
        if not isinstance(response, AIMessage):
            raise LLMError("The AI model returned an unexpected response.")
        return response

    def structured(
        self, messages: list[BaseMessage], schema: type[SchemaT], *, max_tokens: int, control: RunControl
    ) -> SchemaT:
        def _invoke(client: Any) -> Any:
            return client.with_structured_output(schema, method="json_schema", strict=True, include_raw=True).invoke(
                messages
            )

        last_error: Exception | None = None
        for _attempt in range(2):
            output = self._call(_invoke, max_tokens, control)
            self._record(output.get("raw"))
            parsed = output.get("parsed")
            if isinstance(parsed, schema):
                return parsed
            if isinstance(parsed, dict):
                try:
                    return schema.model_validate(parsed)
                except ValidationError as exc:
                    last_error = exc
            else:
                last_error = output.get("parsing_error")
            logger.warning("llm structured output did not validate", extra={"schema": schema.__name__})
        raise LLMError("The AI model did not return a well-formed result.") from last_error
