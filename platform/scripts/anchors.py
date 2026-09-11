"""What "this partition is built" means, shared by the backfill loop and handed to dbt.

`macros/incremental.sql` decides which partitions are dirty inside every model, and
`scripts/backfill.py` decides the same before each pass. They drifted once (monthly vs daily)
and the loop stopped early believing it was done, so the script's half lives here in one
place with its own tests: the anchor list, its SQL, and the vars handed to dbt.
"""

from __future__ import annotations

Anchor = tuple[str, str]
"""(mart table, its date column): where a partition's built watermark is read from."""

DEFAULT_ANCHORS: tuple[Anchor, ...] = (("stats_daily", "day"),)
"""The last model of the chain. Must match the default of `anchors` in macros/incremental.sql."""

PARTITION_EXPR = "toYYYYMMDD"
"""Must match `partition_by` in the models and `dirty_partitions()` in macros/incremental.sql.

Named rather than inlined because these have already drifted apart once: the macro was moved
from monthly to daily while the loop still counted months, so it saw 10 units of work where
there were 164 and would have stopped believing it was finished. Changing partition granularity
means changing it in three places -- the model configs, the macro, and here."""


def parse_anchors(raw: list[str] | None) -> tuple[Anchor, ...]:
    """`TABLE:DATE_COLUMN` strings to anchors; the default when none were given."""
    if not raw:
        return DEFAULT_ANCHORS
    anchors: list[Anchor] = []
    for item in raw:
        table, sep, column = item.partition(":")
        if not sep or not table or not column:
            raise SystemExit(f"--anchor expects TABLE:DATE_COLUMN, got {item!r}")
        anchors.append((table, column))
    return tuple(anchors)


def anchor_sql(prefix: str, anchors: tuple[Anchor, ...]) -> str:
    """The built side of the gate: per partition, the watermark of the anchor table(s).

    Mirrors `anchor_built()` in macros/incremental.sql: with several anchors a partition is
    built only when EVERY table holds it, and its watermark is the oldest of theirs.
    """
    per_table = [
        f"SELECT {PARTITION_EXPR}({column}) AS m, max(src_parsed_at) AS built_max"
        f" FROM {prefix}marts.{table} GROUP BY m"
        for table, column in anchors
    ]
    if len(per_table) == 1:
        return per_table[0]
    union = " UNION ALL ".join(per_table)
    return (
        f"SELECT m, min(built_max) AS built_max FROM ({union}) GROUP BY m"
        f" HAVING count() = {len(per_table)}"
    )


def partition_of(day: str) -> int:
    """`YYYY-MM-DD` to the `toYYYYMMDD` partition integer the gate compares against."""
    parts = day.split("-")
    if len(parts) != 3 or not all(p.isdigit() for p in parts) or len(parts[0]) != 4:
        raise SystemExit(f"expected a YYYY-MM-DD date, got {day!r}")
    return int(f"{parts[0]}{parts[1]:0>2}{parts[2]:0>2}")


def dirty_where(rebuild_from: int | None) -> str:
    """The gate itself: which partitions a pass must still (re)build.

    The watermark half asks "has the source changed since this partition was built", which is
    the right question for new or re-parsed hands and the WRONG one after a bare
    `ALTER TABLE ... ADD COLUMN`: the new column is empty but no source row moved, so the
    partition looks clean and keeps its zeroes forever. `rebuild_from` is the override for
    exactly that case -- everything from that partition on is dirty whatever the watermark says.
    """
    gate = "src.src_max > built.built_max"
    return f"({gate} OR src.m >= {rebuild_from})" if rebuild_from else gate


def advance(rebuild_from: int | None, highest_built: int) -> int | None:
    """Move the force floor past what this pass just rebuilt, so the loop can still converge.

    A forced partition is dirty *by definition*, so a fixed floor never goes clean: the loop
    rebuilds the same oldest partitions every pass and trips its own no-progress guard. Raising
    the floor above the highest partition just built leaves each forced partition rebuilt
    exactly once, while partitions below it stay eligible on the ordinary watermark.
    """
    return max(rebuild_from, highest_built + 1) if rebuild_from else rebuild_from


def dirty_sql(prefix: str, anchors: tuple[Anchor, ...], rebuild_from: int | None = None) -> str:
    """Dirty partitions oldest first, each with the player-row count that sizes a pass.

    **Must mirror `dirty_partitions()` in macros/incremental.sql exactly.** They drifted once
    already (monthly vs daily) and the loop stopped early believing it was done.
    """
    return (
        "SELECT src.m AS m, coalesce(pr.rows, 0) AS rows FROM ("
        f"  SELECT {PARTITION_EXPR}(played_at_utc) AS m, max(parsed_at) AS src_max"
        f"  FROM {prefix}core.hands GROUP BY m"
        f") AS src LEFT JOIN ({anchor_sql(prefix, anchors)}"
        ") AS built ON built.m = src.m LEFT JOIN ("
        f"  SELECT {PARTITION_EXPR}(played_at_utc) AS m, count() AS rows"
        f"  FROM {prefix}core.hand_players GROUP BY m"
        ") AS pr ON pr.m = src.m "
        f"WHERE {dirty_where(rebuild_from)} ORDER BY m FORMAT TSV"
    )


def dbt_vars(batch: int, anchors: tuple[Anchor, ...], rebuild_from: int | None = None) -> str:
    """The `--vars` YAML for one pass: the batch size and the anchor list the macro reads."""
    pairs = ", ".join(f"[{table}, {column}]" for table, column in anchors)
    extra = f", rebuild_from: {rebuild_from}" if rebuild_from else ""
    return f"{{batch_partitions: {batch}, anchors: [{pairs}]{extra}}}"
