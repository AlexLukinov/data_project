"""ClickHouse migration runner.

**Why a 90-line runner instead of a framework** (docs/POKER_DECISIONS.md ADR-017): ClickHouse
has no Alembic-equivalent with comparable maturity, and the alternatives (`golang-migrate`,
`dbmate`) add a non-Python tool to the stack for something this small. Numbered, append-only
`.sql` files applied in order, with applied versions recorded in a table.

**Forward-only, deliberately.** ClickHouse DDL rollbacks are mostly fictional -- you cannot
un-drop a column's data -- so pretending otherwise would be theatre. Every statement is
written to be re-runnable (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT
EXISTS`), which means re-applying a migration is harmless.

Run:  uv run python -m ch.migrate          (or `make ch-migrate`)
"""

from __future__ import annotations

import logging
import re
import sys
from pathlib import Path

import clickhouse_connect
from clickhouse_connect.driver.client import Client

from core.settings import get_settings

log = logging.getLogger(__name__)

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"
VERSION_RE = re.compile(r"^(?P<version>\d{4})_(?P<name>[a-z0-9_]+)\.sql$")

# Statements are separated on semicolons at end-of-line. Deliberately simple: our migrations
# contain no stored procedures or string literals with embedded semicolons, and a real SQL
# splitter is a dependency we do not need.
_STATEMENT_SPLIT = re.compile(r";\s*(?:\n|$)")


def connect() -> Client:
    """Open a ClickHouse client from settings."""
    settings = get_settings()
    return clickhouse_connect.get_client(
        host=settings.clickhouse_host,
        port=settings.clickhouse_port,
        username=settings.clickhouse_user,
        password=settings.clickhouse_password,
    )


def ensure_bookkeeping(client: Client) -> None:
    """Create the table that records which migrations have run."""
    client.command("CREATE DATABASE IF NOT EXISTS _meta")
    client.command(
        "CREATE TABLE IF NOT EXISTS _meta.schema_migrations ("
        "version String, name String, applied_at DateTime64(3,'UTC') DEFAULT now64(3)) "
        "ENGINE = ReplacingMergeTree(applied_at) ORDER BY version"
    )


def applied_versions(client: Client) -> set[str]:
    """Versions already applied, per the bookkeeping table."""
    rows = client.query("SELECT version FROM _meta.schema_migrations FINAL").result_rows
    return {row[0] for row in rows}


def discover() -> list[tuple[str, str, Path]]:
    """Return (version, name, path) for every migration file, in order."""
    found: list[tuple[str, str, Path]] = []
    for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        match = VERSION_RE.match(path.name)
        if not match:
            raise ValueError(f"migration filename must be NNNN_name.sql, got {path.name!r}")
        found.append((match.group("version"), match.group("name"), path))
    return found


def apply(client: Client, version: str, name: str, path: Path) -> int:
    """Execute one migration file. Returns the number of statements run."""
    sql = path.read_text(encoding="utf-8")
    statements = [s.strip() for s in _STATEMENT_SPLIT.split(sql) if s.strip()]
    for statement in statements:
        client.command(statement)
    client.insert("_meta.schema_migrations", [[version, name]], column_names=["version", "name"])
    return len(statements)


def migrate() -> int:
    """Apply every pending migration. Returns how many were applied."""
    client = connect()
    ensure_bookkeeping(client)
    done = applied_versions(client)
    count = 0
    for version, name, path in discover():
        if version in done:
            log.info("skip   %s_%s (already applied)", version, name)
            continue
        statements = apply(client, version, name, path)
        log.info("apply  %s_%s (%d statements)", version, name, statements)
        count += 1
    log.info("clickhouse migrations: %d applied, %d already present", count, len(done))
    return count


def main() -> int:
    """CLI entry point."""
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    migrate()
    return 0


if __name__ == "__main__":
    sys.exit(main())
