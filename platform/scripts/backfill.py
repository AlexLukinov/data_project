"""Build the mart chain a few partitions at a time, so a small node can bootstrap a big corpus.

**Why this exists.** Peak ClickHouse memory is set by the size of ONE dbt run, not by the size
of the table. Routine traffic is cheap — a player uploading a session dirties a day or two —
but a first load, or a re-import of a large archive after a parser fix, dirties every day at
once, and rebuilding all 54.5M player-rows in one query needs ~7.3 GiB.

Looping keeps every individual run small, so the memory ceiling follows the largest single pass
rather than the whole dataset. That is what makes a 4 GB node viable, and it is the same shape
as the production plan: many small nodes, none of which ever holds everything.

Each pass rebuilds the oldest dirty partitions and advances their watermark, so the loop
converges. It is safe to interrupt and re-run: `insert_overwrite` swaps whole partitions, so a
partition is either fully replaced or untouched, and a model that fell behind catches up next.

**A pass is sized by ROWS, not by partition count.** Days are wildly uneven (a few thousand
player-rows to ~900k) and memory follows rows, so a fixed partition count is either wasteful or
fatal -- on 4 GB, two dense days (~1.8M rows) fit and four (~3.6M) do not. Each pass takes as
many of the oldest dirty partitions as fit under a row budget, which halves after an
out-of-memory pass and doubles back after a run of clean ones.

    uv run python -m scripts.backfill                        # 2.0M rows/pass, adapt
    uv run python -m scripts.backfill --row-budget 1000000   # gentler
    uv run python -m scripts.backfill --skip-tests           # tests once at the end, not per pass

**Use `--skip-tests` whenever the chain is already populated** (a re-parse, or a column added
by ALTER rather than by the `empty_chain` recreate). `dbt build` runs the data tests too, and
those scan WHOLE tables: on a chain that starts empty they are cheap and grow with it, but on
one that starts at 73.7M rows every pass re-scans all of it, which is both pointless and, on a
4 GB node, what exhausts the 3.6 GiB server budget. With the flag the loop builds models only
and the tests run once at the end over the finished chain -- the stronger assertion.

**After a bare `ALTER TABLE ... ADD COLUMN`, add `--rebuild-from`** (`--skip-tests
--rebuild-from 2026-08-01`). The gate asks whether the SOURCE changed since a partition was
built, and an ALTER changes neither, so every partition no re-parse happened to touch stays
"clean" with the new column empty in it forever. That is how 2026-09-11 left `invested_bb` at
zero across both hero months -- caught only because a test sampled by hand rather than by date.

**Bootstrapping a second chain beside the first** (plan C.2): anchor on the new tables and
select only them, so the v1 chain is neither rebuilt nor consulted. With several anchors a
partition is clean only once EVERY anchor holds it -- as `anchor_built()` does in
macros/incremental.sql, which `scripts/anchors.py` mirrors exactly.

    uv run python -m scripts.backfill --anchor decisions:played_date
        --anchor player_hands:played_date --select '+decisions +player_hands'
"""

from __future__ import annotations

import argparse
import logging
import os
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

from scripts.anchors import (
    Anchor,
    advance,
    dbt_vars,
    dirty_sql,
    parse_anchors,
    partition_of,
)

log = logging.getLogger("backfill")

PLATFORM = Path(__file__).resolve().parent.parent
DBT = PLATFORM / ".venv-dbt" / "bin" / "dbt"
PROJECT = PLATFORM / "dbt" / "poker_dwh"

DEFAULT_ROW_BUDGET = 2_000_000
"""Player-rows per pass. Measured on a 4 GB node with the 2.5 GB query ceiling: passes of
2.28M rows succeeded, 2.41M and 2.49M failed (the server's 3.6 GiB total, not the query
ceiling, is what trips), so 2.0M leaves margin without wasting a failed pass per growth."""

MAX_PARTITIONS_PER_PASS = 16
"""Hard cap regardless of the budget. ClickHouse holds a write buffer per column per open
part, and `max_partitions_per_insert_block` defaults to 100; sixteen 155-column parts is
comfortably inside both."""

