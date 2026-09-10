"""Request/response models for a saved analysis (plan F.9, spec §15).

An analysis is nine steps over one situation. Each step holds three things: the **work** the
user did (ranges painted, a board, their hand), the **prediction** they committed before seeing
anything, and the one-line **takeaway** they wrote afterwards. The server stores all three and
judges none of them -- the maths is `poker-core`'s and the pool's answer is the report engine's;
what belongs here is that the answer was committed *before* the reveal, which is why
`Prediction` carries its own timestamp and the actual value beside it.

Range bodies inside the work reuse the library's combo-text validator, so a step cannot store a
notation that every later page would fail to parse.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from analysis.pool.nodes import NodeAction, NodeKey, Position
from api.schemas_ranges import Weights

STEP_COUNT = 9
MAX_TITLE = 200
MAX_QUESTION = 300
MAX_ANSWER = 200
MAX_TAKEAWAY = 500
MAX_HEURISTIC = 500
MAX_HAND_CHARS = 200_000
MAX_TAGS = 20
MAX_CARDS = 20
MAX_ASSIGNMENTS = 10
HAND_UID = re.compile(r"^[0-9a-f]{32}$")

Source = Literal["stored", "pasted", "manual"]
AnswerType = Literal["number", "percent", "choice", "text"]
Tag = Annotated[str, StringConstraints(min_length=1, max_length=40)]
Cards = Annotated[str, StringConstraints(max_length=MAX_CARDS)]


class Prediction(BaseModel):
    """What the user committed at a step, and what was revealed afterwards.

    `actual` is empty until the reveal. `error` is the signed miss on a numeric answer, which is
    what the training scores of F.11 will read; it is the client's arithmetic because the
    tolerance belongs to the step, not to the store.
    """

    model_config = ConfigDict(extra="forbid")

    question: str = Field(max_length=MAX_QUESTION)
    answer_type: AnswerType = "text"
    answer: str = Field(max_length=MAX_ANSWER)
    actual: str = Field(default="", max_length=MAX_ANSWER)
    error: float | None = None
    within_tolerance: bool | None = None
    committed_at: datetime


class RangeAssignment(BaseModel):
    """A range given to a seat at step 1, as combo text."""

    model_config = ConfigDict(extra="forbid")

    position: Position
    weights: Weights = ""
    label: str = Field(default="", max_length=MAX_TITLE)


class RangeSplit(BaseModel):
    """One branch of a seat's range at step 2: the part that folds, calls or raises."""

    model_config = ConfigDict(extra="forbid")

    position: Position
    action: NodeAction
    weights: Weights = ""


class StepWork(BaseModel):
    """Everything the nine steps put on the table, in one shape.

    Deliberately flat rather than nine variants: a step uses the fields it needs and leaves the
    rest at their defaults, so the analysis reopens with one model and no per-step branching.
    """

    model_config = ConfigDict(extra="forbid")

    ranges: list[RangeAssignment] = Field(default_factory=list, max_length=MAX_ASSIGNMENTS)
    """Step 1 -- a range per seat."""
    splits: list[RangeSplit] = Field(default_factory=list, max_length=MAX_ASSIGNMENTS)
    """Step 2 -- how a seat's range divides between fold, call and raise."""
    board: Cards = ""
    """Step 3 -- the board the buckets are counted on."""
    hero_cards: Cards = ""
    """Steps 5 and 7 -- the hand held, which is what removes combos."""
    choice: str = Field(default="", max_length=MAX_ANSWER)
    """Steps 6 and 7 -- bet or check; value, protection, semi-bluff or give-up."""
    frequency: float | None = Field(default=None, ge=0, le=1)
    size_pct: float | None = Field(default=None, gt=0)
    value_weights: Weights = ""
    """Step 8 -- the part of hero's own range played as value."""
    bluff_weights: Weights = ""
    """Step 8 -- and the part played as a bluff."""
    pot_bb: float | None = Field(default=None, ge=0)
    bet_bb: float | None = Field(default=None, ge=0)
    """Step 9 -- the bet the MDF baseline is taken against."""


class AnalysisStep(BaseModel):
    """One of the nine steps."""

    model_config = ConfigDict(extra="forbid")

    step: int = Field(ge=1, le=STEP_COUNT)
    prediction: Prediction | None = None
    takeaway: str = Field(default="", max_length=MAX_TAKEAWAY)
    work: StepWork = Field(default_factory=StepWork)


class AnalysisIn(BaseModel):
    """Start an analysis: a title and where the hand comes from.

    A stored hand travels as its uid, a pasted one as its own text (the parse endpoint stores
    nothing, ADR-029, so an analysis of a pasted hand must keep the text or it cannot reopen),
    and a hand-made situation as nothing but its key.
    """

    model_config = ConfigDict(extra="forbid")

    title: str = Field(max_length=MAX_TITLE)
    source: Source
    hand_uid: str = Field(default="", max_length=32)
    hand_text: str = Field(default="", max_length=MAX_HAND_CHARS)
    node_key: NodeKey | None = None
    action_index: int = Field(default=0, ge=0)
    tags: list[Tag] = Field(default_factory=list, max_length=MAX_TAGS)

    @model_validator(mode="after")
    def _has_its_hand(self) -> AnalysisIn:
        """Each source names its hand in its own way; none of them may name it in another's."""
        if self.source == "stored" and HAND_UID.match(self.hand_uid) is None:
            raise ValueError("a stored analysis needs hand_uid as 32 lowercase hex characters")
        if self.source == "pasted" and self.hand_text.strip() == "":
            raise ValueError("a pasted analysis needs the hand text it was started from")
        if self.source == "manual" and self.node_key is None:
            raise ValueError("a manual analysis needs the situation it is about")
        return self


class AnalysisUpdate(BaseModel):
    """Change an analysis. Every field is optional; the steps sent replace those step numbers."""

    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, max_length=MAX_TITLE)
    node_key: NodeKey | None = None
    current_step: int | None = Field(default=None, ge=1, le=STEP_COUNT)
    steps: list[AnalysisStep] | None = Field(default=None, max_length=STEP_COUNT)
    heuristic: str | None = Field(default=None, max_length=MAX_HEURISTIC)
    tags: list[Tag] | None = Field(default=None, max_length=MAX_TAGS)

    @model_validator(mode="after")
    def _one_step_each(self) -> AnalysisUpdate:
        sent = [s.step for s in self.steps or []]
        if len(set(sent)) != len(sent):
            raise ValueError("a step number appears twice in steps")
        return self


class AnalysisSummary(BaseModel):
    """A row of the analysis list: enough to recognise the spot and see how far it got."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    source: Source
    hand_uid: str
    node_key: NodeKey | None
    current_step: int
    completed_steps: list[int]
    heuristic: str
    tags: list[str]
    created_at: datetime
    updated_at: datetime


class AnalysisOut(AnalysisSummary):
    """The whole analysis, with the hand it was started from and all nine steps."""

    hand_text: str
    action_index: int
    steps: list[AnalysisStep]
