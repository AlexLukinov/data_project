"""The analyzer's store, without a database: what a save is allowed to do to what came before.

The autosave sends one step at a time, so the merge is the part that can lose work. These tests
are written from that angle -- what must survive a partial save -- rather than from the model's.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest
from pydantic import ValidationError

from api.analysis_store import apply_update, completed, merge_steps, steps_of
from api.models_analyses import Analysis
from api.schemas_analyses import AnalysisIn, AnalysisStep, AnalysisUpdate, Prediction, StepWork

HAND_UID = "38dcad35" + "0" * 24


def _row(**fields: Any) -> Analysis:
    return Analysis(title="t", source="manual", hand_uid="", hand_text="", steps=[], **fields)


def _prediction(answer: str) -> Prediction:
    return Prediction(
        question="how often does the pool fold here?",
        answer_type="percent",
        answer=answer,
        committed_at=datetime.now(UTC),
    )


def _step(number: int, *, answer: str = "60", takeaway: str = "") -> AnalysisStep:
    return AnalysisStep(step=number, prediction=_prediction(answer), takeaway=takeaway)


def test_saving_one_step_leaves_the_others_alone() -> None:
    row = _row()
    merge_steps(row, [_step(1), _step(2)])
    merge_steps(row, [_step(5, answer="35")])

    assert [s.step for s in steps_of(row)] == [1, 2, 5]
    assert steps_of(row)[2].prediction is not None
    assert steps_of(row)[2].prediction.answer == "35"


def test_saving_a_step_again_replaces_that_step() -> None:
    """Re-committing is how a reveal is recorded, so the second write must win."""
    row = _row()
    merge_steps(row, [_step(3, answer="20")])
    revealed = _step(3, answer="20", takeaway="my pool folds far more than theory says")
    merge_steps(row, [revealed])

    steps = steps_of(row)
    assert len(steps) == 1
    assert steps[0].takeaway == "my pool folds far more than theory says"


def test_a_step_is_done_when_its_prediction_was_committed() -> None:
    row = _row()
    merge_steps(row, [_step(1), AnalysisStep(step=2, work=StepWork(board="Ah7d2c"))])
    assert completed(steps_of(row)) == [1]


def test_an_update_that_sends_no_steps_keeps_every_step() -> None:
    row = _row()
    merge_steps(row, [_step(1), _step(2)])
    apply_update(row, AnalysisUpdate(current_step=4, heuristic="bluff more on paired boards"))

    assert row.current_step == 4 and row.heuristic == "bluff more on paired boards"
    assert [s.step for s in steps_of(row)] == [1, 2]


def test_the_same_step_twice_in_one_save_is_refused() -> None:
    with pytest.raises(ValidationError, match="appears twice"):
        AnalysisUpdate(steps=[_step(1), _step(1, answer="70")])


def test_a_stored_analysis_must_name_a_real_hand() -> None:
    with pytest.raises(ValidationError, match="32 lowercase hex"):
        AnalysisIn(title="t", source="stored", hand_uid="38dcad35")
    assert AnalysisIn(title="t", source="stored", hand_uid=HAND_UID).hand_uid == HAND_UID


def test_a_pasted_analysis_keeps_the_text_because_nothing_else_does() -> None:
    """`POST /v1/hands/parse` stores nothing (ADR-029), so the analysis is the only copy."""
    with pytest.raises(ValidationError, match="the hand text"):
        AnalysisIn(title="t", source="pasted", hand_text="   ")
    assert AnalysisIn(title="t", source="pasted", hand_text="PokerStars Hand #1").hand_text != ""


def test_a_made_up_situation_needs_its_node() -> None:
    with pytest.raises(ValidationError, match="the situation it is about"):
        AnalysisIn(title="t", source="manual")


def test_a_step_cannot_store_a_range_the_matrix_could_not_read() -> None:
    """The library's own combo-text rule, so a saved range is always parseable (F.6)."""
    with pytest.raises(ValidationError, match="is not combo notation"):
        StepWork(ranges=[{"position": "BTN", "weights": "AKs"}])
    assert StepWork(ranges=[{"position": "BTN", "weights": "AsKh: 1"}]).ranges[0].position == "BTN"


def test_the_camel_case_spelling_of_a_step_is_refused_not_ignored() -> None:
    with pytest.raises(ValidationError):
        AnalysisStep.model_validate({"step": 1, "workDone": {}})
