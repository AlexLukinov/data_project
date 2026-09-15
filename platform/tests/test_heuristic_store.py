"""The heuristic log's store, without a database: the fourteen-day rule and what a PUT touches.

The rule these tests exist for is the one that is easy to get wrong twice: answering "still
true?" has to reset the clock, and *only* answering it. Rewording a lesson, retagging it or
moving it to another street must leave the review date exactly where it was, or the prompt
quietly stops coming round.

Dates are hand-worked from one fixed moment rather than `now()`, so a test can never pass by
being run at a convenient second.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from pydantic import ValidationError
from sqlalchemy.sql import functions

from api.heuristic_store import apply_update, due_cutoff, out
from api.models_heuristics import Heuristic
from api.schemas_heuristics import REVIEW_DAYS, HeuristicIn, HeuristicUpdate, review_due_at

WRITTEN = datetime(2026, 9, 1, 12, 0, tzinfo=UTC)
LESSON = "the pool folds turn far more than MDF on paired boards -- barrel more"


def _row(**fields: Any) -> Heuristic:
    """A heuristic as it would come back from the database, with the columns the store reads."""
    defaults: dict[str, Any] = {
        "id": uuid.uuid4(),
        "user_id": uuid.uuid4(),
        "analysis_id": None,
        "text": LESSON,
        "street": "turn",
        "position": "BB",
        "texture": "paired",
        "tags": [],
        "status": "open",
        "confirmed_at": None,
        "created_at": WRITTEN,
        "updated_at": WRITTEN,
    }
    return Heuristic(**{**defaults, **fields})


def test_a_fresh_heuristic_comes_up_for_review_fourteen_days_later() -> None:
    assert review_due_at(None, WRITTEN) == datetime(2026, 9, 15, 12, 0, tzinfo=UTC)


def test_an_answered_heuristic_counts_from_the_answer_not_from_the_writing() -> None:
    answered = datetime(2026, 9, 10, 12, 0, tzinfo=UTC)
    assert review_due_at(answered, WRITTEN) == datetime(2026, 9, 24, 12, 0, tzinfo=UTC)


def test_a_heuristic_is_not_due_the_day_before_and_is_due_on_the_day() -> None:
    row = _row()
    assert out(row, datetime(2026, 9, 14, 12, 0, tzinfo=UTC)).is_due is False
    assert out(row, datetime(2026, 9, 15, 12, 0, tzinfo=UTC)).is_due is True
    assert out(row, WRITTEN).review_due_at == datetime(2026, 9, 15, 12, 0, tzinfo=UTC)


def test_the_sql_cutoff_says_the_same_thing_as_the_derived_date() -> None:
    """`due_only` filters on the anchor column; it must agree with `review_due_at` exactly."""
    now = datetime(2026, 9, 15, 12, 0, tzinfo=UTC)
    assert due_cutoff(now) == now - timedelta(days=REVIEW_DAYS)
    assert (review_due_at(None, WRITTEN) <= now) is (due_cutoff(now) >= WRITTEN)


def test_answering_still_true_stamps_the_review_with_the_database_clock() -> None:
    """The stamp is the database's `now()` -- the clock `created_at` comes from.

    Stamped from this process, a review could land *earlier* than the one just answered, by
    however far the two clocks disagreed (0.22 s, found at the round-5 merge). That the answer
    pushes the next review out is the rule in
    `test_an_answered_heuristic_counts_from_the_answer_not_from_the_writing`, and the round trip
    through a real database is `tests/integration/test_heuristics.py`.
    """
    row = _row()
    apply_update(row, HeuristicUpdate(status="confirmed"))

    assert row.status == "confirmed"
    assert isinstance(row.confirmed_at, functions.now)


def test_retiring_a_heuristic_is_also_an_answer_and_also_resets_the_clock() -> None:
    """Deciding a lesson is wrong is a review like any other -- it is not a silent edit."""
    row = _row()
    apply_update(row, HeuristicUpdate(status="retired"))
    assert row.status == "retired" and row.confirmed_at is not None


def test_rewording_a_lesson_does_not_count_as_having_reviewed_it() -> None:
    row = _row()
    apply_update(row, HeuristicUpdate(text="barrel the turn on paired boards"))

    assert row.text == "barrel the turn on paired boards"
    assert row.confirmed_at is None
    assert out(row).review_due_at == review_due_at(None, WRITTEN)


def test_an_omitted_field_is_left_exactly_as_it_was() -> None:
    row = _row(tags=["turn", "paired"])
    apply_update(row, HeuristicUpdate(street="river"))

    assert row.street == "river"
    assert row.text == LESSON
    assert row.position == "BB" and row.texture == "paired"
    assert row.tags == ["turn", "paired"]


def test_a_rewrite_strips_the_whitespace_around_the_lesson() -> None:
    row = _row()
    apply_update(row, HeuristicUpdate(text="  check back more in position  "))
    assert row.text == "check back more in position"


def test_a_blank_heuristic_is_refused_in_words() -> None:
    with pytest.raises(ValidationError, match="cannot be blank"):
        HeuristicIn(text="   ")
    with pytest.raises(ValidationError, match="cannot be blank"):
        HeuristicUpdate(text="\t\n")
    assert HeuristicIn(text=LESSON).text == LESSON


def test_a_street_the_registry_does_not_know_is_refused() -> None:
    with pytest.raises(ValidationError):
        HeuristicIn(text=LESSON, street="fourth")
    assert HeuristicIn(text=LESSON).street == ""


def test_the_camel_case_spelling_of_a_field_is_refused_not_ignored() -> None:
    with pytest.raises(ValidationError):
        HeuristicIn.model_validate({"text": LESSON, "analysisId": str(uuid.uuid4())})
