"""`core.actions` — one row per decision or chip movement, in global order within the hand."""

from __future__ import annotations

from core.schema.base import ColumnSpec, TableSpec, hand_uid_column

MONEY = "Decimal(18, 4)"
STAMP = "DateTime64(3, 'UTC')"
STREET_ENUM = "Enum8('preflop' = 0, 'flop' = 1, 'turn' = 2, 'river' = 3, 'showdown' = 4)"
ACTION_ENUM = (
    "Enum8('post_sb' = 0, 'post_bb' = 1, 'post_ante' = 2, 'post_straddle' = 3, "
    "'post_dead' = 4, 'fold' = 5, 'check' = 6, 'call' = 7, 'bet' = 8, 'raise' = 9, "
    "'allin' = 10, 'show' = 11, 'muck' = 12, 'uncalled_return' = 13, 'win' = 14)"
)

ACTIONS = TableSpec(
    name="actions",
    doc="One row per decision. The largest table and the one all stat logic reads.",
    columns=(
        ColumnSpec("user_id", "UInt32", lambda c: c.tenant_id),
        ColumnSpec("dataset", "LowCardinality(String)", lambda c: c.dataset),
        hand_uid_column(),
        ColumnSpec("played_at_utc", STAMP, lambda c: c.hand.played_at_utc),
        # GLOBAL order within the hand, not per-street: "did anyone raise BEFORE this player
        # acted" is unanswerable from a per-street counter.
        ColumnSpec("action_index", "UInt16", lambda c: c.require_action().action_index),
        ColumnSpec(
            "street",
            STREET_ENUM,
            lambda c: c.require_action().street.value,
            staging_expr="toString(street) as street",
        ),
        ColumnSpec("seat", "UInt8", lambda c: c.require_action().seat),
        ColumnSpec(
            "action_type",
            ACTION_ENUM,
            lambda c: c.require_action().action_type.value,
            staging_expr="toString(action_type) as action_type",
        ),
        ColumnSpec("amount", MONEY, lambda c: c.require_action().amount),
        ColumnSpec("amount_to", MONEY, lambda c: c.require_action().amount_to),
        ColumnSpec("pot_before", MONEY, lambda c: c.require_action().pot_before),
        ColumnSpec("to_call", MONEY, lambda c: c.require_action().to_call),
        ColumnSpec("is_allin", "UInt8", lambda c: int(c.require_action().is_allin)),
        # Blind and ante posts move chips but are NOT voluntary. This flag is why VPIP is right.
        ColumnSpec("is_voluntary", "UInt8", lambda c: int(c.require_action().is_voluntary)),
        ColumnSpec("parsed_at", STAMP, lambda c: c.parsed_at),
        # ---- migration 0003 -----------------------------------------------------------------
        ColumnSpec("cards_revealed", "String", lambda c: c.require_action().cards_revealed),
    ),
    staging_extras=(
        "toDate(played_at_utc) as played_date",
        "action_type in ('fold', 'check', 'call', 'bet', 'raise') as is_decision",
        "parsed_at as src_parsed_at",
    ),
)
