"""The ClickHouse reads behind the replayer: hand lists and one hand in full.

Two routers use these (`/v1/hands` and `/v1/pool/hands`), so they live here rather than in
either. Rows are read **by column name** (`named_results()`), never by position: an earlier
version indexed `h[7]…h[13]`, so reordering a SELECT silently shifted every value into the
wrong field (docs/POKER_AUDIT.md B11).

Every query is scoped by `user_id` from the token. A hand belonging to another tenant is not
found, which is also the answer for a hand that does not exist.

**`hand_uid` crosses a boundary here.** `core.*` stores 16 raw bytes (plan B.5b), the API
speaks 32-character hex: reads use `UID_HEX`, filters `UID_MATCH` / `uid_in` (`core.ids`). And
a `SELECT … AS hand_uid` alias shadows that column in `WHERE` -- measured, it matches nothing
-- so every filter below is qualified with its table alias: `h.hand_uid`, never `hand_uid`.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import date
from typing import Any

from api.db import clickhouse
from api.schemas import ActionOut, HandDetail, HandPlayerOut, HandSummary
from core.ids import UID_HEX, UID_MATCH, uid_in
from core.settings import get_settings
from stats.hands import HandRef

CORE = get_settings().db("core")
"""The core database, prefixed for the test suite and bare in production."""

MAX_LIST = 500

BOARD = (
    "concat(h.board_flop_1,' ',h.board_flop_2,' ',h.board_flop_3,' ',h.board_turn,' ',"
    "h.board_river)"
)
FOCUS = "(p.hole_cards != '', p.net_won_bb)"
"""Which seat a pool hand opens on: one that showed cards if any did, else the biggest winner.
A pool hand has no hero, and a replayer has to start looking somewhere."""

Row = Mapping[str, Any]


def _date_range(where: list[str], args: dict[str, Any], lo: date | None, hi: date | None) -> None:
    """Append the optional day bounds in place. `h` is the hands table in both callers."""
    if lo is not None:
        where.append("toDate(h.played_at_utc) >= {date_from:Date}")
        args["date_from"] = lo
    if hi is not None:
        where.append("toDate(h.played_at_utc) <= {date_to:Date}")
        args["date_to"] = hi


def summary_from_row(row: Row) -> HandSummary:
    """A hand-list entry from a named row."""
    return HandSummary(
        hand_uid=row["hand_uid"],
        site=row["site"],
        played_at_utc=row["played_at_utc"],
        stake_level=row["stake_level"],
        seat=int(row["seat"]),
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


def detail_from_rows(
    hand_uid: str, hand: Row, players: Sequence[Row], actions: Sequence[Row]
) -> HandDetail:
    """Assemble the replayer payload. `hand_uid` is passed in: `core.hands` stores bytes."""
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
        hand_uid=hand_uid,
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


def hand_exists(tenant_id: int, hand_uid: str) -> bool:
    """Whether this tenant has this hand -- one point lookup on the sort key `(user_id, hand_uid)`.

    What a note or a tag is checked against before it is written (plan D.7b): the hand lives
    here and the annotation in Postgres, so this is the only place ownership can be decided.
    """
    rows = clickhouse().query(
        f"SELECT 1 FROM {CORE}.hands "
        "WHERE user_id = {tenant_id:UInt32} AND " + UID_MATCH.format("", "hand_uid") + " LIMIT 1",
        parameters={"tenant_id": tenant_id, "hand_uid": hand_uid},
    )
    return len(rows.result_rows) > 0


def hero_hands(
    tenant_id: int,
    date_from: date | None,
    date_to: date | None,
    limit: int,
    *,
    only: Sequence[str] | None = None,
) -> list[HandSummary]:
    """Recent hands for this user's own seat, newest first.

    `only` restricts the list to those `hand_uid`s -- how a tag, which lives in Postgres,
    narrows a list that lives here (ADR-048). `None` means no restriction; an empty list is
    the caller's to short-circuit, since it can only ever answer nothing.
    """
    where = ["h.user_id = {tenant_id:UInt32}", "p.is_hero = 1"]
    params: dict[str, Any] = {"tenant_id": tenant_id, "limit": min(limit, MAX_LIST)}
    _date_range(where, params, date_from, date_to)
    if only is not None:
        where.append(uid_in("h.hand_uid", "only"))
        params["only"] = list(only)
    sql = (
        f"SELECT {UID_HEX.format('h.')}, h.site AS site, h.played_at_utc AS played_at_utc, "
        "h.stake_level AS stake_level, p.seat AS seat, p.position AS position, "
        f"p.hole_cards AS hole_cards, {BOARD} AS board, p.net_won_bb AS net_won_bb, "
        "p.went_to_showdown AS went_to_showdown "
        f"FROM {CORE}.hands AS h FINAL "
        f"INNER JOIN {CORE}.hand_players AS p FINAL "
        "  ON p.user_id = h.user_id AND p.hand_uid = h.hand_uid "
        f"WHERE {' AND '.join(where)} "
        "ORDER BY h.played_at_utc DESC LIMIT {limit:UInt32}"
    )
    return [summary_from_row(r) for r in clickhouse().query(sql, parameters=params).named_results()]


def pool_hand_refs(
    tenant_id: int,
    *,
    date_from: date | None,
    date_to: date | None,
    stake_level: str | None,
    limit: int,
    only: Sequence[str] | None = None,
) -> list[HandRef]:
    """Recent pool hands, each with the seat worth opening on (`FOCUS`).

    `only` restricts to those `hand_uid`s, as in `hero_hands`.
    """
    where = ["h.user_id = {tenant_id:UInt32}", "h.dataset = 'population'"]
    params: dict[str, Any] = {"tenant_id": tenant_id, "limit": min(limit, MAX_LIST)}
    _date_range(where, params, date_from, date_to)
    if stake_level is not None:
        where.append("h.stake_level = {stake_level:String}")
        params["stake_level"] = stake_level
    if only is not None:
        where.append(uid_in("h.hand_uid", "only"))
        params["only"] = list(only)
    uids = [
        str(row["hand_uid"])
        for row in clickhouse()
        .query(
            f"SELECT {UID_HEX.format('h.')} FROM {CORE}.hands AS h FINAL "
            f"WHERE {' AND '.join(where)} "
            "ORDER BY h.played_at_utc DESC LIMIT {limit:UInt32}",
            parameters=params,
        )
        .named_results()
    ]
    return _focus_seats(tenant_id, uids)


def _focus_seats(tenant_id: int, uids: Sequence[str]) -> list[HandRef]:
    """One seat per hand, in the order the hands were given."""
    if not uids:
        return []
    rows = (
        clickhouse()
        .query(
            f"SELECT {UID_HEX.format('p.')}, argMax(p.seat, {FOCUS}) AS seat "
            f"FROM {CORE}.hand_players AS p FINAL "
            "WHERE p.user_id = {tenant_id:UInt32} "
            f"AND {uid_in('p.hand_uid', 'uids')} "
            "GROUP BY hand_uid",
            parameters={"tenant_id": tenant_id, "uids": list(uids)},
        )
        .named_results()
    )
    seats = {str(row["hand_uid"]): int(row["seat"]) for row in rows}
    return [HandRef(hand_uid=uid, seat=seats[uid]) for uid in uids if uid in seats]


def summaries_for(tenant_id: int, refs: Sequence[HandRef]) -> list[HandSummary]:
    """The list rows for given (hand, seat) pairs, in the order they were given.

    The pair is matched as one key rather than `hand_uid IN … AND seat IN …`, which would
    return every seat of every hand.
    """
    if not refs:
        return []
    params = {
        "tenant_id": tenant_id,
        "uids": [r.hand_uid for r in refs],
        "pairs": [f"{r.hand_uid}:{r.seat}" for r in refs],
    }
    sql = (
        f"SELECT {UID_HEX.format('h.')}, h.site AS site, h.played_at_utc AS played_at_utc, "
        "h.stake_level AS stake_level, p.seat AS seat, p.position AS position, "
        f"p.hole_cards AS hole_cards, {BOARD} AS board, p.net_won_bb AS net_won_bb, "
        "p.went_to_showdown AS went_to_showdown "
        f"FROM {CORE}.hands AS h FINAL "
        f"INNER JOIN {CORE}.hand_players AS p FINAL "
        "  ON p.user_id = h.user_id AND p.hand_uid = h.hand_uid "
        "WHERE h.user_id = {tenant_id:UInt32} "
        f"AND {uid_in('h.hand_uid', 'uids')} "
        # On the hex: `concat` over the stored bytes cannot meet a Python "<hex>:<seat>".
        "  AND concat(lower(hex(p.hand_uid)), ':', toString(p.seat)) IN {pairs:Array(String)}"
    )
    found = {
        (str(row["hand_uid"]), int(row["seat"])): summary_from_row(row)
        for row in clickhouse().query(sql, parameters=params).named_results()
    }
    return [found[key] for r in refs if (key := (r.hand_uid, r.seat)) in found]


def hand_detail(tenant_id: int, hand_uid: str) -> HandDetail | None:
    """One hand with all seats and actions, or None when this tenant has no such hand."""
    client = clickhouse()
    params = {"tenant_id": tenant_id, "hand_uid": hand_uid}
    scope = "WHERE user_id = {tenant_id:UInt32} AND " + UID_MATCH.format("", "hand_uid")
    # `hand_uid` is deliberately not projected: the caller already has it, and an alias of
    # that name would shadow the column in `scope`'s WHERE, which all three queries share.
    hand_rows = list(
        client.query(
            "SELECT site, site_hand_id, played_at_utc, game_type, stake_level, "
            "big_blind, board_flop_1, board_flop_2, board_flop_3, board_turn, board_river, "
            f"total_pot, rake FROM {CORE}.hands FINAL {scope} LIMIT 1",
            parameters=params,
        ).named_results()
    )
    if not hand_rows:
        return None
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
    return detail_from_rows(hand_uid, hand_rows[0], list(players), list(actions))
