"""Create, refresh and backfill the rollup's materialized views (ADR-044).

    uv run python -m scripts.mv_sync --status     what exists, what each view covers
    uv run python -m scripts.mv_sync --refresh    re-apply the generated view DDL
    uv run python -m scripts.mv_sync --create     boundary + views + backfill (the full path)

**Why this is not a migration.** `ch/migrations/` is append-only and the runner skips a version
it has already applied, so a regenerated file would never reach the database -- the view would
keep the previous registry's logic while `stats_daily.sql` moved on, which is precisely the
drift ADR-003 forbids. A view is pure derived DDL and dropping one never touches a row of its
target, so re-applying it is free and is done unconditionally. The two *tables* it needs do hold
data, so those stay in the numbered migration.

**The boundary-marker pattern** (docs/POKER_DATA_MODEL.md §464, plan step E.1). A materialized
view is forward-only: it sees rows inserted after it exists and nothing before, and `POPULATE`
silently drops whatever lands while it runs. So the order here is

    1. write the boundary T = now + margin, in the future
    2. create the view, fenced by `src_parsed_at >= T`
    3. wait until T has passed
    4. backfill `src_parsed_at < T` with an ordinary INSERT ... SELECT

which has neither a gap nor an overlap at any interleaving. A row stamped before T is either
already in the table (step 4 takes it) or arrives later and is skipped by the fence (step 4
still takes it); a row stamped at or after T can only arrive once the view exists. `parsed_at`
is stamped by the loader at ingest and flows straight into `src_parsed_at`, so it orders rows by
arrival, which is what makes T meaningful at all.

`marts.stats_daily_mv` is a COMPLETE rollup, not an increment: below the boundary from the
backfill, above it from the view. That is what lets `tests/integration/test_mv_reconciliation.py`
assert the thing ADR-003 actually asks for -- that the view's output equals a full dbt rebuild --
rather than asserting something weaker about a delta.
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
from datetime import UTC, datetime, timedelta

from clickhouse_connect.driver.client import Client

from ch.migrate import _STATEMENT_SPLIT, MIGRATIONS_DIR, connect, prefixed
from core.settings import get_settings
from scripts.rollup_sql import BOUNDARY, MV_ALIAS, MV_TARGET, _group_by, select_body
from stats.registry import registry

log = logging.getLogger(__name__)

VIEWS_FILE = MIGRATIONS_DIR.parent / "views" / f"{MV_TARGET}.sql"
SOURCES: tuple[str, ...] = ("decisions", "player_hands")
"""The two fact tables the rollup unions, and so the two views. One view per source: a
materialized view triggers on exactly one table."""

DEFAULT_MARGIN = 5.0
"""Seconds to put the boundary into the future. It only has to exceed the time between writing
the boundary row and the view existing -- two DDL statements -- so it is small on purpose: every
second of it is a second of rows the backfill has to sweep instead of the view catching them."""


def view_name(source: str) -> str:
    """The view that reads `source`."""
    return f"{MV_TARGET}_{source}"


def _db(name: str) -> str:
    """A logical database under the deployment's prefix (`marts` / `test_marts`)."""
    return get_settings().db(name)


def _sql(text: str) -> str:
    """Apply the deployment's database prefix to generated SQL, as the migration runner does."""
    return prefixed(text, get_settings().clickhouse_db_prefix)


def _has_sql(statement: str) -> bool:
    """Is there anything but comments here?

    The migration runner splits on `;` at end of line, and this file is mostly prose -- a
    semicolon inside a comment therefore yields a fragment with no SQL in it, which ClickHouse
    rejects as an empty query. Dropping those is right regardless of how the prose is worded.
    """
    return any(
        line.strip() and not line.strip().startswith("--") for line in statement.splitlines()
    )


def apply_views(client: Client) -> int:
    """Drop and recreate every generated view. Returns how many statements ran."""
    if not VIEWS_FILE.exists():
        raise RuntimeError(f"{VIEWS_FILE} is missing -- run `make gen`")
    fragments = _STATEMENT_SPLIT.split(_sql(VIEWS_FILE.read_text()))
    statements = [s.strip() for s in fragments if s.strip() and _has_sql(s)]
    for statement in statements:
        client.command(statement)
    log.info("applied %d view statements from %s", len(statements), VIEWS_FILE.name)
    return len(statements)


