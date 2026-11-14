"""FastAPI application factory."""

from __future__ import annotations

import logging
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import __version__
from app.api.v1 import router as api_router
from app.api.v1.health import root_router as health_router
from app.core.config import get_settings
from app.core.exceptions import register_exception_handlers
from app.core.logging import configure_logging, request_id_var
from app.workers.analysis_worker import worker

logger = logging.getLogger("app.request")

# Uploads are multipart, so the request is slightly larger than the file itself.
_MULTIPART_OVERHEAD = 1024 * 1024
_JSON_BODY_LIMIT = 64 * 1024
_DOCS_PATHS = ("/docs", "/redoc", "/openapi.json")


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    if settings.worker_enabled:
        worker.start(settings.worker_concurrency)
    yield
    worker.stop()


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)
    if settings.sentry_dsn:
        import sentry_sdk

        # Request bodies and local variables are not sent: they can contain dataset contents.
        sentry_sdk.init(
            dsn=settings.sentry_dsn,
            environment=settings.environment,
            release=__version__,
            send_default_pii=False,
            max_request_body_size="never",
            include_local_variables=False,
            traces_sample_rate=0.0,
        )

    app = FastAPI(
        title="AI Workflow Assistant API",
        version=__version__,
        summary="Upload datasets, run AI-planned analyses computed with pandas, and export verified reports.",
        lifespan=lifespan,
    )
    register_exception_handlers(app)

    @app.middleware("http")
    async def request_context(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        request_id = uuid.uuid4().hex
        token = request_id_var.set(request_id)
        started = time.perf_counter()
        status_code = 500
        try:
            # Reject oversized bodies before reading them.
            declared = request.headers.get("content-length")
            is_upload = request.method == "POST" and request.url.path.rstrip("/") == "/api/v1/datasets"
            limit = settings.max_upload_bytes + _MULTIPART_OVERHEAD if is_upload else _JSON_BODY_LIMIT
            if declared and declared.isdigit() and int(declared) > limit:
                response: Response = JSONResponse(
                    {
                        "error": {
                            "code": "payload_too_large",
                            "message": f"Files are limited to {settings.max_upload_mb} MB."
                            if is_upload
                            else "The request body is too large.",
                            "request_id": request_id,
                        }
                    },
                    status_code=413,
                )
            else:
                response = await call_next(request)
            status_code = response.status_code
            response.headers["X-Request-ID"] = request_id
            response.headers["X-Content-Type-Options"] = "nosniff"
            response.headers["X-Frame-Options"] = "DENY"
            response.headers["Referrer-Policy"] = "no-referrer"
            response.headers["Cross-Origin-Resource-Policy"] = "same-site"
            if settings.is_production:
                response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
            if not request.url.path.startswith(_DOCS_PATHS):
                # The API serves data, never pages: forbid everything a browser could load from it.
                response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
                response.headers.setdefault("Cache-Control", "no-store")
            return response
        finally:
            if request.url.path not in ("/health", "/api/v1/health"):
                logger.info(
                    "request",
                    extra={
                        "method": request.method,
                        "path": request.url.path,
                        "status": status_code,
                        "duration_ms": round((time.perf_counter() - started) * 1000, 1),
                        "user_id": getattr(request.state, "user_id", None),
                    },
                )
            request_id_var.reset(token)

    # Browsers reach the API through the frontend's same-origin proxy, so CORS is only needed
    # for direct file uploads, which authenticate with an upload ticket instead of cookies.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["POST", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
        max_age=600,
    )

    app.include_router(health_router)
    app.include_router(api_router)
    return app


app = create_app()
