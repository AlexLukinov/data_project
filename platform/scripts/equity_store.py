"""Reading and writing the seats `scripts.backfill_equity` enriches.

Split out for the file-size rule, but the seam is real: everything here knows about
ClickHouse and nothing here knows what a made hand or an equity is. A `Hand` carries only
what the enrichment reads and writes; rebuilding a full `CanonicalHand` would mean
re-deriving it from raw text, the cost this path exists to avoid.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from core.allin import HOLDEM_HOLE_CARDS, is_contested, runout_board
from core.enums import Street
from ingestion.clickhouse import clickhouse

log = logging.getLogger("backfill_equity")

BATCH_ROWS = 50_000
_STREETS = (Street.PREFLOP, Street.FLOP, Street.TURN, Street.RIVER)


@dataclass(slots=True)
class Seat:
    """One stored seat, with the fields the enrichment reads and the ones it writes."""

    seat: int
    hole: tuple[str, ...]
    invested: Decimal
    net_won: Decimal
    showdown: bool
    made: list[str] = field(default_factory=lambda: ["", "", ""])
    equity: Decimal | None = None
    ev_won_bb: Decimal | None = None


@dataclass(slots=True)
class Hand:
    """One stored hand: the board, the seats, and where betting stopped."""

    uid: str
    big_blind: Decimal
    board: tuple[str, ...]
    last_street: Street
    has_allin: bool
    seats: list[Seat]

    def contenders(self) -> list[int]:
        """Indices of the seats that reached showdown with both cards known."""
        return [
            i for i, s in enumerate(self.seats) if s.showdown and len(s.hole) == HOLDEM_HOLE_CARDS
        ]

    def board_at_all_in(self) -> tuple[str, ...] | None:
        """The board visible when the last chip went in, or None when EV does not apply.

        The judgement is `core.allin`'s, so this path and the parse-time one cannot drift;
        only the inputs come from storage rather than from a `CanonicalHand`.
        """
        board = runout_board(self.board, self.last_street, self.has_allin)
        if board is None:
            return None
        contenders = self.contenders()
        showdown = sum(1 for s in self.seats if s.showdown)
        if not is_contested(showdown, len(contenders)):
            return None
        cards = {c for i in contenders for c in self.seats[i].hole}
        if len(cards) != len(contenders) * HOLDEM_HOLE_CARDS:
            return None
        return board


_SELECT = """
select
    h.hand_uid                                                  as uid,
    h.big_blind                                                 as big_blind,
    arrayFilter(x -> x != '', [h.board_flop_1, h.board_flop_2, h.board_flop_3,
                               h.board_turn, h.board_river])     as board,
    a.last_street                                               as last_street,
    a.has_allin                                                 as has_allin,
    groupArray(p.seat)                                          as seats,
    groupArray(p.hole_cards)                                    as holes,
    groupArray(p.total_invested)                                as invested,
    groupArray(p.net_won)                                       as net_won,
    groupArray(p.went_to_showdown)                              as showdown
from (
    select user_id, hand_uid, big_blind, board_flop_1, board_flop_2, board_flop_3,
           board_turn, board_river, game_type
    from core.hands final where {where}
) as h
inner join (
    select user_id, hand_uid, seat, hole_cards, total_invested, net_won, went_to_showdown
    from core.hand_players final where {where}
) as p
    on p.user_id = h.user_id and p.hand_uid = h.hand_uid
