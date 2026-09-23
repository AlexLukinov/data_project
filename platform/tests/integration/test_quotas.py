"""Per-tenant query budgets, enforced by ClickHouse itself (plan E.3, F-208, ADR-043).

**The load-bearing test is the first one, and what makes it load-bearing is what it does NOT
use.** It asks ClickHouse directly, on the tenant's own connection, with no FastAPI, no router
and no dependency in the call stack -- because a budget that only exists inside the API is not a
budget: the parser worker, a dbt run, a SQL prompt and any future service all reach the same
database by another road. If this test can be made to pass by an `if` in `api/`, it is worthless.

So it proves three separate things:

1. the refusal comes from the server (a ClickHouse error code, on a connection the API is not in);
2. it is **per tenant** -- the same query, at the same moment, still answers for the other tenant;
3. the ceiling cannot be raised from the client, because the server says it is fixed.

Then the quota half -- an hour's consumption rather than one query's cost -- and the HTTP
translation of a refusal. F-706's Redis-side request budgets are `test_rate_limits.py`.

Written in the E.3 session of 2026-09-11 with no access to the stack; first run on merge, where it
found a real bug (a reconnect re-tiered the tenant) and one in itself (`SELECT 1` is free against a
quota) -- both at the end of ADR-043. The first thing to check if it fails at `tenancy.ensure` is
whether the configured ClickHouse user may create users and `GRANT SELECT`: compose gives it that
with `CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: "1"`.

Requires the stack: `make up && make test-all`.
"""

from __future__ import annotations

import contextlib
import uuid
from collections.abc import Iterator
from dataclasses import replace
from datetime import UTC, date, datetime

import psycopg
import pytest
from clickhouse_connect.driver.exceptions import DatabaseError, ProgrammingError
from httpx import ASGITransport, AsyncClient

from api.main import app
from core.settings import get_settings
from ingestion.clickhouse import clickhouse
from stats import tenancy
from stats.budget import STANDARD, Budget, profile_name, user_name
from stats.request import ReportRequest, ReportResult
from stats.service import run_report

pytestmark = pytest.mark.integration

TRANSPORT = ASGITransport(app=app)

PASSWORD = "a-long-enough-password"
ROWS = 200
"""Comfortably more than `NARROW.max_rows_to_read`, and one insert, so one part."""

PLAYED_AT = datetime(2026, 1, 16, 14, 22, 31, tzinfo=UTC)
PLAYED_DAY = date(2026, 1, 16)
COLUMNS = [
    "user_id",
    "dataset",
    "hand_uid",
    "played_at_utc",
    "played_date",
    "seat",
    "is_hero",
    "street",
    "action",
]

# Both are STANDARD with exactly one ceiling lowered, so a refusal can only be that ceiling.
NARROW = replace(STANDARD, name="e3_narrow", max_rows_to_read=10)
# Small but not exact: a connection costs the driver a handshake query or two of its own, so the
# test loops until the quota refuses rather than counting to a magic number.
SHORT_HOUR = replace(STANDARD, name="e3_short_hour", queries_per_hour=5)

TEST_BUDGETS = (NARROW, SHORT_HOUR)
QUOTA_ATTEMPTS = 25
"""Bound on the exhaustion loop: `queries_per_hour` plus generous room for the handshake."""


