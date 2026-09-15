"""Request/response models for hand notes and tags (plan D.7b).

**A tag is normalized in exactly one place, `normalize_tag`,** and every road a tag travels --
the body of a `POST`, the path of a `DELETE`, the `?tag=` on a hand list -- goes through it. So
`Bluff`, ` bluff ` and `BLUFF` are one tag, and a list filtered by `?tag=Bluff` finds the hands
tagged `bluff` instead of silently finding none.

The note is not normalized beyond trimming: it is prose, and its case and line breaks are the
writer's. A note that is blank after trimming is not stored at all (see `hand_note_store`).
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field

from api.models_hand_notes import MAX_TAG_CHARS

MAX_NOTE_CHARS = 10_000
MAX_DISTINCT_TAGS = 500
"""How many distinct tags one user may have across all their hands. A tag vocabulary is a
thing to browse, and five hundred is already past that; the 501st is refused in words."""

BLANK_TAG = "a tag needs some text"
TAG_TOO_LONG = f"a tag is at most {MAX_TAG_CHARS} characters"
NUL = "\x00"
HAS_NUL = "text cannot contain a NUL character"


def refuse_nul(text: str) -> str:
    """Postgres `text` refuses a NUL byte outright; say so here, as a 422, not there, as a 500."""
    if NUL in text:
        raise ValueError(HAS_NUL)
    return text


def normalize_tag(text: str) -> str:
    """The canonical spelling of a tag: trimmed, lower-cased, inner whitespace collapsed.

    Raises `ValueError` in words when nothing is left, or too much is -- pydantic turns that
    into a 422 with the sentence in it.
    """
    tag = " ".join(refuse_nul(text).split()).lower()
    if tag == "":
        raise ValueError(BLANK_TAG)
    if len(tag) > MAX_TAG_CHARS:
        raise ValueError(TAG_TOO_LONG)
    return tag


Tag = Annotated[str, AfterValidator(normalize_tag)]
"""A tag as the API accepts it: any spelling in, the canonical one out."""


class HandNoteIn(BaseModel):
    """The note to keep on a hand. A blank body removes the note."""

    model_config = ConfigDict(extra="forbid")

    body: Annotated[str, AfterValidator(refuse_nul)] = Field(max_length=MAX_NOTE_CHARS)


class HandNoteOut(BaseModel):
    """A hand's note. `body` is empty and `updated_at` is null when there is none."""

    model_config = ConfigDict(from_attributes=True)

    hand_uid: str
    body: str
    updated_at: datetime | None


class TagIn(BaseModel):
    """One tag to put on a hand."""

    model_config = ConfigDict(extra="forbid")

    tag: Tag


class HandTagsOut(BaseModel):
    """Every tag on one hand, alphabetically."""

    hand_uid: str
    tags: list[str]


class TagCount(BaseModel):
    """One tag in the user's vocabulary and how many hands carry it."""

    tag: str
    hands: int
