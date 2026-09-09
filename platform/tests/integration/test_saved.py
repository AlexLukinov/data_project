"""Saved filters, reports and stats: round trips, validation, and the tenancy wall.

Requires the stack (`make test-all`): the rows live in the test Postgres database.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from api.main import app

pytestmark = pytest.mark.integration

TRANSPORT = ASGITransport(app=app)


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


REPORT = {
    "name": "Fold to c-bet by SPR",
    "definition": {
        "stats": ["fold_to_cbet_flop", "call_cbet_flop"],
        "group_by": ["spr"],
        "filter": {"dim": "position", "op": "in", "value": ["BTN", "CO"]},
    },
}


async def test_saved_report_round_trips_and_runs() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        auth = await _token(c, "saved-a@example.com")
        created = await c.post("/v1/saved/reports", json=REPORT, headers=auth)
        assert created.status_code == 201, created.text
        report_id = created.json()["id"]

        fetched = await c.get(f"/v1/saved/reports/{report_id}", headers=auth)
        assert fetched.status_code == 200
        definition = fetched.json()["definition"]
        assert definition["stats"] == REPORT["definition"]["stats"]
        assert definition["filter"] == REPORT["definition"]["filter"]
        assert definition["dataset"] == "hero" and definition["hero_only"] is True

        ran = await c.post("/v1/reports/run", json=definition, headers=auth)
        assert ran.status_code == 200, ran.text
        assert ran.json()["group_by"] == ["spr"]

        listed = await c.get("/v1/saved/reports", headers=auth)
        assert [r["id"] for r in listed.json()] == [report_id]

        duplicate = await c.post("/v1/saved/reports", json=REPORT, headers=auth)
        assert duplicate.status_code == 409

        renamed = await c.put(
            f"/v1/saved/reports/{report_id}", json={**REPORT, "name": "renamed"}, headers=auth
        )
        assert renamed.status_code == 200 and renamed.json()["name"] == "renamed"

        assert (await c.delete(f"/v1/saved/reports/{report_id}", headers=auth)).status_code == 204
        assert (await c.get(f"/v1/saved/reports/{report_id}", headers=auth)).status_code == 404


async def test_saved_documents_are_validated_on_the_way_in() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        auth = await _token(c, "saved-b@example.com")
        bad_report = {"name": "x", "definition": {"stats": ["vpip"], "group_by": ["facing"]}}
        res = await c.post("/v1/saved/reports", json=bad_report, headers=auth)
        assert res.status_code == 400 and "not available for hand-grain stat" in res.text

        bad_filter = {"name": "f", "ast": {"dim": "sprr", "op": "eq", "value": 1}}
        res = await c.post("/v1/saved/filters", json=bad_filter, headers=auth)
        assert res.status_code == 400 and "unknown dimension 'sprr'" in res.text

        deep_ip = {
            "all": [
                {"dim": "spr", "op": "gte", "value": 6},
                {"dim": "is_ip", "op": "eq", "value": 1},
            ]
        }
        good_filter = {"name": "deep IP", "ast": deep_ip}
        res = await c.post("/v1/saved/filters", json=good_filter, headers=auth)
        assert res.status_code == 201, res.text
        assert res.json()["ast"] == good_filter["ast"]

        count_all = {"code": "vpip", "grain": "hand", "format": "count"}
        shadow = {"code": "vpip", "definition": {**count_all, "numerator": {"count": True}}}
        res = await c.post("/v1/saved/stats", json=shadow, headers=auth)
        assert res.status_code == 400 and "shadows a built-in" in res.text

        good_stat = {
            "code": "limp_any",
            "label": "Limped at all",
            "definition": {
                "code": "limp_any",
                "grain": "decision",
                "numerator": {"countIf": {"dim": "action", "op": "eq", "value": "call"}},
                "denominator": {"countIf": {"dim": "street", "op": "eq", "value": "preflop"}},
            },
        }
        res = await c.post("/v1/saved/stats", json=good_stat, headers=auth)
        assert res.status_code == 201, res.text
        assert res.json()["definition"]["numerator"] == good_stat["definition"]["numerator"]


async def test_another_tenant_cannot_see_or_touch_saved_objects() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        owner = await _token(c, "saved-owner@example.com")
        thief = await _token(c, "saved-thief@example.com")
        created = await c.post(
            "/v1/saved/reports", json={**REPORT, "name": "private"}, headers=owner
        )
        assert created.status_code == 201, created.text
        report_id = created.json()["id"]

        assert (await c.get("/v1/saved/reports", headers=thief)).json() == []
        assert (await c.get(f"/v1/saved/reports/{report_id}", headers=thief)).status_code == 404
        assert (
            await c.put(f"/v1/saved/reports/{report_id}", json=REPORT, headers=thief)
        ).status_code == 404
        assert (await c.delete(f"/v1/saved/reports/{report_id}", headers=thief)).status_code == 404
        # A random id behaves identically: no way to tell "exists but not yours" apart.
        assert (await c.get(f"/v1/saved/reports/{uuid.uuid4()}", headers=thief)).status_code == 404
        assert (await c.get(f"/v1/saved/reports/{report_id}", headers=owner)).status_code == 200
