"""Build the mart chain a few partitions at a time, so a small node can bootstrap a big corpus.

**Why this exists.** Peak ClickHouse memory is set by the size of ONE dbt run, not by the size
of the table. Routine traffic is cheap — a player uploading a session dirties a day or two —
but a first load, or a re-import of a large archive after a parser fix, dirties every day at
once. Rebuilding all 54.5M player-rows in a single query needs ~7.3 GiB, which is a machine you
would otherwise be renting purely for an operation that runs twice a year.

Looping instead keeps every individual run small, so the memory ceiling is a function of the
largest single partition rather than of the whole dataset. That is what makes a 4 GB node
viable, and it is the same shape as the production plan: many small nodes, none of which ever
has to hold everything.

Each pass rebuilds the oldest N dirty partitions and advances those partitions' watermarks, so
the loop converges. It is safe to interrupt and re-run: a partition is either fully replaced
or untouched (`insert_overwrite` swaps whole partitions), and a model that fell behind catches
up on the next pass.

The batch size ADAPTS: it starts at --batch and halves whenever a pass runs out of memory, so
the loop settles on the largest batch the node can carry rather than making you guess. Days are
very uneven -- a quiet day is a few thousand rows, a grinding day ~900k -- so a fixed size is
either wasteful or fatal depending on where in the corpus you are.

    uv run python scripts/backfill.py                 # start at 8/pass, adapt downward
    uv run python scripts/backfill.py --batch 1       # smallest possible steps
    uv run python scripts/backfill.py --max-passes 5  # stop early
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

GROW_AFTER = 3
"""Consecutive successful passes before doubling the batch again. Small enough to recover
quickly after a dense stretch, large enough not to thrash back into the failure that shrank
it."""

PARTITION_EXPR = "toYYYYMMDD"
"""Must match `partition_by` in the models and `dirty_partitions()` in macros/incremental.sql.

Named rather than inlined because these have already drifted apart once: the macro was moved
from monthly to daily while this script still counted months, so the loop saw 10 units of work
where there were 164 and would have stopped believing it was finished. Changing partition
granularity means changing it in three places -- the model configs, the macro, and here."""


def _remaining() -> int:
    """Dirty partitions still pending, read straight from ClickHouse.

    Uses `marts.player_hand_flags` as the reference model: it is last in the chain, so if it is
    caught up everything upstream is too.

    **This must mirror `dirty_partitions()` in macros/incremental.sql exactly**, per partition
    rather than against one global watermark. A global `max(src_parsed_at)` answers a different
    question and undercounts: ingest order and partition order are unrelated, so building one
    partition can push the watermark past others that were never built. If the two ever
    disagree, the loop stops while work remains.
    """
    sql = (
        "SELECT count() FROM ("
        "  SELECT src.m FROM ("
        f"    SELECT {PARTITION_EXPR}(played_at_utc) AS m, max(parsed_at) AS src_max"
        "    FROM core.hands GROUP BY m"
        "  ) AS src"
        "  LEFT JOIN ("
        f"    SELECT {PARTITION_EXPR}(played_at_utc) AS m, max(src_parsed_at) AS built_max"
        "    FROM marts.player_hand_flags GROUP BY m"
        "  ) AS built ON built.m = src.m"
        "  WHERE src.src_max > built.built_max"
        ")"
    )
    out = subprocess.run(
        ["docker", "compose", "exec", "-T", "clickhouse", "clickhouse-client", "-q", sql],
        cwd=PLATFORM,
        capture_output=True,
        text=True,
        check=True,
    )
    return int(out.stdout.strip() or 0)


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


def main(argv: list[str] | None = None) -> int:
    """Loop dbt until no partition is dirty, shrinking the batch when memory says so."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--batch", type=int, default=8, help="partitions per pass (default 8)")
    ap.add_argument("--max-passes", type=int, default=400, help="safety stop")
    args = ap.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(message)s")

    # Days are wildly uneven -- a quiet day is a few thousand rows, a grinding day is ~900k --
    # so no fixed batch size is right for the whole corpus. Halve on failure, and grow back
    # after a run of successes: without the growth half, one dense stretch early on pins the
    # batch at 1 for the entire rest of the corpus. Observed exactly that -- the loop dropped to
    # 1 on pass 4 against December's dense days and stayed there for 44 more passes of sparse
    # ones, turning a few minutes of work into a half-hour.
    ceiling = max(1, args.batch)
    batch = ceiling
    streak = 0
    start = time.monotonic()

    for attempt in range(1, args.max_passes + 1):
        pending = _remaining()
        if pending == 0:
            log.info("caught up after %d pass(es), %.0fs", attempt - 1, time.monotonic() - start)
            return 0

        log.info("pass %d — %d partition(s) dirty, taking %d", attempt, pending, batch)
        if not _run_pass(batch):
            if batch > 1:
                batch = max(1, batch // 2)
                streak = 0
                log.warning("pass failed; retrying with batch=%d", batch)
                continue
            # Already at one partition per pass: this is a real failure, not a sizing problem.
            log.error("pass %d failed at batch=1 — stopping", attempt)
            return 1

        streak += 1
        if streak >= GROW_AFTER and batch < ceiling:
            batch = min(ceiling, batch * 2)
            streak = 0
            log.info("steady; growing batch to %d", batch)

        if _remaining() >= pending:
            # No forward progress: another pass would loop forever. Fail loudly rather than
            # spinning -- the usual cause is a model erroring on one partition every time.
            log.error("pass %d made no progress (%d still dirty) — stopping", attempt, pending)
            return 1

    log.error("hit --max-passes=%d with work remaining", args.max_passes)
    return 1


if __name__ == "__main__":
    sys.exit(main())
