"""Canonical hands -> ClickHouse, in columnar batches.

Two throughput rules, both learned the hard way in the lab:

  1. **Batch inserts.** One INSERT = one ClickHouse part. Thousands of small inserts produce
     thousands of parts and hit `TOO_MANY_PARTS`; the background merge pool cannot keep up.
     Batching here is a correctness constraint, not an optimization.

  2. **Build columns, not rows.** Polars turns the per-hand Python objects into Arrow columns
     once, and clickhouse-connect ships them straight down. Doing the same work as a Python
     loop over row tuples is the single biggest avoidable cost in the ingest path
     (docs/POKER_DATA_MODEL.md §10).

**What goes in which column is not written here.** Every row is built by iterating the
table's `TableSpec` (`core/schema`), the one declaration of the storage schema; this module
only adds the per-batch context (tenant, dataset, timestamp) and the insert itself.

Note that Polars does mechanical normalization only. **Stat logic lives in dbt** — that is a
locked decision and this module deliberately computes nothing a statistic depends on.
"""

from __future__ import annotations

import logging
from dataclasses import replace
from datetime import UTC, datetime
from typing import Final

import polars as pl
from clickhouse_connect.driver.client import Client

from core.models import CanonicalHand
from core.schema import ACTIONS, HANDS, PLAYERS, TABLES, WINNERS, RowContext
from core.settings import get_settings

log = logging.getLogger(__name__)

HANDS_COLUMNS: Final = HANDS.column_names
PLAYERS_COLUMNS: Final = PLAYERS.column_names
ACTIONS_COLUMNS: Final = ACTIONS.column_names
WINNERS_COLUMNS: Final = WINNERS.column_names

DATASET_HERO: Final = "hero"
DATASET_POPULATION: Final = "population"
"""`hero` = hands the user played (a Hero seat exists). `population` = observed pool hands.
Mixing the two makes every win-rate meaningless, so the distinction is carried explicitly
rather than inferred from a null hero seat -- see ch/migrations/0007_dataset.sql.
`Final` so mypy types them as literals: `api.queries.Dataset` is the union of exactly these."""

Rows = list[list[object]]


def to_rows(
    hands: list[CanonicalHand],
    tenant_id: int,
    dataset: str = DATASET_HERO,
    parsed_at: datetime | None = None,
) -> tuple[Rows, Rows, Rows, Rows]:
    """Flatten canonical hands into the four ClickHouse row sets, in `TABLES` order.

    `tenant_id` is a required argument, not a field read off the hand: tenancy comes from the
    authenticated request, never from parsed content. `dataset` is likewise supplied by the
    caller — it is a property of the import, not of the hand text.

    `parsed_at` is stamped explicitly rather than left to the column's `now64(3)` default,
    because the default is evaluated per INSERT and this batch becomes four separate INSERTs.
    That gave one hand four timestamps milliseconds apart, which is wrong twice over: it is the
    ReplacingMergeTree version column, so a re-parse could collapse the four tables
    inconsistently; and it is the watermark the incremental dbt models read, where a skew
    between `hands` and `actions` makes them disagree about which partitions are dirty.

    **Datetimes stay timezone-AWARE all the way into the driver.** clickhouse-connect reads a
    naive datetime as *local* time and converts it to UTC, so stripping tzinfo silently shifts
    every timestamp by the host's UTC offset — and makes the stored data depend on which
    machine ran the import. `parser/base.py` already returns aware UTC; keep it that way.
    """
    stamped = parsed_at or datetime.now(UTC)
    hand_rows: Rows = []
    player_rows: Rows = []
    action_rows: Rows = []
    winner_rows: Rows = []

    for hand in hands:
        ctx = RowContext(hand=hand, tenant_id=tenant_id, dataset=dataset, parsed_at=stamped)
        hand_rows.append(HANDS.row(ctx))
        player_rows.extend(PLAYERS.row(replace(ctx, player=p)) for p in hand.players)
        action_rows.extend(ACTIONS.row(replace(ctx, action=a)) for a in hand.actions)
        winner_rows.extend(WINNERS.row(replace(ctx, winner=w)) for w in hand.pot_winners)

    return hand_rows, player_rows, action_rows, winner_rows


def insert_hands(
    client: Client,
    hands: list[CanonicalHand],
    tenant_id: int,
    dataset: str = DATASET_HERO,
) -> dict[str, int]:
    """Insert a batch of hands into every core table. Returns per-table row counts."""
    if not hands:
        return {t.name: 0 for t in TABLES}

    core = get_settings().db("core")
    counts: dict[str, int] = {}
    for spec, rows in zip(TABLES, to_rows(hands, tenant_id, dataset), strict=True):
        if rows:
            client.insert(f"{core}.{spec.name}", rows, column_names=spec.column_names)
        counts[spec.name] = len(rows)
    log.info("inserted %s", counts)
    return counts


def normalize_frame(
    hands: list[CanonicalHand], tenant_id: int, dataset: str = DATASET_HERO
) -> pl.DataFrame:
    """Build a Polars frame of hand-level rows.

    Used for bulk paths where derived columns are computed vectorized rather than per hand.
    Kept separate from `insert_hands` so the simple path stays simple; this is where the
    Phase-3 Spark re-parse job and any future bulk transform hook in.
    """
    hand_rows, _, _, _ = to_rows(hands, tenant_id, dataset)
    return pl.DataFrame(hand_rows, schema=HANDS_COLUMNS, orient="row")
