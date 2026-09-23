"""The registry's own words: what a reader is shown, and what is kept away from them.

`notes` is the caveat beside a definition on screen; `v1_parity` is the audit record of how a
v2 definition departs from the v1 mart, which no screen renders (ADR-062). `value_labels` is
the reader's half of an enum, complete so that no client has to invent one -- the client's own
rewrites got `5bet_plus` right and a player named `a_plus_b` wrong (ADR-057 §4).
"""

from __future__ import annotations

from stats.registry import registry


def test_every_enum_value_is_named_for_a_reader() -> None:
    """The client had to guess one, and guessed wrong twice (ADR-062)."""
    for dim in registry().dimensions.values():
        if dim.type != "enum":
            assert dim.value_labels == {}, dim.code
            continue
        assert list(dim.value_labels) == dim.values, dim.code
        assert all(label.strip() for label in dim.value_labels.values()), dim.code


def test_the_blank_value_says_what_it_means_in_each_dimension_that_has_one() -> None:
    """'' is "no flop" in one dimension and "nobody raised" in another; one word cannot do both."""
    blanks = {d.code: d.value_labels[""] for d in registry().dimensions.values() if "" in d.values}
    # Ten until phase G/H added flop_high_card_class, flop_connectivity, turn_change and
    # river_change (ADR-075, ADR-082); the words stayed at seven.
    assert len(blanks) == 13, blanks
    assert len(set(blanks.values())) == 7, "the file header counts these; keep the two in step"
    assert blanks["turn_rank"] != blanks["river_rank"] != blanks["opener_position"]
    assert blanks["made_hand"] != blanks["hand_shape"], "one is preflop too, the other never is"


def test_a_reader_facing_note_never_mentions_the_mart_it_replaced() -> None:
    """`notes` is shown beside the definition; the v1 record lives in `v1_parity` (ADR-062)."""
    reg = registry()
    said = sorted(code for code, stat in reg.stats.items() if "v1" in stat.notes.lower())
    assert said == [], f"reader notes still talking about v1: {said}"
    assert sum(1 for stat in reg.stats.values() if stat.v1_parity) == 42
    for stat in reg.stats.values():
        assert not stat.notes or stat.notes[0].isupper(), stat.code


def test_ev_is_not_the_name_of_two_different_numbers() -> None:
    """The registry's is the all-in adjusted result, not a solver EV (ADR-057 §5)."""
    label = registry().stat("ev_bb_per_100").label
    assert "EV" not in label and "adjusted" in label.lower(), label


def test_the_all_in_adjusted_rate_explains_its_own_population_baseline() -> None:
    """Its field column is the field's bb/100 exactly, and the caveat says so (ADR-066).

    The all-in adjustment moves chips between the seats of one hand and both datasets hold
    every seat, so a whole-hand comparison gives the pool the same number twice. A reader who
    is not told that reads a broken screen; a client told it by special case learns the
    registry's job (ADR-057).
    """
    stat = registry().stat("ev_bb_per_100")
    assert "bb/100" in stat.notes, "name the number this one cannot differ from"
    assert "whole hands" in stat.notes, "and the condition that makes them equal"
    assert "position" in stat.notes, "and the case where they part"
