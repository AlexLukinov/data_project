"""Request/response models of the pool area (plan §2.8, §2.10): cohorts and presets.

A stored cohort's `criteria` IS the engine's `CohortSpec`, so what a user saves is exactly
what the engine evaluates.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

from analysis.pool.cohorts import CohortGroup, CohortPreset
from analysis.pool.nodes import NodeKey
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
    """The pool area's landing reports, its ready-made cohorts, and the groups they form.

    A cohort here is addressable by its code (`?cohort=preset:reg`) and a group by its key
    (`?cohort=group:unknown`) on every pool route that takes a `cohort_id` (plan G.4, ADR-080).
    """

    reports: list[Preset]
    cohorts: list[CohortPreset]
    groups: list[CohortGroup]


HAND_CLASS = r"^(?:[2-9TJQKA]{2}|[2-9TJQKA]{2}[so])$"
"""A 169-combo class: a pair (`QQ`), or two ranks with `s`/`o` (`AKs`, `T9o`)."""

CLASSES = 169


class EstimateIn(BaseModel):
    """Tier 3's question: this node, and the range I believe is there before I ask (spec §10.3).

    Weights are relative — a chart in percent, in combos or in fractions all reconstruct the
    same — so anything positive is accepted and the sum is normalized. Classes the prior does
    not name are simply not in the range.
    """

    model_config = ConfigDict(extra="forbid")

    node: NodeKey
    prior: dict[Annotated[str, Field(pattern=HAND_CLASS)], Annotated[float, Field(ge=0)]] = Field(
        min_length=1, max_length=CLASSES
    )
