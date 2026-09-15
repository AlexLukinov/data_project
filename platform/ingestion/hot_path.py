"""Derive a just-inserted batch into the fact tables, so an upload is in stats without dbt.

The SQL is generated: `ch/hot_path/<table>.sql` is the dbt model for that table rendered for one
batch (`scripts/hot_path_sql.py`, ADR-047). This module only binds the three parameters -- the
tenant, the batch's stamp and the partitions its hands fall in -- and runs the statement. It
knows nothing about how a decision is derived, which is the point: that knowledge is dbt's.

Called by `ClickHouseHandSink` right after the core insert for the same batch, on the same
connection. Every row it writes carries `built_by = 'hot'`, and a partition holding such a row
is dirty for dbt until dbt has replaced it (macros/incremental.sql).
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from functools import cache
from pathlib import Path
from typing import Any

from clickhouse_connect.driver.client import Client
from clickhouse_connect.driver.summary import QuerySummary

from ch.migrate import prefixed
from core.models import CanonicalHand
from core.settings import get_settings

log = logging.getLogger(__name__)

HOT_PATH_DIR = Path(__file__).resolve().parent.parent / "ch" / "hot_path"
TABLES: tuple[str, ...] = ("decisions", "player_hands")
"""In this order: the decision fact first because it is the larger derivation, so a failure
surfaces before anything has been written."""

SETTINGS: dict[str, dict[str, Any]] = {"decisions": {"enable_analyzer": 0}, "player_hands": {}}
"""Per-statement query settings: the decisions derivation is planned by the legacy analyzer.

Measured on 25.8 for a two-hand batch: `EXPLAIN` of the decisions derivation alone takes
3,240 ms under the new analyzer and 182 ms under the old one; execution is ~170 ms either way.
The cost is planning `decision_state()`'s hundred-odd lambda expressions, which dbt pays once
per pass and never notices, and which the hot path would pay once per batch. The derived rows
are the same under both -- `tests/integration/test_hot_path.py` compares them with dbt's, which
plans with the server default -- so this is a speed setting, not a semantic one. The
player_hands statement stays on the default: it plans in under 200 ms, and the legacy analyzer
refuses its `ARRAY JOIN ... AS seat` beside `seat AS seat`. Revisit when the legacy analyzer is
removed upstream: the decisions statement then simply plans slower."""


@cache
def statement(table: str) -> str:
    """The generated INSERT for `table`, under the deployment's database prefix."""
    path = HOT_PATH_DIR / f"{table}.sql"
    if not path.exists():
        raise RuntimeError(f"{path} is missing -- run `make gen`")
    return prefixed(path.read_text(), get_settings().clickhouse_db_prefix)


def partitions_of(hands: list[CanonicalHand]) -> list[int]:
    """The `toYYYYMMDD(played_at_utc)` partitions the batch touches, ascending."""
    return sorted({int(h.played_at_utc.astimezone(UTC).strftime("%Y%m%d")) for h in hands})


def derive_batch(
    client: Client, hands: list[CanonicalHand], tenant_id: int, stamp: datetime
) -> dict[str, int]:
    """Insert the batch's rows into every fact table. Returns rows written per table.

    `stamp` must be the `parsed_at` the core insert used for these hands: it is how the
    statement finds the batch. A hand already present in a table for these partitions is
    skipped by the statement itself, so calling this twice for one batch writes nothing twice.
    """
    if not hands:
        return {t: 0 for t in TABLES}
    params: dict[str, Any] = {
        "tenant": tenant_id,
        "stamp": stamp,
        "partitions": partitions_of(hands),
    }
    written: dict[str, int] = {}
    for table in TABLES:
        summary = client.command(statement(table), parameters=params, settings=SETTINGS[table])
        written[table] = summary.written_rows if isinstance(summary, QuerySummary) else 0
    log.info("hot path derived %s", written)
    return written
