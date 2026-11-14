"""Accounts and server-side sessions."""

from __future__ import annotations

import logging
import uuid
from datetime import timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import utcnow
from app.core.exceptions import AuthenticationError, ConflictError
from app.core.security import (
    hash_password,
    hash_token,
    new_token,
    password_needs_rehash,
    verify_password,
)
from app.models import Analysis, Dataset, Report, UsageRecord, User, UserSession
from app.models.analysis import ACTIVE_STATUSES
from app.schemas.auth import UsageOut
from app.services import dataset_service

logger = logging.getLogger(__name__)


def register(db: Session, *, email: str, password: str, name: str) -> User:
    user = User(email=email, name=name, password_hash=hash_password(password))
    db.add(user)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError("An account with this email already exists.", code="email_taken") from exc
    logger.info("user registered", extra={"user_id": str(user.id)})
    return user


def authenticate(db: Session, *, email: str, password: str) -> User:
    user = db.scalar(select(User).where(User.email == email))
    # The hash is verified even when the account does not exist, to keep response times alike.
    if not verify_password(password, user.password_hash if user else None) or user is None:
        raise AuthenticationError("Incorrect email or password.", code="invalid_credentials")
    if password_needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)
        db.commit()
    return user


def create_session(db: Session, user: User) -> str:
    """Create a session and return its bearer token. Only the token's digest is stored."""
    token = new_token()
    now = utcnow()
    db.execute(delete(UserSession).where(UserSession.expires_at < now))
    db.add(
        UserSession(
            user_id=user.id,
            token_hash=hash_token(token),
            expires_at=now + timedelta(hours=get_settings().session_ttl_hours),
        )
    )
    db.commit()
    return token


def resolve_session(db: Session, token: str | None) -> User | None:
    if not token:
        return None
    session = db.scalar(select(UserSession).where(UserSession.token_hash == hash_token(token)))
    if session is None or session.expires_at <= utcnow():
        return None
    return db.get(User, session.user_id)


def end_session(db: Session, token: str | None) -> None:
    if token:
        db.execute(delete(UserSession).where(UserSession.token_hash == hash_token(token)))
        db.commit()


def change_password(
    db: Session, user: User, *, current_password: str, new_password: str, keep_token: str | None
) -> None:
    if not verify_password(current_password, user.password_hash):
        raise AuthenticationError("Your current password is incorrect.", code="invalid_credentials")
    user.password_hash = hash_password(new_password)
    # Changing the password signs out every other device.
    statement = delete(UserSession).where(UserSession.user_id == user.id)
    if keep_token:
        statement = statement.where(UserSession.token_hash != hash_token(keep_token))
    db.execute(statement)
    db.commit()


def delete_account(db: Session, user: User, *, password: str) -> None:
    if not verify_password(password, user.password_hash):
        raise AuthenticationError("Your password is incorrect.", code="invalid_credentials")
    user_id = user.id
    dataset_service.delete_all_for_user(db, user_id)
    # Foreign keys cascade from users to sessions, datasets, analyses, messages, events,
    # reports and usage records.
    db.delete(user)
    db.commit()
    logger.info("user deleted", extra={"user_id": str(user_id)})


def usage(db: Session, user_id: uuid.UUID) -> UsageOut:
    settings = get_settings()

    def _count(model: type, *conditions: object) -> int:
        return int(db.scalar(select(func.count()).select_from(model).where(*conditions)) or 0)  # type: ignore[arg-type]

    return UsageOut(
        analyses_today=analyses_in_window(db, user_id),
        daily_analysis_limit=settings.daily_analysis_limit,
        analyses_total=_count(UsageRecord, UsageRecord.user_id == user_id),
        datasets=_count(Dataset, Dataset.user_id == user_id),
        max_datasets=settings.max_datasets_per_user,
        storage_used_bytes=dataset_service.storage_used_bytes(db, user_id),
        storage_quota_bytes=settings.user_storage_quota_bytes,
        reports=_count(Report, Report.user_id == user_id),
        max_upload_bytes=settings.max_upload_bytes,
        max_rows=settings.max_rows,
        max_columns=settings.max_columns,
    )


def analyses_in_window(db: Session, user_id: uuid.UUID) -> int:
    """Analysis turns started in the last 24 hours: finished ones plus those still in progress."""
    since = utcnow() - timedelta(hours=24)
    # Turns that never reached the model (cancelled while queued, dataset missing) are free.
    finished = db.scalar(
        select(func.count())
        .select_from(UsageRecord)
        .where(UsageRecord.user_id == user_id, UsageRecord.created_at >= since, UsageRecord.llm_calls > 0)
    )
    active = db.scalar(
        select(func.count())
        .select_from(Analysis)
        .where(Analysis.user_id == user_id, Analysis.status.in_(ACTIVE_STATUSES))
    )
    return int(finished or 0) + int(active or 0)
