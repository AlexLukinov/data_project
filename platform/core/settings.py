"""Configuration. One settings object, read from the environment, owned by `core`.

`pydantic-settings` rather than scattered `os.environ` calls: a missing or malformed setting
fails at startup with a readable error, instead of at 3am inside a worker with a KeyError.

Lives in `core` -- the bottom of the dependency stack -- because every service reads it: the
parser worker, the migration runner, the bulk importer and the API. When it lived in `api/`,
`ingestion` and `ch` imported the web layer to find their own configuration, and the worker
could not be shipped without FastAPI (docs/POKER_AUDIT.md B10, ADR-023).
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_JWT_SECRET = "dev-only-not-a-real-secret-change-me"
"""The placeholder shipped in `.env.example`. `api.main` refuses to start with it outside
`ENVIRONMENT=dev`: a known secret means anyone can mint a valid token for any tenant."""


class Settings(BaseSettings):
    """Every knob the platform reads. Defaults match `docker-compose.yml`."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # -- Deployment --------------------------------------------------------------
    environment: Literal["dev", "test", "prod"] = "dev"
    """Only `dev` tolerates the placeholder JWT secret and an insecure refresh cookie."""
    cors_origins: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]
    """Browser origins allowed to call the API with credentials. Explicit list, never `*`:
    the refresh cookie travels with these requests. The same-origin dashboard at `/` needs
    no entry. The Nuxt dev server (POKER_PLAN.md phase D) is the default."""

    # -- ClickHouse ------------------------------------------------------------
    clickhouse_host: str = "localhost"
    clickhouse_port: int = 8124
    clickhouse_user: str = "poker"
    clickhouse_password: str = "poker"

    # -- Postgres --------------------------------------------------------------
    postgres_host: str = "localhost"
    postgres_port: int = 5434
    postgres_user: str = "poker"
    postgres_password: str = "poker"
    postgres_db: str = "poker"

    # -- Redis -----------------------------------------------------------------
    redis_url: str = "redis://localhost:6380/0"
    stats_cache_ttl_seconds: int = 300

    # -- Object storage (S3-compatible) ---------------------------------------
    s3_endpoint: str = "http://localhost:9010"
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    s3_raw_bucket: str = "poker-raw"
    s3_region: str = "us-east-1"

    # -- Kafka -----------------------------------------------------------------
    kafka_bootstrap: str = "127.0.0.1:9094"
    kafka_uploads_topic: str = "hands.uploads.v1"
    kafka_bulk_topic: str = "hands.bulkimport.v1"
    kafka_deadletter_topic: str = "hands.deadletter.v1"
    kafka_consumer_group: str = "parser-workers"

    # -- Auth ------------------------------------------------------------------
    jwt_secret: str = Field(default=DEFAULT_JWT_SECRET)
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 30
    """Short-lived by policy. Refresh lives in an HttpOnly cookie, never in JS-reachable
    storage."""
    refresh_token_days: int = 14
    cookie_secure: bool = False
    """`Secure` flag on the refresh cookie. False only for plain-http local development;
    behind TLS it must be True, and `environment=prod` requires it."""
    auth_rate_limit_per_minute: int = 20
    """Login/register attempts allowed per client address per minute (see api/ratelimit.py)."""

    # -- Ingestion -------------------------------------------------------------
    insert_batch_size: int = 5_000
    """Rows per ClickHouse insert. One insert = one part; thousands of tiny inserts hit
    TOO_MANY_PARTS. Batching is not an optimization here, it is a correctness constraint."""
    max_upload_bytes: int = 200 * 1024 * 1024

    @property
    def postgres_dsn(self) -> str:
        """Async SQLAlchemy DSN."""
        return (
            f"postgresql+asyncpg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def postgres_sync_dsn(self) -> str:
        """SQLAlchemy sync DSN (driver-qualified).

        NOT interchangeable with `postgres_libpq_dsn`: SQLAlchemy needs the `+psycopg`
        dialect suffix, and libpq rejects it outright ("missing = in connection info
        string"). Two properties rather than one, because the failure is a runtime error in a
        code path that only runs after a successful ingest.
        """
        return (
            f"postgresql+psycopg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def postgres_libpq_dsn(self) -> str:
        """Plain libpq URI, for direct `psycopg.connect()` in the worker."""
        return (
            f"postgresql://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process-wide settings singleton."""
    return Settings()
