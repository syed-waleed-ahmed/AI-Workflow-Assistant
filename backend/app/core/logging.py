"""Structured JSON logging with request and analysis correlation ids."""

from __future__ import annotations

import json
import logging
import sys
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any

request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)
analysis_id_var: ContextVar[str | None] = ContextVar("analysis_id", default=None)

_RESERVED = set(logging.makeLogRecord({}).__dict__) | {"message", "asctime"}
# Belt and braces: values under these keys never reach the log, whoever passes them.
_SENSITIVE_KEYS = ("password", "token", "secret", "authorization", "cookie", "api_key", "ticket")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if request_id := request_id_var.get():
            payload["request_id"] = request_id
        if analysis_id := analysis_id_var.get():
            payload["analysis_id"] = analysis_id
        for key, value in record.__dict__.items():
            if key in _RESERVED or key.startswith("_"):
                continue
            if any(marker in key.lower() for marker in _SENSITIVE_KEYS):
                value = "[redacted]"
            payload[key] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level.upper())
    # Uvicorn's access log is replaced by the request middleware, which adds ids and timings.
    logging.getLogger("uvicorn.access").disabled = True
    for noisy in ("httpx", "httpcore", "botocore", "boto3", "urllib3", "groq"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