@pytest.fixture
def provisioned() -> Iterator[list[int]]:
    """Tenants whose ClickHouse access objects this test made, dropped afterwards.

    Load-bearing, not tidiness: a cache miss runs `ensure_exists`, which deliberately keeps the
    tier a tenant is on (ADR-043's reconnect bug), so a narrowed tenant does **not** heal on its
    next use. Dropping the user and quota is what puts it back on the standard budget when it is
    next provisioned -- and a test that leaves server-side state behind is a test that passes for
    the wrong reason on the second run.
    """
    tenants: list[int] = []
    yield tenants
    admin = clickhouse()
    for tenant_id in tenants:
        with contextlib.suppress(DatabaseError):
            tenancy.drop(tenant_id)
    for budget in TEST_BUDGETS:
        with contextlib.suppress(DatabaseError):
            admin.command(f"DROP SETTINGS PROFILE IF EXISTS {profile_name(budget)}")


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _account(client: AsyncClient, tag: str) -> tuple[str, int]:
    """A fresh account and its numeric tenant id."""
    res = await client.post(
        "/v1/auth/register",
        json={
            "email": f"{tag}-{uuid.uuid4().hex[:10]}@example.com",
            "password": PASSWORD,
            "display_name": tag,
        },
    )
    assert res.status_code == 201, res.text
    token = str(res.json()["access_token"])
    me = (await client.get("/v1/auth/me", headers=_auth(token))).json()
    return token, _tenant_of(me["id"])


def _tenant_of(user_uuid: str) -> int:
    """The numeric tenant id for a user UUID (the helper every integration test uses)."""
    with psycopg.connect(get_settings().postgres_libpq_dsn) as conn:
        row = conn.execute("SELECT tenant_id FROM users WHERE id = %s", (user_uuid,)).fetchone()
    assert row is not None
    return int(row[0])


def _decisions(tenant_id: int, rows: int) -> None:
    """Rows in the decision mart for one tenant. One insert, so one part."""
    data = [
        (tenant_id, "hero", uuid.uuid4().bytes, PLAYED_AT, PLAYED_DAY, 1, 1, "flop", "bet")
        for _ in range(rows)
    ]
    clickhouse().insert(f"{get_settings().db('marts')}.decisions", data=data, column_names=COLUMNS)


def _narrow(tenant_id: int, budget: Budget) -> None:
    """Put a tenant on a budget now. `forget` because a profile is read at authentication."""
    tenancy.ensure(tenant_id, budget)
    tenancy.forget(tenant_id)


def _reads_rows(tenant_id: int) -> tuple[str, dict[str, int]]:
    """A query that must actually read rows -- `count()` alone is answered from metadata."""
    table = f"{get_settings().db('marts')}.decisions"
    return (
        f"SELECT sum(seat) FROM {table} WHERE user_id = {{t:UInt32}} AND dataset = 'hero'",
        {"t": tenant_id},
    )


def _report() -> ReportRequest:
    """A report the router must answer from `decisions`: `made_hand` is not on the rollup."""
    return ReportRequest(stats=["cbet_flop"], group_by=["made_hand"])


async def test_a_second_tenants_over_budget_query_is_rejected_by_clickhouse(
    provisioned: list[int],
) -> None:
    """The whole point of E.3, with the API deliberately absent from the call stack."""
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        _, first = await _account(c, "e3-a")
        _, second = await _account(c, "e3-b")
    provisioned += [first, second]
    _decisions(first, 5)
    _decisions(second, ROWS)
    _narrow(second, NARROW)

    sql, params = _reads_rows(second)
    with pytest.raises(DatabaseError) as raised:
        tenancy.client_for(second).query(sql, parameters=params)

    assert raised.value.code == tenancy.TOO_MANY_ROWS_OR_BYTES, raised.value
    # Per tenant, not per server: the same shape of query still answers for the first tenant,
    # on its own connection, at the same moment.
    own_sql, own_params = _reads_rows(first)
    assert tenancy.client_for(first).query(own_sql, parameters=own_params).result_rows


async def test_the_engine_runs_a_report_on_the_tenants_own_connection(
    provisioned: list[int],
) -> None:
    """The wiring, not just the DDL: `run_report`'s default runner must be the tenant's."""
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        _, generous = await _account(c, "e3-ok")
        _, narrowed = await _account(c, "e3-narrow")
    provisioned += [generous, narrowed]
    _decisions(narrowed, ROWS)
    _narrow(narrowed, NARROW)

    with pytest.raises(DatabaseError) as raised:
        run_report(_report(), tenant_id=narrowed, cache=None)
    assert raised.value.code == tenancy.TOO_MANY_ROWS_OR_BYTES, raised.value

    # The same report, same process, for a tenant on the standard budget: not raising is the
    # assertion -- it proves the narrowed tenant's refusal was the budget and not the query.
    assert isinstance(run_report(_report(), tenant_id=generous, cache=None), ReportResult)


