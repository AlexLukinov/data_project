"""Request/response models for the range library (plan F.6, spec §11.1).

The body of a range travels as the combo text `poker-core` serializes (`AsKh: 1,AsKd: 0.5,…`,
canonical form, at most 1326 entries). The server never parses it into weights -- the maths
lives in TypeScript -- but it refuses anything that is not that notation, with the entry
number, so a broken client cannot store garbage that every later page fails to parse.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, Field, StringConstraints

from analysis.pool.nodes import NodeKey

Source = Literal["own", "solver", "pool"]
RangeFormat = Literal["combo", "class"]
OnConflict = Literal["skip", "version"]
ExportFormat = Literal["poker-ranges/1"]

EXPORT_FORMAT: ExportFormat = "poker-ranges/1"
COMBO_COUNT = 1326
MAX_WEIGHTS_CHARS = 65_536
MAX_TAGS = 20
MAX_BULK = 500
MAX_NAME = 200
MAX_NOTE = 500
MAX_TOOL = 120
ENTRY_PREVIEW = 24
COMBO_ENTRY = re.compile(
    r"^[2-9TJQKA][cdhs][2-9TJQKA][cdhs]: (?:[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?)$"
)

Tag = Annotated[str, StringConstraints(min_length=1, max_length=40)]


def check_weights(text: str) -> str:
    """Accept only `poker-core`'s canonical combo text; name the first entry that is not."""
    if len(text) > MAX_WEIGHTS_CHARS:
        raise ValueError(f"weights text is longer than {MAX_WEIGHTS_CHARS} characters")
    if text == "":
        return text
    entries = text.split(",")
    if len(entries) > COMBO_COUNT:
        raise ValueError(f"a range has at most {COMBO_COUNT} combos, got {len(entries)} entries")
    for i, entry in enumerate(entries, 1):
        if COMBO_ENTRY.match(entry) is None:
            raise ValueError(
                f"entry {i} ({entry[:ENTRY_PREVIEW]!r}) is not combo notation like 'AsKh: 0.5'"
            )
    return text


Weights = Annotated[str, AfterValidator(check_weights)]


class RangeIn(BaseModel):
    """Create a range; its body becomes version 1."""

    name: str = Field(min_length=1, max_length=MAX_NAME)
    node_key: NodeKey
    source: Source = "own"
    source_tool: str = Field(default="", max_length=MAX_TOOL)
    format: RangeFormat = "combo"
    tags: list[Tag] = Field(default_factory=list, max_length=MAX_TAGS)
    weights: Weights
    note: str = Field(default="", max_length=MAX_NOTE)


class RangeUpdate(BaseModel):
    """Change any of a range's fields; `weights` present means a new version carrying `note`."""

    name: str | None = Field(default=None, min_length=1, max_length=MAX_NAME)
    node_key: NodeKey | None = None
    source: Source | None = None
    source_tool: str | None = Field(default=None, max_length=MAX_TOOL)
    format: RangeFormat | None = None
    tags: list[Tag] | None = Field(default=None, max_length=MAX_TAGS)
    weights: Weights | None = None
    note: str = Field(default="", max_length=MAX_NOTE)


class RangeSummary(BaseModel):
    """A library entry without its body: what the list and the lookup table show."""

    id: uuid.UUID
    name: str
    node_key: NodeKey
    source: Source
    source_tool: str
    format: RangeFormat
    tags: list[str]
    version: int
    created_at: datetime
    updated_at: datetime


class RangeOut(RangeSummary):
    """A library entry with the body of its current version."""

    weights: str
    note: str


class VersionOut(BaseModel):
    """One entry of a range's history."""

    version: int
    weights: str
    note: str
    created_at: datetime


class BulkIn(BaseModel):
    """A folder import after review. A name already in the library is versioned or skipped."""

    ranges: list[RangeIn] = Field(min_length=1, max_length=MAX_BULK)
    on_conflict: OnConflict = "version"


class BulkSkipped(BaseModel):
    """One range the import left alone, and why."""

    name: str
    reason: str


class BulkOut(BaseModel):
    """The import report (spec §11.2): created, given a new version, or skipped -- and why."""

    created: list[RangeOut]
    updated: list[RangeOut]
    skipped: list[BulkSkipped]


class ExportOut(BaseModel):
    """The library as our own JSON format -- the backup `poker-importers` reads back."""

    format: ExportFormat = EXPORT_FORMAT
    exported_at: datetime
    ranges: list[RangeOut]
