"""Create and migrate the databases a deployment needs. Idempotent.

Used by the integration suite and `make seed` to provision the **test** databases
(`POSTGRES_DB=poker_test`, `CLICKHOUSE_DB_PREFIX=test_`), and usable for a fresh real
environment. Two stores, two mechanisms:

- Postgres: the database named in settings is created if missing (via the `postgres`
  maintenance database), then Alembic runs to head.
- ClickHouse: the numbered SQL migrations run with the configured prefix (`ch.migrate`).
- Object storage: the raw-text bucket named in settings is created if missing.
- dbt: every model's table is created empty, so the stats API has something to read.
- The rollup's materialized views: fenced and backfilled (`scripts/mv_sync.py --create`).

Run:  uv run python -m api.provision
"""

from __future__ import annotations

import logging
import os
import subprocess
import sys
from pathlib import Path

import psycopg
from alembic import command
from alembic.config import Config

from ch import migrate as ch_migrate
from core.settings import get_settings
from ingestion.storage import s3_client

log = logging.getLogger(__name__)

PLATFORM = Path(__file__).resolve().parent.parent
ALEMBIC_INI = PLATFORM / "alembic.ini"
MAINTENANCE_DB = "postgres"


def ensure_postgres_database() -> bool:
    """Create the settings' Postgres database if it does not exist. True if created."""
    settings = get_settings()
    dsn = (
        f"postgresql://{settings.postgres_user}:{settings.postgres_password}"
        f"@{settings.postgres_host}:{settings.postgres_port}/{MAINTENANCE_DB}"
    )
    with psycopg.connect(dsn, autocommit=True) as conn:
        exists = conn.execute(
            "SELECT 1 FROM pg_database WHERE datname = %s", (settings.postgres_db,)
        ).fetchone()
        if exists:
            return False
        # Identifier, not a value: validated by pydantic as a plain name and quoted here.
        conn.execute(f'CREATE DATABASE "{settings.postgres_db}"')
    log.info("created postgres database %s", settings.postgres_db)
    return True


def migrate_postgres() -> None:
    """Alembic upgrade to head, against the settings' database."""
    command.upgrade(Config(str(ALEMBIC_INI)), "head")


def ensure_raw_bucket() -> bool:
    """Create the settings' raw-text bucket if it does not exist. True if created."""
    settings = get_settings()
    client = s3_client()
    existing = {b["Name"] for b in client.list_buckets().get("Buckets", [])}
    if settings.s3_raw_bucket in existing:
        return False
    client.create_bucket(Bucket=settings.s3_raw_bucket)
    log.info("created bucket %s", settings.s3_raw_bucket)
    return True


def build_empty_marts() -> None:
    """Create every dbt-managed table (staging views, intermediate, marts) with no rows.

    dbt owns those tables, not the migrations (ADR-017), so a fresh environment has none of
    them until dbt runs -- and the stats API reads `marts.stats_daily` on its first request.
    `--full-refresh` with `empty_chain: true` recreates each table from its own SELECT with
    an always-false gate (see dbt/poker_dwh/macros/incremental.sql), in seconds. dbt lives in
    its own virtualenv, hence a subprocess; it inherits `CLICKHOUSE_DB_PREFIX` from the
    environment like everything else.
    """
    dbt = PLATFORM / ".venv-dbt" / "bin" / "dbt"
    if not dbt.exists():
        raise RuntimeError(f"{dbt} not found; run `make dbt-install`")
    project = PLATFORM / "dbt" / "poker_dwh"
    env = {**os.environ, "CLICKHOUSE_PORT": str(get_settings().clickhouse_port)}
    subprocess.run(
        [
            str(dbt),
            "run",
            "--full-refresh",
            "--vars",
            "empty_chain: true",
            "--project-dir",
            str(project),
            "--profiles-dir",
            str(project),
        ],
        cwd=PLATFORM,
        env=env,
        check=True,
        capture_output=True,
    )


def create_rollup_views() -> None:
    """Fence and backfill the rollup's materialized views (ADR-044, ADR-047). Idempotent.

    After the marts exist, because the views read `marts.decisions`; a subprocess, because the
    script lives in `scripts/`, which nothing imports (`.importlinter`). Margin zero: nothing
    can be ingesting while an environment is being provisioned, and on an empty chain the
    backfill is instant. Without this a fresh environment would be read through a union with
    an empty half (`stats/query.py: rollup_from`).
    """
    env = {**os.environ, "CLICKHOUSE_PORT": str(get_settings().clickhouse_port)}
    result = subprocess.run(
        [sys.executable, "-m", "scripts.mv_sync", "--create", "--margin", "0"],
        cwd=PLATFORM,
        env=env,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"scripts.mv_sync --create failed:\n{result.stderr[-2000:]}")


def provision() -> None:
    """Create what is missing and apply every pending migration in every store."""
    ensure_postgres_database()
    migrate_postgres()
    ch_migrate.migrate()
    ensure_raw_bucket()
    build_empty_marts()
    create_rollup_views()


def drop_postgres_database() -> None:
    """Drop the settings' Postgres database. **Refuses unless its name ends in `_test`**."""
    settings = get_settings()
    if not settings.postgres_db.endswith("_test"):
        raise RuntimeError(f"refusing to drop non-test database {settings.postgres_db!r}")
    dsn = (
        f"postgresql://{settings.postgres_user}:{settings.postgres_password}"
        f"@{settings.postgres_host}:{settings.postgres_port}/{MAINTENANCE_DB}"
    )
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute(f'DROP DATABASE IF EXISTS "{settings.postgres_db}" WITH (FORCE)')


def main() -> int:
    """CLI entry point."""
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    provision()
    return 0


if __name__ == "__main__":
    sys.exit(main())
