"""One ClickHouse connection per tenant, under that tenant's own server-side budget (E.3).

`runner_for(tenant_id)` is what every report actually runs on. It hands back the same
`(sql, params) -> rows` callable the engine has always used, but bound to a ClickHouse user whose
settings profile and quota belong to that tenant, so an over-budget query is refused by the
server rather than by anything in this process. `stats/budget.py` holds the DDL and the numbers;
this module owns the connections, the once-per-process provisioning, and the translation of a
refusal into something an HTTP layer can return.

**Provisioning is lazy and idempotent.** The first query a tenant makes applies its DDL (as the
admin user) and caches the connection; every later query is a dictionary lookup. Nothing has to
happen at registration, so an account can be created while ClickHouse is down.

**If provisioning fails the query still runs, on the shared admin connection, and says so
loudly.** A budget is a fairness mechanism, not the tenant-isolation boundary -- isolation is the
`user_id` filter in `stats/query.py`, which is unchanged and untouched by any of this -- so
refusing every report because the access DDL was rejected would trade a small problem for an
outage. The integration suite asserts that enforcement is live, which is what stops the
fallback from becoming the silent normal.

**First-run caveat, deliberately written down.** The DDL needs the configured ClickHouse user to
be able to create users and to `GRANT SELECT`; compose grants that with
`CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: "1"` (docker-compose.yml). If the first run logs
"per-tenant ClickHouse budget unavailable", that grant is the thing to check first.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

import clickhouse_connect
from clickhouse_connect import common
from clickhouse_connect.driver.client import Client
from clickhouse_connect.driver.exceptions import DatabaseError

from core.settings import get_settings
from ingestion.clickhouse import clickhouse
from stats.budget import (
    STANDARD,
    Budget,
    drop_statements,
    password,
    shared_statements,
    statements,
    user_name,
)

log = logging.getLogger(__name__)

Rows = tuple[list[str], Sequence[Sequence[Any]]]
Runner = Callable[[str, Mapping[str, Any]], Rows]
StatementBuilder = Callable[[str, int, Budget, tuple[str, ...], str], tuple[str, ...]]
"""`statements` or `shared_statements` — the two that share this signature. `tier_statements`
deliberately does not: it is never sent on its own."""

MAX_CACHED_CLIENTS = 64
"""Connections kept alive. Each holds an HTTP pool, so the least recently added is closed past
this; a deployment with more concurrent tenants than this pays a reconnect, not a failure."""

GRANTED_DATABASES = ("marts",)
"""Every report query reads `marts` and nothing else (`stats/query.py`, `stats/timeline.py`,
`stats/hands.py`). `core` is deliberately absent: `api/hand_query.py` reads it on the admin
connection, and a grant added "just in case" is a privilege nobody asked for."""

SYSTEM_SETTINGS = "system.settings"
"""clickhouse-connect reads this once while building a client. Reading `system` needs no grant
under ClickHouse's defaults, but `select_from_system_db_requires_grant` can turn that off, so the
one table the driver needs is granted explicitly rather than left to a default."""

_clients: dict[int, Client] = {}

_provisioning = threading.Lock()
"""Held across a cache miss, because a report route is a plain `def` and FastAPI runs those in a
thread pool: two threads asking for the same new tenant would otherwise each build a connection
and one would be dropped on the floor still holding an HTTP pool. Only a miss takes it."""


@dataclass(frozen=True, slots=True)
class Rejection:
    """A ClickHouse refusal that is the budget working, mapped to how to answer the caller."""

    status_code: int
    detail: str
    clickhouse: str


QUOTA_EXCEEDED = 201
TOO_MANY_ROWS_OR_BYTES = 158
TIMEOUT_EXCEEDED = 159
MEMORY_LIMIT_EXCEEDED = 241
SETTING_CONSTRAINT_VIOLATION = 452

_TOO_BIG = (
    "This query reads more data than the account's budget allows. Narrow the date range or the "
    "filter, or group less finely."
)

REJECTIONS: dict[int, tuple[int, str]] = {
    QUOTA_EXCEEDED: (429, "The account's hourly query budget is spent; try again later."),
    TOO_MANY_ROWS_OR_BYTES: (400, _TOO_BIG),
    MEMORY_LIMIT_EXCEEDED: (400, _TOO_BIG),
    TIMEOUT_EXCEEDED: (504, "This query took longer than the account's budget allows."),
    SETTING_CONSTRAINT_VIOLATION: (400, "That query setting is fixed for this account."),
}
"""ClickHouse error code -> (HTTP status, message the caller may see).

