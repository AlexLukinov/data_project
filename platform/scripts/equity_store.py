"""Reading and writing the seats `scripts.backfill_equity` enriches.

Split out from it for the file-size rule, and the seam is a real one: everything here knows
about ClickHouse and nothing here knows what a made hand or an equity is. The compute side
knows the reverse.

The shapes are deliberately thin — a `Hand` is the five things the enrichment reads (the board,
where betting stopped, whether anyone was all-in, and each seat's cards and money) and the five
it writes. Reconstructing a full `CanonicalHand` would mean re-deriving it from raw text, which
is the forty-five minutes this whole path exists to avoid.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime
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

        The judgement itself is `core.allin`'s, so this path and the parse-time one cannot
        drift; only the inputs are read from storage rather than from a `CanonicalHand`.
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
-- Only the hands that can gain something. A hand where nobody's cards were shown and
-- nobody went all-in has no made hand to classify and no EV to adjust, and it cannot be
-- holding a stale value either, since both need cards. On the real corpus that is 14.5%
-- of hands loaded instead of all of them.
having max(p.hole_cards != '') = 1 or a.has_allin = 1
"""


def days(dataset: str | None, month: str | None) -> list[str]:
    """The days holding hands, oldest first — the unit of work.

    A day, not the monthly partition: 2025-01 alone is 38% of the corpus, and holding one such
    month as objects reached 3.8 GB of resident memory before it had written a single row. A
    day is ~150k hands, which is the same reasoning `scripts/backfill.py` applies to dbt.
    Writing a partition from several day-batches is fine here — this is a ReplacingMergeTree
    insert, not `insert_overwrite`, so nothing is being swapped wholesale.
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


_COLUMNS = (
    "user_id, dataset, hand_uid, played_at_utc, seat, player_key, screen_name, is_hero, "
    "is_anonymized, anon_alias, position, position_index, starting_stack, starting_stack_bb, "
    "hole_cards, total_invested, net_won, net_won_bb, allin_equity, ev_won_bb, saw_flop, "
    "saw_turn, saw_river, went_to_showdown, won_hand, parsed_at, bounty_won, was_eliminated, "
    "finish_position, extra, made_hand_flop, made_hand_turn, made_hand_river"
)


def write(hands: list[Hand], day: str, dataset: str | None) -> int:
    """Rewrite whole rows for the seats whose five columns changed, with a bumped version.

    Written by comparison, not by intent: a seat is rewritten when what it holds differs from
    what it should hold. That makes the pass idempotent — a second run over the same day writes
    nothing — and, more importantly, it *clears* a value that should no longer be there. An
    earlier revision of the cash-out rule wrote equities on hands that were never dealt out,
    and a write-only-what-I-computed pass would have left every one of them in place.
    """
    wanted = {(h.uid, s.seat): s for h in hands for s in h.seats}
    if not wanted:
        return 0
    out = _changed_rows(_stored_rows(dataset, day), wanted)
    for start in range(0, len(out), BATCH_ROWS):
        clickhouse().insert(
            "core.hand_players", out[start : start + BATCH_ROWS], column_names=_COLUMNS.split(", ")
        )
    return len(out)


def _stored_rows(dataset: str | None, day: str) -> list[list[Any]]:
    """The day's seats that could possibly change.

    A seat with no cards, no stored equity and no stored class has nothing to write and nothing
    to clear, so it is not fetched: on a dense day that is ~150k rows instead of ~600k.
    """
    where = _scope(dataset, day=day) + (
        " and (hole_cards != '' or allin_equity is not null or made_hand_flop != ''"
        " or made_hand_turn != '' or made_hand_river != '')"
    )
    rows = clickhouse().query(f"select {_COLUMNS} from core.hand_players final where {where}")
    return [list(r) for r in rows.result_rows]


def _changed_rows(rows: list[list[Any]], wanted: dict[tuple[str, int], Seat]) -> list[list[Any]]:
    """The stored rows whose five enriched columns differ from what they should be."""
    stamp = datetime.now(UTC)
    out = []
    for row in rows:
        seat = wanted.get((row[2], row[4]))
        if seat is None:
            continue
        current = (row[18], row[19], row[30], row[31], row[32])
        target = (seat.equity, seat.ev_won_bb, *seat.made)
        if current == target:
            continue
        updated = list(row)
        updated[18], updated[19] = seat.equity, seat.ev_won_bb
        updated[25] = stamp
        updated[30], updated[31], updated[32] = seat.made
        out.append(updated)
    return out
