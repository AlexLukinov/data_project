"""Pasting a hand: what must be refused, and what the replayer gets when it is not.

Unhappy paths first — a paste is untrusted text, and every one of these failures is something
the user has to be told about in words, not a 500.
"""

from __future__ import annotations

import pytest

from api.hand_parse import PasteError, detail_from_hand, detect_site, one_hand
from core.enums import Site
from parser.registry import split_hands

NO_NAMES: frozenset[str] = frozenset()


def _first(gg_text: str) -> str:
    return next(iter(split_hands(gg_text, Site.GGPOKER)))


def test_unknown_format_is_named(gg_text: str) -> None:
    with pytest.raises(PasteError, match="matches no registered hand-history format"):
        detect_site("this is not a hand history")
    assert detect_site(_first(gg_text)) is Site.GGPOKER


def test_several_hands_are_refused_rather_than_truncated(gg_text: str) -> None:
    """Silently replaying the first of five would be found out by the numbers, not by anyone."""
    with pytest.raises(PasteError, match="holds 2 hands"):
        one_hand(gg_text, Site.GGPOKER, NO_NAMES)


def test_empty_text_is_refused() -> None:
    with pytest.raises(PasteError, match="no hand found"):
        one_hand("   \n\n  ", Site.GGPOKER, NO_NAMES)


def test_a_hand_that_does_not_reconcile_is_refused(gg_text: str) -> None:
    """The ingest loop refuses to store one; the replayer refuses to draw one."""
    broken = _first(gg_text).replace("Rake $0.56", "Rake $5.56")
    with pytest.raises(PasteError, match="does not reconcile"):
        one_hand(broken, Site.GGPOKER, NO_NAMES)


def test_unparseable_hand_reports_the_parser_message(gg_text: str) -> None:
    mangled = _first(gg_text).replace("Seat 2: Hero ($50.00 in chips)", "Seat 2: Hero (broken)")
    with pytest.raises(PasteError):
        one_hand(mangled, Site.GGPOKER, NO_NAMES)


def test_parsed_hand_becomes_the_replayer_payload(gg_text: str) -> None:
    detail = detail_from_hand(one_hand(_first(gg_text), Site.GGPOKER, frozenset({"hero"})))

    assert detail.site == "ggpoker" and detail.site_hand_id == "RC1851234567"
    assert detail.stake_level == "NL50" and detail.big_blind == 0.5
    assert detail.board == ["8h", "5d", "2s"]
    assert detail.total_pot == 12.5 and detail.rake == 0.56

    hero = next(p for p in detail.players if p.is_hero)
    assert hero.seat == 2 and hero.screen_name == "Hero"
    assert hero.position == "SB" and hero.hole_cards == "Qh Qs"
    assert hero.net_won_bb == pytest.approx(11.88, abs=0.01)
    assert [p.is_anonymized for p in detail.players].count(True) == 5

    # Posts are actions too: the replayer draws the blinds going in.
    assert detail.actions[0].action_type == "post_sb" and detail.actions[0].seat == 2
    raise_to = next(a for a in detail.actions if a.action_type == "raise" and a.seat == 2)
    assert raise_to.amount == 5.75 and raise_to.amount_to == 6.0
    indexes = [a.action_index for a in detail.actions]
    assert indexes == sorted(indexes)


def test_hero_is_unresolved_without_registered_names(gg_text: str) -> None:
    """GG prints `Dealt to`, so hero still resolves; the names only make it independent of it."""
    detail = detail_from_hand(one_hand(_first(gg_text), Site.GGPOKER, NO_NAMES))
    assert sum(p.is_hero for p in detail.players) == 1
