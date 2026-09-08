"""Hand list and single-hand fetch — the data behind the replayer."""

from __future__ import annotations

from datetime import date
from typing import Any

from fastapi import APIRouter, HTTPException, status

from api.db import clickhouse
from api.deps import CurrentUserDep
from api.schemas import HandDetail, HandSummary

router = APIRouter(prefix="/v1/hands", tags=["hands"])


@router.get("", response_model=list[HandSummary])
async def list_hands(
    user: CurrentUserDep,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = 100,
) -> list[HandSummary]:
    """Recent hands for the authenticated user's hero seat."""
    where = ["h.user_id = {tenant_id:UInt32}", "p.is_hero = 1"]
    params: dict[str, Any] = {"tenant_id": user.tenant_id, "limit": min(limit, 500)}
    if date_from is not None:
        where.append("toDate(h.played_at_utc) >= {date_from:Date}")
        params["date_from"] = date_from
    if date_to is not None:
        where.append("toDate(h.played_at_utc) <= {date_to:Date}")
        params["date_to"] = date_to

    sql = (
        "SELECT h.hand_uid, h.site, h.played_at_utc, h.stake_level, p.position, "
        "p.hole_cards, "
        "concat(h.board_flop_1,' ',h.board_flop_2,' ',h.board_flop_3,' ',"
        "h.board_turn,' ',h.board_river) AS board, "
        "p.net_won_bb, p.went_to_showdown "
        "FROM core.hands AS h FINAL "
        "INNER JOIN core.hand_players AS p FINAL "
        "  ON p.user_id = h.user_id AND p.hand_uid = h.hand_uid "
        f"WHERE {' AND '.join(where)} "
        "ORDER BY h.played_at_utc DESC LIMIT {limit:UInt32}"
    )
    rows = clickhouse().query(sql, parameters=params).result_rows
    return [
        HandSummary(
            hand_uid=r[0],
            site=r[1],
            played_at_utc=r[2],
            stake_level=r[3],
            position=r[4],
            hole_cards=r[5],
            board=" ".join(str(r[6]).split()),
            net_won_bb=float(r[7]),
            went_to_showdown=bool(r[8]),
        )
        for r in rows
    ]


@router.get("/{hand_uid}", response_model=HandDetail)
async def get_hand(hand_uid: str, user: CurrentUserDep) -> HandDetail:
    """One hand with all seats and actions — everything the replayer needs.

    Every query below is scoped by `user_id` from the token. A hand_uid belonging to another
    tenant returns 404: the response must not reveal that the hand exists at all.
    """
    client = clickhouse()
    params = {"tenant_id": user.tenant_id, "hand_uid": hand_uid}

    hand_rows = client.query(
        "SELECT hand_uid, site, site_hand_id, played_at_utc, game_type, stake_level, "
        "big_blind, board_flop_1, board_flop_2, board_flop_3, board_turn, board_river, "
        "total_pot, rake "
        "FROM core.hands FINAL "
        "WHERE user_id = {tenant_id:UInt32} AND hand_uid = {hand_uid:String} LIMIT 1",
        parameters=params,
    ).result_rows
    if not hand_rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Hand not found")
    h = hand_rows[0]

    players = client.query(
        "SELECT seat, screen_name, position, is_hero, is_anonymized, starting_stack, "
        "hole_cards, net_won, net_won_bb, went_to_showdown, won_hand "
        "FROM core.hand_players FINAL "
        "WHERE user_id = {tenant_id:UInt32} AND hand_uid = {hand_uid:String} ORDER BY seat",
        parameters=params,
    )
    actions = client.query(
        "SELECT action_index, street, seat, action_type, amount, amount_to, pot_before, "
        "to_call, is_allin "
        "FROM core.actions FINAL "
        "WHERE user_id = {tenant_id:UInt32} AND hand_uid = {hand_uid:String} "
        "ORDER BY action_index",
        parameters=params,
    )

    def rows_as_dicts(result: Any) -> list[dict[str, object]]:
        names = result.column_names
        return [dict(zip(names, row, strict=True)) for row in result.result_rows]

    board = [c for c in (h[7], h[8], h[9], h[10], h[11]) if c]
    return HandDetail(
        hand_uid=h[0],
        site=h[1],
        site_hand_id=h[2],
        played_at_utc=h[3],
        game_type=h[4],
        stake_level=h[5],
        big_blind=float(h[6]),
        board=board,
        total_pot=float(h[12]),
        rake=float(h[13]),
        players=rows_as_dicts(players),
        actions=rows_as_dicts(actions),
    )
