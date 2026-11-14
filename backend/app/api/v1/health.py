"""Liveness and readiness. These endpoints never return configuration or error details."""

from __future__ import annotations

import logging
from typing import Literal

from fastapi import APIRouter, Response, status
from pydantic import BaseModel
from sqlalchemy import text

from app import __version__
from app.core.config import get_settings
from app.core.db import get_engine
from app.services.storage_service import StorageError, get_storage

logger = logging.getLogger(__name__)
router = APIRouter(tags=["health"])
root_router = APIRouter(tags=["health"])


class Health(BaseModel):
    status: Literal["ok"]
    version: str


class Readiness(BaseModel):
    status: Literal["ready", "degraded"]
    checks: dict[str, Literal["ok", "failed", "not_configured"]]


def _readiness(response: Response) -> Readiness:
    checks: dict[str, Literal["ok", "failed", "not_configured"]] = {}
    try:
        with get_engine().connect() as connection:
            connection.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception:
        logger.exception("readiness: database check failed")
        checks["database"] = "failed"
    try:
        get_storage().check()
        checks["storage"] = "ok"
    except StorageError:
        logger.exception("readiness: storage check failed")
        checks["storage"] = "failed"
    checks["llm"] = "ok" if get_settings().groq_api_key else "not_configured"

    ready = all(value == "ok" for value in checks.values())
    if not ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return Readiness(status="ready" if ready else "degraded", checks=checks)


@router.get("/health", response_model=Health)
@root_router.get("/health", response_model=Health)
def health() -> Health:
    """Liveness: the process is up."""
    return Health(status="ok", version=__version__)


@router.get("/ready", response_model=Readiness)
@root_router.get("/ready", response_model=Readiness)
def ready(response: Response) -> Readiness:
    """Readiness: the database and file storage are reachable and a model key is configured."""
    return _readiness(response)
