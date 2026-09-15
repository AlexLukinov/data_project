"""The winnings curve (plan D.4, D.9a, ADR-052): the hero's money by day, as running totals.

Not a report -- the group key is the calendar day and the measures are the four money sums, and
the registry has no day dimension -- so it has its own query, `stats.timeline.build_timeline`,
scoped exactly like a report (tenant, dataset, hero seat, dates) and read from the fresh rollup.
This module runs that query and turns its per-day sums into the running totals the graph draws.

**The totals are summed here, once, on the server.** A reload and a re-read then cannot disagree
about them -- the contract `WinningsPoint` in `web/apps/web/app/hero/api.ts` was written to in D.4.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import date
from typing import Any

from stats import tenancy
from stats.ast import _Strict
from stats.registry import registry
from stats.request import DATASET_HERO, ReportRequest
from stats.service import Runner
from stats.timeline import build_timeline

HANDS_PER_RATE = 100
MONEY_DECIMALS = 2


class WinningsPoint(_Strict):
    """One day on the curve: that day's hands, and the four sums up to and including it."""

    day: date
    hands: int
    """Hands played on this day alone -- not a running total, unlike the four sums beside it."""
    cumulative_net_bb: float
    cumulative_ev_bb: float
    """All-in adjusted (plan E.5, ADR-039)."""
    cumulative_showdown_bb: float
    cumulative_nonshowdown_bb: float


class WinningsResult(_Strict):
    """The curve over the range, oldest day first, and the headline rates it ends on."""

    hands: int
    bb_per_100: float | None
    """`None` when no hand falls in the range, rather than a division by zero."""
    ev_bb_per_100: float | None
    points: list[WinningsPoint]


def winnings(
    tenant_id: int,
    *,
    date_from: date | None = None,
    date_to: date | None = None,
    run: Runner | None = None,
) -> WinningsResult:
    """The hero's cumulative winnings by day: actual, all-in EV, showdown and non-showdown."""
    request = ReportRequest(
        dataset=DATASET_HERO, hero_only=True, date_from=date_from, date_to=date_to
    )
    runner = run or tenancy.runner_for(tenant_id)
    _, rows = runner(*build_timeline(request, tenant_id, registry()))
    return _curve(rows)


def _curve(rows: Sequence[Sequence[Any]]) -> WinningsResult:
    """Per-day rows `day, hands, won_bb, ev_bb, sd_bb, nsd_bb`, in date order, as running totals."""
    points: list[WinningsPoint] = []
    net = ev = showdown = nonshowdown = 0.0
    total_hands = 0
    for day, hands, won_bb, ev_bb, sd_bb, nsd_bb in rows:
        net += float(won_bb or 0)
        ev += float(ev_bb or 0)
        showdown += float(sd_bb or 0)
        nonshowdown += float(nsd_bb or 0)
        total_hands += int(hands or 0)
        points.append(
            WinningsPoint(
                day=day,
                hands=int(hands or 0),
                cumulative_net_bb=round(net, MONEY_DECIMALS),
                cumulative_ev_bb=round(ev, MONEY_DECIMALS),
                cumulative_showdown_bb=round(showdown, MONEY_DECIMALS),
                cumulative_nonshowdown_bb=round(nonshowdown, MONEY_DECIMALS),
            )
        )
    return WinningsResult(
        hands=total_hands,
        bb_per_100=_per_100(net, total_hands),
        ev_bb_per_100=_per_100(ev, total_hands),
        points=points,
    )


def _per_100(total_bb: float, hands: int) -> float | None:
    """Big blinds per 100 hands, or `None` over no hands."""
    return round(HANDS_PER_RATE * total_bb / hands, MONEY_DECIMALS) if hands else None
