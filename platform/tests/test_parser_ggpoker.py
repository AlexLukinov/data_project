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


# ---------------------------------------------------------------------------------------
# Regressions found by importing two real exports (19,813 personal + ~9.1M observed hands).
# Both were silent: the parser raised nothing and the hands validated. Only the identity
# columns were wrong, which is the kind of bug that surfaces as "my opponent stats look odd"
# six months later.
# ---------------------------------------------------------------------------------------

_ANON_TABLE = """\
Poker Hand #RC1: Hold'em No Limit ($0.02/$0.05) - 2026/08/23 10:45:45
Table 'RushAndCash1' 6-max Seat #1 is the button
Seat 1: 8e31df41 ($5 in chips)
Seat 2: 7fef795 ($5 in chips)
Seat 3: Hero ($5 in chips)
Seat 4: eeacdb ($5 in chips)
Seat 5: 2e784d2c ($5 in chips)
Seat 6: 35e1cd85 ($5 in chips)
7fef795: posts small blind $0.02
Hero: posts big blind $0.05
*** HOLE CARDS ***
Dealt to Hero [5c Ks]
eeacdb: folds
2e784d2c: folds
35e1cd85: folds
8e31df41: folds
7fef795: folds
Uncalled bet ($0.02) returned to Hero
Hero collected $0.04 from pot
*** SUMMARY ***
Total pot $0.04 | Rake $0 | Jackpot $0 | Bingo $0 | Fortune $0 | Tax $0
Seat 3: Hero (big blind) collected ($0.04)
"""

_REAL_NAME_TABLE = """\
Poker Hand #RC2: Hold'em No Limit ($0.05/$0.10) - 2025/01/06 00:00:01
Table 'RushAndCash2' 6-max Seat #1 is the button
Seat 1: TableRegular ($20 in chips)
Seat 2: Nitty1987 ($4.79 in chips)
Seat 3: dead ($29.14 in chips)
Seat 4: CallStation ($15.08 in chips)
Seat 5: Donkamatic ($12.17 in chips)
Seat 6: T E S T ($45.59 in chips)
Nitty1987: posts small blind $0.05
dead: posts big blind $0.10
*** HOLE CARDS ***
CallStation: folds
Donkamatic: folds
T E S T: folds
TableRegular: folds
Nitty1987: folds
Uncalled bet ($0.05) returned to dead
dead collected $0.10 from pot
*** SUMMARY ***
Total pot $0.10 | Rake $0 | Jackpot $0 | Bingo $0 | Fortune $0 | Tax $0
Seat 3: dead (big blind) collected ($0.10)
"""


def test_short_hex_aliases_are_anonymized() -> None:
    """GG renders its alias as `%x` of a uint32 — leading zeros stripped, not padded.

    A regex anchored at exactly 8 hex characters leaked the ~6.2% of aliases that come out
    shorter, handing them downstream as if they were durable screen names.
    """
    hand = _hands(_ANON_TABLE)[0]
    by_name = {p.screen_name: p for p in hand.players}

    for short_alias in ("7fef795", "eeacdb"):
        player = by_name[short_alias]
        assert player.is_anonymized, f"{short_alias!r} (len {len(short_alias)}) not detected"
        assert player.player_key is None
        assert player.anon_alias == short_alias


def test_real_screen_names_survive_at_a_non_anonymous_table() -> None:
    """The alias shape alone must not be enough to discard a name.

    `dead` is a legal screen name AND a legal hex string. At a table where every other seat
    carries an obviously human handle, the table is not anonymized and the name is real.
    """
    hand = _hands(_REAL_NAME_TABLE)[0]
    by_name = {p.screen_name: p for p in hand.players}

    assert not by_name["dead"].is_anonymized
    assert by_name["dead"].player_key is not None
    assert all(not p.is_anonymized for p in hand.players)


