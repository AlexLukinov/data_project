"""Rebuild `core.*` with `hand_uid` as `FixedString(16)` (plan B.5b).

`hand_uid` leads the sort key of every core table, and a sort-key change is a **table rebuild,
not a migration** (ADR-017). Migration `0013` states the new DDL and performs that rebuild in
one shot, which is right for an empty or small database (a fresh deployment, the test
databases, CI) and wrong for one holding a real corpus: a single `INSERT ... SELECT` over
9.1M hands opens every partition at once, which is the failure ADR-019 exists to avoid.

This script is the same rebuild done a partition at a time, with the swap held back until the
copy has been proved identical:

    uv run python -m scripts.rebuild_core_uid --create    # the four core.<t>__v2 tables
    uv run python -m scripts.rebuild_core_uid --copy      # partition by partition, resumable
    uv run python -m scripts.rebuild_core_uid --verify    # row counts and hashes, old vs new
    uv run python -m scripts.rebuild_core_uid --exchange  # the swap; refuses on a failed verify
    uv run python -m scripts.rebuild_core_uid --drop-old  # only once everything else is green

`--copy` is idempotent: a partition whose row count already matches is skipped, so an
interrupted run resumes where it stopped. `--exchange` re-runs `--verify` itself and refuses
on the first disagreement rather than swapping a table it cannot vouch for. Nothing here
drops anything except `--drop-old`, which is a separate decision taken after the mart chain,
the API and the test suites are green.
"""

from __future__ import annotations

import argparse
import logging
import re
import sys

from clickhouse_connect.driver.client import Client

from core.settings import get_settings
from ingestion.clickhouse import clickhouse

log = logging.getLogger("rebuild_core_uid")

TABLES: tuple[str, ...] = ("hands", "hand_players", "actions", "pot_winners")
"""Every core table carrying `hand_uid`, smallest first is not worth it -- all four are copied."""

SUFFIX = "__v2"
OLD_TYPE = "`hand_uid` String"
NEW_TYPE = "`hand_uid` FixedString(16)"
CONVERT = "toFixedString(unhex(hand_uid), 16)"
"""Hex string to the 16 raw bytes. `unhex` alone returns `String`; the column is a
`FixedString(16)` and comparing the two is not the same thing, so the cast is not optional."""

MAX_MEMORY = 2_500_000_000
"""The node's per-query ceiling (`infra/clickhouse/limits.xml`). Stated here so a pass that
would exceed it fails loudly instead of taking the server's 3.6 GiB down with it."""


def core() -> str:
    """The core database, prefixed for the test suite and bare in production."""
    return get_settings().db("core")


def new_ddl(client: Client, table: str) -> str:
    """The `CREATE TABLE` for `<table>__v2`, derived from the live table.

    Taken from `SHOW CREATE` rather than restated, so the copy cannot silently differ from the
    original in a `DEFAULT`, a codec or a setting -- only in `hand_uid`'s type.
    """
    # `query`, not `command`: the latter hands back the TSV-escaped text, where every newline
    # is a literal backslash-n and the server refuses its own DDL.
    ddl = str(client.query(f"SHOW CREATE TABLE {core()}.{table}").result_rows[0][0])
    if OLD_TYPE not in ddl:
        raise SystemExit(f"{core()}.{table}: expected {OLD_TYPE!r} in its DDL; already rebuilt?")
    ddl = ddl.replace(OLD_TYPE, NEW_TYPE)
    return re.sub(
        rf"CREATE TABLE {re.escape(core())}\.{table}\b",
        f"CREATE TABLE {core()}.{table}{SUFFIX}",
        ddl,
        count=1,
    )


def create(client: Client) -> None:
    """Create the four `__v2` tables, skipping any that already exist."""
    for table in TABLES:
        target = f"{core()}.{table}{SUFFIX}"
        if int(client.query(f"EXISTS TABLE {target}").result_rows[0][0]):
            log.info("exists %s", target)
            continue
        client.command(new_ddl(client, table))
        log.info("create %s", target)


def partitions(client: Client, table: str) -> list[str]:
    """The partition ids of one table, oldest first."""
    rows = client.query(
        "SELECT DISTINCT partition FROM system.parts WHERE active "
        "AND database = {db:String} AND table = {t:String} ORDER BY partition",
        parameters={"db": core(), "t": table},
    ).result_rows
    return [str(row[0]) for row in rows]


def _rows(client: Client, table: str, partition: str) -> int:
    """Logical row count of one partition, i.e. `count()` under `FINAL`.

    Not the `system.parts` sum: both tables are `ReplacingMergeTree`, the source still holds
    the superseded rows of the 2026-09-11 re-parse, and merges collapse them in the copy as it
    runs -- so the physical counts differ by design and only the logical ones may be compared.
    """
    rows = client.query(
        f"SELECT count() FROM {core()}.{table} FINAL WHERE toYYYYMM(played_at_utc) = {{p:UInt32}}",
        parameters={"p": int(partition)},
        settings={"max_memory_usage": MAX_MEMORY},
    ).result_rows
    return int(rows[0][0] or 0)


