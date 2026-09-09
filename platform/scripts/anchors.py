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


def dbt_vars(batch: int, anchors: tuple[Anchor, ...]) -> str:
    """The `--vars` YAML for one pass: the batch size and the anchor list the macro reads."""
    pairs = ", ".join(f"[{table}, {column}]" for table, column in anchors)
    return f"{{batch_partitions: {batch}, anchors: [{pairs}]}}"
