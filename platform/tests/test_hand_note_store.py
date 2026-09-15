"""Hand notes and tags without a database (plan D.7b): the one spelling of a tag, the cap, and
how a list row picks up its tags.

The rule worth pinning is that a tag has exactly one canonical form and every road in shares
it -- otherwise `?tag=Bluff` finds nothing while the chip on the hand says `bluff`.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from api.hand_note_store import note_out, vocabulary_has_room, with_tags
from api.models_hand_notes import MAX_TAG_CHARS, HandNote
from api.schemas import HandSummary
from api.schemas_hand_notes import MAX_DISTINCT_TAGS, HandNoteIn, TagIn, normalize_tag

WRITTEN = datetime(2026, 9, 14, 12, 0, tzinfo=UTC)


def _row(uid: str) -> HandSummary:
    return HandSummary(
        hand_uid=uid,
        site="ggpoker",
        played_at_utc=WRITTEN,
        stake_level="NL50",
        seat=3,
        position="BTN",
        hole_cards="As Kd",
        board="",
        net_won_bb=1.5,
        went_to_showdown=False,
    )


def test_a_tag_has_one_spelling_whatever_was_typed() -> None:
    assert normalize_tag("Bluff") == "bluff"
    assert normalize_tag("  3-bet   pot ") == "3-bet pot"
    assert normalize_tag("River\tCall") == "river call"
    assert TagIn(tag="  Bluff ").tag == "bluff"


def test_a_tag_made_of_whitespace_is_refused_in_words() -> None:
    with pytest.raises(ValueError, match="needs some text"):
        normalize_tag("   ")
    with pytest.raises(ValidationError, match="needs some text"):
        TagIn(tag="\t\n")


def test_a_tag_is_measured_after_normalizing_not_before() -> None:
    """Forty characters of text with padding around it is still forty characters."""
    padded = "  " + "x" * MAX_TAG_CHARS + "  "
    assert len(normalize_tag(padded)) == MAX_TAG_CHARS
    with pytest.raises(ValueError, match=f"at most {MAX_TAG_CHARS}"):
        normalize_tag("x" * (MAX_TAG_CHARS + 1))


def test_an_unknown_field_is_refused_not_ignored() -> None:
    """With the required field present, so the refusal can only come from `extra="forbid"`."""
    with pytest.raises(ValidationError, match="Extra inputs"):
        HandNoteIn.model_validate({"body": "x", "Body": "y"})
    with pytest.raises(ValidationError, match="Extra inputs"):
        TagIn.model_validate({"tag": "x", "colour": "red"})
    assert HandNoteIn.model_validate({"body": "x"}).body == "x"


def test_a_nul_character_is_refused_at_the_edge_not_by_postgres() -> None:
    """Postgres `text` rejects NUL with an error the API would turn into a 500."""
    with pytest.raises(ValidationError, match="NUL"):
        HandNoteIn(body="fold\x00pre")
    with pytest.raises(ValueError, match="NUL"):
        normalize_tag("blu\x00ff")


def test_a_tag_may_contain_a_slash_or_a_percent_sign() -> None:
    """Those travel in the DELETE path as `%2F`/`%25`, which is why that route is `{tag:path}`."""
    assert normalize_tag("3-bet/4-bet") == "3-bet/4-bet"
    assert normalize_tag("50% pot") == "50% pot"


def test_a_known_tag_always_fits_and_a_new_one_only_under_the_cap() -> None:
    """The 501st *distinct* tag is the one refused; reusing a tag never is."""
    assert vocabulary_has_room(MAX_DISTINCT_TAGS - 1, is_known=False) is True
    assert vocabulary_has_room(MAX_DISTINCT_TAGS, is_known=False) is False
    assert vocabulary_has_room(MAX_DISTINCT_TAGS, is_known=True) is True
    assert vocabulary_has_room(MAX_DISTINCT_TAGS + 7, is_known=True) is True


def test_a_missing_note_reads_as_empty_rather_than_absent() -> None:
    out = note_out("abc", None)
    assert out.hand_uid == "abc" and out.body == "" and out.updated_at is None

    row = HandNote(id=uuid.uuid4(), user_id=uuid.uuid4(), hand_uid="abc", body="fold pre")
    row.updated_at = WRITTEN
    assert note_out("abc", row).body == "fold pre"
    assert note_out("abc", row).updated_at == WRITTEN


def test_a_list_row_picks_up_its_own_tags_and_no_others() -> None:
    rows = [_row("a"), _row("b"), _row("c")]
    decorated = with_tags(rows, {"a": ["bluff", "river"], "c": ["study"]})

    assert [r.tags for r in decorated] == [["bluff", "river"], [], ["study"]]
    assert [r.hand_uid for r in decorated] == ["a", "b", "c"]
    # The rows given are left as they were: a copy carries the tags, not a mutation.
    assert rows[0].tags == []


def test_a_row_read_off_clickhouse_carries_no_tags() -> None:
    """`summary_from_row` never sees Postgres, so the default must be an empty list."""
    assert _row("a").tags == []