GROW_AFTER = 3
"""Consecutive successful passes before doubling the budget again -- small enough to recover
after a dense stretch, large enough not to thrash back into the failure that shrank it."""


def _clickhouse(sql: str, *, check: bool = True) -> str:
    """Run one statement through the compose service's client; returns its stdout."""
    out = subprocess.run(
        ["docker", "compose", "exec", "-T", "clickhouse", "clickhouse-client", "-q", sql],
        cwd=PLATFORM,
        capture_output=True,
        text=True,
        check=check,
    )
    return out.stdout


def _dirty_partitions(
    anchors: tuple[Anchor, ...], rebuild_from: int | None = None
) -> list[tuple[int, int]]:
    """Dirty partitions still pending, oldest first, each with its player-row count.

    The SQL lives in `scripts/anchors.py`: it must mirror `dirty_partitions()` in
    macros/incremental.sql exactly, so one file owns that duty.
    """
    prefix = os.environ.get("CLICKHOUSE_DB_PREFIX", "")
    rows: list[tuple[int, int]] = []
    for line in _clickhouse(dirty_sql(prefix, anchors, rebuild_from)).splitlines():
        m, n = line.split("\t")
        rows.append((int(m), int(n)))
    return rows


def _batch_for(pending: list[tuple[int, int]], row_budget: int) -> tuple[int, int]:
    """(partitions to take, rows they hold): the longest oldest-first prefix under budget.

    Always at least one partition, so a single day larger than the budget is still attempted
    rather than stalling the loop forever.
    """
    taken, rows = 0, 0
    for _, n in pending[:MAX_PARTITIONS_PER_PASS]:
        if taken and rows + n > row_budget:
            break
        taken += 1
        rows += n
    return taken, rows


def _drop_scratch_tables() -> None:
    """Drop the `__dbt_new_data_*` temp tables a failed pass leaves behind.

    dbt creates one per model for `insert_overwrite` and drops it on success; a pass killed by
    the memory limit leaves them, and they accumulate (22 of them, 396 MiB, were found after
    one bad afternoon). Called only after a failed pass, when no dbt process is running.
    """
    prefix = os.environ.get("CLICKHOUSE_DB_PREFIX", "")
    tables = _clickhouse(
        "SELECT concat(database, '.', name) FROM system.tables "
        f"WHERE database IN ('{prefix}intermediate', '{prefix}marts') "
        "AND name LIKE '%__dbt_new_data%' FORMAT TSVRaw",
        check=False,
    ).split()
    for table in tables:
        _clickhouse(f"DROP TABLE IF EXISTS {table}", check=False)
    if tables:
        log.info("dropped %d scratch table(s) from the failed pass", len(tables))


