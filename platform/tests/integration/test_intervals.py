"""Confidence intervals against a real ClickHouse (plan E.2, ADR-040).

What the unit tests cannot prove: that `stddevSamp` is a real aggregate over the real column
type, that the routing change actually lands the per-100 query on `marts.player_hands`, and
that the number coming back is the sample standard deviation of the per-hand amounts and not
something else that happens to be a float.

**NOT YET RUN.** Written in the E.2 session of 2026-09-11, which had no access to the stack --
a parallel session owned the database for the whole of it. Run it with
`make seed && make test-all` and tick plan step E.2 only then.

Requires the stack: `make up && make seed`.
"""

from __future__ import annotations

import math
import uuid
from typing import Any

import psycopg
import pytest
from httpx import ASGITransport, AsyncClient

from api.main import app
from core.settings import get_settings
from ingestion.clickhouse import clickhouse
from stats.interval import Z

pytestmark = pytest.mark.integration

TRANSPORT = ASGITransport(app=app)
LEVEL = 95
TOLERANCE = 5e-3
"""Both sides round to three decimals, so agreement is asserted to half a hundredth."""


async def _client() -> AsyncClient:
    return AsyncClient(transport=TRANSPORT, base_url="http://test")


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _account(client: AsyncClient) -> str:
    res = await client.post(
        "/v1/auth/register",
        json={
            "email": f"e2-{uuid.uuid4().hex[:10]}@example.com",
            "password": "a-long-enough-password",
            "display_name": "e2",
        },
    )
    assert res.status_code == 201, res.text
    token: str = res.json()["access_token"]
    return token


def _tenant_of(user_uuid: str) -> int:
    """The numeric tenant id for a user UUID (the helper every integration test uses)."""
    with psycopg.connect(get_settings().postgres_libpq_dsn) as conn:
        row = conn.execute("SELECT tenant_id FROM users WHERE id = %s", (user_uuid,)).fetchone()
    assert row is not None
    return int(row[0])


async def _cells(client: AsyncClient, token: str, stats: list[str]) -> dict[str, Any]:
    """One ungrouped row of the hero dataset at `LEVEL`, or a skip when nothing is seeded."""
    res = await client.post(
        "/v1/reports/run",
        json={"stats": stats, "confidence": LEVEL},
        headers=_auth(token),
    )
    assert res.status_code == 200, res.text
    rows = res.json()["rows"]
    if not rows or not rows[0]["hands"]:
        pytest.skip("no hands in the test databases; run `make seed` first")
    cells: dict[str, Any] = rows[0]["cells"]
    return cells


async def test_the_per_hundred_interval_arrives_and_is_symmetric() -> None:
    """`stddevSamp` runs, the band brackets the value, and it repeats the cell's own n."""
    async with await _client() as client:
        token = await _account(client)
        cell = (await _cells(client, token, ["bb_per_100"]))["bb_per_100"]
        interval = cell["interval"]
        assert interval is not None, "a per-100 stat with a level must carry an interval"
        assert interval["method"] == "normal" and interval["level"] == LEVEL
        assert interval["n"] == cell["n"], "the interval repeats the cell's own sample size"
        assert interval["low"] < cell["value"] < interval["high"]
        below = cell["value"] - interval["low"]
        above = interval["high"] - cell["value"]
        assert math.isclose(below, above, abs_tol=TOLERANCE), "a mean interval is symmetric"


async def test_the_half_width_is_the_standard_error_clickhouse_measured() -> None:
    """The API's band equals `100 * z * stddevSamp / sqrt(n)` read straight from the mart.

    The assertion that proves the number means what the module docstring says it means: the
    same spread, queried independently out of `marts.player_hands`, reproduces the bound.
    """
    async with await _client() as client:
        token = await _account(client)
        cell = (await _cells(client, token, ["bb_per_100"]))["bb_per_100"]
        me = (await client.get("/v1/auth/me", headers=_auth(token))).json()
        rows = (
            clickhouse()
            .query(
                "SELECT stddevSamp(net_won_bb), count() FROM "
                f"{get_settings().db('marts')}.player_hands "
                "WHERE user_id = {t:UInt32} AND dataset = 'hero' AND is_hero = 1",
                parameters={"t": _tenant_of(me["id"])},
            )
            .result_rows
        )
        sd, n = float(rows[0][0]), int(rows[0][1])
        assert n == cell["n"], "the report and the mart count the same hands"
        expected = 100.0 * Z[LEVEL] * sd / math.sqrt(n)
        measured = cell["interval"]["high"] - cell["value"]
        assert math.isclose(measured, expected, abs_tol=TOLERANCE)


async def test_a_proportion_keeps_the_rollup_and_still_gets_its_interval() -> None:
    """Wilson costs no extra column, so a cached proportion keeps the fast path."""
    async with await _client() as client:
        token = await _account(client)
        cell = (await _cells(client, token, ["vpip"]))["vpip"]
        interval = cell["interval"]
        assert interval is not None and interval["method"] == "wilson"
        assert 0.0 <= interval["low"] <= cell["value"] <= interval["high"] <= 100.0
        assert interval["n"] == cell["n"]


async def test_a_ratio_and_a_count_come_back_without_an_interval() -> None:
    """The formats that have no interval say so by omission, never by a fabricated band."""
    async with await _client() as client:
        token = await _account(client)
        cells = await _cells(client, token, ["af_flop", "hands"])
        assert cells["af_flop"]["interval"] is None
        assert cells["hands"]["interval"] is None
