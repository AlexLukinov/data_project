"""`core.hands` — one row per hand."""

from __future__ import annotations

from core.models import ZERO
from core.schema.base import ColumnSpec, RowContext, TableSpec, hand_uid_column

LC = "LowCardinality(String)"
MONEY = "Decimal(18, 4)"
STAMP = "DateTime64(3, 'UTC')"


def _board(index: int) -> ColumnSpec:
    def slot(ctx: RowContext) -> str:
        return ctx.hand.board[index] if len(ctx.hand.board) > index else ""

    names = ("board_flop_1", "board_flop_2", "board_flop_3", "board_turn", "board_river")
    return ColumnSpec(names[index], LC, slot)


def _tourney(attr: str, default: object, ch_type: str) -> ColumnSpec:
    """A column read off `hand.tournament`, `default` on cash hands."""

    def get(ctx: RowContext) -> object:
        t = ctx.hand.tournament
        if t is None:
            return default
        value = getattr(t, attr)
        return value.value if hasattr(value, "value") else value

    return ColumnSpec(f"tourney_{attr}" if attr in TOURNEY_PREFIXED else attr, ch_type, get)


TOURNEY_PREFIXED = {"kind", "speed", "buy_in", "bounty", "fee", "currency", "level"}

HANDS = TableSpec(
    name="hands",
    doc="One row per hand.",
    columns=(
        ColumnSpec("user_id", "UInt32", lambda c: c.tenant_id),
        ColumnSpec("dataset", LC, lambda c: c.dataset),
        hand_uid_column(),
        ColumnSpec("site", LC, lambda c: c.hand.site.value),
        ColumnSpec("site_hand_id", "String", lambda c: c.hand.site_hand_id),
        # Aware datetime, never naive: clickhouse-connect reads a naive value as LOCAL time.
        ColumnSpec("played_at_utc", STAMP, lambda c: c.hand.played_at_utc),
        ColumnSpec("game_type", LC, lambda c: c.hand.game_type.value),
        ColumnSpec("limit_type", LC, lambda c: c.hand.limit_type.value),
        ColumnSpec("table_format", LC, lambda c: c.hand.table_format.value),
        ColumnSpec("currency", LC, lambda c: c.hand.currency),
        ColumnSpec("small_blind", MONEY, lambda c: c.hand.small_blind),
        ColumnSpec("big_blind", MONEY, lambda c: c.hand.big_blind),
        ColumnSpec("ante", MONEY, lambda c: c.hand.ante),
        ColumnSpec("straddle", MONEY, lambda c: c.hand.straddle),
        ColumnSpec("stake_level", LC, lambda c: c.hand.stake_level),
        ColumnSpec("hole_card_count", "UInt8", lambda c: c.hand.hole_card_count),
        ColumnSpec("max_seats", "UInt8", lambda c: c.hand.max_seats),
        ColumnSpec("players_dealt_in", "UInt8", lambda c: c.hand.players_dealt_in),
        ColumnSpec("button_seat", "UInt8", lambda c: c.hand.button_seat),
        ColumnSpec("table_name", "String", lambda c: c.hand.table_name),
        _board(0),
        _board(1),
        _board(2),
        _board(3),
        _board(4),
        ColumnSpec("total_pot", MONEY, lambda c: c.hand.total_pot),
        ColumnSpec("rake", MONEY, lambda c: c.hand.rake),
        ColumnSpec("hero_seat", "Nullable(UInt8)", lambda c: c.hand.hero_seat),
        ColumnSpec("tournament_id", "Nullable(String)", lambda c: c.hand.tournament_id or ""),
        ColumnSpec("tz_source", LC, lambda c: c.hand.tz_source),
        ColumnSpec("raw_object_key", "String", lambda c: c.hand.raw_object_key),
        ColumnSpec("raw_byte_offset", "UInt64", lambda c: c.hand.raw_byte_offset),
        ColumnSpec("parser_version", "UInt32", lambda c: c.hand.parser_version),
        # Stamped once per batch by the loader: it is the ReplacingMergeTree version column
        # and the incremental watermark, so the four tables must agree to the millisecond.
        ColumnSpec("parsed_at", STAMP, lambda c: c.parsed_at),
        # ---- variant + tournament coverage (migration 0003) ------------------------------
        ColumnSpec("game_structure", LC, lambda c: c.hand.game_type.structure.value),
        ColumnSpec("is_hi_lo", "UInt8", lambda c: int(c.hand.game_type.is_hi_lo)),
        _tourney("kind", "none", LC),
        _tourney("speed", "none", LC),
        _tourney("buy_in", ZERO, MONEY),
        _tourney("bounty", ZERO, MONEY),
        _tourney("fee", ZERO, MONEY),
        _tourney("currency", "", LC),
        _tourney("level", "", LC),
        ColumnSpec(
            "is_big_blind_ante",
            "UInt8",
            lambda c: int(c.hand.tournament.is_big_blind_ante) if c.hand.tournament else 0,
        ),
        ColumnSpec(
            "is_satellite",
            "UInt8",
            lambda c: int(c.hand.tournament.is_satellite) if c.hand.tournament else 0,
        ),
        _tourney("players_remaining", None, "Nullable(UInt32)"),
        _tourney("entrants", None, "Nullable(UInt32)"),
        # ---- forward compatibility (migration 0004) ---------------------------------------
        ColumnSpec("schema_version", "UInt16", lambda c: c.hand.schema_version),
        ColumnSpec("format_signature", LC, lambda c: c.hand.format_signature),
        ColumnSpec("unparsed_count", "UInt16", lambda c: len(c.hand.unparsed_lines)),
        ColumnSpec("unparsed_lines", "Array(String)", lambda c: list(c.hand.unparsed_lines)),
        ColumnSpec("extra", "Map(String, String)", lambda c: dict(c.hand.extra)),
        # ---- house money (migrations 0006, 0008) ------------------------------------------
        ColumnSpec("jackpot_drop", MONEY, lambda c: c.hand.jackpot_drop),
        ColumnSpec("cash_drop", MONEY, lambda c: c.hand.cash_drop),
    ),
    staging_extras=(
        "toDate(played_at_utc) as played_date",
        # CAST, not toUInt8: comparing a LowCardinality(String) yields LowCardinality(UInt8),
        # which ClickHouse refuses to materialize (SUSPICIOUS_TYPE_FOR_LOW_CARDINALITY).
        "cast(board_flop_1 != '' as UInt8) as has_flop",
        "cast(board_turn != '' as UInt8) as has_turn",
        "cast(board_river != '' as UInt8) as has_river",
        # THE authoritative incremental watermark (macros/incremental.sql).
        "parsed_at as src_parsed_at",
    ),
)
