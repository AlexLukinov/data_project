"""`core.pot_winners` — one seat's share of one pot (side pots and split pots need it)."""

from __future__ import annotations

from core.schema.base import ColumnSpec, TableSpec, hand_uid_column

WINNERS = TableSpec(
    name="pot_winners",
    doc="One row per (pot, winning seat). pot_index 0 is the main pot.",
    columns=(
        ColumnSpec("user_id", "UInt32", lambda c: c.tenant_id),
        ColumnSpec("dataset", "LowCardinality(String)", lambda c: c.dataset),
        hand_uid_column(),
        ColumnSpec("played_at_utc", "DateTime64(3, 'UTC')", lambda c: c.hand.played_at_utc),
        ColumnSpec("pot_index", "UInt8", lambda c: c.require_winner().pot_index),
        ColumnSpec("seat", "UInt8", lambda c: c.require_winner().seat),
        ColumnSpec("amount_won", "Decimal(18, 4)", lambda c: c.require_winner().amount_won),
        ColumnSpec("parsed_at", "DateTime64(3, 'UTC')", lambda c: c.parsed_at),
    ),
    staging_extras=(
        "toDate(played_at_utc) as played_date",
        "parsed_at as src_parsed_at",
    ),
)
