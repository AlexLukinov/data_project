"""Cohorts round-trip through Postgres and drive pool and hero reports; the tenancy wall.

Requires the stack (`make test-all`): cohort rows live in the test Postgres database and the
reports run against the empty test marts.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from api.main import app

pytestmark = pytest.mark.integration

TRANSPORT = ASGITransport(app=app)
REGS = {
    "name": "regs",
    "criteria": {
        "rules": [
            {"stat": "vpip", "op": "lt", "value": 25},
            {"stat": "hands", "op": "gte", "value": 1000},
        ]
    },
}
POOL_REQUEST = {"dataset": "population", "hero_only": False, "stats": ["vpip", "pfr"]}


async def _token(client: AsyncClient, email: str) -> dict[str, str]:
    res = await client.post(
        "/v1/auth/register",
        json={"email": email, "password": "a-long-enough-password", "display_name": "s"},
    )
    if res.status_code == 409:
        res = await client.post(
            "/v1/auth/login", json={"email": email, "password": "a-long-enough-password"}
        )
    assert res.status_code in (200, 201), res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def test_cohort_round_trip_and_reports_on_it() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        auth = await _token(c, "cohort-a@example.com")
        created = await c.post("/v1/pool/cohorts", json=REGS, headers=auth)
        assert created.status_code == 201, created.text
        cohort_id = created.json()["id"]
        assert created.json()["criteria"] == REGS["criteria"]

        listed = await c.get("/v1/pool/cohorts", headers=auth)
        assert [row["name"] for row in listed.json()] == ["regs"]

        detail = await c.get(f"/v1/pool/cohorts/{cohort_id}", headers=auth)
        assert detail.status_code == 200, detail.text
        assert detail.json()["players"] == 0  # the test marts are empty

        members = await c.get(f"/v1/pool/cohorts/{cohort_id}/members", headers=auth)
        assert members.status_code == 200 and members.json()["group_by"] == ["player_key"]

        stats = await c.post(
            f"/v1/pool/stats?cohort_id={cohort_id}", json=POOL_REQUEST, headers=auth
        )
        assert stats.status_code == 200, stats.text
        assert stats.json()["rows"] == [] and stats.json()["hands"] == 0

        leaks = await c.get(f"/v1/hero/leaks?cohort_id={cohort_id}", headers=auth)
        assert leaks.status_code == 200, leaks.text
        assert leaks.json()["leaks"] == [] and "vpip" in leaks.json()["skipped"]

        renamed = await c.put(
            f"/v1/pool/cohorts/{cohort_id}", json={**REGS, "name": "regs 1k"}, headers=auth
        )
        assert renamed.status_code == 200 and renamed.json()["name"] == "regs 1k"

        duplicate = await c.post("/v1/pool/cohorts", json={**REGS, "name": "regs 1k"}, headers=auth)
        assert duplicate.status_code == 409

        deleted = await c.delete(f"/v1/pool/cohorts/{cohort_id}", headers=auth)
        assert deleted.status_code == 204
        assert (await c.get(f"/v1/pool/cohorts/{cohort_id}", headers=auth)).status_code == 404


async def test_cohort_criteria_are_validated() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        auth = await _token(c, "cohort-v@example.com")
        bad = {"name": "x", "criteria": {"rules": [{"stat": "af_flop", "op": "gt", "value": 2}]}}
        res = await c.post("/v1/pool/cohorts", json=bad, headers=auth)
        assert res.status_code == 400 and "only cached stats" in res.text


async def test_cohorts_are_invisible_across_tenants() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        owner = await _token(c, "cohort-owner@example.com")
        other = await _token(c, "cohort-other@example.com")
        created = await c.post("/v1/pool/cohorts", json=REGS, headers=owner)
        cohort_id = created.json()["id"]
        for path in (f"/v1/pool/cohorts/{cohort_id}", f"/v1/pool/cohorts/{cohort_id}/members"):
            assert (await c.get(path, headers=other)).status_code == 404
        assert (
            await c.get(f"/v1/hero/leaks?cohort_id={cohort_id}", headers=other)
        ).status_code == 404
        stats = await c.post(
            f"/v1/pool/stats?cohort_id={cohort_id}", json=POOL_REQUEST, headers=other
        )
        assert stats.status_code == 404
        assert (await c.get("/v1/pool/cohorts", headers=other)).json() == []
        assert (await c.get(f"/v1/pool/cohorts/{uuid.uuid4()}", headers=owner)).status_code == 404


async def test_hero_sessions_on_an_empty_account() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        auth = await _token(c, "sessions@example.com")
        res = await c.get("/v1/hero/sessions", headers=auth)
        assert res.status_code == 200, res.text
        assert res.json() == {"gap_minutes": 30, "hands": 0, "net_bb": 0.0, "sessions": []}
