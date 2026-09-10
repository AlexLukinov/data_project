"""Pasted hand-history text -> the replayer payload, storing nothing (ADR-029).

One parser, three sources. `GET /v1/hands/{uid}` reads a stored hand out of ClickHouse and
this module reads one out of raw text; both produce the same `HandDetail`, so the replayer
never learns where a hand came from.

Nothing here writes: no upload row, no ClickHouse insert, no dead letter. A hand that does not
reconcile is refused rather than shown, for the same reason the ingest loop refuses to store
it -- every number the replayer draws from a mis-parsed hand would be quietly wrong.
"""

from __future__ import annotations

from decimal import Decimal

from api.schemas import ActionOut, HandDetail, HandPlayerOut
from core.enums import Site
from core.models import Action, CanonicalHand, HandPlayer
from core.validation import validate
from parser.errors import FormatDetectionError, HandParseError, ParserError
from parser.registry import parse, sniff, split_hands

MAX_TEXT_CHARS = 200_000
"""A single hand is a few kilobytes. The cap is what keeps a whole day-file out of this path
(that is what an upload is for), not a guess at the longest hand."""


class PasteError(ValueError):
    """The text could not become one replayable hand. The message is shown to the user."""


def detect_site(text: str) -> Site:
    """The format the text is in, or `PasteError` naming what went wrong."""
    try:
        return sniff(text)
    except FormatDetectionError as exc:
        raise PasteError(str(exc)) from exc


def one_hand(text: str, site: Site, hero_names: frozenset[str]) -> CanonicalHand:
    """Parse exactly one hand out of `text`.

    More than one hand is refused rather than silently truncated to the first: a paste that
    quietly loses four of five hands is the kind of thing nobody notices until the numbers
    disagree with the site.
    """
    chunks = [chunk for chunk in split_hands(text, site) if chunk.strip()]
    if not chunks:
        raise PasteError("no hand found in the text")
    if len(chunks) > 1:
        raise PasteError(f"the text holds {len(chunks)} hands; paste one at a time")
    try:
        hand = parse(chunks[0], site, hero_names)
    except HandParseError as exc:
        raise PasteError(_with_line(exc)) from exc
    except ParserError as exc:
        raise PasteError(str(exc)) from exc
    check = validate(hand)
    if not check.ok:
        raise PasteError(f"the hand does not reconcile: {check.summary()}")
    return hand


def _with_line(exc: HandParseError) -> str:
    """The parser's message, with the offending line when it recorded one (spec §13)."""
    return f"line {exc.line_no}: {exc}" if exc.line_no is not None else str(exc)


def _per_bb(amount: Decimal, big_blind: Decimal) -> float:
    """`amount` in big blinds; 0 when the hand has no blind to divide by."""
    return float(amount / big_blind) if big_blind else 0.0


def _player_out(player: HandPlayer, big_blind: Decimal) -> HandPlayerOut:
    """One seat, in the same shape the stored path builds from `core.hand_players`."""
    return HandPlayerOut(
        seat=player.seat,
        screen_name=player.screen_name,
        position=player.position.value,
        is_hero=player.is_hero,
        is_anonymized=player.is_anonymized,
        starting_stack=float(player.starting_stack),
        hole_cards=" ".join(player.hole_cards),
        net_won=float(player.net_won),
        net_won_bb=_per_bb(player.net_won, big_blind),
        went_to_showdown=player.went_to_showdown,
        won_hand=player.won_hand,
    )


def _action_out(action: Action) -> ActionOut:
    """One action, in the same shape the stored path builds from `core.actions`."""
    return ActionOut(
        action_index=action.action_index,
        street=action.street.value,
        seat=action.seat,
        action_type=action.action_type.value,
        amount=float(action.amount),
        amount_to=float(action.amount_to),
        pot_before=float(action.pot_before),
        to_call=float(action.to_call),
        is_allin=action.is_allin,
    )


def detail_from_hand(hand: CanonicalHand) -> HandDetail:
    """The replayer payload for a parsed hand -- field for field what the stored path returns."""
    return HandDetail(
        hand_uid=hand.hand_uid,
        site=hand.site.value,
        site_hand_id=hand.site_hand_id,
        played_at_utc=hand.played_at_utc,
        game_type=hand.game_type.value,
        stake_level=hand.stake_level,
        big_blind=float(hand.big_blind),
        board=list(hand.board),
        total_pot=float(hand.total_pot),
        rake=float(hand.rake),
        players=[_player_out(p, hand.big_blind) for p in hand.players],
        actions=[_action_out(a) for a in hand.actions],
    )
