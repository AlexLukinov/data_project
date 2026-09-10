"""Request/response models of the pool area (plan §2.8, §2.10): cohorts and presets.

A stored cohort's `criteria` IS the engine's `CohortSpec`, so what a user saves is exactly
what the engine evaluates.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from analysis.pool.cohorts import CohortPreset
from analysis.presets import Preset
from stats.request import CohortSpec


class CohortIn(BaseModel):
    """Create or replace a named cohort."""

    name: str = Field(min_length=1, max_length=120)
    criteria: CohortSpec


class CohortOut(BaseModel):
    """A stored cohort."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    criteria: CohortSpec
    created_at: datetime
    updated_at: datetime


class CohortDetailOut(CohortOut):
    """A stored cohort with how many players it names right now."""

    players: int


class PoolPresetsOut(BaseModel):
    """The pool area's landing reports and its ready-made cohorts."""

    reports: list[Preset]
    cohorts: list[CohortPreset]
