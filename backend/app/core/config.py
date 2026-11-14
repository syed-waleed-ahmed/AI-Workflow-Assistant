"""Application settings, loaded from environment variables (and `.env` in development)."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_DEV_SECRET = "dev-only-secret-change-me"  # noqa: S105 - rejected outside development


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- runtime ---
    environment: Literal["development", "test", "production"] = "development"
    log_level: str = "INFO"
    secret_key: str = _DEV_SECRET
    # Comma-separated list of browser origins allowed to call the API directly (CORS).
    frontend_origins: str = "http://localhost:3000"
    sentry_dsn: str | None = None
    # Number of reverse proxies in front of the app whose X-Forwarded-For entry is trusted.
    trusted_proxy_hops: int = 0

    # --- database ---
    database_url: str = "sqlite:///./dev.db"
    db_pool_size: int = 5

    # --- object storage ---
    storage_backend: Literal["local", "s3"] = "local"
    local_storage_dir: str = "./storage"
    s3_endpoint_url: str | None = None
    s3_region: str = "auto"
    s3_access_key_id: str | None = None
    s3_secret_access_key: str | None = None
    s3_bucket: str | None = None

    # --- LLM ---
    groq_api_key: str | None = None
    groq_model: str = "openai/gpt-oss-120b"
    llm_reasoning_effort: Literal["low", "medium", "high"] = "low"
    # Largest request (prompt + completion allowance) the provider accepts. Groq's free tier
    # rejects any single request above its tokens-per-minute limit, so prompts are sized to fit.
    llm_request_token_budget: int = 7600
    llm_max_rate_limit_wait_seconds: int = 90

    # --- sessions ---
    session_ttl_hours: int = 24 * 7
    session_cookie_name: str = "awa_session"
    csrf_cookie_name: str = "awa_csrf"

    # --- dataset limits ---
    max_upload_mb: int = 20
    max_rows: int = 250_000
    max_columns: int = 200
    max_cells: int = 5_000_000
    max_datasets_per_user: int = 25
    user_storage_quota_mb: int = 100

    # --- analysis limits ---
    daily_analysis_limit: int = 10
    max_concurrent_analyses_per_user: int = 1
    worker_concurrency: int = 1
    worker_enabled: bool = True
    analysis_timeout_seconds: int = 420
    max_tool_calls: int = 16
    max_agent_rounds: int = 5
    max_question_chars: int = 2000

    # --- rate limits (requests per minute) ---
    rate_limit_auth_per_minute: int = 10
    rate_limit_api_per_minute: int = 240
    rate_limit_upload_per_minute: int = 10

    @field_validator("database_url")
    @classmethod
    def _normalise_database_url(cls, value: str) -> str:
        # Providers hand out postgres:// or postgresql:// URLs; route both to psycopg 3.
        for prefix in ("postgres://", "postgresql://"):
            if value.startswith(prefix):
                return "postgresql+psycopg://" + value[len(prefix) :]
        return value

    @model_validator(mode="after")
    def _validate_production(self) -> Settings:
        if self.environment == "production":
            if self.secret_key == _DEV_SECRET or len(self.secret_key) < 32:
                raise ValueError("SECRET_KEY must be set to a random value of at least 32 characters")
            if self.database_url.startswith("sqlite"):
                raise ValueError("DATABASE_URL must point to PostgreSQL in production")
            if self.storage_backend != "s3":
                raise ValueError("STORAGE_BACKEND must be 's3' in production (local disk is ephemeral)")
        if self.storage_backend == "s3":
            missing = [
                name
                for name in ("s3_endpoint_url", "s3_access_key_id", "s3_secret_access_key", "s3_bucket")
                if not getattr(self, name)
            ]
            if missing:
                raise ValueError(f"S3 storage is enabled but these settings are missing: {missing}")
        return self

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip().rstrip("/") for origin in self.frontend_origins.split(",") if origin.strip()]

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @property
    def user_storage_quota_bytes(self) -> int:
        return self.user_storage_quota_mb * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    return Settings()