The message never carries the server's own text: a ClickHouse exception body contains the SQL,
which names every table and column in it (`api/main.py` has made that mistake once already).
"""

NAMES = {
    QUOTA_EXCEEDED: "QUOTA_EXCEEDED",
    TOO_MANY_ROWS_OR_BYTES: "TOO_MANY_ROWS_OR_BYTES",
    TIMEOUT_EXCEEDED: "TIMEOUT_EXCEEDED",
    MEMORY_LIMIT_EXCEEDED: "MEMORY_LIMIT_EXCEEDED",
    SETTING_CONSTRAINT_VIOLATION: "SETTING_CONSTRAINT_VIOLATION",
}
"""The symbolic names, for the server-side log line and for tests to assert on."""


def rejection(exc: DatabaseError) -> Rejection | None:
    """Classify a driver error: a budget refusal, or None for anything else.

    None means "not ours" -- an unknown table, a syntax error, a server that is down -- and the
    caller must treat it as an internal error rather than telling the client it asked for too
    much.
    """
    code = getattr(exc, "code", None)
    if not isinstance(code, int) or code not in REJECTIONS:
        return None
    status_code, detail = REJECTIONS[code]
    return Rejection(status_code=status_code, detail=detail, clickhouse=NAMES[code])


def runner_for(tenant_id: int) -> Runner:
    """The report runner for one tenant: its own connection, its own budget."""

    def run(sql: str, params: Mapping[str, Any]) -> Rows:
        result = client_for(tenant_id).query(sql, parameters=dict(params))
        return list(result.column_names), result.result_rows

    return run


def client_for(tenant_id: int) -> Client:
    """The tenant's ClickHouse connection, provisioning it on first use.

    **Only the DDL falls back.** If the access objects cannot be created the query runs on the
    shared admin connection and says so loudly (see the module docstring). If they exist and the
    server then refuses the *connection*, that refusal propagates: a tenant whose quota is spent
    must be told so, and handing it an unbudgeted connection instead would make the quota a
    suggestion -- reconnect and the hour starts again.
    """
    existing = _clients.get(tenant_id)
    if existing is not None:
        return existing
    with _provisioning:
        return _provision_and_connect(tenant_id)


def _provision_and_connect(tenant_id: int) -> Client:
    """The cache miss, under `_provisioning`. Checked again: another thread may have won."""
    existing = _clients.get(tenant_id)
    if existing is not None:
        return existing
    try:
        ensure_exists(tenant_id)
    except DatabaseError as exc:
        log.error(
            "per-tenant ClickHouse budget unavailable for tenant %s, falling back to the shared "
            "connection: %s",
            tenant_id,
            exc,
        )
        return clickhouse()
    client = _connect(tenant_id)
    _evict_if_full()
    _clients[tenant_id] = client
    return client


def ensure(tenant_id: int, budget: Budget = STANDARD) -> None:
    """Apply one tenant's access objects and put it **on** `budget`.

    Idempotent; raises `DatabaseError` if refused. Call `forget` afterwards: a settings profile
    is read when the session authenticates, so an open connection keeps the ceiling it started
    with.
    """
    _apply(statements, tenant_id, budget)


def ensure_exists(tenant_id: int) -> None:
    """Make a tenant able to connect, without changing the tier it is already on.

    This is what a cache miss runs, and the distinction is the whole of it. `ensure` ends in
    `ALTER USER ... SETTINGS PROFILE`, so using it here put every tenant back on `STANDARD` the
    moment it next connected: a tier assignment survived only until the next reconnect, which
    made the tiers in `stats/budget.py` decorative. A tenant that does not exist yet has no tier
    to preserve, so it gets the full list.
    """
    if not exists(tenant_id):
        ensure(tenant_id)
        return
    _apply(shared_statements, tenant_id, STANDARD)


def exists(tenant_id: int) -> bool:
    """Whether this tenant's ClickHouse user has been created. One query, once per cache miss."""
    name = user_name(get_settings().clickhouse_db_prefix, tenant_id)
    rows = (
        clickhouse()
        .query("SELECT count() FROM system.users WHERE name = {n:String}", parameters={"n": name})
        .result_rows
    )
    return bool(rows and rows[0][0])


def _apply(builder: StatementBuilder, tenant_id: int, budget: Budget) -> None:
    """Send one of `stats/budget.py`'s statement lists on the admin connection."""
    settings = get_settings()
    grants = (*(f"{settings.db(name)}.*" for name in GRANTED_DATABASES), SYSTEM_SETTINGS)
    admin = clickhouse()
    for statement in builder(
        settings.clickhouse_db_prefix,
        tenant_id,
        budget,
        grants,
        settings.clickhouse_password,
    ):
        admin.command(statement)


def forget(tenant_id: int) -> None:
    """Drop the cached connection so the next query re-reads the tenant's budget.

    Needed after `ensure` changes a budget: the profile is read when the session authenticates,
    so an open connection keeps the ceiling it started with.
    """
    client = _clients.pop(tenant_id, None)
    if client is not None:
        client.close()


def drop(tenant_id: int) -> None:
    """Remove one tenant's user and quota. The integration suite's teardown."""
    forget(tenant_id)
    admin = clickhouse()
    for statement in drop_statements(get_settings().clickhouse_db_prefix, tenant_id):
        admin.command(statement)


def _connect(tenant_id: int) -> Client:
    """Authenticate as the tenant. Assumes `ensure` has already run for it."""
    settings = get_settings()
    name = user_name(settings.clickhouse_db_prefix, tenant_id)
    # As in `ingestion/clickhouse.py`: one session id per process serialises unrelated queries,
    # and two reads issued together then fail outright (plan F.9).
    common.set_setting("autogenerate_session_id", False)
    return clickhouse_connect.get_client(
        host=settings.clickhouse_host,
        port=settings.clickhouse_port,
        username=name,
        password=password(settings.clickhouse_password, name),
        query_limit=0,
    )


def _evict_if_full() -> None:
    """Close the oldest connection once the cache is full.

    `popitem` would take the newest -- dicts are LIFO there -- which evicts the connection most
    likely to be used again; the first key in insertion order is the one to drop.
    """
    while len(_clients) >= MAX_CACHED_CLIENTS:
        _clients.pop(next(iter(_clients))).close()
