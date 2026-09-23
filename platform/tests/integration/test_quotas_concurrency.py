"""Plan H.0, the live bug: one query too many at once is a worded 429, not a 500 (ADR-095).

One replayer step asks up to four questions against a per-account ceiling of four, and
ClickHouse's refusal of the next one (code 202, `TOO_MANY_SIMULTANEOUS_QUERIES`) reached the
browser as an unclassified 500 until `stats/tenancy.py` learned it. It is the budget working, so
it is a 429 that says when to come back.

Provoked for real rather than by patching the driver: the tenant is put on a one-query budget,
one query is held open on its own connection, and the API's report is the one too many. Its own
file because `test_quotas.py` is at the size ceiling; the account, row and budget helpers are
that file's.

Requires the stack: `make up && make test-all`.
"""

from __future__ import annotations

import asyncio
import contextlib
import threading
from collections.abc import Iterator
from dataclasses import replace

import pytest
from clickhouse_connect.driver.exceptions import DatabaseError
from httpx import AsyncClient

from core.settings import get_settings
from ingestion.clickhouse import clickhouse
from stats import tenancy
from stats.budget import STANDARD, profile_name, user_name
from tests.integration.test_quotas import ROWS, TRANSPORT, _account, _auth, _decisions, _narrow

pytestmark = pytest.mark.integration

# STANDARD with exactly one ceiling lowered: a second query at once is the replayer's "fifth".
ONE_AT_A_TIME = replace(STANDARD, name="h0_one_at_a_time", max_concurrent_queries=1)
HOLD_SECONDS = 3
"""How long the held query sleeps: long enough for the API's query to arrive while it runs."""
REACH_SERVER_POLLS = 40
REACH_SERVER_POLL_SECONDS = 0.05
"""How long, at most, the held query is given to show up in `system.processes` (two seconds)."""
LEAKS = ("SELECT", "decisions", "user_id", "Code:", "poker_tenant")
"""What a refusal's body must never carry: the SQL, its tables, the server's own text."""


@pytest.fixture
def narrowed() -> Iterator[list[int]]:
    """Tenants put on the one-query budget, dropped afterwards.

    Load-bearing: a cache miss runs `ensure_exists`, which keeps the tier a tenant is on, so a
    narrowed tenant does not heal on its next use; dropping its user and quota is what puts it
    back on the standard budget when it is next provisioned.
    """
    tenants: list[int] = []
    yield tenants
    for tenant_id in tenants:
        with contextlib.suppress(DatabaseError):
            tenancy.drop(tenant_id)
    with contextlib.suppress(DatabaseError):
        clickhouse().command(f"DROP SETTINGS PROFILE IF EXISTS {profile_name(ONE_AT_A_TIME)}")


async def _held_query_running(tenant_id: int) -> bool:
    """Whether the tenant's `sleep` query is running on the server right now, polled briefly."""
    name = user_name(get_settings().clickhouse_db_prefix, tenant_id)
    sql = "SELECT count() FROM system.processes WHERE user = {u:String} AND query LIKE '%sleep%'"
    for _ in range(REACH_SERVER_POLLS):
        rows = clickhouse().query(sql, parameters={"u": name}).result_rows
        if rows and rows[0][0]:
            return True
        await asyncio.sleep(REACH_SERVER_POLL_SECONDS)
    return False


def _hold(tenant_id: int) -> tuple[threading.Thread, list[Exception]]:
    """Start a thread holding one query open on the tenant's own connection.

    The connection is built here, on the calling thread, so the thread's first act is the query:
    a cache miss would run the access DDL and a handshake first, and the order the test relies on
    is then made deterministic by `_held_query_running` rather than by a pause.
    """
    client = tenancy.client_for(tenant_id)
    failures: list[Exception] = []

    def hold() -> None:
        try:
            client.query(f"SELECT sleep({HOLD_SECONDS})")
        except Exception as exc:  # reported after the join, whatever it is
            failures.append(exc)

    holder = threading.Thread(target=hold)
    holder.start()
    return holder, failures


async def test_one_query_too_many_at_once_is_a_worded_429_with_retry_after(
    narrowed: list[int],
) -> None:
    """The status says what happened, `Retry-After` says when, and the body leaks nothing."""
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token, tenant_id = await _account(c, "h0-at-once")
        narrowed.append(tenant_id)
        _decisions(tenant_id, ROWS)
        _narrow(tenant_id, ONE_AT_A_TIME)
        holder, failures = _hold(tenant_id)
        assert await _held_query_running(tenant_id), "the held query never reached the server"
        res = await c.post(
            "/v1/reports/run",
            json={"stats": ["cbet_flop"], "group_by": ["made_hand"]},
            headers=_auth(token),
        )
        holder.join()

    assert failures == [], failures
    assert res.status_code == 429, res.text
    assert res.headers.get("Retry-After"), res.headers
    assert res.json()["detail"] == tenancy.QUERIES_AT_ONCE
    for leak in LEAKS:
        assert leak not in res.text, leak
