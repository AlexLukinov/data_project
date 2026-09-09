"""Build the mart chain a few partitions at a time, so a small node can bootstrap a big corpus.

**Why this exists.** Peak ClickHouse memory is set by the size of ONE dbt run, not by the size
of the table. Routine traffic is cheap — a player uploading a session dirties a day or two —
but a first load, or a re-import of a large archive after a parser fix, dirties every day at
once. Rebuilding all 54.5M player-rows in a single query needs ~7.3 GiB, which is a machine you
would otherwise be renting purely for an operation that runs twice a year.

Looping instead keeps every individual run small, so the memory ceiling is a function of the
largest single pass rather than of the whole dataset. That is what makes a 4 GB node viable,
and it is the same shape as the production plan: many small nodes, none of which ever has to
hold everything.

Each pass rebuilds the oldest dirty partitions and advances their watermark, so the loop
converges. It is safe to interrupt and re-run: a partition is either fully replaced or
untouched (`insert_overwrite` swaps whole partitions), and a model that fell behind catches up
on the next pass.

**A pass is sized by ROWS, not by partition count.** Days are wildly uneven: a quiet day is a
few thousand player-rows, a grinding December day ~900k. Memory follows rows, so a fixed
number of partitions is either wasteful on quiet days or fatal on dense ones -- measured on
4 GB: two dense days (~1.8M rows) fit, four (~3.6M) do not. Each pass therefore takes as many
of the oldest dirty partitions as fit under a row budget. The budget still ADAPTS as a safety
net: it halves when a pass runs out of memory and doubles back after a run of clean passes.

    uv run python scripts/backfill.py                        # 2.5M rows/pass, adapt
    uv run python scripts/backfill.py --row-budget 1000000   # gentler
    uv run python scripts/backfill.py --max-passes 5         # stop early
"""

from __future__ import annotations

import argparse
import logging
import os
import subprocess
import sys
import time
from pathlib import Path

log = logging.getLogger("backfill")

PLATFORM = Path(__file__).resolve().parent.parent
DBT = PLATFORM / ".venv-dbt" / "bin" / "dbt"
PROJECT = PLATFORM / "dbt" / "poker_dwh"

DEFAULT_ROW_BUDGET = 2_500_000
"""Player-rows per pass. Measured on a 4 GB node with the 2.5 GB query ceiling: ~1.8M rows
(two dense days) rebuilt at ~2.0 GiB peak; ~3.6M rows exceeded the server's 3.6 GiB total."""

MAX_PARTITIONS_PER_PASS = 16
"""Hard cap regardless of the budget. ClickHouse holds a write buffer per column per open
part, and `max_partitions_per_insert_block` defaults to 100; sixteen 155-column parts is
comfortably inside both."""

GROW_AFTER = 3
"""Consecutive successful passes before doubling the budget again. Small enough to recover
quickly after a dense stretch, large enough not to thrash back into the failure that shrank
it."""

PARTITION_EXPR = "toYYYYMMDD"
"""Must match `partition_by` in the models and `dirty_partitions()` in macros/incremental.sql.

Named rather than inlined because these have already drifted apart once: the macro was moved
from monthly to daily while this script still counted months, so the loop saw 10 units of work
where there were 164 and would have stopped believing it was finished. Changing partition
granularity means changing it in three places -- the model configs, the macro, and here."""


def _dirty_partitions() -> list[tuple[int, int]]:
    """Dirty partitions still pending, oldest first, each with its player-row count.

    **This must mirror `dirty_partitions()` in macros/incremental.sql exactly**: the same
    anchor (`marts.stats_daily`, the LAST model of the chain) and the same per-partition
    comparison. A global `max(src_parsed_at)` answers a different question and undercounts,
    because ingest order and partition order are unrelated. If the two ever disagree, the loop
    stops while work remains.
    """
    sql = (
        "SELECT src.m AS m, coalesce(pr.rows, 0) AS rows FROM ("
        f"  SELECT {PARTITION_EXPR}(played_at_utc) AS m, max(parsed_at) AS src_max"
        "  FROM core.hands GROUP BY m"
        ") AS src LEFT JOIN ("
        f"  SELECT {PARTITION_EXPR}(day) AS m, max(src_parsed_at) AS built_max"
        "  FROM marts.stats_daily GROUP BY m"
        ") AS built ON built.m = src.m LEFT JOIN ("
        f"  SELECT {PARTITION_EXPR}(played_at_utc) AS m, count() AS rows"
        "  FROM core.hand_players GROUP BY m"
        ") AS pr ON pr.m = src.m "
        "WHERE src.src_max > built.built_max ORDER BY m FORMAT TSV"
    )
    out = subprocess.run(
        ["docker", "compose", "exec", "-T", "clickhouse", "clickhouse-client", "-q", sql],
        cwd=PLATFORM,
        capture_output=True,
        text=True,
        check=True,
    )
    rows: list[tuple[int, int]] = []
    for line in out.stdout.splitlines():
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


def _run_pass(batch: int) -> bool:
    """One dbt pass over the oldest `batch` dirty partitions. True if it succeeded."""
    env = {**os.environ, "CLICKHOUSE_PORT": os.environ.get("CLICKHOUSE_PORT", "8124")}
    result = subprocess.run(
        [
            str(DBT),
            "build",
            "--project-dir",
            str(PROJECT),
            "--profiles-dir",
            str(PROJECT),
            "--vars",
            f"batch_partitions: {batch}",
        ],
        cwd=PLATFORM,
        env=env,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        tail = "\n".join(result.stdout.splitlines()[-25:])
        log.error("dbt pass failed:\n%s", tail)
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
    return ap.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    """Loop dbt until no partition is dirty, shrinking the row budget when memory says so."""
    args = _parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    ceiling = max(1, args.row_budget)
    budget = ceiling
    streak = 0
    start = time.monotonic()

    for attempt in range(1, args.max_passes + 1):
        pending = _dirty_partitions()
        if not pending:
            log.info("caught up after %d pass(es), %.0fs", attempt - 1, time.monotonic() - start)
            return 0

        batch, rows = _batch_for(pending, budget)
        log.info(
            "pass %d — %d partition(s) dirty, taking %d (%s rows, budget %s)",
            attempt,
            len(pending),
            batch,
            f"{rows:,}",
            f"{budget:,}",
        )
        if not _run_pass(batch):
            if batch > 1:
                budget = max(1, budget // 2)
                streak = 0
                log.warning("pass failed; retrying with row budget %s", f"{budget:,}")
                continue
            # Already at one partition per pass: this is a real failure, not a sizing problem.
            log.error("pass %d failed at a single partition — stopping", attempt)
            return 1

        streak += 1
        if streak >= GROW_AFTER and budget < ceiling:
            budget = min(ceiling, budget * 2)
            streak = 0
            log.info("steady; growing row budget to %s", f"{budget:,}")

        if len(_dirty_partitions()) >= len(pending):
            # No forward progress: another pass would loop forever. Fail loudly rather than
            # spinning -- the usual cause is a model erroring on one partition every time.
            log.error("pass %d made no progress (%d still dirty) — stopping", attempt, len(pending))
            return 1

    log.error("hit --max-passes=%d with work remaining", args.max_passes)
    return 1


if __name__ == "__main__":
    sys.exit(main())