inner join (
    select
        hand_uid,
        max(multiIf(street = 'preflop', 0, street = 'flop', 1,
                    street = 'turn', 2, 3))                  as last_street,
        max(is_allin) as has_allin
    from core.actions final
    where {where}
      and action_type in ('fold', 'check', 'call', 'bet', 'raise')
    group by hand_uid
) as a on a.hand_uid = h.hand_uid
where h.game_type = 'holdem'
group by h.hand_uid, h.big_blind, board, a.last_street, a.has_allin
-- Only the hands that can gain something: one where nobody's cards were shown and nobody
-- went all-in has no class to compute, no EV to adjust and no stale value to clear, since
-- all three need cards. On the real corpus that is 14.5% of hands loaded, not 100%.
having max(p.hole_cards != '') = 1 or a.has_allin = 1
"""


def days(dataset: str | None, month: str | None) -> list[str]:
    """The days holding hands, oldest first — the unit of work.

    A day, not the monthly partition: 2025-01 alone is 38% of the corpus and reached 3.8 GB of
    resident memory as objects before writing a row. Filling a partition from several day
    batches is fine — a ReplacingMergeTree insert swaps nothing wholesale.
    """
    where = _scope(dataset, month)
    rows = (
        clickhouse()
        .query(
            f"select distinct toDate(played_at_utc) as d from core.hands where {where} order by d"
        )
        .result_rows
    )
    return [str(r[0]) for r in rows]


def unfinished(dataset: str | None, candidates: list[str]) -> list[str]:
    """The days of `candidates` still holding a seat that should have a class and has none.

    Resuming must be decided by what is MISSING, not by what is present. The first version
    asked whether a day held any class at all and skipped it if so — wrong the moment a run
    dies midway through a day, since `write()` inserts in batches and a half-written day then
    looks finished for ever — it left 1,154 seats of 2025-04-30 unenriched. "Should have a
    class" is two known cards in a hand that saw a flop, the mart assertion's own condition.
    """
    where = _scope(dataset)
    sql = f"""
        select distinct toDate(p.played_at_utc) as d
        from (select hand_uid, played_at_utc, hole_cards, made_hand_flop
              from core.hand_players final where {where}) as p
        inner join (select hand_uid, board_flop_1 from core.hands final where {where}) as h
            on h.hand_uid = p.hand_uid
        where length(splitByChar(' ', p.hole_cards)) = 2
          and h.board_flop_1 != ''
          and p.made_hand_flop = ''
    """
    pending = {str(r[0]) for r in clickhouse().query(sql).result_rows}
    return [d for d in candidates if d in pending]


def _scope(dataset: str | None, month: str | None = None, day: str | None = None) -> str:
    clauses = ["1"]
    if dataset:
        clauses.append(f"dataset = '{dataset}'")
    if month:
        clauses.append(f"toYYYYMM(played_at_utc) = {int(month.replace('-', ''))}")
    if day:
        clauses.append(f"toDate(played_at_utc) = toDate('{day}')")
    return " and ".join(clauses)


def load(dataset: str | None, day: str) -> list[Hand]:
    """Every hold'em hand of one day, as `Hand` objects."""
    rows = clickhouse().query(_SELECT.format(where=_scope(dataset, day=day))).result_rows
    hands: list[Hand] = []
    for uid, bb, board, street, allin, seats, holes, invested, won, showdown in rows:
        hands.append(
            Hand(
                uid=uid,
                big_blind=bb,
                board=tuple(board),
                last_street=_STREETS[street],
                has_allin=bool(allin),
                seats=[
                    Seat(
                        seat=s,
                        hole=tuple(h.split()) if h else (),
                        invested=inv,
                        net_won=w,
                        showdown=bool(sd),
                    )
                    for s, h, inv, w, sd in zip(seats, holes, invested, won, showdown, strict=True)
                ],
            )
        )
    return hands


# The seat's identity, and the five columns this pass owns. Nothing else is named, and that is
# the point: everything else is copied inside ClickHouse and never travels through Python.
_KEYS = ("user_id", "hand_uid", "seat")
_OWNED = ("allin_equity", "ev_won_bb", "made_hand_flop", "made_hand_turn", "made_hand_river")

