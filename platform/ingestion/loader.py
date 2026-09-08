"""Canonical hands -> ClickHouse, in columnar batches.

Two throughput rules, both learned the hard way in the lab:

  1. **Batch inserts.** One INSERT = one ClickHouse part. Thousands of small inserts produce
     thousands of parts and hit `TOO_MANY_PARTS`; the background merge pool cannot keep up.
     Batching here is a correctness constraint, not an optimization.

  2. **Build columns, not rows.** Polars turns the per-hand Python objects into Arrow columns
     once, and clickhouse-connect ships them straight down. Doing the same work as a Python
     loop over row tuples is the single biggest avoidable cost in the ingest path
     (docs/POKER_DATA_MODEL.md §10).

Note that Polars does mechanical normalization only. **Stat logic lives in dbt** — that is a
locked decision and this module deliberately computes nothing a statistic depends on.
"""

from __future__ import annotations

import logging
from decimal import Decimal
from typing import Any

import polars as pl
from clickhouse_connect.driver.client import Client

from core.models import ZERO, CanonicalHand

log = logging.getLogger(__name__)

HANDS_COLUMNS = [
    "user_id",
    "hand_uid",
    "site",
    "site_hand_id",
    "played_at_utc",
    "game_type",
    "limit_type",
    "table_format",
    "currency",
    "small_blind",
    "big_blind",
    "ante",
    "straddle",
    "stake_level",
    "hole_card_count",
    "max_seats",
    "players_dealt_in",
    "button_seat",
    "table_name",
    "board_flop_1",
    "board_flop_2",
    "board_flop_3",
    "board_turn",
    "board_river",
    "total_pot",
    "rake",
    "jackpot_drop",
    "hero_seat",
    "tournament_id",
    "tz_source",
    "raw_object_key",
    "raw_byte_offset",
    "parser_version",
    # variant + tournament coverage (migration 0003)
    "game_structure",
    "is_hi_lo",
    "tourney_kind",
    "tourney_speed",
    "tourney_buy_in",
    "tourney_bounty",
    "tourney_fee",
    "tourney_currency",
    "tourney_level",
    "is_big_blind_ante",
    "is_satellite",
    # forward compatibility (migration 0004)
    "schema_version",
    "format_signature",
    "unparsed_count",
    "unparsed_lines",
    "extra",
]
PLAYERS_COLUMNS = [
    "user_id",
    "hand_uid",
    "played_at_utc",
    "seat",
    "player_key",
    "screen_name",
    "is_hero",
    "is_anonymized",
    "anon_alias",
    "position",
    "position_index",
    "starting_stack",
    "starting_stack_bb",
    "hole_cards",
    "total_invested",
    "net_won",
    "net_won_bb",
    "allin_equity",
    "ev_won_bb",
    "saw_flop",
    "saw_turn",
    "saw_river",
    "went_to_showdown",
    "won_hand",
    "bounty_won",
    "was_eliminated",
    "extra",
]
ACTIONS_COLUMNS = [
    "user_id",
    "hand_uid",
    "played_at_utc",
    "action_index",
    "street",
    "seat",
    "action_type",
    "amount",
    "amount_to",
    "pot_before",
    "to_call",
    "is_allin",
    "is_voluntary",
]
WINNERS_COLUMNS = ["user_id", "hand_uid", "played_at_utc", "pot_index", "seat", "amount_won"]


def _board_slot(board: tuple[str, ...], index: int) -> str:
    return board[index] if len(board) > index else ""


