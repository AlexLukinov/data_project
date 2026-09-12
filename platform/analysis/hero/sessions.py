"""Sessions (plan §2.8, C.7): the hero's hands split on gaps in play.

A session is a run of hands with no gap longer than `gap_minutes` between consecutive hands:
a break for dinner ends one, a table change does not. Computed in ClickHouse with window
functions in one ordered scan, so a 500k-hand history costs one query rather than a round
trip per hand. Not a stat -- the group key is time -- so it has its own query, scoped exactly
like a report through `stats.query.scope` (tenant, dataset, hero seat, dates).
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from core.settings import get_settings
from stats import tenancy
from stats.ast import _Strict
from stats.query import PHYSICAL, scope
from stats.request import DATASET_HERO, ReportRequest
from stats.service import Runner

DEFAULT_GAP_MINUTES = 30
SECONDS_PER_MINUTE = 60
HANDS_PER_RATE = 100


class Session(_Strict):
    """One sitting: when, how long, how many hands, and what it made."""

    started_at: datetime
    ended_at: datetime
    minutes: int
    hands: int
    net_bb: float
    ev_bb: float
    bb_per_100: float
    sites: list[str]
    stakes: list[str]


class SessionsResult(_Strict):
    """Every session in the range, oldest first, with the totals behind them."""

    gap_minutes: int
    hands: int
    net_bb: float
    sessions: list[Session]


def sessions_query(
    tenant_id: int, *, gap_minutes: int, date_from: date | None, date_to: date | None
) -> tuple[str, dict[str, Any]]:
    """(sql, parameters): one row per session in time order.

    Innermost: the hero's hands in time order with the previous hand's time beside each
    (`lagInFrame`; the first hand sees the epoch, so it opens a session). Middle: a running
    count of session starts numbers the sessions. Outer: one row per number.
    """
    request = ReportRequest(
        dataset=DATASET_HERO, hero_only=True, date_from=date_from, date_to=date_to
    )
    where, params = scope(request, tenant_id, "player_hands")
    params["gap_seconds"] = gap_minutes * SECONDS_PER_MINUTE
    table = f"{get_settings().db('marts')}.{PHYSICAL['player_hands']}"
    ordered = (
        "SELECT played_at_utc, hand_uid, net_won_bb, ev_won_bb, site, stake_level, "
        "lagInFrame(played_at_utc) OVER (ORDER BY played_at_utc, hand_uid) AS prev_at "
        f"FROM {table} AS s WHERE {' AND '.join(where)}"
    )
    numbered = (
        "SELECT played_at_utc, net_won_bb, ev_won_bb, site, stake_level, "
        "sum(toUInt8(dateDiff('second', prev_at, played_at_utc) > {gap_seconds:UInt32})) "
        "OVER (ORDER BY played_at_utc, hand_uid ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)"
        f" AS session_no FROM ({ordered})"
    )
    sql = (
        "SELECT session_no, min(played_at_utc) AS started_at, max(played_at_utc) AS ended_at, "
        "count() AS hand_count, sum(net_won_bb) AS net_total, sum(ev_won_bb) AS ev_total, "
        "arrayDistinct(groupArray(toString(site))) AS site_list, "
        "arrayDistinct(groupArray(toString(stake_level))) AS stake_list "
        f"FROM ({numbered}) GROUP BY session_no ORDER BY started_at"
    )
    return sql, params


def sessions(
    tenant_id: int,
    *,
    gap_minutes: int = DEFAULT_GAP_MINUTES,
    date_from: date | None = None,
    date_to: date | None = None,
    run: Runner | None = None,
) -> SessionsResult:
    """The hero's sessions in the range, oldest first."""
    runner = run or tenancy.runner_for(tenant_id)
    columns, rows = runner(
        *sessions_query(tenant_id, gap_minutes=gap_minutes, date_from=date_from, date_to=date_to)
    )
    found = [_session(dict(zip(columns, row, strict=True))) for row in rows]
    return SessionsResult(
        gap_minutes=gap_minutes,
        hands=sum(s.hands for s in found),
        net_bb=round(sum(s.net_bb for s in found), 2),
        sessions=found,
    )


def _session(record: dict[str, Any]) -> Session:
    started, ended = record["started_at"], record["ended_at"]
    hands = int(record["hand_count"])
    net = float(record["net_total"])
    return Session(
        started_at=started,
        ended_at=ended,
        minutes=int((ended - started).total_seconds() // SECONDS_PER_MINUTE),
        hands=hands,
        net_bb=round(net, 2),
        ev_bb=round(float(record["ev_total"]), 2),
        bb_per_100=round(HANDS_PER_RATE * net / hands, 2) if hands else 0.0,
        sites=[str(s) for s in record["site_list"]],
        stakes=[str(s) for s in record["stake_list"]],
    )
