"""The v1 statistics routes, now thin adapters over `stats.service` (plan C.5).

They keep the response shapes the demo dashboard reads (`StatsResponse`, `TimelineResponse`)
and translate the v1 query parameters into a `ReportRequest`; the engine does the rest.
Deleted in plan D.9, once the Nuxt UI talks to `/v1/reports/run` directly.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, status

from api import cache
from api.deps import CurrentUserDep
from api.schemas import (
    CustomStatsRequest,
    StatsResponse,
    StatValue,
    TimelinePoint,
    TimelineResponse,
)
from stats.ast import All, Leaf, Node
from stats.errors import RegistryError, ReportError
from stats.registry import registry
from stats.request import DATASET_HERO, Dataset, ReportRequest, ReportResult
from stats.service import clickhouse_runner, run_report
from stats.timeline import build_timeline

router = APIRouter(prefix="/v1/stats", tags=["stats"])

FilterList = Annotated[list[str] | None, Query()]
COARSE = ("site", "stake_level", "position", "game_type")


def _filter_node(raw: dict[str, list[Any]]) -> Node:
    """`{dimension: [values]}` -> an `all` of `in` leaves, values cast to the dimension's type."""
    reg = registry()
    leaves: list[Node] = []
    for code, values in raw.items():
        if not values:
            continue
        dim = reg.dimensions.get(code)
        if dim is not None and dim.type in ("number", "bool"):
            try:
                values = [int(v) if float(v) == int(float(v)) else float(v) for v in values]
            except (TypeError, ValueError) as exc:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST, f"filter {code!r} expects numbers"
                ) from exc
        leaves.append(Leaf(dim=code, op="in", value=list(values)))
    return All(all=leaves)


def _request(
    dataset: Dataset,
    date_from: date | None,
    date_to: date | None,
    filters: dict[str, list[Any]],
    group_by: Sequence[str],
    stats: Sequence[str],
) -> ReportRequest:
    try:
        return ReportRequest(
            dataset=dataset,
            hero_only=dataset == DATASET_HERO,
            date_from=date_from,
            date_to=date_to,
            filter=_filter_node(filters),
            group_by=list(group_by),
            stats=list(stats),
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


def _run(request: ReportRequest, tenant_id: int) -> StatsResponse:
    """Run through the engine and re-shape into the v1 response."""
    try:
        result = run_report(request, tenant_id=tenant_id, cache=cache)
    except (ReportError, RegistryError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return _v1_shape(result)


def _v1_shape(result: ReportResult) -> StatsResponse:
    groups: list[dict[str, object]] = []
    for row in result.rows:
        group: dict[str, object] = dict(row.group)
        for code, cell in row.cells.items():
            group[code] = cell.value
            group[f"{code}__n"] = cell.n
        group["hands_total"] = row.hands
        groups.append(group)
    labels = {meta.code: meta.label for meta in result.stats}
    stat_values = (
        [
            StatValue(code=code, label=labels.get(code, code), value=cell.value, sample=cell.n)
            for code, cell in result.rows[0].cells.items()
        ]
        if result.rows and not result.group_by
        else []
    )
    return StatsResponse(hands=result.hands, groups=groups, stats=stat_values, cached=result.cached)


@router.get("", response_model=StatsResponse)
def get_stats(
    user: CurrentUserDep,
    date_from: date | None = None,
    date_to: date | None = None,
    dataset: Dataset = DATASET_HERO,
    group_by: FilterList = None,
    stats: FilterList = None,
    site: FilterList = None,
    stake_level: FilterList = None,
    position: FilterList = None,
    game_type: FilterList = None,
) -> StatsResponse:
    """Core stats, filtered and optionally grouped. `dataset` picks own play or the pool."""
    raw = dict(zip(COARSE, (site, stake_level, position, game_type), strict=True))
    filters = {k: v for k, v in raw.items() if v}
    request = _request(dataset, date_from, date_to, filters, group_by or [], stats or [])
    return _run(request, user.tenant_id)


@router.post("/custom", response_model=StatsResponse)
def custom_stats(body: CustomStatsRequest, user: CurrentUserDep) -> StatsResponse:
    """The v1 custom-report body over the v2 engine.

    Counter-based custom stats (`numerator`/`denominator` as counter names) no longer exist:
    the counters were the v1 flag table. Define stats as expressions with `/v1/reports/run`.
    """
    if body.custom:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "counter-based custom stats are gone; define them on /v1/reports/run",
        )
    filters = {k: v for k, v in (body.filters or {}).items() if v}
    request = _request(
        body.dataset, body.date_from, body.date_to, filters, body.group_by, body.stats
    )
    return _run(request, user.tenant_id)


def _per_100(total_bb: float, hands: int) -> float | None:
    """Win rate in big blinds per 100 hands; None rather than a division by zero."""
    return round(100 * total_bb / hands, 2) if hands else None


def _timeline_payload(rows: Sequence[Sequence[Any]]) -> TimelineResponse:
    """Turn the per-day rows (in date order) into cumulative points and the headline rates."""
    points: list[TimelinePoint] = []
    cum = cum_ev = cum_sd = cum_nsd = 0.0
    total_hands = 0
    for day, hands, won_bb, ev_bb, sd_bb, nsd_bb in rows:
        cum += float(won_bb or 0)
        cum_ev += float(ev_bb or 0)
        cum_sd += float(sd_bb or 0)
        cum_nsd += float(nsd_bb or 0)
        total_hands += int(hands or 0)
        points.append(
            TimelinePoint(
                day=day,
                hands=int(hands or 0),
                cumulative_bb=round(cum, 2),
                cumulative_ev_bb=round(cum_ev, 2),
                cumulative_showdown_bb=round(cum_sd, 2),
                cumulative_nonshowdown_bb=round(cum_nsd, 2),
            )
        )
    return TimelineResponse(
        points=points,
        total_hands=total_hands,
        bb_per_100=_per_100(cum, total_hands),
        ev_bb_per_100=_per_100(cum_ev, total_hands),
    )


@router.get("/timeline", response_model=TimelineResponse)
def timeline(
    user: CurrentUserDep,
    date_from: date | None = None,
    date_to: date | None = None,
    dataset: Dataset = DATASET_HERO,
    site: FilterList = None,
    stake_level: FilterList = None,
    position: FilterList = None,
    game_type: FilterList = None,
) -> TimelineResponse:
    """Cumulative winnings, EV-adjusted winnings, and the showdown split, by day."""
    raw = dict(zip(COARSE, (site, stake_level, position, game_type), strict=True))
    filters = {k: v for k, v in raw.items() if v}
    request = _request(dataset, date_from, date_to, filters, [], [])
    key = f"{request.cache_key(user.tenant_id)}:timeline"
    cached = cache.get_json(key)
    if cached is not None:
        return TimelineResponse(**cached)
    try:
        sql, params = build_timeline(request, user.tenant_id, registry())
    except (ReportError, RegistryError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    payload = _timeline_payload(clickhouse_runner(sql, params)[1])
    cache.set_json(key, payload.model_dump(mode="json"))
    return payload
