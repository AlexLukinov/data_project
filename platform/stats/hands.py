"""Which hands match a situation (plan F.7) -- the reverse of a report.

A report asks "how often does this happen"; the replayer asks "show me the hands where it
did". Same filter tree, same decision table, same tenancy rule -- so a situation built in the
Reports workbench opens directly as a list of hands, with no second filter language.

The answer is the matching **decisions**, not just the hands: a pool hand has no hero seat, so
without the seat the caller would not know whose decision to watch.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from core.settings import get_settings
from stats.compiler import Compiler, Params
from stats.definitions import Table
from stats.errors import RegistryError, ReportError
from stats.query import PHYSICAL, scope
from stats.registry import Registry, registry
from stats.request import HandSearch
from stats.service import Runner, clickhouse_runner

DECISIONS: Table = "decisions"
"""The only table a hand search reads: it is the one with a row per decision."""


@dataclass(frozen=True, slots=True)
class HandRef:
    """One decision that matched: the hand to open and the seat that made it."""

    hand_uid: str
    seat: int


def hand_search_sql(
    search: HandSearch, tenant_id: int, reg: Registry | None = None
) -> tuple[str, dict[str, Any]]:
    """(sql, parameters) for one search. `tenant_id` comes from the token, never the body."""
    reg = reg or registry()
    params = Params()
    compiler = Compiler(dims=reg.dimensions, table=DECISIONS, values=params, alias="s")
    try:
        filter_sql = compiler.node(search.filter)
    except RegistryError as exc:
        raise ReportError(str(exc)) from exc

    where, scalars = scope(search.as_report(), tenant_id, DECISIONS)
    if filter_sql != "1":
        where.append(f"({filter_sql})")
    scalars["limit"] = search.limit

    table = f"{get_settings().db('marts')}.{PHYSICAL[DECISIONS]}"
    sql = (
        # The mart stores the hand id as the 16 raw bytes; `core.*` and the API speak the
        # 32-character lowercase hex. Converting here keeps that difference inside the query.
        "SELECT lower(hex(s.hand_uid)) AS hand_uid, s.seat AS seat, "
        "max(s.played_at_utc) AS played_at_utc "
        f"FROM {table} AS s WHERE {' AND '.join(where)} "
        "GROUP BY hand_uid, seat "
        "ORDER BY played_at_utc DESC, hand_uid, seat "
        "LIMIT {limit:UInt32}"
    )
    return sql, {**scalars, **params.values}


def find_hands(
    search: HandSearch,
    tenant_id: int,
    *,
    run: Runner | None = None,
    reg: Registry | None = None,
) -> list[HandRef]:
    """The hands and seats that match, newest first. Never cached: the list is a browse."""
    runner = run or clickhouse_runner
    columns, rows = runner(*hand_search_sql(search, tenant_id, reg))
    index = {name: i for i, name in enumerate(columns)}
    return [HandRef(hand_uid=str(r[index["hand_uid"]]), seat=int(r[index["seat"]])) for r in rows]