def to_rows(
    hands: list[CanonicalHand], tenant_id: int
) -> tuple[list[list[Any]], list[list[Any]], list[list[Any]], list[list[Any]]]:
    """Flatten canonical hands into the four ClickHouse row sets.

    `tenant_id` is a required argument, not a field read off the hand: tenancy comes from the
    authenticated request, never from parsed content.
    """
    hand_rows: list[list[Any]] = []
    player_rows: list[list[Any]] = []
    action_rows: list[list[Any]] = []
    winner_rows: list[list[Any]] = []

    for hand in hands:
        uid = hand.hand_uid
        ts = hand.played_at_utc.replace(tzinfo=None)
        bb = hand.big_blind or Decimal(1)

        hand_rows.append(
            [
                tenant_id,
                uid,
                hand.site.value,
                hand.site_hand_id,
                ts,
                hand.game_type.value,
                hand.limit_type.value,
                hand.table_format.value,
                hand.currency,
                hand.small_blind,
                hand.big_blind,
                hand.ante,
                hand.straddle,
                hand.stake_level,
                hand.hole_card_count,
                hand.max_seats,
                hand.players_dealt_in,
                hand.button_seat,
                hand.table_name,
                _board_slot(hand.board, 0),
                _board_slot(hand.board, 1),
                _board_slot(hand.board, 2),
                _board_slot(hand.board, 3),
                _board_slot(hand.board, 4),
                hand.total_pot,
                hand.rake,
                hand.jackpot_drop,
                hand.hero_seat,
                hand.tournament_id or "",
                hand.tz_source,
                hand.raw_object_key,
                hand.raw_byte_offset,
                hand.parser_version,
                hand.game_type.structure.value,
                int(hand.game_type.is_hi_lo),
                t.kind.value if (t := hand.tournament) else "none",
                t.speed.value if t else "none",
                t.buy_in if t else ZERO,
                t.bounty if t else ZERO,
                t.fee if t else ZERO,
                t.currency if t else "",
                t.level if t else "",
                int(t.is_big_blind_ante) if t else 0,
                int(t.is_satellite) if t else 0,
                hand.schema_version,
                hand.format_signature,
                len(hand.unparsed_lines),
                list(hand.unparsed_lines),
                dict(hand.extra),
            ]
        )

        for player in hand.players:
            player_rows.append(
                [
                    tenant_id,
                    uid,
                    ts,
                    player.seat,
                    player.player_key,
                    player.screen_name,
                    int(player.is_hero),
                    int(player.is_anonymized),
                    player.anon_alias,
                    player.position.value,
                    player.position_index,
                    player.starting_stack,
                    (player.starting_stack / bb).quantize(Decimal("0.01")),
                    " ".join(player.hole_cards),
                    player.total_invested,
                    player.net_won,
                    (player.net_won / bb).quantize(Decimal("0.0001")),
                    player.allin_equity,
                    (player.ev_won / bb).quantize(Decimal("0.0001"))
                    if player.ev_won is not None
                    else None,
                    int(player.saw_flop),
                    int(player.saw_turn),
                    int(player.saw_river),
                    int(player.went_to_showdown),
                    int(player.won_hand),
                    player.bounty_won,
                    int(player.was_eliminated),
                    dict(player.extra),
                ]
            )

        for action in hand.actions:
            action_rows.append(
                [
                    tenant_id,
                    uid,
                    ts,
                    action.action_index,
                    action.street.value,
                    action.seat,
                    action.action_type.value,
                    action.amount,
                    action.amount_to,
                    action.pot_before,
                    action.to_call,
                    int(action.is_allin),
                    int(action.is_voluntary),
                ]
            )

        for winner in hand.pot_winners:
            winner_rows.append(
                [
                    tenant_id,
                    uid,
                    ts,
                    winner.pot_index,
                    winner.seat,
                    winner.amount_won,
                ]
            )

    return hand_rows, player_rows, action_rows, winner_rows


def insert_hands(client: Client, hands: list[CanonicalHand], tenant_id: int) -> dict[str, int]:
    """Insert a batch of hands into every core table. Returns per-table row counts."""
    if not hands:
        return {"hands": 0, "hand_players": 0, "actions": 0, "pot_winners": 0}

    hand_rows, player_rows, action_rows, winner_rows = to_rows(hands, tenant_id)

    client.insert("core.hands", hand_rows, column_names=HANDS_COLUMNS)
    client.insert("core.hand_players", player_rows, column_names=PLAYERS_COLUMNS)
    client.insert("core.actions", action_rows, column_names=ACTIONS_COLUMNS)
    if winner_rows:
        client.insert("core.pot_winners", winner_rows, column_names=WINNERS_COLUMNS)

    counts = {
        "hands": len(hand_rows),
        "hand_players": len(player_rows),
        "actions": len(action_rows),
        "pot_winners": len(winner_rows),
    }
    log.info("inserted %s", counts)
    return counts


def normalize_frame(hands: list[CanonicalHand], tenant_id: int) -> pl.DataFrame:
    """Build a Polars frame of hand-level rows.

    Used for bulk paths where derived columns are computed vectorized rather than per hand.
    Kept separate from `insert_hands` so the simple path stays simple; this is where the
    Phase-3 Spark re-parse job and any future bulk transform hook in.
    """
    hand_rows, _, _, _ = to_rows(hands, tenant_id)
    return pl.DataFrame(hand_rows, schema=HANDS_COLUMNS, orient="row")
