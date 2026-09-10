"""The baseline seam (plan §2.8, ADR-011, ADR-026): what the hero is compared against.

`hero` never reads the pool directly; it asks a `BaselineProvider` the same question it asked
of its own hands and gets a `ReportResult` back, shaped identically. Today that is the whole
population, or a cohort of it ("regs"); a solver-strategy implementation plugs into the same
Protocol later without the hero module changing.
"""

from __future__ import annotations

from typing import Protocol

from stats.registry import Registry
from stats.request import CohortSpec, ReportRequest, ReportResult
from stats.service import Cache, Runner, run_report


class BaselineProvider(Protocol):
    """Answer the hero's question for the baseline population."""

    def baseline(
        self, request: ReportRequest, tenant_id: int, cohort: CohortSpec | None = None
    ) -> ReportResult:
        """The same stats, dates, filter and grouping as `request`, measured on the baseline."""
        ...


class PopulationBaseline:
    """The observed pool -- every seat of the population dataset, or a cohort of it."""

    def __init__(
        self,
        *,
        run: Runner | None = None,
        cache: Cache | None = None,
        reg: Registry | None = None,
    ) -> None:
        """Injectable database runner, cache and registry, as for `run_report`."""
        self.run = run
        self.cache = cache
        self.reg = reg

    def baseline(
        self, request: ReportRequest, tenant_id: int, cohort: CohortSpec | None = None
    ) -> ReportResult:
        """`request` asked of the pool (`ReportRequest.baseline`), restricted to `cohort` if any."""
        pool = request.baseline().model_copy(update={"cohort": cohort})
        return run_report(pool, tenant_id, run=self.run, cache=self.cache, reg=self.reg)