def copy_partition(client: Client, table: str, partition: str) -> int:
    """Copy one partition into `<table>__v2`; returns its peak memory in bytes.

    `* REPLACE` projects every column in the table's own order with only `hand_uid` rewritten,
    so a column added later cannot be dropped here by a stale list.
    """
    query_id = f"b5b-{table}-{partition}"
    client.command(
        f"INSERT INTO {core()}.{table}{SUFFIX} "
        f"SELECT * REPLACE ({CONVERT} AS hand_uid) FROM {core()}.{table} "
        "WHERE toYYYYMM(played_at_utc) = {p:UInt32}",
        parameters={"p": int(partition)},
        settings={"max_memory_usage": MAX_MEMORY, "query_id": query_id},
    )
    client.command("SYSTEM FLUSH LOGS")
    peak = client.query(
        "SELECT max(memory_usage) FROM system.query_log "
        "WHERE query_id = {q:String} AND type = 'QueryFinish'",
        parameters={"q": query_id},
    ).result_rows
    return int(peak[0][0] or 0)


def copy(client: Client) -> None:
    """Copy every partition of every table, skipping those already complete."""
    for table in TABLES:
        for partition in partitions(client, table):
            want = _rows(client, table, partition)
            have = _rows(client, f"{table}{SUFFIX}", partition)
            if have == want:
                log.info("skip   %s %s (%d rows already)", table, partition, have)
                continue
            if have:
                raise SystemExit(
                    f"{table}{SUFFIX} partition {partition} holds {have} of {want} rows -- "
                    f"a half-copied partition; drop it and re-run: "
                    f"ALTER TABLE {core()}.{table}{SUFFIX} DROP PARTITION '{partition}'"
                )
            peak = copy_partition(client, table, partition)
            log.info(
                "copy   %s %s: %d rows, peak %.2f GiB",
                table,
                partition,
                want,
                peak / 1024**3,
            )


def _fingerprint(client: Client, table: str, uid: str) -> tuple[int, int, int]:
    """(rows, hash of the canonical hex ids, hash of every other column) for one table.

    Read with `FINAL`, which is the whole point: `core.*` is a `ReplacingMergeTree`, the copy
    writes fresh parts, and background merges collapse superseded duplicates as it goes -- so
    the *physical* row count legitimately drops while the *logical* content must not move by a
    bit. `tuple()` makes the row hash NULL-safe: a bare `cityHash64` over a row with a NULL
    column returns NULL, and `sum` would then skip that row without saying so. `sum` is
    order-independent, so part layout cannot affect it.
    """
    row = client.query(
        f"SELECT count(), sum(cityHash64({uid})), sum(cityHash64(tuple(* EXCEPT hand_uid))) "
        f"FROM {core()}.{table} FINAL",
        settings={"max_memory_usage": MAX_MEMORY},
    ).result_rows[0]
    return int(row[0]), int(row[1] or 0), int(row[2] or 0)


def verify(client: Client) -> bool:
    """Compare every `__v2` table with its original. True only when all four agree.

    The canonical form of a hand id is the 32-character lowercase hex string: the original
    stores exactly that, the copy stores the bytes and `lower(hex(...))` gives it back, so the
    id hash is comparable across the change by construction.
    """
    ok = True
    for table in TABLES:
        old = _fingerprint(client, table, "hand_uid")
        new = _fingerprint(client, f"{table}{SUFFIX}", "lower(hex(hand_uid))")
        agree = old == new
        ok = ok and agree
        log.info(
            "%s %s: rows %d/%d uid %d/%d row %d/%d",
            "match " if agree else "DIFFER",
            table,
            old[0],
            new[0],
            old[1],
            new[1],
            old[2],
            new[2],
        )
    return ok


def exchange(client: Client) -> None:
    """Swap each table with its rebuilt twin, atomically and only on a clean verify."""
    if not verify(client):
        raise SystemExit("refusing to exchange: the copy does not match the original")
    for table in TABLES:
        client.command(f"EXCHANGE TABLES {core()}.{table} AND {core()}.{table}{SUFFIX}")
        log.info("exchange %s <-> %s%s", table, table, SUFFIX)


def drop_old(client: Client) -> None:
    """Drop the `__v2` tables, which after `--exchange` hold the pre-rebuild data."""
    for table in TABLES:
        client.command(f"DROP TABLE IF EXISTS {core()}.{table}{SUFFIX}")
        log.info("drop   %s.%s%s", core(), table, SUFFIX)


def main(argv: list[str] | None = None) -> int:
    """CLI entry point: one step per invocation, in the order the docstring lists them."""
    ap = argparse.ArgumentParser(description=__doc__)
    for step in ("create", "copy", "verify", "exchange", "drop-old"):
        ap.add_argument(f"--{step}", action="store_true", help=f"run the {step} step")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    client = clickhouse()
    if args.create:
        create(client)
    if args.copy:
        copy(client)
    if args.verify and not verify(client):
        return 1
    if args.exchange:
        exchange(client)
    if args.drop_old:
        drop_old(client)
    return 0


if __name__ == "__main__":
    sys.exit(main())
