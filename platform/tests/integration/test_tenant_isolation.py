"""Tenant isolation — the test that must never be deleted.

This is the failure mode that ends analytics products: user A sees user B's hands. It does not
announce itself, it does not crash, and by the time anyone notices, the trust is gone.

So this test does not merely check that isolation works on the happy path. It **actively
tries to break it** — forged tenant ids in the payload, another tenant's upload id in the
path, tampered query parameters — and fails the build if any attempt succeeds.

Requires the stack: `make up && make seed`.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import ASGITransport, AsyncClient, Response

from api import cache
from api.main import app
from ingestion.cache import STATS_PREFIX
from stats.request import ReportRequest

pytestmark = pytest.mark.integration

TRANSPORT = ASGITransport(app=app)


async def _client() -> AsyncClient:
    return AsyncClient(transport=TRANSPORT, base_url="http://test")


async def _register(client: AsyncClient, email: str) -> str:
    res = await client.post(
        "/v1/auth/register",
        json={"email": email, "password": "a-long-enough-password", "display_name": "t"},
    )
    if res.status_code == 409:
        res = await client.post(
            "/v1/auth/login", json={"email": email, "password": "a-long-enough-password"}
        )
    assert res.status_code in (200, 201), res.text
    return str(res.json()["access_token"])


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


REPORT = ("POST", "/v1/reports/run")
"""The report engine: what `GET /v1/stats` was an adapter over until plan D.9a deleted it. An
empty body is the same question that route asked by default -- own hands, hero seat, no filter."""
WINNINGS = ("GET", "/v1/hero/winnings")
"""The winnings curve: the successor of `GET /v1/stats/timeline` (ADR-052)."""
FORGED_QUERY = "?user_id=1&tenant_id=1&player_key=pokerstars%3Ahero"


async def _ask(
    client: AsyncClient,
    route: tuple[str, str],
    query: str = "",
    headers: dict[str, str] | None = None,
) -> Response:
    """One call to a probed route; a POST carries the empty report document."""
    method, path = route
    body: dict[str, str] | None = {} if method == "POST" else None
    return await client.request(method, f"{path}{query}", json=body, headers=headers)


async def test_unauthenticated_requests_are_rejected() -> None:
    async with await _client() as c:
        for route in (REPORT, WINNINGS, ("GET", "/v1/hands"), ("GET", "/v1/uploads")):
            assert (await _ask(c, route)).status_code == 401, route


async def test_forged_bearer_token_is_rejected() -> None:
    async with await _client() as c:
        for bad in ("Bearer not-a-token", "Bearer " + "a" * 200):
            for route in (REPORT, WINNINGS):
                res = await _ask(c, route, headers={"Authorization": bad})
                assert res.status_code == 401, route


def _forget_cached_answers() -> None:
    """Drop every cached report and curve, so the next call is computed, not recalled.

    Both probed routes cache under the tenant in the token, never under anything the caller
    sends -- so without this the second of two calls is answered from the first one's entry and
    never reaches ClickHouse, and a forgery honoured in the query but not in the key would pass.
    The prefixes are read from the code that writes them. Safe to wipe: the integration conftest
    refuses to run against Redis database 0.
    """
    prefixes = {ReportRequest().cache_key(0).split(":", 1)[0], STATS_PREFIX}
    conn = cache.client()
    for prefix in prefixes:
        for key in conn.scan_iter(match=f"{prefix}:*", count=500):
            conn.delete(key)


async def test_tenant_cannot_be_supplied_in_the_query_string() -> None:
    """Passing `user_id`/`tenant_id` as a parameter must not change what comes back.

    FastAPI ignores unknown query parameters, so the risk is a future endpoint that reads one.
    This test locks the behaviour in now. Each call starts from an empty cache, so both answers
    come from ClickHouse (see `_forget_cached_answers`).
    """
    async with await _client() as c:
        token = await _register(c, "iso-a@example.com")
        for route in (REPORT, WINNINGS):
            _forget_cached_answers()
            forged = await _ask(c, route, FORGED_QUERY, headers=_auth(token))
            _forget_cached_answers()
            clean = await _ask(c, route, headers=_auth(token))
            assert clean.status_code == forged.status_code == 200, route
            assert clean.json()["hands"] == forged.json()["hands"], route


async def test_tenant_cannot_be_supplied_in_the_report_body() -> None:
    """The report route reads a body, so the body is the other place to forge a tenant in.

    `ReportRequest` forbids unknown fields: a tenant named there is refused, not ignored -- a
    silently dropped field is one refactor away from a silently obeyed one.
    """
    async with await _client() as c:
        token = await _register(c, "iso-body@example.com")
        for field in ("tenant_id", "user_id"):
            res = await c.post("/v1/reports/run", json={field: 1}, headers=_auth(token))
            assert res.status_code == 422 and "extra_forbidden" in res.text, field


async def test_a_fresh_tenant_sees_no_hands() -> None:
    """The demo tenant has hands; a brand-new tenant must see exactly zero."""
    async with await _client() as c:
        token = await _register(c, "iso-empty@example.com")
        stats = await _ask(c, REPORT, headers=_auth(token))
        assert stats.status_code == 200
        assert stats.json()["hands"] == 0

        hands = await c.get("/v1/hands", headers=_auth(token))
        assert hands.status_code == 200
        assert hands.json() == []

        winnings = await _ask(c, WINNINGS, headers=_auth(token))
        assert winnings.status_code == 200
        assert winnings.json()["hands"] == 0 and winnings.json()["points"] == []


async def test_cannot_read_another_tenants_hand_by_uid() -> None:
    """The strongest form: tenant B knows tenant A's hand_uid and asks for it directly."""
    async with await _client() as c:
        demo = await c.post(
            "/v1/auth/login",
            json={"email": "demo@example.com", "password": "demo-password-123"},
        )
        if demo.status_code != 200:
            pytest.skip("demo user not seeded; run `make seed`")
        demo_token = demo.json()["access_token"]

        listing = await c.get("/v1/hands?limit=1", headers=_auth(demo_token))
        rows = listing.json()
        if not rows:
            pytest.skip("no hands seeded; run `make seed`")
        stolen_uid = rows[0]["hand_uid"]

        # Sanity: the owner CAN read it.
        assert (
            await c.get(f"/v1/hands/{stolen_uid}", headers=_auth(demo_token))
        ).status_code == 200

        other = await _register(c, "iso-thief@example.com")
        res = await c.get(f"/v1/hands/{stolen_uid}", headers=_auth(other))
        # 404, not 403: the response must not confirm that the hand exists at all.
        assert res.status_code == 404


async def test_cannot_read_another_tenants_upload() -> None:
    async with await _client() as c:
        demo = await c.post(
            "/v1/auth/login",
            json={"email": "demo@example.com", "password": "demo-password-123"},
        )
        if demo.status_code != 200:
            pytest.skip("demo user not seeded; run `make seed`")
        uploads = await c.get("/v1/uploads", headers=_auth(demo.json()["access_token"]))
        rows = uploads.json()
        if not rows:
            pytest.skip("no uploads seeded")
        upload_id = rows[0]["upload_id"]

        other = await _register(c, "iso-thief2@example.com")
        res = await c.get(f"/v1/uploads/{upload_id}", headers=_auth(other))
        assert res.status_code == 404

        # A random UUID must behave identically — no timing or status difference that would
        # let an attacker distinguish "exists but not yours" from "does not exist".
        assert (await c.get(f"/v1/uploads/{uuid.uuid4()}", headers=_auth(other))).status_code == 404
