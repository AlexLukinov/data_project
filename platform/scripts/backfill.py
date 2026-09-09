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

    uv run python scripts/backfill.py                        # 2.0M rows/pass, adapt
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
from dataclasses import dataclass
from pathlib import Path

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
"""Consecutive successful passes before doubling the budget again. Small enough to recover
quickly after a dense stretch, large enough not to thrash back into the failure that shrank
it."""

PARTITION_EXPR = "toYYYYMMDD"
"""Must match `partition_by` in the models and `dirty_partitions()` in macros/incremental.sql.

Named rather than inlined because these have already drifted apart once: the macro was moved
from monthly to daily while this script still counted months, so the loop saw 10 units of work
where there were 164 and would have stopped believing it was finished. Changing partition
granularity means changing it in three places -- the model configs, the macro, and here."""


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


def _dirty_partitions() -> list[tuple[int, int]]:
    """Dirty partitions still pending, oldest first, each with its player-row count.

    **This must mirror `dirty_partitions()` in macros/incremental.sql exactly**: the same
    anchor (`marts.stats_daily`, the LAST model of the chain) and the same per-partition
    comparison. A global `max(src_parsed_at)` answers a different question and undercounts,
    because ingest order and partition order are unrelated. If the two ever disagree, the loop
    stops while work remains.
    """
    prefix = os.environ.get("CLICKHOUSE_DB_PREFIX", "")
    sql = (
        "SELECT src.m AS m, coalesce(pr.rows, 0) AS rows FROM ("
        f"  SELECT {PARTITION_EXPR}(played_at_utc) AS m, max(parsed_at) AS src_max"
        f"  FROM {prefix}core.hands GROUP BY m"
        ") AS src LEFT JOIN ("
        f"  SELECT {PARTITION_EXPR}(day) AS m, max(src_parsed_at) AS built_max"
        f"  FROM {prefix}marts.stats_daily GROUP BY m"
        ") AS built ON built.m = src.m LEFT JOIN ("
        f"  SELECT {PARTITION_EXPR}(played_at_utc) AS m, count() AS rows"
        f"  FROM {prefix}core.hand_players GROUP BY m"
        ") AS pr ON pr.m = src.m "
        "WHERE src.src_max > built.built_max ORDER BY m FORMAT TSV"
    )
    rows: list[tuple[int, int]] = []
    for line in _clickhouse(sql).splitlines():
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
    budget = _Budget(ceiling=max(1, args.row_budget), rows=max(1, args.row_budget))
    start = time.monotonic()

    for attempt in range(1, args.max_passes + 1):
        pending = _dirty_partitions()
        if not pending:
            log.info("caught up after %d pass(es), %.0fs", attempt - 1, time.monotonic() - start)
            return 0

        batch, rows = _batch_for(pending, budget.rows)
        log.info(
            "pass %d — %d partition(s) dirty, taking %d (%s rows, budget %s)",
            attempt,
            len(pending),
            batch,
            f"{rows:,}",
            f"{budget.rows:,}",
        )
        if not _run_pass(batch):
            if _recover(budget, batch, attempt):
                continue
            return 1
        if budget.reward():
            log.info("steady; growing row budget to %s", f"{budget.rows:,}")

        if len(_dirty_partitions()) >= len(pending):
            # No forward progress: another pass would loop forever. Fail loudly rather than
            # spinning -- the usual cause is a model erroring on one partition every time.
            log.error("pass %d made no progress (%d still dirty) — stopping", attempt, len(pending))
            return 1

    log.error("hit --max-passes=%d with work remaining", args.max_passes)
    return 1


if __name__ == "__main__":
    sys.exit(main())
