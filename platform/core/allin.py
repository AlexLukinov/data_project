"""Parse-time enrichment: the made-hand class per street, and the all-in-adjusted result.

Both are derived facts that need a hand evaluator, which is why they are computed here and
stored rather than derived in dbt — SQL cannot rank a poker hand, and re-deriving them per
query is the thing ADR-018 exists to refuse. `ingestion.pipeline` calls `enrich()` on every
hand that validates, so the Kafka worker and the bulk importer get identical values by
construction; `scripts.backfill_equity` calls the same functions over the stored corpus.

**What `ev_won` means here.** It is the result the seat would have had *on average* from the
moment the last chip went in, with the cards still to come unknown. The money is not invented:
the pot that was actually awarded is redistributed by each contender's expected share of each
side-pot layer, so `sum(ev_won) == sum(net_won)` for the hand, exactly. That invariant is what
`assert_ev_won_bb_redistributes_the_pot` checks on the real data, and it is why rake, jackpot
drops and cash drops need no special handling: they are already inside the awarded total.

`ev_won` stays `None` — and `marts` then falls back to the actual result — when there was
nothing to adjust: no all-in, no runout still to come, fewer than two players contesting, or a
contender whose cards the file never showed. A pool hand that folded round to a blind has no EV
question to answer, and inventing one would be worse than leaving it alone.
"""

from __future__ import annotations

from collections.abc import Sequence
from decimal import Decimal

from core.cards import card_id, split_cards
from core.classify import UNKNOWN, MadeHand, made_hand_of
from core.enums import ActionType, Street
from core.equity import Hole, equity, pot_layers, pot_shares
from core.models import CanonicalHand, HandPlayer
from core.validation import contributed_by_seat

BOARD_CARDS = 5
HOLDEM_HOLE_CARDS = 2

BOARD_AT_STREET: dict[Street, int] = {
    Street.PREFLOP: 0,
    Street.FLOP: 3,
    Street.TURN: 4,
    Street.RIVER: 5,
    Street.SHOWDOWN: 5,
}
"""Board cards visible when a street's betting happens."""

_DECIDING = frozenset(
    {ActionType.FOLD, ActionType.CHECK, ActionType.CALL, ActionType.BET, ActionType.RAISE}
)
"""Actions a player chooses. The last one of these is where betting stopped; everything after
it — the runout, the show, the award — happens with no further decision."""

_STREET_CARDS = ((Street.FLOP, 3), (Street.TURN, 4), (Street.RIVER, 5))


def enrich(hand: CanonicalHand) -> None:
    """Fill `made_hand_*`, `allin_equity` and `ev_won` on every seat. Idempotent."""
    fill_made_hands(hand)
    fill_all_in_ev(hand)


def fill_made_hands(hand: CanonicalHand) -> None:
    """The seat's made-hand class on each street the board reached.

    Computed for every seat whose cards are known, including one that folded earlier: the
    column is read per decision, and a decision only exists where the seat acted, so an unread
    value costs one evaluation and saves a special case. Non-hold'em holdings stay `UNKNOWN`.
    """
    for player in hand.players:
        hole = split_cards(" ".join(player.hole_cards))
        classes = [UNKNOWN, UNKNOWN, UNKNOWN]
        if len(hole) == HOLDEM_HOLE_CARDS:
            for i, (_, cards) in enumerate(_STREET_CARDS):
                if len(hand.board) >= cards:
                    classes[i] = made_hand_of(hole, hand.board[:cards])
        player.made_hand_flop, player.made_hand_turn, player.made_hand_river = classes


def _last_deciding_street(hand: CanonicalHand) -> Street | None:
    """The street on which the last real decision was made."""
    streets = [a.street for a in hand.actions if a.action_type in _DECIDING]
    return max(streets, key=lambda s: s.order) if streets else None


def _contenders(hand: CanonicalHand) -> list[HandPlayer]:
    """Seats that reached showdown with both cards known."""
    return [
        p for p in hand.players if p.went_to_showdown and len(p.hole_cards) == HOLDEM_HOLE_CARDS
    ]


