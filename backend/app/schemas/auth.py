from __future__ import annotations

import re
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

_EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s.]{2,}$")
MIN_PASSWORD_LENGTH = 10
MAX_PASSWORD_LENGTH = 128


def _validate_password(value: str) -> str:
    if len(value) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters long.")
    if len(value) > MAX_PASSWORD_LENGTH:
        raise ValueError(f"Password must be at most {MAX_PASSWORD_LENGTH} characters long.")
    if value.isdigit() or len(set(value)) < 4:
        raise ValueError("Password is too simple. Mix letters, numbers or symbols.")
    return value


def _normalise_email(value: str) -> str:
    email = value.strip().lower()
    if len(email) > 320 or not _EMAIL.fullmatch(email):
        raise ValueError("Enter a valid email address.")
    return email


class RegisterRequest(BaseModel):
    email: str
    password: str
    name: str = Field(min_length=1, max_length=120)

    _email = field_validator("email")(_normalise_email)
    _password = field_validator("password")(_validate_password)

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        cleaned = " ".join(value.split())
        if not cleaned:
            raise ValueError("Enter your name.")
        return cleaned


class LoginRequest(BaseModel):
    email: str
    password: str = Field(min_length=1, max_length=MAX_PASSWORD_LENGTH)

    _email = field_validator("email")(_normalise_email)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    name: str
    created_at: datetime


class UpdateProfileRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        cleaned = " ".join(value.split())
        if not cleaned:
            raise ValueError("Enter your name.")
        return cleaned


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=MAX_PASSWORD_LENGTH)
    new_password: str

    _password = field_validator("new_password")(_validate_password)


class DeleteAccountRequest(BaseModel):
    password: str = Field(min_length=1, max_length=MAX_PASSWORD_LENGTH)


class UsageOut(BaseModel):
    analyses_today: int
    daily_analysis_limit: int
    analyses_total: int
    datasets: int
    max_datasets: int
    storage_used_bytes: int
    storage_quota_bytes: int
    reports: int
    max_upload_bytes: int
    max_rows: int
    max_columns: int
