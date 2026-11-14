from __future__ import annotations

from fastapi import APIRouter, Request, Response, status

from app.api.deps import CurrentUser, DbSession, clear_session_cookies
from app.core.config import get_settings
from app.schemas.auth import (
    ChangePasswordRequest,
    DeleteAccountRequest,
    UpdateProfileRequest,
    UsageOut,
    UserOut,
)
from app.services import auth_service

router = APIRouter(prefix="/users/me", tags=["users"])


@router.patch("", response_model=UserOut)
def update_profile(payload: UpdateProfileRequest, user: CurrentUser, db: DbSession) -> UserOut:
    user.name = payload.name
    db.commit()
    return UserOut.model_validate(user)


@router.post("/password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(payload: ChangePasswordRequest, request: Request, user: CurrentUser, db: DbSession) -> None:
    """Change the password and sign out every other session."""
    auth_service.change_password(
        db,
        user,
        current_password=payload.current_password,
        new_password=payload.new_password,
        keep_token=request.cookies.get(get_settings().session_cookie_name),
    )


@router.get("/usage", response_model=UsageOut)
def usage(user: CurrentUser, db: DbSession) -> UsageOut:
    """Current usage against the account's limits."""
    return auth_service.usage(db, user.id)


@router.post("/delete", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(payload: DeleteAccountRequest, response: Response, user: CurrentUser, db: DbSession) -> None:
    """Permanently delete the account with all datasets, analyses and reports."""
    auth_service.delete_account(db, user, password=payload.password)
    clear_session_cookies(response)
