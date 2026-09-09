"""Request/response models for saved filters, reports and stats (POKER_PLAN.md §2.10).

The stored documents ARE the engine's own request models -- a saved filter is a `Node`, a
saved report a `ReportRequest`, a saved stat a `CustomStatSpec` -- so what a user saves is
exactly what the engine runs, validated on the way in by the same code.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from stats.ast import CODE, Node
from stats.request import CustomStatSpec, ReportRequest

Module = Literal["hero", "pool"]


class SavedFilterIn(BaseModel):
    """Create or replace a named filter."""

    name: str = Field(min_length=1, max_length=120)
    ast: Node


class SavedFilterOut(BaseModel):
    """A stored filter."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    ast: Node
    created_at: datetime
    updated_at: datetime


class SavedReportIn(BaseModel):
    """Create or replace a named report definition."""

    name: str = Field(min_length=1, max_length=120)
    module: Module = "hero"
    definition: ReportRequest


class SavedReportOut(BaseModel):
    """A stored report definition."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    module: Module
    definition: ReportRequest
    created_at: datetime
    updated_at: datetime


class SavedStatIn(BaseModel):
    """Create or replace a user-defined stat."""

    code: str = Field(pattern=CODE)
    label: str = Field(default="", max_length=120)
    definition: CustomStatSpec


class SavedStatOut(BaseModel):
    """A stored user-defined stat."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    code: str
    label: str
    definition: CustomStatSpec
    created_at: datetime
    updated_at: datetime
