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
from stats.interval import Interval, Level

Direction = Literal["asc", "desc"]

Dataset = Literal["hero", "population"]
DATASET_HERO: Dataset = "hero"
DATASET_POPULATION: Dataset = "population"
DATASETS: frozenset[str] = frozenset({DATASET_HERO, DATASET_POPULATION})
"""The runtime allowlist for `dataset` where it arrives as a plain string (an upload form)."""

MAX_GROUP_BY = 4
MAX_STATS = 40
MAX_CUSTOM = 20
MAX_LIMIT = 10_000
MAX_COHORT_RULES = 10
MAX_HANDS = 200
"""Hands one search returns. A replayer list is browsed, not exported."""

MAX_ORDER_BY = 4

CohortOp = Literal["lt", "lte", "gt", "gte"]


class CohortRule(_Strict):
    """One threshold on a cached stat, evaluated per player: `vpip lt 25`, `hands gte 1000`."""

    stat: str = Field(pattern=CODE)
    op: CohortOp
    value: float


class CohortSpec(_Strict):
    """A set of pool players named by criteria (plan §2.8, F-602): every rule must hold.

    Compiled by the engine into a subquery over the rollup, so a cohort is evaluated on each
    player's whole history at query time and never stored as a member list.
    """

    rules: list[CohortRule] = Field(min_length=1, max_length=MAX_COHORT_RULES)


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


class OrderKey(_Strict):
    """Order by a column the answer already has.

    A group-by dimension or a stat of this same request -- named, so a client reading the
    result can see what it was ranked by.
    """

    key: str = Field(pattern=CODE)
    direction: Direction = "asc"


class OrderMatch(_Strict):
    """Order by whether a condition holds: the rows where it does sort together.

    Because a ranking is not always a column -- "the exact name first, then the busiest"
    (ADR-062 decision 3, ADR-065) has no column to name. It is the ordinary filter grammar
    (ADR-022) over the request's own group-by dimensions, and goes through the ordinary
    compiler, so its identifiers are the registry's and every value it carries is bound.
    """

    match: Node
    direction: Direction = "asc"


OrderBy = OrderKey | OrderMatch
"""One ORDER BY term. Two shapes, told apart by the field they carry -- so a term that is
neither, or both, does not exist to be handled."""


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
    order_by: list[OrderBy] = Field(default_factory=list, max_length=MAX_ORDER_BY)
    """How to rank the groups. Empty is the group key itself, which is what a grid wants.

    Only meaningful with a `group_by`: a report without one has a single row. Every term is
    allowlisted in `stats.order` against this request's own group-by and stats, so a rank can
    only be over a column of the answer (ADR-065)."""
    stats: list[str] = Field(default_factory=list, max_length=MAX_STATS)
    custom: list[CustomStatSpec] = Field(default_factory=list, max_length=MAX_CUSTOM)
    compare_to: Literal["population"] | None = None
    cohort: CohortSpec | None = None
    """Restrict the pool to these players. On a population request it scopes the report; on a
    hero request with `compare_to` it scopes the baseline (hero vs regs)."""
    confidence: Level | None = None
    """Put a confidence interval at this level on every cell that can carry one (plan E.2).

    Opt-in rather than always-on, because it is not free: a per-100 interval needs the
    per-hand spread, which only the fact tables can give, so asking for one on `bb_per_100`
    takes that report off the rollup (`stats.router.plan`). Screens that show a KPI want it;
    a 40-column grid being scrolled does not."""
    limit: int = Field(default=500, ge=1, le=MAX_LIMIT)

    @model_validator(mode="after")
    def _consistent(self) -> ReportRequest:
        """No hero seat in the pool; a baseline only makes sense against own play."""
        if self.dataset == DATASET_POPULATION and self.hero_only:
            raise ValueError("hero_only cannot be combined with the population dataset")
        if self.compare_to is not None and self.dataset != DATASET_HERO:
            raise ValueError("compare_to needs the hero dataset")
        if self.cohort is not None and self.dataset != DATASET_POPULATION and not self.compare_to:
            raise ValueError("a cohort applies to the population dataset, or to a baseline")
        if self.date_from and self.date_to and self.date_from > self.date_to:
            raise ValueError("date_from is after date_to")
        if self.order_by and not self.group_by:
            raise ValueError("order_by needs a group_by: a report without one has a single row")
        return self

    def canonical(self) -> str:
        """A stable JSON form: the same question always yields the same cache key."""
        return json.dumps(self.model_dump(mode="json", by_alias=True), sort_keys=True)

    def cache_key(self, tenant_id: int) -> str:
        """Tenant first, so the namespace is physically partitioned."""
        digest = hashlib.sha256(self.canonical().encode()).hexdigest()[:20]
        return f"report:{tenant_id}:{digest}"

    def baseline(self) -> ReportRequest:
        """The same question asked of the pool: every seat, no player, no further baseline.

        Without the interval: only the baseline's `value` and `n` are attached to a cell, and
        carrying `confidence` here would drop a whole-pool per-100 query off the rollup to
        compute bounds nobody reads. A caller that wants the pool's own interval asks for the
        pool's own report (plan E.2).
        """
        return self.model_copy(
            update={
                "dataset": DATASET_POPULATION,
                "hero_only": False,
                "player_key": None,
                "compare_to": None,
                "confidence": None,
            }
        )


class HandSearch(_Strict):
    """Which hands to show, not how often something happens (plan F.7).

    The same filter tree a report uses, asked of the same decision table, but the answer is
    the matching decisions themselves: the replayer needs to know which seat to watch, not
    only which hand to open.
    """

    dataset: Dataset = DATASET_HERO
    hero_only: bool = True
    date_from: date | None = None
    date_to: date | None = None
    player_key: str | None = None
    filter: Node = Field(default_factory=lambda: All(all=[]))
    limit: int = Field(default=100, ge=1, le=MAX_HANDS)

    @model_validator(mode="after")
    def _consistent(self) -> HandSearch:
        """The report's rules on the same fields, applied by building one."""
        self.as_report()
        return self

    def as_report(self) -> ReportRequest:
        """The equivalent report request -- so scoping and its rules are written once."""
        return ReportRequest(
            dataset=self.dataset,
            hero_only=self.hero_only,
            date_from=self.date_from,
            date_to=self.date_to,
            player_key=self.player_key,
            filter=self.filter,
            limit=self.limit,
        )


class Cell(_Strict):
    """One stat in one row: the value and the sample size behind it, always together."""

    value: float | None
    n: int
    baseline: float | None = None
    baseline_n: int | None = None
    delta: float | None = None
    interval: Interval | None = None
    """Present when the request named a `confidence` level and the format has one. Its own `n`
    repeats this cell's, so a client holding only the interval still knows what it rests on."""


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
