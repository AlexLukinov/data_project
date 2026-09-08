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
from httpx import ASGITransport, AsyncClient

from api.main import app

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


async def test_unauthenticated_requests_are_rejected() -> None:
    async with await _client() as c:
        for path in ("/v1/stats", "/v1/stats/timeline", "/v1/hands", "/v1/uploads"):
            assert (await c.get(path)).status_code == 401, path


async def test_forged_bearer_token_is_rejected() -> None:
    async with await _client() as c:
        for bad in ("Bearer not-a-token", "Bearer " + "a" * 200):
            res = await c.get("/v1/stats", headers={"Authorization": bad})
            assert res.status_code == 401


async def test_tenant_cannot_be_supplied_in_the_query_string() -> None:
    """Passing `user_id`/`tenant_id` as a parameter must not change what comes back.

    FastAPI ignores unknown query parameters, so the risk is a future endpoint that reads one.
    This test locks the behaviour in now.
    """
    async with await _client() as c:
        token = await _register(c, "iso-a@example.com")
        clean = await c.get("/v1/stats", headers=_auth(token))
        forged = await c.get(
            "/v1/stats?user_id=1&tenant_id=1&player_key=pokerstars%3Ahero",
            headers=_auth(token),
        )
        assert clean.status_code == forged.status_code == 200
        assert clean.json()["hands"] == forged.json()["hands"]


async def test_a_fresh_tenant_sees_no_hands() -> None:
    """The demo tenant has hands; a brand-new tenant must see exactly zero."""
    async with await _client() as c:
        token = await _register(c, "iso-empty@example.com")
        stats = await c.get("/v1/stats", headers=_auth(token))
        assert stats.status_code == 200
        assert stats.json()["hands"] == 0

        hands = await c.get("/v1/hands", headers=_auth(token))
        assert hands.status_code == 200
        assert hands.json() == []

        timeline = await c.get("/v1/stats/timeline", headers=_auth(token))
        assert timeline.json()["total_hands"] == 0


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
