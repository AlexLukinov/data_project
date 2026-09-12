"""The API's request budgets, against the real Redis (plan E.3's F-706 half, ADR-043).

The other half of E.3 is in `test_quotas.py` and is about the cost of a *query*, enforced by
ClickHouse. This is about the number of *requests*, enforced here, and the two are deliberately
different mechanisms: this one is cheap, fails open and can be evicted, which is fine for
fairness and would not be for accounting.

Two axes, because they are keyed differently and for different reasons:

- the **unauthenticated** auth routes are keyed on the client address, since there is no tenant
  yet -- that is what the request is for;
- the **analytics** routes are keyed on the tenant from the token, because one tenant behind a
  shared address would otherwise throttle another, and one tenant across many addresses would
  not be throttled at all.

**NOT YET RUN.** Written in the E.3 session of 2026-09-11, which deliberately had no access to
the stack. Run it with `make up && make seed && make test-all`.

Requires the stack: `make up && make test-all`.
"""

from __future__ import annotations

import contextlib
import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from api import cache, ratelimit
from api.main import app
from core.settings import get_settings

pytestmark = pytest.mark.integration

TRANSPORT = ASGITransport(app=app)
PASSWORD = "a-long-enough-password"


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _token(client: AsyncClient, tag: str) -> str:
    res = await client.post(
        "/v1/auth/register",
        json={
            "email": f"{tag}-{uuid.uuid4().hex[:10]}@example.com",
            "password": PASSWORD,
            "display_name": tag,
        },
    )
    assert res.status_code == 201, res.text
    return str(res.json()["access_token"])


def _clear_limiter_keys() -> None:
    """Drop every rate-limit counter.

    These are real keys shared with every other test in the session, so a test that lowers a
    limit has to start from a known count and leave one behind. Safe to wipe: the integration
    conftest refuses to run against Redis database 0.
    """
    with contextlib.suppress(Exception):
        conn = cache.client()
        for key in conn.scan_iter(match="ratelimit:*", count=500):
            conn.delete(key)


async def test_auth_endpoints_return_429_past_the_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    """The credential surface, which is the half the plan's "Done means" names.

    The budget is raised to 1000 for the suite (`TEST_ENV` in the Makefile, and the same value in
    CI) because the whole suite signs in from one address; this lowers it for one test and
    `monkeypatch` puts it back.
    """
    monkeypatch.setattr(get_settings(), "auth_rate_limit_per_minute", 2)
    _clear_limiter_keys()
    wrong = {"email": "e3-nobody@example.com", "password": PASSWORD}
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        answers = [await c.post("/v1/auth/login", json=wrong) for _ in range(4)]
    _clear_limiter_keys()

    statuses = [res.status_code for res in answers]
    assert statuses[:2] == [401, 401], statuses
    assert statuses[2:] == [429, 429], statuses
    # A 429 without this is a client guessing when to come back.
    assert answers[-1].headers["Retry-After"] == str(ratelimit.WINDOW_SECONDS)


async def test_refreshing_does_not_spend_the_sign_in_budget(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Separate buckets per route family: a tab open all day is not credential stuffing.

    `/v1/auth/refresh` is unauthenticated and was unlimited before E.3, so it both needed a
    budget and could not be given sign-in's.
    """
    monkeypatch.setattr(get_settings(), "auth_rate_limit_per_minute", 2)
    _clear_limiter_keys()
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        refusals = [await c.post("/v1/auth/refresh") for _ in range(4)]
        after = await c.post(
            "/v1/auth/login", json={"email": "e3-nobody@example.com", "password": PASSWORD}
        )
    _clear_limiter_keys()

    assert [res.status_code for res in refusals] == [401, 401, 429, 429]
    assert after.status_code == 401, "signing in must still be possible"


async def test_one_tenants_request_budget_does_not_throttle_another(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The analytics limiter is keyed on the tenant, so a shared address is not a shared budget."""
    monkeypatch.setattr(ratelimit, "TENANT_REQUESTS_PER_MINUTE", 2)
    _clear_limiter_keys()
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        busy, quiet = await _token(c, "e3-busy"), await _token(c, "e3-calm")
        statuses = [(await c.get("/v1/stats", headers=_auth(busy))).status_code for _ in range(3)]
        untouched = await c.get("/v1/stats", headers=_auth(quiet))
    _clear_limiter_keys()

    assert statuses == [200, 200, 429], statuses
    assert untouched.status_code == 200, untouched.text
