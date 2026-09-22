"""`core.hand_players` — one row per occupied seat per hand."""

from __future__ import annotations

from decimal import Decimal

from core.schema.base import ColumnSpec, RowContext, TableSpec, hand_uid_column

LC = "LowCardinality(String)"
MONEY = "Decimal(18, 4)"
STAMP = "DateTime64(3, 'UTC')"
CENTS = Decimal("0.01")
TEN_THOUSANDTHS = Decimal("0.0001")


def _stack_bb(ctx: RowContext) -> Decimal:
    return (ctx.require_player().starting_stack / ctx.bb).quantize(CENTS)


def _net_won_bb(ctx: RowContext) -> Decimal:
    return (ctx.require_player().net_won / ctx.bb).quantize(TEN_THOUSANDTHS)


def _ev_won_bb(ctx: RowContext) -> Decimal | None:
    ev = ctx.require_player().ev_won
    return (ev / ctx.bb).quantize(TEN_THOUSANDTHS) if ev is not None else None


def _finish_position(ctx: RowContext) -> int | None:
    t = ctx.hand.tournament
    return t.finish_position if t is not None else None


PLAYERS = TableSpec(
    name="hand_players",
    doc="One row per occupied seat per hand.",
    columns=(
        ColumnSpec("user_id", "UInt32", lambda c: c.tenant_id),
        ColumnSpec("dataset", LC, lambda c: c.dataset),
        hand_uid_column(),
        ColumnSpec("played_at_utc", STAMP, lambda c: c.hand.played_at_utc),
        ColumnSpec("seat", "UInt8", lambda c: c.require_player().seat),
        # NULL on anonymized sites -- the single field every opponent-stat gate keys off.
        ColumnSpec("player_key", "Nullable(String)", lambda c: c.require_player().player_key),
        ColumnSpec("screen_name", "String", lambda c: c.require_player().screen_name),
        ColumnSpec("is_hero", "UInt8", lambda c: int(c.require_player().is_hero)),
        ColumnSpec("is_anonymized", "UInt8", lambda c: int(c.require_player().is_anonymized)),
        ColumnSpec("anon_alias", "String", lambda c: c.require_player().anon_alias),
        ColumnSpec("position", LC, lambda c: c.require_player().position.value),
        ColumnSpec("position_index", "UInt8", lambda c: c.require_player().position_index),
        ColumnSpec("starting_stack", MONEY, lambda c: c.require_player().starting_stack),
        ColumnSpec("starting_stack_bb", "Decimal(12, 2)", _stack_bb),
        ColumnSpec("hole_cards", "String", lambda c: " ".join(c.require_player().hole_cards)),
        ColumnSpec("total_invested", MONEY, lambda c: c.require_player().total_invested),
        ColumnSpec("net_won", MONEY, lambda c: c.require_player().net_won),
        ColumnSpec("net_won_bb", MONEY, _net_won_bb),
        ColumnSpec(
            "allin_equity", "Nullable(Decimal(9, 6))", lambda c: c.require_player().allin_equity
        ),
        ColumnSpec("ev_won_bb", "Nullable(Decimal(18, 4))", _ev_won_bb),
        ColumnSpec("saw_flop", "UInt8", lambda c: int(c.require_player().saw_flop)),
        ColumnSpec("saw_turn", "UInt8", lambda c: int(c.require_player().saw_turn)),
        ColumnSpec("saw_river", "UInt8", lambda c: int(c.require_player().saw_river)),
        ColumnSpec("went_to_showdown", "UInt8", lambda c: int(c.require_player().went_to_showdown)),
        ColumnSpec("won_hand", "UInt8", lambda c: int(c.require_player().won_hand)),
        ColumnSpec("parsed_at", STAMP, lambda c: c.parsed_at),
        # ---- tournaments (migration 0003) ---------------------------------------------------
        ColumnSpec("bounty_won", MONEY, lambda c: c.require_player().bounty_won),
        ColumnSpec("was_eliminated", "UInt8", lambda c: int(c.require_player().was_eliminated)),
        ColumnSpec("finish_position", "Nullable(UInt32)", _finish_position),
        # ---- forward compatibility (migration 0004) ---------------------------------------
        ColumnSpec("extra", "Map(String, String)", lambda c: dict(c.require_player().extra)),
        # ---- made-hand classes (migration 0010, plan E.5) ----------------------------------
        # One per street, because the class a decision is taken with is the one for its own
        # street. Empty where the cards or the board are unknown -- never a class name, so
        # "not shown" stays distinguishable from "no pair".
        ColumnSpec("made_hand_flop", LC, lambda c: c.require_player().made_hand_flop),
        ColumnSpec("made_hand_turn", LC, lambda c: c.require_player().made_hand_turn),
        ColumnSpec("made_hand_river", LC, lambda c: c.require_player().made_hand_river),
    ),
    staging_extras=(
        "toDate(played_at_utc) as played_date",
        "parsed_at as src_parsed_at",
    ),
)