@dataclass(slots=True)
class _Budget:
    """The adaptive row budget: halves on a failed pass, doubles back after clean ones."""

    ceiling: int
    rows: int
    streak: int = 0

    def shrink(self) -> None:
        """A pass ran out of memory: take half as many rows next time."""
        self.rows = max(1, self.rows // 2)
        self.streak = 0

    def reward(self) -> bool:
        """Note a clean pass. True when that just grew the budget."""
        self.streak += 1
        if self.streak < GROW_AFTER or self.rows >= self.ceiling:
            return False
        self.rows = min(self.ceiling, self.rows * 2)
        self.streak = 0
        return True


def _recover(budget: _Budget, batch: int, attempt: int) -> bool:
    """After a failed pass: clean up, shrink the budget, and say whether to retry."""
    _drop_scratch_tables()
    if batch > 1:
        budget.shrink()
        log.warning("pass failed; retrying with row budget %s", f"{budget.rows:,}")
        return True
    # Already at one partition per pass: this is a real failure, not a sizing problem.
    log.error("pass %d failed at a single partition — stopping", attempt)
    return False


def _dbt(
    verb: str,
    batch: int,
    anchors: tuple[Anchor, ...],
    select: str | None,
    rebuild_from: int | None = None,
) -> bool:
    """Run one dbt command against the project. True if it succeeded."""
    env = {**os.environ, "CLICKHOUSE_PORT": os.environ.get("CLICKHOUSE_PORT", "8124")}
    command = [
        str(DBT),
        verb,
        "--project-dir",
        str(PROJECT),
        "--profiles-dir",
        str(PROJECT),
        "--vars",
        dbt_vars(batch, anchors, rebuild_from),
    ]
    if select:
        command += ["--select", select]
    result = subprocess.run(command, cwd=PLATFORM, env=env, capture_output=True, text=True)
    if result.returncode != 0:
        tail = "\n".join(result.stdout.splitlines()[-25:])
        log.error("dbt %s failed:\n%s", verb, tail)
    return result.returncode == 0


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--row-budget",
        type=int,
        default=DEFAULT_ROW_BUDGET,
        help=f"player-rows per pass (default {DEFAULT_ROW_BUDGET:,})",
    )
    ap.add_argument("--max-passes", type=int, default=400, help="safety stop")
    ap.add_argument(
        "--anchor",
        action="append",
        metavar="TABLE:DATE_COLUMN",
        help="mart table (and its date column) a partition must be built in to count as "
        "clean; repeatable; default stats_daily:day",
    )
    ap.add_argument("--select", help="dbt selector, e.g. '+decisions +player_hands'")
    ap.add_argument(
        "--rebuild-from",
        metavar="YYYY-MM-DD",
        help="rebuild every partition from this day on whatever the watermark says (use after "
        "a bare ALTER ADD COLUMN — see the module docstring)",
    )
    ap.add_argument(
        "--skip-tests",
        action="store_true",
        help="build models only during the loop and run the data tests once at the end "
        "(they scan whole tables, so per-pass they cost the same every pass)",
    )
    return ap.parse_args(argv)


def _final_tests(anchors: tuple[Anchor, ...], select: str | None) -> int:
    """The data tests, once, over the finished chain. 0 when they pass."""
    log.info("running the data tests once over the rebuilt chain")
    if _dbt("test", 0, anchors, select):
        log.info("data tests green")
        return 0
    log.error("data tests failed on the rebuilt chain")
    return 1


def main(argv: list[str] | None = None) -> int:
    """Loop dbt until no partition is dirty, shrinking the row budget when memory says so."""
    args = _parse_args(argv)
    anchors = parse_anchors(args.anchor)
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    budget = _Budget(ceiling=max(1, args.row_budget), rows=max(1, args.row_budget))
    start = time.monotonic()
    forced = partition_of(args.rebuild_from) if args.rebuild_from else None

    for attempt in range(1, args.max_passes + 1):
        pending = _dirty_partitions(anchors, forced)
        if not pending:
            log.info("caught up after %d pass(es), %.0fs", attempt - 1, time.monotonic() - start)
            return _final_tests(anchors, args.select) if args.skip_tests else 0

        batch, rows = _batch_for(pending, budget.rows)
        log.info(
            "pass %d — %d dirty, taking %d (%s rows, budget %s)",
            attempt,
            len(pending),
            batch,
            f"{rows:,}",
            f"{budget.rows:,}",
        )
        if not _dbt("run" if args.skip_tests else "build", batch, anchors, args.select, forced):
            if _recover(budget, batch, attempt):
                continue
            return 1
        if budget.reward():
            log.info("steady; growing row budget to %s", f"{budget.rows:,}")
        forced = advance(forced, pending[batch - 1][0])

        if len(_dirty_partitions(anchors, forced)) >= len(pending):
            # No forward progress: another pass would loop forever. Fail loudly rather than
            # spinning -- the usual cause is a model erroring on one partition every time.
            log.error("pass %d made no progress (%d still dirty) — stopping", attempt, len(pending))
            return 1

    log.error("hit --max-passes=%d with work remaining", args.max_passes)
    return 1


if __name__ == "__main__":
    sys.exit(main())