_MERGE = """
insert into core.hand_players (
    user_id, dataset, hand_uid, played_at_utc, seat, player_key, screen_name, is_hero,
    is_anonymized, anon_alias, position, position_index, starting_stack, starting_stack_bb,
    hole_cards, total_invested, net_won, net_won_bb, allin_equity, ev_won_bb, saw_flop,
    saw_turn, saw_river, went_to_showdown, won_hand, parsed_at, bounty_won, was_eliminated,
    finish_position, extra, made_hand_flop, made_hand_turn, made_hand_river
)
select
    p.user_id, p.dataset, p.hand_uid, p.played_at_utc, p.seat, p.player_key, p.screen_name,
    p.is_hero, p.is_anonymized, p.anon_alias, p.position, p.position_index, p.starting_stack,
    p.starting_stack_bb, p.hole_cards, p.total_invested, p.net_won, p.net_won_bb,
    e.allin_equity, e.ev_won_bb,
    p.saw_flop, p.saw_turn, p.saw_river, p.went_to_showdown, p.won_hand,
    now64(3),
    p.bounty_won, p.was_eliminated, p.finish_position, p.extra,
    e.made_hand_flop, e.made_hand_turn, e.made_hand_river
from (select * from core.hand_players final where {where}) as p
inner join {scratch} as e
    on e.user_id = p.user_id and e.hand_uid = p.hand_uid and e.seat = p.seat
"""
"""The whole row is rewritten, but only the five owned columns come from Python.

**A bug fix, not a refactor.** The first version selected all 33 columns into Python and
inserted them back, round-tripping `played_at_utc` — a `DateTime64(3, 'UTC')` — through an
aware `datetime` that clickhouse-connect re-encoded in the machine's local zone. On a UTC+3
laptop every rewritten row moved **three hours earlier** (2,264,407 of them), and those
crossing a month boundary landed in another partition where `ReplacingMergeTree` cannot
collapse them, so the hand grew duplicate seats. Copying inside ClickHouse removes the class.
"""


def write(hands: list[Hand], day: str, dataset: str | None) -> int:
    """Merge the five computed columns into the day's seats, in place, server-side.

    Written by comparison, not by intent: a seat is rewritten when what it holds differs from
    what it should hold. That makes the pass idempotent — a second run over the same day writes
    nothing — and, more importantly, it *clears* a value that should no longer be there. An
    earlier revision of the cash-out rule wrote equities on hands that were never dealt out,
    and a write-only-what-I-computed pass would have left every one of them in place.
    """
    wanted = {(h.uid, s.seat): s for h in hands for s in h.seats}
    if not wanted:
        return 0
    where = _scope(dataset, day=day)
    changed = _changed_rows(_stored_rows(where), wanted)
    if not changed:
        return 0
    scratch = f"core.enrichment_{day.replace('-', '')}"
    client = clickhouse()
    client.command(f"drop table if exists {scratch}")
    client.command(
        f"create table {scratch} (user_id UInt32, hand_uid String, seat UInt8, "
        "allin_equity Nullable(Decimal(9, 6)), ev_won_bb Nullable(Decimal(18, 4)), "
        "made_hand_flop LowCardinality(String), made_hand_turn LowCardinality(String), "
        "made_hand_river LowCardinality(String)) engine = Memory"
    )
    try:
        for start in range(0, len(changed), BATCH_ROWS):
            client.insert(
                scratch,
                changed[start : start + BATCH_ROWS],
                column_names=[*_KEYS, *_OWNED],
            )
        client.command(_MERGE.format(where=where, scratch=scratch))
    finally:
        client.command(f"drop table if exists {scratch}")
    return len(changed)


def _stored_rows(where: str) -> list[list[Any]]:
    """The day's seats that could possibly change, with only the columns needed to compare.

    A seat with no cards, no stored equity and no stored class has nothing to write and nothing
    to clear, so it is not fetched: on a dense day that is ~150k rows instead of ~600k. No
    timestamp is selected, because none is needed and selecting one is how this went wrong.
    """
    clause = where + (
        " and (hole_cards != '' or allin_equity is not null or made_hand_flop != ''"
        " or made_hand_turn != '' or made_hand_river != '')"
    )
    columns = ", ".join([*_KEYS, *_OWNED])
    rows = clickhouse().query(f"select {columns} from core.hand_players final where {clause}")
    return [list(r) for r in rows.result_rows]


def _changed_rows(rows: list[list[Any]], wanted: dict[tuple[str, int], Seat]) -> list[list[Any]]:
    """The seats whose five owned columns differ from what they should be."""
    out = []
    for row in rows:
        seat = wanted.get((row[1], row[2]))
        if seat is None:
            continue
        if tuple(row[3:8]) == (seat.equity, seat.ev_won_bb, *seat.made):
            continue
        out.append([row[0], row[1], row[2], seat.equity, seat.ev_won_bb, *seat.made])
    return out