async def test_a_tenant_cannot_raise_its_own_ceiling(provisioned: list[int]) -> None:
    """The server reports every capped setting as fixed, so the budget is not advisory."""
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        _, tenant_id = await _account(c, "e3-const")
    provisioned.append(tenant_id)
    client = tenancy.client_for(tenant_id)
    settings = get_settings()
    assert client.query("SELECT currentUser()").result_rows[0][0] == user_name(
        settings.clickhouse_db_prefix, tenant_id
    ), "the report connection must not be the admin user"

    rows = client.query(
        "SELECT name, readonly FROM system.settings WHERE name IN {names:Array(String)}",
        parameters={"names": list(STANDARD.query_settings())},
    ).result_rows
    # Every ceiling the server knows about must report as fixed. A subset, not equality: whether
    # a given knob appears in `system.settings` is the server's business, not this test's.
    assert {name for name, _ in rows} >= {
        "max_memory_usage",
        "max_execution_time",
        "max_rows_to_read",
        "max_result_rows",
    }
    assert all(readonly for _, readonly in rows), rows

    # The driver refuses before the wire too, which is defence and not the proof.
    with pytest.raises((ProgrammingError, DatabaseError)):
        client.query("SELECT 1", settings={"max_rows_to_read": 10**9})


async def test_the_hourly_quota_refuses_the_next_query_for_that_tenant_alone(
    provisioned: list[int],
) -> None:
    """A quota is consumption over time, which one query's ceiling cannot express.

    **The probe must read a table.** ClickHouse charges the `queries` counter for a query that
    goes through a storage; `SELECT 1` is folded to a constant and costs nothing, so a loop of
    them exhausts no quota however long it runs. Measured on 25.8: 25 `SELECT 1`s left the
    counter at 1 -- the one the driver's own handshake spends reading `system.settings` -- while
    a single read of a mart moved it. A health check is free, and that is worth knowing, but it
    cannot be what proves a quota works.
    """
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        _, spender = await _account(c, "e3-quota")
        _, other = await _account(c, "e3-quiet")
    provisioned += [spender, other]
    _decisions(spender, 5)
    _decisions(other, 5)
    _narrow(spender, SHORT_HOUR)

    sql, params = _reads_rows(spender)
    refusal = None
    for _ in range(QUOTA_ATTEMPTS):
        try:
            tenancy.client_for(spender).query(sql, parameters=params)
        except DatabaseError as exc:
            refusal = exc
            break
    assert refusal is not None, (
        f"{SHORT_HOUR.queries_per_hour}/hour survived {QUOTA_ATTEMPTS} tries"
    )
    assert refusal.code == tenancy.QUOTA_EXCEEDED, refusal

    quiet_sql, quiet_params = _reads_rows(other)
    assert tenancy.client_for(other).query(quiet_sql, parameters=quiet_params).result_rows


async def test_the_refusal_reaches_the_caller_as_a_status_that_leaks_nothing(
    provisioned: list[int],
) -> None:
    """The status says what happened; the body never repeats what the server said."""
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token, tenant_id = await _account(c, "e3-http")
        provisioned.append(tenant_id)
        _decisions(tenant_id, ROWS)
        _narrow(tenant_id, NARROW)

        res = await c.post(
            "/v1/reports/run",
            json={"stats": ["cbet_flop"], "group_by": ["made_hand"]},
            headers=_auth(token),
        )

    assert res.status_code == 400, res.text
    assert "budget" in res.json()["detail"]
    for leak in ("SELECT", "decisions", "user_id", "Code:"):
        assert leak not in res.text, leak
