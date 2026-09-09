"""Statistics endpoints. Everything here is tenant-scoped by construction.

The read path is: Redis (hit -> ~5 ms) -> ClickHouse (miss -> one aggregate query over
`marts.stats_daily`). Nothing upstream of ClickHouse is in this path -- no parsing, no dbt, no
orchestrator. See docs/POKER_ARCHITECTURE.md, "three latency classes".
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, status

from api import cache
from api.db import clickhouse
from api.deps import CurrentUserDep
from api.queries import (
    COUNTERS,
    FILTERABLE,
    STATS,
    CustomStat,
    Dataset,
    StatsQuery,
    TimelineQuery,
    coerce_filters,
)
from api.schemas import (
    CustomStatsRequest,
    StatsResponse,
    StatValue,
    TimelinePoint,
    TimelineResponse,
)
from ingestion.loader import DATASET_HERO

router = APIRouter(prefix="/v1/stats", tags=["stats"])

FilterList = Annotated[list[str] | None, Query()]


def _filters(
    site: list[str] | None,
    stake_level: list[str] | None,
    position: list[str] | None,
    game_type: list[str] | None,
) -> dict[str, list[Any]]:
    """Assemble the filter dict from allowlisted query parameters only."""
    raw = {
        "site": site,
        "stake_level": stake_level,
        "position": position,
        "game_type": game_type,
    }
    return {k: v for k, v in raw.items() if v}


@router.get("/definitions")
async def definitions() -> dict[str, list[dict[str, Any]]]:
    """Stat codes, labels and formulas.

    One definition, read by the API, the dashboard and (later) the LLM prompt — instead of
    three copies that drift apart.
    """
    return {
        "stats": [
            {
                "code": s.code,
                "label": s.label,
                "kind": s.kind,
                "higher_is_better": s.higher_is_better,
                "numerator": s.numerator,
                "denominator": s.denominator,
            }
            for s in STATS.values()
        ],
        "filters": [{"name": name, "column": col} for name, (col, _) in FILTERABLE.items()],
        # The vocabulary for custom stats: every counter you may use as an action or as an
        # OPPORTUNITY. Choosing the denominator is the point — "fold to 3-bet per hand dealt"
        # and "fold to 3-bet when facing one" are different questions with the same numerator.
        "counters": [{"name": name, "label": label} for name, label in COUNTERS.items()],
    }


@router.post("/custom", response_model=StatsResponse)
async def custom_stats(body: CustomStatsRequest, user: CurrentUserDep) -> StatsResponse:
    """Compute user-defined statistics, where the caller chooses the OPPORTUNITY.

    POST rather than GET because a report definition is a document, not a filter, and it is
    the shape a saved report will be stored in.
    """
    try:
        query = StatsQuery(
            tenant_id=user.tenant_id,
            date_from=body.date_from,
            date_to=body.date_to,
            dataset=body.dataset,
            hero_only=body.dataset == DATASET_HERO,
            filters=coerce_filters({k: v for k, v in (body.filters or {}).items() if v}),
            group_by=list(body.group_by or []),
            stats=list(body.stats or []),
            custom_stats=[
                CustomStat(
                    code=c.code,
                    label=c.label,
                    numerator=c.numerator,
                    denominator=c.denominator,
                    kind=c.kind,
                )
                for c in body.custom
            ],
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return _run_stats(query)


def _cache_fields(query: StatsQuery) -> dict[str, Any]:
    """Everything that changes the answer, so two different questions never share a key."""
    return {
        "dataset": query.dataset,
        "from": query.date_from,
        "to": query.date_to,
        "group": query.group_by,
        "stats": query.stats,
        "filters": query.filters,
        "custom": [(c.code, c.numerator, c.denominator) for c in query.custom_stats],
    }


def _stat_values(row: dict[str, Any], query: StatsQuery) -> list[StatValue]:
    """Each requested stat and its sample size, read off the single ungrouped row."""
    values: list[StatValue] = []
    for definition in query.definitions():
        value = row.get(definition.code)
        values.append(
            StatValue(
                code=definition.code,
                label=definition.label,
                value=float(value) if value is not None else None,
                # Sample size travels with every stat, always.
                sample=int(row.get(f"{definition.code}__n") or 0),
            )
        )
    return values


def _run_stats(query: StatsQuery, *, use_cache: bool = True) -> StatsResponse:
    """Execute a stats query, with caching. Shared by the GET and POST endpoints."""
    key = cache.stats_key(query.tenant_id, "stats", _cache_fields(query))
    if use_cache:
        cached = cache.get_json(key)
        if cached is not None:
            return StatsResponse(**cached, cached=True)

    sql, params = query.build()
    result = clickhouse().query(sql, parameters=params)
    rows = [dict(zip(result.column_names, row, strict=True)) for row in result.result_rows]
    total_hands = int(sum(int(r.get("hands_total") or 0) for r in rows))
    stat_values = _stat_values(rows[0], query) if rows and not query.group_by else []

    payload = StatsResponse(hands=total_hands, groups=rows, stats=stat_values)
    cache.set_json(key, payload.model_dump(exclude={"cached"}))
    return payload


@router.get("", response_model=StatsResponse)
async def get_stats(
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
    """Core stats, filtered and optionally grouped.

    `dataset` chooses the body of hands: `hero` (own play, own seat only) or `population`
    (observed pool hands, every seat). It is the one switch that must be explicit.
    """
    try:
        query = StatsQuery(
            # Tenant is a constructor argument and comes from the token. There is no request
            # parameter that can influence it.
            tenant_id=user.tenant_id,
            date_from=date_from,
            date_to=date_to,
            dataset=dataset,
            hero_only=dataset == DATASET_HERO,
            filters=_filters(site, stake_level, position, game_type),
            group_by=list(group_by or []),
            stats=list(stats or []),
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    return _run_stats(query)


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
async def timeline(
    user: CurrentUserDep,
    date_from: date | None = None,
    date_to: date | None = None,
    dataset: Dataset = DATASET_HERO,
    site: FilterList = None,
    stake_level: FilterList = None,
    position: FilterList = None,
    game_type: FilterList = None,
) -> TimelineResponse:
    """Cumulative winnings, EV-adjusted winnings, and the showdown split.

    The EV line is what turns a losing month into a diagnosable event rather than a mood: the
    gap between the two lines is run-good/run-bad, and everything else is how you played.
    """
    filters = _filters(site, stake_level, position, game_type)
    try:
        query = TimelineQuery(
            tenant_id=user.tenant_id,
            date_from=date_from,
            date_to=date_to,
            dataset=dataset,
            filters=filters,
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    key = cache.stats_key(
        user.tenant_id,
        "timeline",
        {"dataset": dataset, "from": date_from, "to": date_to, "filters": query.filters},
    )
    cached = cache.get_json(key)
    if cached is not None:
        return TimelineResponse(**cached)

    sql, params = query.build()
    payload = _timeline_payload(clickhouse().query(sql, parameters=params).result_rows)
    cache.set_json(key, payload.model_dump())
    return payload
