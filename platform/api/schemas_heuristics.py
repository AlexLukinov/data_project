"""Request/response models for the heuristic log (plan F.11, spec §16).

A heuristic is one sentence plus the situation it applies to. The server stores it and judges
none of it -- whether the lesson is right is what the review prompt is for, not what a validator
can decide. What it does enforce is that the sentence exists: a blank takeaway is the one way
the log can fill up with rows that mean nothing.

**The fourteen-day rule lives here and only here.** `REVIEW_DAYS` and `review_due_at()` are the
single definition; the store's filter and the `is_due` flag are both derived from them, so
changing the interval is a one-line change rather than a hunt through the query layer.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from analysis.pool.nodes import NodeKey, Position, Street

REVIEW_DAYS = 14
"""How long a heuristic stands before the log asks whether it is still true (spec §16)."""

MAX_TEXT = 500
MAX_TEXTURE = 32
MAX_TAG = 40
MAX_TAGS = 20
MAX_TITLE = 200

Status = Literal["open", "confirmed", "retired"]
DEFAULT_STATUS: Status = "open"

StreetTag = Street | Literal[""]
"""A street, or empty when the heuristic is not about one street in particular."""
PositionTag = Position | Literal[""]
Texture = Annotated[str, StringConstraints(max_length=MAX_TEXTURE)]
Tag = Annotated[str, StringConstraints(min_length=1, max_length=MAX_TAG)]

BLANK_TEXT = "a heuristic needs the lesson itself -- `text` cannot be blank"


def review_due_at(confirmed_at: datetime | None, created_at: datetime) -> datetime:
    """When the "still true?" prompt comes due: `REVIEW_DAYS` after the last answer.

    A heuristic that has never been reviewed counts from the day it was written, so a lesson
    left alone surfaces again exactly once per interval rather than never.
    """
    return (confirmed_at or created_at) + timedelta(days=REVIEW_DAYS)


class HeuristicIn(BaseModel):
    """Write a heuristic into the log. Only the sentence is required."""

    model_config = ConfigDict(extra="forbid")

    text: str = Field(max_length=MAX_TEXT)
    analysis_id: uuid.UUID | None = None
    street: StreetTag = ""
    position: PositionTag = ""
    texture: Texture = ""
    tags: list[Tag] = Field(default_factory=list, max_length=MAX_TAGS)
    status: Status = DEFAULT_STATUS

    @model_validator(mode="after")
    def _says_something(self) -> HeuristicIn:
        """Whitespace is not a lesson; refuse it in words rather than storing an empty row."""
        if self.text.strip() == "":
            raise ValueError(BLANK_TEXT)
        return self


class HeuristicUpdate(BaseModel):
    """Change a heuristic. Every field is optional and an omitted one is left exactly as it was."""

    model_config = ConfigDict(extra="forbid")

    text: str | None = Field(default=None, max_length=MAX_TEXT)
    analysis_id: uuid.UUID | None = None
    street: StreetTag | None = None
    position: PositionTag | None = None
    texture: Texture | None = None
    tags: list[Tag] | None = Field(default=None, max_length=MAX_TAGS)
    status: Status | None = None

    @model_validator(mode="after")
    def _says_something(self) -> HeuristicUpdate:
        """A rewrite may not blank the sentence out; omit `text` to leave it alone instead."""
        if self.text is not None and self.text.strip() == "":
            raise ValueError(BLANK_TEXT)
        return self


class HeuristicOut(BaseModel):
    """One row of the log, with its review state worked out."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    analysis_id: uuid.UUID | None
    text: str
    street: StreetTag
    position: PositionTag
    texture: str
    tags: list[str]
    status: Status
    confirmed_at: datetime | None
    review_due_at: datetime
    """Derived from `confirmed_at` or `created_at`; never stored, so the rule cannot drift."""
    is_due: bool
    created_at: datetime
    updated_at: datetime


class HeuristicCandidate(BaseModel):
    """An analysis whose step 9 wrote a takeaway that is not in the log yet.

    This is the bridge ADR-034 promised when it gave `analyses` a `heuristic` column of its own:
    the log offers those takeaways for adoption instead of making the user retype them.
    """

    model_config = ConfigDict(from_attributes=True)

    analysis_id: uuid.UUID
    title: str = Field(max_length=MAX_TITLE)
    heuristic: str = Field(max_length=MAX_TEXT)
    node_key: NodeKey | None
    created_at: datetime
