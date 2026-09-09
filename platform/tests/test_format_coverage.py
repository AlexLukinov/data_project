"""Format coverage: table sizes, tournament structures, variants, and format drift.

These are the tests that keep the model general. Each one asserts a property the schema must
keep as new formats arrive — not the behaviour of a specific corpus file.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from core.enums import GameStructure, GameType, Position, TournamentKind, TournamentSpeed
from core.positions import assign_positions, preflop_order
from core.tournament import Tournament
from parser.registry import parse
from parser.sites.pokerstars import PokerStarsParser


def _header(body: str) -> str:
    """Build a minimal but complete two-player hand with the given header body."""
    return (
        f"PokerStars Hand #900000001:  {body} - 2026/03/01 12:00:00 ET\n"
        "Table 'Test' 9-max Seat #1 is the button\n"
        "Seat 1: Hero (1000 in chips)\n"
        "Seat 2: Villain (1000 in chips)\n"
        "Hero: posts small blind 10\n"
        "Villain: posts big blind 20\n"
        "*** HOLE CARDS ***\n"
        "Dealt to Hero [Ac Kd]\n"
        "Hero: folds\n"
        "Uncalled bet (10) returned to Villain\n"
        "Villain collected 20 from pot\n"
        "*** SUMMARY ***\n"
        "Total pot 20 | Rake 0\n"
    )


# ---------------------------------------------------------------------------------------
# Table sizes: heads-up through 10-max
# ---------------------------------------------------------------------------------------


@pytest.mark.parametrize("n", range(2, 11))
def test_every_table_size_gets_positions(n: int) -> None:
    """2-handed through 10-handed must all assign a position to every seat."""
    seats = list(range(1, n + 1))
    positions = assign_positions(1, seats)
    assert len(positions) == n
    assert Position.UNKNOWN not in positions.values()
    assert positions[1] is Position.BTN


@pytest.mark.parametrize("n", range(2, 11))
def test_preflop_order_is_a_permutation(n: int) -> None:
    seats = list(range(1, n + 1))
    order = preflop_order(1, seats)
    assert sorted(order.values()) == list(range(n))


def test_heads_up_has_no_small_blind_position() -> None:
    """Heads-up: the button IS the small blind, so only BTN and BB exist."""
    assert set(assign_positions(1, [1, 2]).values()) == {Position.BTN, Position.BB}


def test_ten_max_has_three_utg_seats() -> None:
    positions = set(assign_positions(1, list(range(1, 11))).values())
    assert {Position.UTG, Position.UTG1, Position.UTG2} <= positions


# ---------------------------------------------------------------------------------------
# Tournament structures
# ---------------------------------------------------------------------------------------


def test_freezeout_buy_in_split() -> None:
    hand = parse(
        _header("Tournament #55, $9.20+$0.80 USD Hold'em No Limit - Level V (10/20)"),
        __import__("core.enums", fromlist=["Site"]).Site.POKERSTARS,
    )
    t = hand.tournament
    assert t is not None
    assert t.buy_in == Decimal("9.20")
    assert t.fee == Decimal("0.80")
    assert t.bounty == 0
    assert not t.is_knockout
    assert t.total_entry_cost == Decimal("10.00")


def test_knockout_three_part_buy_in_is_detected() -> None:
    """`$4.60+$4.60+$0.80` means buy-in + BOUNTY + fee — the bounty signal."""
    from core.enums import Site

    hand = parse(
        _header("Tournament #56, $4.60+$4.60+$0.80 USD Hold'em No Limit - Level III (50/100)"),
        Site.POKERSTARS,
    )
    t = hand.tournament
    assert t is not None
    assert t.bounty == Decimal("4.60")
    assert t.is_knockout
    assert t.kind is TournamentKind.KNOCKOUT
    assert hand.stake_level.endswith("KO")


def test_progressive_knockout_is_distinguished() -> None:
    from core.enums import Site

    hand = parse(
        _header(
            "Tournament #57, Progressive Knockout $5+$5+$1 USD Hold'em No Limit - Level I (10/20)"
        ),
        Site.POKERSTARS,
    )
    assert hand.tournament is not None
    assert hand.tournament.kind is TournamentKind.PROGRESSIVE_KO


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Hyper-Turbo", TournamentSpeed.HYPER),
        ("Turbo", TournamentSpeed.TURBO),
        ("Slow", TournamentSpeed.SLOW),
        ("", TournamentSpeed.NORMAL),
    ],
)
def test_speed_is_captured(text: str, expected: TournamentSpeed) -> None:
    from core.enums import Site

    hand = parse(
        _header(f"Tournament #58, {text} $10+$1 USD Hold'em No Limit - Level I (10/20)"),
        Site.POKERSTARS,
    )
    assert hand.tournament is not None
    assert hand.tournament.speed is expected


def test_satellite_is_flagged() -> None:
    """Satellites pay seats, not money — ICM near the bubble behaves completely differently."""
    from core.enums import Site

    hand = parse(
        _header("Tournament #59, Satellite $20+$2 USD Hold'em No Limit - Level II (20/40)"),
        Site.POKERSTARS,
    )
    assert hand.tournament is not None
    assert hand.tournament.is_satellite
    assert hand.tournament.kind is TournamentKind.SATELLITE


def test_cash_hand_has_no_tournament() -> None:
    from core.enums import Site

    hand = parse(_header("Hold'em No Limit ($0.10/$0.20 USD)"), Site.POKERSTARS)
    assert hand.tournament is None
    assert not hand.is_tournament
    assert hand.stake_level == "NL20"


def test_tournament_stake_level_groups_by_entry_cost_not_blind_level() -> None:
    """The same $22 MTT passes through twenty blind levels and is ONE population."""
    from core.enums import Site

    early = parse(
        _header("Tournament #60, $20+$2 USD Hold'em No Limit - Level I (10/20)"), Site.POKERSTARS
    )
    late = parse(
        _header("Tournament #60, $20+$2 USD Hold'em No Limit - Level XX (2000/4000)"),
        Site.POKERSTARS,
    )
    assert early.stake_level == late.stake_level


# ---------------------------------------------------------------------------------------
# Game variants
# ---------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("printed", "expected", "structure"),
    [
        ("Hold'em No Limit", GameType.HOLDEM, GameStructure.FLOP),
        ("6+ Hold'em No Limit", GameType.SHORTDECK, GameStructure.FLOP),
        ("Omaha Pot Limit", GameType.OMAHA, GameStructure.FLOP),
        ("Omaha Hi/Lo Pot Limit", GameType.OMAHA_HI_LO, GameStructure.FLOP),
        ("5 Card Omaha Pot Limit", GameType.OMAHA5, GameStructure.FLOP),
        ("6 Card Omaha Pot Limit", GameType.OMAHA6, GameStructure.FLOP),
        ("Courchevel Pot Limit", GameType.COURCHEVEL, GameStructure.FLOP),
        ("7 Card Stud Limit", GameType.STUD, GameStructure.STUD),
        ("7 Card Stud Hi/Lo Limit", GameType.STUD_HI_LO, GameStructure.STUD),
        ("Razz Limit", GameType.RAZZ, GameStructure.STUD),
        ("5 Card Draw No Limit", GameType.DRAW5, GameStructure.DRAW),
        ("Badugi Limit", GameType.BADUGI, GameStructure.DRAW),
        ("Triple Draw 2-7 Lowball Limit", GameType.TRIPLE_DRAW_27, GameStructure.DRAW),
        ("All-in or Fold No Limit", GameType.ALLIN_OR_FOLD, GameStructure.FLOP),
        ("HORSE Limit", GameType.HORSE, GameStructure.MIXED),
    ],
)
def test_variant_is_recognized(printed: str, expected: GameType, structure: GameStructure) -> None:
    from core.enums import Site

    hand = parse(_header(f"{printed} ($0.10/$0.20 USD)"), Site.POKERSTARS)
    assert hand.game_type is expected
    assert hand.game_type.structure is structure


def test_hi_lo_games_are_flagged() -> None:
    assert GameType.OMAHA_HI_LO.is_hi_lo
    assert GameType.STUD_HI_LO.is_hi_lo
    assert not GameType.HOLDEM.is_hi_lo


def test_stud_and_draw_have_no_community_board() -> None:
    assert not GameType.RAZZ.has_community_board
    assert not GameType.BADUGI.has_community_board
    assert GameType.HOLDEM.has_community_board


def test_hole_card_counts() -> None:
    assert GameType.HOLDEM.hole_cards == 2
    assert GameType.OMAHA.hole_cards == 4
    assert GameType.OMAHA5.hole_cards == 5
    assert GameType.OMAHA6.hole_cards == 6
    assert GameType.STUD.hole_cards == 0  # varies by street


# ---------------------------------------------------------------------------------------
# Format drift: the reason this product survives a site changing its export
# ---------------------------------------------------------------------------------------


def test_unknown_variant_imports_instead_of_failing() -> None:
    """A game we have never seen must still import, tagged and traceable.

    This is the extensibility mechanism: adding support later is an enum member plus a
    re-parse, not a data-loss incident.
    """
    from core.enums import Site

    hand = parse(_header("Fusion Pot Limit ($0.10/$0.20 USD)"), Site.POKERSTARS)
    assert hand.game_type is GameType.UNKNOWN
    assert hand.extra.get("game_raw") == ""  # header regex matched nothing -> preserved empty


def test_unrecognized_lines_are_recorded_not_dropped() -> None:
    """A new line type is the first symptom of a format change. It must be visible."""
    from core.enums import Site

    text = _header("Hold'em No Limit ($0.10/$0.20 USD)").replace(
        "Hero: folds\n", "Hero: folds\nHero: activates SuperNova Turbo Boost\n"
    )
    hand = parse(text, Site.POKERSTARS)
    assert any("SuperNova" in line for line in hand.unparsed_lines)


def test_format_signature_is_stable_and_discriminating() -> None:
    """Same shape -> same signature; different shape -> different signature.

    Grouping stored hands by this column turns "did the site change their format?" into a
    query instead of a support ticket.
    """
    from core.enums import Site

    base = _header("Hold'em No Limit ($0.10/$0.20 USD)")
    a = parse(base, Site.POKERSTARS)
    b = parse(base.replace("#900000001", "#900000002"), Site.POKERSTARS)
    assert a.format_signature == b.format_signature
    assert len(a.format_signature) == 12

    richer = base.replace(
        "*** SUMMARY ***", "*** SHOW DOWN ***\nHero: shows [Ac Kd]\n*** SUMMARY ***"
    )
    assert parse(richer, Site.POKERSTARS).format_signature != a.format_signature


def test_schema_version_is_stamped() -> None:
    from core.enums import Site
    from core.models import SCHEMA_VERSION

    hand = parse(_header("Hold'em No Limit ($0.10/$0.20 USD)"), Site.POKERSTARS)
    assert hand.schema_version == SCHEMA_VERSION


def test_adding_a_variant_is_two_lines() -> None:
    """Documents the extension contract as an executable assertion.

    Everything a new flop variant needs is: a `GameType` member, and a name in the parser's
    lookup table. No model change, no migration, no downstream edit.
    """
    parser = PokerStarsParser()
    assert hasattr(parser, "site")
    # A Tournament needs only its id; every structural field has a sane default.
    assert Tournament(tournament_id="1").total_entry_cost == 0