def set_boundary(client: Client, source: str, at: datetime) -> None:
    """Record the instant from which this view owns its source's rows."""
    client.insert(
        f"{_db('_meta')}.{BOUNDARY}",
        [[view_name(source), f"{_db('marts')}.{source}", at]],
        column_names=["view", "source", "boundary_at"],
    )


def boundaries(client: Client) -> dict[str, datetime]:
    """The current boundary per view."""
    rows = client.query(
        f"SELECT view, boundary_at FROM {_db('_meta')}.{BOUNDARY} FINAL"
    ).result_rows
    return {row[0]: row[1] for row in rows}


def backfill(client: Client, source: str, at: datetime) -> int:
    """Roll up every row stamped before the boundary, one day-partition at a time.

    Per partition rather than in one statement for the reason the whole chain is partitioned
    that way (ADR-019): peak memory is the size of one pass, and the target is a 4 GB node.
    """
    marts = _db("marts")
    days = client.query(
        f"SELECT DISTINCT played_date FROM {marts}.{source} "
        "WHERE src_parsed_at < %(at)s ORDER BY played_date",
        parameters={"at": at},
    ).result_rows
    for (day,) in days:
        client.command(
            f"INSERT INTO {marts}.{MV_TARGET}\n"
            + select_body(registry(), source)  # type: ignore[arg-type]
            # Aliased and qualified for the same reason the view is: `src_parsed_at` is also
            # the name of an aggregate alias in the shared SELECT body.
            + f"\nFROM {marts}.{source} AS {MV_ALIAS}\n"
            f"WHERE {MV_ALIAS}.src_parsed_at < %(at)s AND {MV_ALIAS}.played_date = %(day)s\n"
            f"GROUP BY {_group_by()}",
            parameters={"at": at, "day": day},
        )
    log.info("backfilled %s: %d day-partitions below the boundary", source, len(days))
    return len(days)


def create(client: Client, margin: float = DEFAULT_MARGIN) -> None:
    """The full boundary-marker path: fence the views into the future, then sweep up behind them."""
    at = datetime.now(UTC) + timedelta(seconds=margin)
    for source in SOURCES:
        set_boundary(client, source, at)
    log.info("boundary set to %s for %s", at.isoformat(), ", ".join(SOURCES))
    apply_views(client)

    remaining = (at - datetime.now(UTC)).total_seconds()
    if remaining > 0:
        log.info("waiting %.1fs for the boundary to pass before backfilling", remaining)
        time.sleep(remaining)
    for source in SOURCES:
        backfill(client, source, at)


def status(client: Client) -> None:
    """Print what exists and what each view covers."""
    marts, meta = _db("marts"), _db("_meta")
    current = boundaries(client)
    views = {
        row[0]
        for row in client.query(
            f"SELECT name FROM system.tables WHERE database = '{marts}' "
            "AND engine = 'MaterializedView'"
        ).result_rows
    }
    total = client.query(f"SELECT count() FROM {marts}.{MV_TARGET}").result_rows[0][0]
    print(f"{marts}.{MV_TARGET}: {total:,} rows")
    print(f"{meta}.{BOUNDARY}: {len(current)} boundaries")
    for source in SOURCES:
        name = view_name(source)
        mark = "present" if name in views else "MISSING -- run --create"
        at = current.get(name)
        print(f"  {name:<34} {mark:<24} boundary={at.isoformat() if at else 'unset'}")


def main(argv: list[str] | None = None) -> int:
    """CLI entry point."""
    ap = argparse.ArgumentParser(description=__doc__)
    group = ap.add_mutually_exclusive_group(required=True)
    group.add_argument("--status", action="store_true", help="show what exists")
    group.add_argument("--refresh", action="store_true", help="re-apply the view DDL only")
    group.add_argument("--create", action="store_true", help="boundary + views + backfill")
    ap.add_argument(
        "--margin",
        type=float,
        default=DEFAULT_MARGIN,
        help=f"seconds to place the boundary into the future (default {DEFAULT_MARGIN})",
    )
    args = ap.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    client = connect()
    if args.status:
        status(client)
    elif args.refresh:
        apply_views(client)
    else:
        create(client, args.margin)
    return 0


if __name__ == "__main__":
    sys.exit(main())
