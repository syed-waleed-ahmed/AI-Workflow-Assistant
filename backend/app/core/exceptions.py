"""Application errors and the handlers that turn them into safe JSON responses."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import request_id_var

logger = logging.getLogger(__name__)


class AppError(Exception):
    """An expected failure with a message that is safe to show to the user."""

    status_code = 400
    code = "bad_request"

    def __init__(self, message: str, *, code: str | None = None, headers: dict[str, str] | None = None):
        super().__init__(message)
        self.message = message
        self.headers = headers
        if code:
            self.code = code


class AuthenticationError(AppError):
    status_code = 401
    code = "not_authenticated"


class PermissionDeniedError(AppError):
    status_code = 403
    code = "forbidden"


class NotFoundError(AppError):
    # Also returned when a resource exists but belongs to someone else, so ids cannot be probed.
    status_code = 404
    code = "not_found"


class ConflictError(AppError):
    status_code = 409
    code = "conflict"


class PayloadTooLargeError(AppError):
    status_code = 413
    code = "payload_too_large"


class UnprocessableError(AppError):
    status_code = 422
    code = "unprocessable"


class QuotaExceededError(AppError):
    status_code = 429
    code = "quota_exceeded"


class RateLimitedError(AppError):
    status_code = 429
    code = "rate_limited"


class ServiceUnavailableError(AppError):
    status_code = 503
    code = "service_unavailable"


def _body(code: str, message: str, details: Any = None) -> dict[str, Any]:
    error: dict[str, Any] = {"code": code, "message": message, "request_id": request_id_var.get()}
    if details is not None:
        error["details"] = details
    return {"error": error}


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(_body(exc.code, exc.message), status_code=exc.status_code, headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
        details = [
            {"field": ".".join(str(part) for part in err["loc"] if part != "body"), "message": err["msg"]}
            for err in exc.errors()
        ]
        message = details[0]["message"] if len(details) == 1 else "The request is not valid."
        return JSONResponse(_body("validation_error", message, details), status_code=422)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        codes = {404: "not_found", 405: "method_not_allowed"}
        return JSONResponse(
            _body(codes.get(exc.status_code, "http_error"), str(exc.detail)),
            status_code=exc.status_code,
            headers=getattr(exc, "headers", None),
        )

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        # The stack trace goes to the log; the client only learns the request id.
        logger.exception("unhandled error", extra={"path": request.url.path, "method": request.method})
        return JSONResponse(
            _body("internal_error", "Something went wrong on our side. Please try again."),
            status_code=500,
        )
