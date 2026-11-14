"""Password hashing, session tokens and signed upload tickets."""

from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from itsdangerous import BadSignature, URLSafeTimedSerializer

from app.core.config import get_settings

_hasher = PasswordHasher()  # Argon2id with the library's recommended parameters
# Verified against when the account does not exist, so login timing does not reveal which emails
# are registered.
_DUMMY_HASH = _hasher.hash("timing-equalisation-placeholder")

UPLOAD_TICKET_TTL_SECONDS = 300


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerificationError, InvalidHashError):
        return False


def password_needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


def new_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """Session tokens are high-entropy, so a fast digest is sufficient for storage."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def constant_time_equal(left: str, right: str) -> bool:
    return hmac.compare_digest(left.encode("utf-8"), right.encode("utf-8"))


def _ticket_serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(get_settings().secret_key, salt="upload-ticket")


def issue_upload_ticket(user_id: uuid.UUID) -> str:
    """Short-lived credential that authorises exactly one thing: uploading a dataset as `user_id`.

    It lets the browser send the file straight to the API host instead of through the frontend
    host's proxy, which has a small request-body limit.
    """
    return _ticket_serializer().dumps({"uid": str(user_id)})


def verify_upload_ticket(ticket: str) -> uuid.UUID | None:
    try:
        payload = _ticket_serializer().loads(ticket, max_age=UPLOAD_TICKET_TTL_SECONDS)
        return uuid.UUID(payload["uid"])
    except (BadSignature, KeyError, ValueError, TypeError):
        return None