def runout_board(
    board: Sequence[str], last_street: Street | None, has_allin: bool
) -> tuple[str, ...] | None:
    """The board visible when the last chip went in, or None when there was no gamble.

    Shared with `scripts.backfill_equity`, which rebuilds the same judgement from stored
    columns. Three ways there is nothing to adjust, and the third was found in the data:

    * no all-in, so the result was never a coin flip;
    * betting ran to the river, so the cards were already out and EV *is* the actual result;
    * **the runout never happened.** GGPoker settles an all-in on request without dealing the
      rest of the board, and such a hand stops with exactly the cards betting stopped on — 0
      after preflop, 3 after the flop, 4 after the turn. 27,088 hands of the real corpus are
      like this, 20% of the pool's all-ins. De-lucking a hand nobody gambled on would invent a
      swing that never existed, so the actual result stands.
    """
    if not has_allin or last_street is None:
        return None
    known = BOARD_AT_STREET[last_street]
    if known >= BOARD_CARDS or len(board) != BOARD_CARDS:
        return None
    return tuple(board[:known])


def is_contested(showdown_seats: int, with_cards: int) -> bool:
    """True when at least two seats saw it through and EVERY one of them showed.

    Not "two or more showed": a third hand nobody saw is still in the pot, and sharing the
    whole pot between the two that were shown would hand that player's money to them. It does
    not happen in the current corpus, and it is cheap to make impossible rather than unlikely.
    """
    return with_cards >= 2 and with_cards == showdown_seats


def all_in_spot(hand: CanonicalHand) -> tuple[list[HandPlayer], tuple[str, ...]] | None:
    """The contenders and the board they were all-in on, or None when EV does not apply."""
    board = runout_board(
        hand.board, _last_deciding_street(hand), any(a.is_allin for a in hand.actions)
    )
    if board is None:
        return None
    contenders = _contenders(hand)
    showdown = sum(1 for p in hand.players if p.went_to_showdown)
    if not is_contested(showdown, len(contenders)):
        return None
    if len({c for p in contenders for c in p.hole_cards}) != len(contenders) * HOLDEM_HOLE_CARDS:
        return None
    return contenders, board


def all_in_result(
    holes: Sequence[tuple[str, str]],
    board: Sequence[str],
    contributions: Sequence[Decimal],
    contenders: Sequence[int],
    awarded: Decimal,
) -> list[tuple[Decimal, Decimal]]:
    """`(equity, ev_won)` per contender — the whole money model, in one place.

    Takes plain values rather than a `CanonicalHand` so that the parse-time path and
    `scripts.backfill_equity`, which rebuilds the same spot from stored columns instead of from
    raw text, cannot drift apart. `contributions` is every seat's chips in the pot, folders
    included; `contenders` indexes into it.
    """
    ids: list[Hole] = [(card_id(a), card_id(b)) for a, b in holes]
    cards = [card_id(c) for c in board]
    layers = pot_layers([float(c) for c in contributions], contenders)
    shares = pot_shares(ids, cards, layers)
    out: list[tuple[Decimal, Decimal]] = []
    for index, share, own in zip(contenders, shares, equity(ids, cards), strict=True):
        expected = awarded * Decimal(str(share))
        out.append(
            (
                Decimal(str(own)).quantize(Decimal("0.000001")),
                (expected - contributions[index]).quantize(Decimal("0.0001")),
            )
        )
    return out


def fill_all_in_ev(hand: CanonicalHand) -> None:
    """Redistribute the awarded pot by expected share, and record each contender's equity."""
    spot = all_in_spot(hand)
    if spot is None:
        return
    contenders, board = spot
    contributed = contributed_by_seat(hand)
    order = {p.seat: i for i, p in enumerate(hand.players)}
    results = all_in_result(
        [(p.hole_cards[0], p.hole_cards[1]) for p in contenders],
        board,
        [contributed[p.seat] for p in hand.players],
        [order[p.seat] for p in contenders],
        sum((p.net_won + contributed[p.seat] for p in hand.players), Decimal(0)),
    )
    for player, (own, ev) in zip(contenders, results, strict=True):
        player.allin_equity = own
        player.ev_won = ev


def made_hand_for_street(player: HandPlayer, street: Street) -> MadeHand:
    """The stored class for a street — the accessor the row builders and tests share."""
    if street is Street.FLOP:
        return player.made_hand_flop
    if street is Street.TURN:
        return player.made_hand_turn
    if street in (Street.RIVER, Street.SHOWDOWN):
        return player.made_hand_river
    return UNKNOWN
