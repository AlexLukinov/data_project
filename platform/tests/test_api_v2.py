"""The v2 API surface without a database: definitions, reports, and the winnings curve.

The authenticated user is injected through FastAPI's dependency overrides, the ClickHouse
runner is a fake that records every query, and the cache is disabled -- so these assert on
what the routes send to the engine and how they shape what comes back. The probes that used to
go through the v1 adapters (`/v1/stats*`, retired in plan D.9a) now go through their successors.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator, Mapping
from datetime import date
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from api.deps import CurrentUser, current_user
from api.main import app
from api.routers import hero as hero_router
from api.routers import reports as reports_router

TENANT = 7


class FakeRunner:
    """Answers by table name; records (sql, params) so tests can assert on tenancy."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def __call__(
        self, sql: str, params: Mapping[str, Any]
    ) -> tuple[list[str], list[tuple[Any, ...]]]:
        self.calls.append((sql, dict(params)))
        if "GROUP BY day" in sql:
            return ["day", "hands", "won_bb", "ev_bb", "sd_bb", "nsd_bb"], [
                ("2026-01-01", 100, 12.5, 10.0, 20.0, -7.5),
                ("2026-01-02", 50, -2.5, 1.0, -5.0, 2.5),
            ]
        if "GROUP BY position" in sql:
            return ["position", "vpip", "vpip__n", "__hands"], [("BTN", 30.0, 400, 400)]
        return ["vpip", "vpip__n", "hands", "hands__n", "__hands"], [(24.5, 1000, 1000, 1000, 1000)]


