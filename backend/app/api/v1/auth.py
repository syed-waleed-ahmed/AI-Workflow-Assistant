from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response, status

from app.api.deps import (
    CurrentUser,
    DbSession,
    auth_rate_limit,
    clear_session_cookies,
    set_session_cookies,
)
from app.core.config import get_settings
from app.core.rate_limit import rate_limiter
from app.core.security import hash_token
from app.schemas.auth import LoginRequest, RegisterRequest, UserOut
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post(
    "/register", response_model=UserOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(auth_rate_limit)]
)
def register(payload: RegisterRequest, response: Response, db: DbSession) -> UserOut:
    """Create an account and start a session."""
    user = auth_service.register(db, email=payload.email, password=payload.password, name=payload.name)
    set_session_cookies(response, auth_service.create_session(db, user))
    return UserOut.model_validate(user)


@router.post("/login", response_model=UserOut, dependencies=[Depends(auth_rate_limit)])
def login(payload: LoginRequest, response: Response, db: DbSession) -> UserOut:
    """Start a session. The session token is set as an HttpOnly cookie."""
    # Per-account limit as well as the per-address one, so guessing one account's password
    # cannot be spread across many addresses.
    rate_limiter.check(f"login:{hash_token(payload.email)}", get_settings().rate_limit_auth_per_minute)
    user = auth_service.authenticate(db, email=payload.email, password=payload.password)
    set_session_cookies(response, auth_service.create_session(db, user))
    return UserOut.model_validate(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response, db: DbSession) -> None:
    """End the current session. Safe to call when already signed out."""
    auth_service.end_session(db, request.cookies.get(get_settings().session_cookie_name))
    clear_session_cookies(response)


@router.get("/me", response_model=UserOut)
def me(user: CurrentUser) -> UserOut:
    return UserOut.model_validate(user)
