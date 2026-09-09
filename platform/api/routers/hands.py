"""Hand list and single-hand fetch — the data behind the replayer.

Rows are read **by column name** (`named_results()`), never by position: an earlier version
indexed `h[7]…h[13]`, so reordering a SELECT would have silently shifted every value into the
wrong field (docs/POKER_AUDIT.md B11).
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import date
from typing import Any

from fastapi import APIRouter, HTTPException, status

from api.db import clickhouse
from api.deps import CurrentUserDep
from api.schemas import ActionOut, HandDetail, HandPlayerOut, HandSummary
from core.settings import get_settings

router = APIRouter(prefix="/v1/hands", tags=["hands"])

CORE = get_settings().db("core")
"""The core database, prefixed for the test suite and bare in production."""

MAX_LIST = 500

Row = Mapping[str, Any]


def summary_from_row(row: Row) -> HandSummary:
    """A hand-list entry from a named row."""
    return HandSummary(
        hand_uid=row["hand_uid"],
        site=row["site"],
        played_at_utc=row["played_at_utc"],
        stake_level=row["stake_level"],
        position=row["position"],
        hole_cards=row["hole_cards"],
        board=" ".join(str(row["board"]).split()),
        net_won_bb=float(row["net_won_bb"]),
        went_to_showdown=bool(row["went_to_showdown"]),
    )


def player_from_row(row: Row) -> HandPlayerOut:
    """A seat from a named row."""
    return HandPlayerOut(
        seat=int(row["seat"]),
        screen_name=row["screen_name"],
        position=row["position"],
        is_hero=bool(row["is_hero"]),
        is_anonymized=bool(row["is_anonymized"]),
        starting_stack=float(row["starting_stack"]),
        hole_cards=row["hole_cards"],
        net_won=float(row["net_won"]),
        net_won_bb=float(row["net_won_bb"]),
        went_to_showdown=bool(row["went_to_showdown"]),
        won_hand=bool(row["won_hand"]),
    )


def action_from_row(row: Row) -> ActionOut:
    """An action from a named row (Enum8 columns arrive as their string labels)."""
    return ActionOut(
        action_index=int(row["action_index"]),
        street=str(row["street"]),
        seat=int(row["seat"]),
        action_type=str(row["action_type"]),
        amount=float(row["amount"]),
        amount_to=float(row["amount_to"]),
        pot_before=float(row["pot_before"]),
        to_call=float(row["to_call"]),
        is_allin=bool(row["is_allin"]),
    )


def detail_from_rows(hand: Row, players: list[Row], actions: list[Row]) -> HandDetail:
    """Assemble the replayer payload from named rows."""
    board = [
        c
        for c in (
            hand["board_flop_1"],
            hand["board_flop_2"],
            hand["board_flop_3"],
            hand["board_turn"],
            hand["board_river"],
        )
        if c
    ]
    return HandDetail(
        hand_uid=hand["hand_uid"],
        site=hand["site"],
        site_hand_id=hand["site_hand_id"],
        played_at_utc=hand["played_at_utc"],
        game_type=hand["game_type"],
        stake_level=hand["stake_level"],
        big_blind=float(hand["big_blind"]),
        board=board,
        total_pot=float(hand["total_pot"]),
        rake=float(hand["rake"]),
        players=[player_from_row(r) for r in players],
        actions=[action_from_row(r) for r in actions],
    )


@router.get("", response_model=list[HandSummary])
async def list_hands(
    user: CurrentUserDep,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = 100,
) -> list[HandSummary]:
    """Recent hands for the authenticated user's hero seat."""
    where = ["h.user_id = {tenant_id:UInt32}", "p.is_hero = 1"]
    params: dict[str, Any] = {"tenant_id": user.tenant_id, "limit": min(limit, MAX_LIST)}
    if date_from is not None:
        where.append("toDate(h.played_at_utc) >= {date_from:Date}")
        params["date_from"] = date_from
    if date_to is not None:
        where.append("toDate(h.played_at_utc) <= {date_to:Date}")
        params["date_to"] = date_to

    sql = (
        "SELECT h.hand_uid AS hand_uid, h.site AS site, h.played_at_utc AS played_at_utc, "
        "h.stake_level AS stake_level, p.position AS position, p.hole_cards AS hole_cards, "
        "concat(h.board_flop_1,' ',h.board_flop_2,' ',h.board_flop_3,' ',"
        "h.board_turn,' ',h.board_river) AS board, "
        "p.net_won_bb AS net_won_bb, p.went_to_showdown AS went_to_showdown "
        f"FROM {CORE}.hands AS h FINAL "
        f"INNER JOIN {CORE}.hand_players AS p FINAL "
        "  ON p.user_id = h.user_id AND p.hand_uid = h.hand_uid "
        f"WHERE {' AND '.join(where)} "
        "ORDER BY h.played_at_utc DESC LIMIT {limit:UInt32}"
    )
    rows = clickhouse().query(sql, parameters=params).named_results()
    return [summary_from_row(r) for r in rows]


@router.get("/{hand_uid}", response_model=HandDetail)
async def get_hand(hand_uid: str, user: CurrentUserDep) -> HandDetail:
    """One hand with all seats and actions — everything the replayer needs.

    Every query below is scoped by `user_id` from the token. A hand_uid belonging to another
    tenant returns 404: the response must not reveal that the hand exists at all.
    """
    client = clickhouse()
    params = {"tenant_id": user.tenant_id, "hand_uid": hand_uid}
    scope = "WHERE user_id = {tenant_id:UInt32} AND hand_uid = {hand_uid:String}"

    hand_rows = list(
        client.query(
            "SELECT hand_uid, site, site_hand_id, played_at_utc, game_type, stake_level, "
            "big_blind, board_flop_1, board_flop_2, board_flop_3, board_turn, board_river, "
            f"total_pot, rake FROM {CORE}.hands FINAL {scope} LIMIT 1",
            parameters=params,
        ).named_results()
    )
    if not hand_rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Hand not found")

    players = client.query(
        "SELECT seat, screen_name, position, is_hero, is_anonymized, starting_stack, "
        "hole_cards, net_won, net_won_bb, went_to_showdown, won_hand "
        f"FROM {CORE}.hand_players FINAL {scope} ORDER BY seat",
        parameters=params,
    ).named_results()
    actions = client.query(
        "SELECT action_index, street, seat, action_type, amount, amount_to, pot_before, "
        f"to_call, is_allin FROM {CORE}.actions FINAL {scope} ORDER BY action_index",
        parameters=params,
    ).named_results()
    return detail_from_rows(hand_rows[0], list(players), list(actions))