_CASH_DROP = """\
Poker Hand #RC3: Hold'em No Limit ($0.10/$0.25) - 2025/05/13 11:54:15
Table 'RushAndCash3' 6-max Seat #1 is the button
Seat 1: Sample Player ($25.80 in chips)
Seat 2: 3BAD ($25.00 in chips)
Seat 3: Bluff2024 ($25.00 in chips)
Seat 4: limpfolder ($25.80 in chips)
Cash Drop to Pot : total $2.50
3BAD: posts small blind $0.10
Bluff2024: posts big blind $0.25
*** HOLE CARDS ***
limpfolder: raises $0.38 to $0.63
Sample Player: calls $0.63
3BAD: calls $0.53
Bluff2024: raises $24.37 to $25.00 and is all-in
limpfolder: folds
Sample Player: folds
3BAD: folds
Uncalled bet ($24.37) returned to Bluff2024
*** SHOWDOWN ***
Bluff2024 collected $4.77 from pot
*** SUMMARY ***
Total pot $2.52 | Rake $0.25 | Jackpot $0.00 | Bingo $0 | Fortune $0 | Tax $0
Seat 3: Bluff2024 (big blind) collected ($4.77)
"""


def test_cash_drop_is_parsed_and_balances_the_pot() -> None:
    """GG's Cash Drop adds house money to the pot — the one amount that isn't from a player.

    Players contribute $2.52 here but the winner collects $4.77, because the house dropped
    $2.50 in. Before this was parsed the reconciliation was simply false and the validator
    discarded the hand, which cost 0.6% of a real 9M-hand corpus.
    """
    hand = _hands(_CASH_DROP)[0]
    assert hand.cash_drop == Decimal("2.50")
    assert not hand.unparsed_lines, f"unparsed: {list(hand.unparsed_lines)}"

    result = validate(hand)
    assert result.ok, result.summary()


def test_cash_drop_is_not_confused_with_rake_side_drops() -> None:
    """Cash Drop moves money INTO the pot; Jackpot/Bingo/Fortune/Tax take it OUT.

    Sharing one column would make `rake + jackpot_drop` stop meaning "what the house took",
    which is the expression every rake-adjusted stat is built on.
    """
    hand = _hands(_CASH_DROP)[0]
    assert hand.cash_drop == Decimal("2.50")
    assert hand.jackpot_drop == Decimal("0")
    assert hand.rake == Decimal("0.25")


def test_observed_table_cards_come_from_the_summary(gg_observed_text: str) -> None:
    """On an observed table the SUMMARY is the only place a player's cards are printed.

    Skipping the summary block cost the pool 1.84M of 2.23M showdown seats their hole cards
    (docs/POKER_PLAN.md §6, F.8) — 100% of the cardless showdown seats in a 371-hand sample had
    their cards sitting in this block.
    """
    hand = _hands(gg_observed_text)[0]
    by_seat = {p.seat: p for p in hand.players}

    assert by_seat[3].hole_cards == ("Qd", "Js")
    assert by_seat[4].hole_cards == ("Qs", "Kd")
    assert by_seat[3].went_to_showdown and by_seat[4].went_to_showdown
    # `Dealt to <name>` with no cards must not become a hand, and a folder gets nothing.
    assert all(by_seat[s].hole_cards == () for s in (1, 2, 5, 6))
    assert not any(by_seat[s].went_to_showdown for s in (1, 2, 5, 6))
    assert hand.unparsed_lines == ()
    assert validate(hand).ok


def test_summary_cards_never_override_what_the_hand_already_showed(gg_text: str) -> None:
    """A self-export already has hero's cards from `Dealt to`; the summary must not touch them."""
    hand = _hands(gg_text)[0]
    hero = hand.hero
    assert hero is not None and hero.hole_cards == ("Qh", "Qs")
    # Nobody else showed in that hand, so nobody else gains cards from the summary.
    assert all(p.hole_cards == () for p in hand.players if not p.is_hero)
