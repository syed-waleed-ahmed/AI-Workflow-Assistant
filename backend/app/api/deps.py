"""Shared request dependencies: authentication, CSRF protection, rate limiting, pagination."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Query, Request, Response
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.db import get_db
from app.core.exceptions import AuthenticationError, PermissionDeniedError
from app.core.rate_limit import rate_limiter
from app.core.security import constant_time_equal, new_token
from app.models import User
from app.services import auth_service

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
CSRF_HEADER = "x-csrf-token"
# Set by the frontend's proxy (frontend/src/proxy.ts) on the requests it forwards.
PROXY_SECRET_HEADER = "x-awa-proxy-secret"  # noqa: S105 - a header name, not a secret
PROXY_CLIENT_IP_HEADER = "x-awa-client-ip"

DbSession = Annotated[Session, Depends(get_db)]
AppSettings = Annotated[Settings, Depends(get_settings)]


def proxy_stamped_address(request: Request) -> str | None:
    """The visitor's address stamped by the frontend's proxy, if the shared secret matches."""
    secret = get_settings().proxy_shared_secret
    if not secret:
        return None
    stamped = request.headers.get(PROXY_CLIENT_IP_HEADER, "").strip()
    if stamped and constant_time_equal(request.headers.get(PROXY_SECRET_HEADER, ""), secret):
        return stamped[:64]
    return None


def client_ip(request: Request) -> str:
    """The caller's address, for per-address rate limits.

    A request forwarded by the frontend's proxy carries the visitor's address and the shared
    secret; that address is used only when the secret matches, so a caller cannot choose its
    own. Otherwise X-Forwarded-For is honoured for the configured number of proxies, counted
    from the right, because each proxy appends the address that connected to it.
    """
    stamped = proxy_stamped_address(request)
    if stamped:
        return stamped
    settings = get_settings()
    hops = settings.trusted_proxy_hops
    forwarded = [part.strip() for part in request.headers.get("x-forwarded-for", "").split(",") if part.strip()]
    if hops > 0 and len(forwarded) >= hops:
        return forwarded[-hops]
    return request.client.host if request.client else "unknown"


def set_session_cookies(response: Response, token: str) -> None:
    settings = get_settings()
    max_age = settings.session_ttl_hours * 3600
    common = {"max_age": max_age, "secure": settings.is_production, "samesite": "lax", "path": "/"}
    # The session token is unreadable from JavaScript. The CSRF token must be readable so the
    # frontend can echo it in a header; an attacker's page on another origin cannot read it.
    response.set_cookie(settings.session_cookie_name, token, httponly=True, **common)  # type: ignore[arg-type]
    response.set_cookie(settings.csrf_cookie_name, new_token(), httponly=False, **common)  # type: ignore[arg-type]


def clear_session_cookies(response: Response) -> None:
    settings = get_settings()
    response.delete_cookie(settings.session_cookie_name, path="/")
    response.delete_cookie(settings.csrf_cookie_name, path="/")


def verify_csrf(request: Request) -> None:
    """Double-submit check for cookie-authenticated requests that change state."""
    if request.method in SAFE_METHODS:
        return
    cookie = request.cookies.get(get_settings().csrf_cookie_name, "")
    header = request.headers.get(CSRF_HEADER, "")
    if not cookie or not header or not constant_time_equal(cookie, header):
        raise PermissionDeniedError(
            "Your session could not be verified. Refresh the page and try again.", code="csrf_failed"
        )


def get_current_user(request: Request, db: DbSession) -> User:
    settings = get_settings()
    user = auth_service.resolve_session(db, request.cookies.get(settings.session_cookie_name))
    if user is None:
        raise AuthenticationError("Sign in to continue.")
    verify_csrf(request)
    rate_limiter.check(f"api:{user.id}", settings.rate_limit_api_per_minute)
    request.state.user_id = str(user.id)
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def auth_rate_limit(request: Request) -> None:
    settings = get_settings()
    # With a frontend proxy configured, sign-in and registration are accepted only through it,
    # because only there is the visitor's address known. Called directly, the API sits behind
    # an edge whose forwarded addresses a caller can influence (see DEPLOYMENT.md).
    if settings.proxy_shared_secret and proxy_stamped_address(request) is None:
        raise PermissionDeniedError("Sign in through the web app.", code="proxy_required")
    rate_limiter.check(f"auth:{client_ip(request)}", settings.rate_limit_auth_per_minute)


@dataclass
class Page:
    limit: int
    offset: int


def pagination(
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
) -> Page:
    return Page(limit=limit, offset=offset)


Pagination = Annotated[Page, Depends(pagination)]
