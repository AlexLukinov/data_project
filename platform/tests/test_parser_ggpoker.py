"""GGPoker parser tests — mostly about the anonymization contract.

The line grammar is inherited from PokerStars and covered there. What matters here is that
opponent identity is destroyed correctly and hero identity survives, because every downstream
gate on opponent stats depends on exactly these two fields.
"""

from __future__ import annotations

from decimal import Decimal

from core.enums import Site, TableFormat
from core.validation import validate
from parser.registry import parse_file, sniff, split_hands


def _hands(text: str) -> list:
    return list(parse_file(text, Site.GGPOKER))


def test_split_and_header(gg_text: str) -> None:
    assert len(list(split_hands(gg_text, Site.GGPOKER))) == 2
    hand = _hands(gg_text)[0]
    assert hand.site is Site.GGPOKER
    assert hand.site_hand_id == "RC1851234567"
    assert hand.big_blind == Decimal("0.50")
    # GG stamps UTC and prints no abbreviation; PokerStars would have assumed ET.
    assert hand.tz_source == "UTC"
    assert hand.played_at_utc.hour == 14


def test_rush_and_cash_is_detected(gg_text: str) -> None:
    """Fast-fold: the table dissolves each hand, so nothing may assume table persistence."""
    hand = _hands(gg_text)[0]
    assert hand.table_format is TableFormat.RUSH


def test_hero_keeps_identity(gg_text: str) -> None:
    hand = _hands(gg_text)[0]
    hero = hand.hero
    assert hero is not None
    assert hero.screen_name == "Hero"
    assert hero.player_key == "ggpoker:hero"
    assert not hero.is_anonymized
    assert hero.hole_cards == ("Qh", "Qs")


def test_opponents_have_no_cross_hand_identity(gg_text: str) -> None:
    """The whole GG constraint, asserted.

    `player_key is None` is the single field every opponent-stat gate keys off. If this
    regresses, the platform starts inventing opponents that don't exist.
    """
    hand = _hands(gg_text)[0]
    villains = [p for p in hand.players if not p.is_hero]
    assert len(villains) == 5
    assert all(p.player_key is None for p in villains)
    assert all(p.is_anonymized for p in villains)
    assert all(p.anon_alias == p.screen_name for p in villains)


def test_aliases_do_not_persist_across_hands(gg_text: str) -> None:
    """Two hands from the same session share no opponent alias — by design, not by accident."""
    first, second = _hands(gg_text)
    aliases_1 = {p.anon_alias for p in first.players if p.is_anonymized}
    aliases_2 = {p.anon_alias for p in second.players if p.is_anonymized}
    assert aliases_1 and aliases_2
    assert not (aliases_1 & aliases_2)


def test_gg_hands_balance(gg_text: str) -> None:
    for hand in _hands(gg_text):
        result = validate(hand)
        assert result.ok, result.summary()


def test_hero_raise_over_own_small_blind(gg_text: str) -> None:
    """Hero posts SB 0.25 then 3-bets to 6.00, so the raise adds 5.75, not 6.00."""
    hand = _hands(gg_text)[0]
    hero = hand.hero
    assert hero is not None
    assert hero.total_invested == Decimal("6.00")
    assert hero.net_won == Decimal("5.94")  # collected 11.94 - 6.00


def test_sniff_distinguishes_the_two_formats(gg_text: str, stars_cash_text: str) -> None:
    """Users mislabel uploads; a wrong `site` yields zero hands rather than an error."""
    assert sniff(gg_text) is Site.GGPOKER
    assert sniff(stars_cash_text) is Site.POKERSTARS