@pytest.fixture
def runner(monkeypatch: pytest.MonkeyPatch) -> FakeRunner:
    fake = FakeRunner()
    # `stats.tenancy.runner_for` is the one seam every read path resolves its runner through
    # (plan E.3), so patching it covers the engine, the analysis modules and the winnings curve
    # at once.
    monkeypatch.setattr("stats.tenancy.runner_for", lambda tenant_id: fake)
    monkeypatch.setattr(reports_router, "report_cache", lambda: None)
    monkeypatch.setattr(hero_router, "report_cache", lambda: None)
    return fake


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    app.dependency_overrides[current_user] = lambda: CurrentUser(
        id=uuid.uuid4(), tenant_id=TENANT, email="t@example.com"
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


async def test_definitions_serve_the_registry(client: AsyncClient) -> None:
    res = await client.get("/v1/definitions")
    assert res.status_code == 200, res.text
    body = res.json()
    assert len(body["stats"]) == 65 and len(body["dimensions"]) == 83
    vpip = next(s for s in body["stats"] if s["code"] == "vpip")
    assert vpip["label"] == "VPIP" and vpip["typical"] == [18.0, 28.0]
    assert vpip["action"] == {"dim": "did_vpip", "op": "eq", "value": 1}
    # `made_hand` is the evaluator's, filled at parse time (plan E.5, ADR-039); '' is a real
    # value in it — preflop, and wherever the cards were never shown — not a missing one.
    made = next(d for d in body["dimensions"] if d["code"] == "made_hand")
    assert made["tables"] == ["decisions"] and "" in made["values"]
    assert made["values"][1] == "straight_flush" and made["values"][-1] == "no_pair"
    spr = next(d for d in body["dimensions"] if d["code"] == "spr")
    assert spr["buckets"]["13+"] == [13.0, None] and "between" in spr["allowed_ops"]


async def test_run_report_is_tenant_scoped_and_typed(
    client: AsyncClient, runner: FakeRunner
) -> None:
    res = await client.post("/v1/reports/run", json={"stats": ["vpip"], "group_by": ["position"]})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["rows"][0]["group"] == {"position": "BTN"}
    assert body["rows"][0]["cells"]["vpip"] == {
        "value": 30.0,
        "n": 400,
        "baseline": None,
        "baseline_n": None,
        "delta": None,
        "interval": None,
    }
    assert body["stats"][0]["label"] == "VPIP"
    assert runner.calls[0][1]["tenant_id"] == TENANT


@pytest.mark.parametrize(
    ("body", "status_code", "message"),
    [
        ({"stats": ["nope"]}, 400, "unknown stat 'nope'"),
        ({"tenant_id": 1}, 422, "extra_forbidden"),
        (
            {"stats": ["vpip"], "filter": {"dim": "facing", "op": "eq", "value": "3bet"}},
            400,
            "not available for hand-grain stat 'vpip'",
        ),
        (
            {"filter": {"dim": "site", "op": "eq", "value": "'; DROP TABLE x; --"}},
            400,
            "not a value of 'site'",
        ),
        ({"dataset": "population"}, 422, "hero_only cannot be combined"),
    ],
)
async def test_bad_reports_are_named_not_executed(
    client: AsyncClient, runner: FakeRunner, body: dict[str, Any], status_code: int, message: str
) -> None:
    res = await client.post("/v1/reports/run", json=body)
    assert res.status_code == status_code, res.text
    assert message in res.text
    assert runner.calls == []


async def test_a_report_is_scoped_to_the_tenant_and_the_hero_seat_by_default(
    client: AsyncClient, runner: FakeRunner
) -> None:
    """The scoping `GET /v1/stats` was held to, asked of the route that replaced it."""
    site = {"dim": "site", "op": "in", "value": ["pokerstars"]}
    res = await client.post("/v1/reports/run", json={"stats": ["vpip", "hands"], "filter": site})
    assert res.status_code == 200, res.text
    assert res.json()["hands"] == 1000
    sql, params = runner.calls[-1]
    assert "s.site IN {p" in sql and ["pokerstars"] in params.values()
    assert params["tenant_id"] == TENANT and "s.is_hero = 1" in sql


async def test_a_report_binds_free_text_and_refuses_a_bad_enum(
    client: AsyncClient, runner: FakeRunner
) -> None:
    payload = "'; DROP TABLE core.hands; --"
    stake = {"dim": "stake_level", "op": "in", "value": [payload]}
    res = await client.post("/v1/reports/run", json={"filter": stake})
    assert res.status_code == 200, res.text
    sql, params = runner.calls[-1]
    assert payload not in sql and [payload] in params.values()
    site = {"dim": "site", "op": "in", "value": [payload]}
    res = await client.post("/v1/reports/run", json={"filter": site})
    assert res.status_code == 400 and "not a value of 'site'" in res.text
    assert len(runner.calls) == 1, "a refused filter must never reach ClickHouse"


async def test_the_winnings_curve_is_running_totals_of_the_heros_own_hands(
    client: AsyncClient, runner: FakeRunner
) -> None:
    res = await client.get("/v1/hero/winnings?date_from=2026-01-01")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["hands"] == 150
    assert body["points"] == [
        {"day": "2026-01-01", "hands": 100, "cumulative_net_bb": 12.5, "cumulative_ev_bb": 10.0,
         "cumulative_showdown_bb": 20.0, "cumulative_nonshowdown_bb": -7.5},
        {"day": "2026-01-02", "hands": 50, "cumulative_net_bb": 10.0, "cumulative_ev_bb": 11.0,
         "cumulative_showdown_bb": 15.0, "cumulative_nonshowdown_bb": -5.0},
    ]  # fmt: skip
    assert body["bb_per_100"] == round(100 * 10.0 / 150, 2)
    assert body["ev_bb_per_100"] == round(100 * 11.0 / 150, 2)
    sql, params = runner.calls[-1]
    assert "stats_daily" in sql and "GROUP BY day" in sql
    assert params["tenant_id"] == TENANT and params["dataset"] == "hero" and "s.is_hero = 1" in sql
    assert params["date_from"] == date(2026, 1, 1)


async def test_the_winnings_curve_cannot_be_pointed_at_another_tenant_or_the_pool(
    client: AsyncClient, runner: FakeRunner
) -> None:
    """The curve takes dates and nothing else: a forged scope is ignored, never obeyed."""
    forged = "tenant_id=1&user_id=1&dataset=population&hero_only=false&player_key=villain"
    res = await client.get(f"/v1/hero/winnings?{forged}")
    assert res.status_code == 200, res.text
    sql, params = runner.calls[-1]
    assert params == {"tenant_id": TENANT, "dataset": "hero"}
    assert "s.is_hero = 1" in sql and "player_key" not in sql


async def test_the_winnings_curve_refuses_a_backwards_range(
    client: AsyncClient, runner: FakeRunner
) -> None:
    res = await client.get("/v1/hero/winnings?date_from=2026-09-02&date_to=2026-09-01")
    assert res.status_code == 400 and "date_from is after date_to" in res.text
    assert runner.calls == []


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/v1/stats"),
        ("GET", "/v1/stats/timeline"),
        ("POST", "/v1/stats/custom"),
        ("GET", "/"),
        ("GET", "/static/index.html"),
    ],
)
async def test_the_retired_v1_surface_is_gone(
    client: AsyncClient, runner: FakeRunner, method: str, path: str
) -> None:
    """Plan D.9a (ADR-052): the v1 adapters and the static dashboard are deleted, not hidden."""
    res = await client.request(method, path)
    assert res.status_code == 404, res.text
    assert runner.calls == []


async def test_unauthenticated_requests_are_rejected() -> None:
    app.dependency_overrides.clear()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        assert (await c.get("/v1/definitions")).status_code == 401
        assert (await c.post("/v1/reports/run", json={})).status_code == 401
        assert (await c.get("/v1/saved/reports")).status_code == 401
        assert (await c.get("/v1/hero/winnings")).status_code == 401


async def test_a_confidence_level_travels_the_wire_with_no_adapter(
    client: AsyncClient, runner: FakeRunner
) -> None:
    """`POST /v1/reports/run` gains intervals for free: the body IS the engine's request.

    The route declares `ReportRequest` in and `ReportResult` out, so plan E.2 added a field to
    each model and nothing in `api/` at all -- the layering (ADR-023) doing its job.
    """
    res = await client.post(
        "/v1/reports/run",
        json={"stats": ["vpip"], "group_by": ["position"], "confidence": 95},
    )
    assert res.status_code == 200, res.text
    interval = res.json()["rows"][0]["cells"]["vpip"]["interval"]
    # Wilson on 30% of 400 opportunities: (25.72, 34.66), and the n comes with it.
    assert interval == {"low": 25.72, "high": 34.66, "n": 400, "level": 95, "method": "wilson"}


async def test_a_confidence_level_outside_the_offered_set_is_a_422(client: AsyncClient) -> None:
    res = await client.post("/v1/reports/run", json={"stats": ["vpip"], "confidence": 97})
    assert res.status_code == 422, res.text
