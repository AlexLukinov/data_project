"""Manually load shop-db (Postgres) -> ClickHouse: the pre-Airflow version of the pipeline.

Runs on the host against port-forwarded services (Postgres :5433, ClickHouse HTTP :8123).
Full extract each run into ReplacingMergeTree(_loaded_at) targets, so re-running is idempotent:
every run stamps a fresh _loaded_at, and on the next background merge the newest copy of each id
wins. Counts therefore only settle after a merge -- read with FINAL to see the deduplicated truth.

Config comes from env vars (defaults are the intentionally-committed lab creds); run with:
    python -m venv .venv && ./.venv/bin/pip install -r requirements.txt
    ./.venv/bin/python pg_to_clickhouse.py
"""
from __future__ import annotations

import os
from collections.abc import Iterator
from dataclasses import dataclass

import clickhouse_connect
import psycopg
from clickhouse_connect.driver.client import Client

BATCH_ROWS = 2000
TARGET_DB = "shop_raw"


@dataclass(frozen=True)
class TableSpec:
    """One source->target table: the Postgres columns to read and the ClickHouse DDL to land into."""

    source: str
    target: str
    columns: tuple[str, ...]
    ddl: str


TABLE_SPECS: tuple[TableSpec, ...] = (
    TableSpec(
        source="customers",
        target=f"{TARGET_DB}.customers",
        columns=("id", "name", "email", "city", "created_at"),
        ddl=f"""
            CREATE TABLE IF NOT EXISTS {TARGET_DB}.customers (
                id UInt64,
                name String,
                email String,
                city LowCardinality(String),
                created_at DateTime64(3, 'UTC'),
                _loaded_at DateTime64(3, 'UTC') DEFAULT now64(3)
            ) ENGINE = ReplacingMergeTree(_loaded_at) ORDER BY id
        """,
    ),
    TableSpec(
        source="orders",
        target=f"{TARGET_DB}.orders",
        columns=("id", "customer_id", "status", "order_ts", "amount", "created_at"),
        ddl=f"""
            CREATE TABLE IF NOT EXISTS {TARGET_DB}.orders (
                id UInt64,
                customer_id UInt64,
                status LowCardinality(String),
                order_ts DateTime64(3, 'UTC'),
                amount Decimal(10, 2),
                created_at DateTime64(3, 'UTC'),
                _loaded_at DateTime64(3, 'UTC') DEFAULT now64(3)
            ) ENGINE = ReplacingMergeTree(_loaded_at) ORDER BY id
        """,
    ),
    TableSpec(
        source="order_items",
        target=f"{TARGET_DB}.order_items",
        columns=("id", "order_id", "product", "quantity", "unit_price"),
        ddl=f"""
            CREATE TABLE IF NOT EXISTS {TARGET_DB}.order_items (
                id UInt64,
                order_id UInt64,
                product LowCardinality(String),
                quantity UInt32,
                unit_price Decimal(10, 2),
                _loaded_at DateTime64(3, 'UTC') DEFAULT now64(3)
            ) ENGINE = ReplacingMergeTree(_loaded_at) ORDER BY id
        """,
    ),
)


def pg_dsn() -> dict[str, object]:
    """Build the Postgres connection kwargs from env (defaults = lab creds over the port-forward)."""
    return {
        "host": os.environ.get("PG_HOST", "127.0.0.1"),
        "port": int(os.environ.get("PG_PORT", "5433")),
        "dbname": os.environ.get("PG_DB", "shop"),
        "user": os.environ.get("PG_USER", "shop"),
        "password": os.environ.get("PG_PASSWORD", "shop"),
    }


def connect_ch() -> Client:
    """Open a ClickHouse HTTP client from env (defaults = lab creds over the port-forward)."""
    return clickhouse_connect.get_client(
        host=os.environ.get("CH_HOST", "127.0.0.1"),
        port=int(os.environ.get("CH_PORT", "8123")),
        username=os.environ.get("CH_USER", "admin"),
        password=os.environ.get("CH_PASSWORD", "admin"),
    )


def ensure_schema(ch: Client, specs: tuple[TableSpec, ...]) -> None:
    """Create the target database and all target tables if absent (idempotent DDL)."""
    ch.command(f"CREATE DATABASE IF NOT EXISTS {TARGET_DB}")
    for spec in specs:
        ch.command(spec.ddl)


def stream_rows(pg: psycopg.Connection, spec: TableSpec) -> Iterator[list[tuple[object, ...]]]:
    """Yield source rows in batches via a server-side cursor -- never fetchall() the whole table."""
    col_list = ", ".join(spec.columns)  # identifiers are trusted module constants, not user input
    with pg.cursor(name=f"cur_{spec.source}") as cur:
        cur.execute(f"SELECT {col_list} FROM {spec.source}")
        while True:
            rows = cur.fetchmany(BATCH_ROWS)
            if not rows:
                break
            yield rows


def load_table(pg: psycopg.Connection, ch: Client, spec: TableSpec) -> int:
    """Stream every source row into the ClickHouse target in batches; return rows loaded."""
    total = 0
    for batch in stream_rows(pg, spec):
        ch.insert(spec.target, batch, column_names=list(spec.columns))
        total += len(batch)
    return total


def verify(pg: psycopg.Connection, ch: Client, spec: TableSpec) -> tuple[int, int]:
    """Return (source count(*), deduplicated target count() FINAL) for the post-load check."""
    with pg.cursor() as cur:
        cur.execute(f"SELECT count(*) FROM {spec.source}")
        row = cur.fetchone()
        src = 0 if row is None else int(row[0])
    dst = int(ch.command(f"SELECT count() FROM {spec.target} FINAL"))
    return src, dst


def main() -> None:
    """Run the full extract -> transform -> load -> verify pass for every table in the registry."""
    ch = connect_ch()
    ensure_schema(ch, TABLE_SPECS)
    failures = 0
    with psycopg.connect(**pg_dsn()) as pg:
        for spec in TABLE_SPECS:
            loaded = load_table(pg, ch, spec)
            src, dst = verify(pg, ch, spec)
            ok = src == dst
            failures += 0 if ok else 1
            tag = "OK" if ok else "MISMATCH"
            print(
                f"[{tag}] {spec.source} -> {spec.target}: "
                f"loaded={loaded} source={src} target_final={dst}",
                flush=True,
            )
    if failures:
        raise SystemExit(f"{failures} table(s) failed row-count verification")


if __name__ == "__main__":
    main()
