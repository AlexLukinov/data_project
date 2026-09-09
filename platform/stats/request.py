"""What a report asks for, and what it gets back (POKER_PLAN.md §2.6, §2.7).

`ReportRequest` is the one shape every screen produces and every saved report is stored in:
a dataset, a date range, a filter tree, a group-by, and the stats -- built-in codes or inline
custom definitions. `tenant_id` is NOT in it: the service takes it as an argument from the
token, so no request document can name a tenant.
"""

from __future__ import annotations

import hashlib
import json
from datetime import date
from typing import Literal

from pydantic import Field, model_validator

from stats.ast import CODE, All, Expr, Node, _Strict
from stats.definitions import Format, Grain

Dataset = Literal["hero", "population"]
DATASET_HERO: Dataset = "hero"
DATASET_POPULATION: Dataset = "population"
DATASETS: frozenset[str] = frozenset({DATASET_HERO, DATASET_POPULATION})
"""The runtime allowlist for `dataset` where it arrives as a plain string (an upload form)."""

MAX_GROUP_BY = 4
MAX_STATS = 40
MAX_CUSTOM = 20
MAX_LIMIT = 10_000


class CustomStatSpec(_Strict):
    """A user-defined stat: numerator (+ denominator) expressions over one grain."""

    code: str = Field(pattern=CODE)
    label: str = ""
    grain: Grain
    format: Format = "percent"
    numerator: Expr
    denominator: Expr | None = None

    @model_validator(mode="after")
    def _denominator_matches_format(self) -> CustomStatSpec:
        """A count has no denominator; everything else needs one."""
        if self.format == "count" and self.denominator is not None:
            raise ValueError("a count has no denominator")
        if self.format != "count" and self.denominator is None:
            raise ValueError(f"format {self.format!r} needs a denominator")
        return self


class ReportRequest(_Strict):
    """One report: which hands, sliced how, measured by what."""

    dataset: Dataset = DATASET_HERO
    hero_only: bool = True
    """Own seat only. Only meaningful on the hero dataset: pool exports have no hero seat."""
    date_from: date | None = None
    date_to: date | None = None
    player_key: str | None = None
    filter: Node = Field(default_factory=lambda: All(all=[]))
    group_by: list[str] = Field(default_factory=list, max_length=MAX_GROUP_BY)
    stats: list[str] = Field(default_factory=list, max_length=MAX_STATS)
    custom: list[CustomStatSpec] = Field(default_factory=list, max_length=MAX_CUSTOM)
    compare_to: Literal["population"] | None = None
    limit: int = Field(default=500, ge=1, le=MAX_LIMIT)

    @model_validator(mode="after")
    def _consistent(self) -> ReportRequest:
        """No hero seat in the pool; a baseline only makes sense against own play."""
        if self.dataset == DATASET_POPULATION and self.hero_only:
            raise ValueError("hero_only cannot be combined with the population dataset")
        if self.compare_to is not None and self.dataset != DATASET_HERO:
            raise ValueError("compare_to needs the hero dataset")
        if self.date_from and self.date_to and self.date_from > self.date_to:
            raise ValueError("date_from is after date_to")
        return self

    def canonical(self) -> str:
        """A stable JSON form: the same question always yields the same cache key."""
        return json.dumps(self.model_dump(mode="json", by_alias=True), sort_keys=True)

    def cache_key(self, tenant_id: int) -> str:
        """Tenant first, so the namespace is physically partitioned."""
        digest = hashlib.sha256(self.canonical().encode()).hexdigest()[:20]
        return f"report:{tenant_id}:{digest}"

    def baseline(self) -> ReportRequest:
        """The same question asked of the pool: every seat, no player, no further baseline."""
        return self.model_copy(
            update={
                "dataset": DATASET_POPULATION,
                "hero_only": False,
                "player_key": None,
                "compare_to": None,
            }
        )


class Cell(_Strict):
    """One stat in one row: the value and the sample size behind it, always together."""

    value: float | None
    n: int
    baseline: float | None = None
    baseline_n: int | None = None
    delta: float | None = None


class ReportRow(_Strict):
    """One group: its key values, how many hands it covers, and a cell per stat."""

    group: dict[str, str | int | float | None]
    hands: int
    cells: dict[str, Cell]


class StatMeta(_Strict):
    """How to read a column of the result."""

    code: str
    label: str
    format: Format
    grain: Grain
    description: str = ""


class ReportResult(_Strict):
    """The answer: rows in group order, and the meaning of every column."""

    hands: int
    group_by: list[str]
    stats: list[StatMeta]
    rows: list[ReportRow]
    cached: bool = False
