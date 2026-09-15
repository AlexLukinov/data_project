"""The hero and pool routes without a database: shapes, tenancy, and the 400s.

The user is injected, the ClickHouse runner is a fake that answers by the shape of the SQL,
the cache is off. Cohort persistence (Postgres) is covered by the integration suite.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import AsyncIterator, Mapping
from datetime import UTC, datetime
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from analysis.pool.baselines import PopulationBaseline
from api.deps import CurrentUser, current_user
from api.main import app
from api.routers import hero as hero_router
from api.routers import pool as pool_router

TENANT = 7


class FakeRunner:
    """One row per query: group keys as 'x', every stat 20.0 over 1,000, sessions canned."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def __call__(
        self, sql: str, params: Mapping[str, Any]
    ) -> tuple[list[str], list[tuple[Any, ...]]]:
        self.calls.append((sql, dict(params)))
        if "GROUP BY session_no" in sql:
            start = datetime(2026, 8, 20, 18, 0, tzinfo=UTC)
            end = datetime(2026, 8, 20, 19, 0, tzinfo=UTC)
            return (
                ["session_no", "started_at", "ended_at", "hand_count", "net_total", "ev_total",
                 "site_list", "stake_list"],
                [(1, start, end, 120, 12.5, 10.0, ["pokerstars"], ["NL50"])],
            )  # fmt: skip
        # The report's own GROUP BY is the one after the FROM alias; the fresh-rollup
        # prologue (ADR-047) groups its stamp subqueries by (dataset, day) before it.
        grouped = re.search(r"GROUP BY (.+?) ORDER BY", sql.rsplit(" AS s WHERE", 1)[-1])
        keys = grouped.group(1).split(", ") if grouped else []
        codes = re.findall(r" AS ([a-z0-9_]+)__n", sql)
        columns = [*keys, *[c for code in codes for c in (code, f"{code}__n")], "__hands"]
        value = 20.0 if params["dataset"] == "hero" else 25.0
        row = ["x"] * len(keys) + [v for _ in codes for v in (value, 1000)] + [1000]
        return columns, [tuple(row)]


@pytest.fixture
def runner(monkeypatch: pytest.MonkeyPatch) -> FakeRunner:
    fake = FakeRunner()
    # One seam for all three: since plan E.3 the engine, the cohort query and the session query
    # all resolve their default runner through `stats.tenancy.runner_for`, and each imports the
    # module rather than the function so this patch reaches every one of them.
    monkeypatch.setattr("stats.tenancy.runner_for", lambda tenant_id: fake)
    monkeypatch.setattr(hero_router, "report_cache", lambda: None)
    monkeypatch.setattr(hero_router, "baseline_provider", lambda: PopulationBaseline(run=fake))
    monkeypatch.setattr(pool_router, "report_cache", lambda: None)
    return fake


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    user = CurrentUser(id=uuid.uuid4(), tenant_id=TENANT, email="t@example.com")
    app.dependency_overrides[current_user] = lambda: user
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


async def test_hero_leaks_are_ranked_and_tenant_scoped(
    client: AsyncClient, runner: FakeRunner
) -> None:
    res = await client.get("/v1/hero/leaks?min_n=500")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["hands"] == 1000 and body["min_n"] == 500 and body["skipped"] == []
    top = body["leaks"][0]
    assert top["value"] == 20.0 and top["baseline"] == 25.0 and top["delta"] == -5.0
    assert top["direction"] == "below" and top["n"] == 1000 and top["label"]
    assert all(params["tenant_id"] == TENANT for _, params in runner.calls)


async def test_hero_leaks_reject_a_bad_range(client: AsyncClient, runner: FakeRunner) -> None:
    res = await client.get("/v1/hero/leaks?date_from=2026-09-02&date_to=2026-09-01")
    assert res.status_code == 400 and "date_from is after date_to" in res.text


async def test_hero_sessions(client: AsyncClient, runner: FakeRunner) -> None:
    res = await client.get("/v1/hero/sessions?gap_minutes=20")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["gap_minutes"] == 20 and body["hands"] == 120
    assert body["sessions"][0]["minutes"] == 60 and body["sessions"][0]["bb_per_100"] == 10.42
    assert runner.calls[-1][1]["gap_seconds"] == 1200
    assert (await client.get("/v1/hero/sessions?gap_minutes=0")).status_code == 422


async def test_presets_are_served(client: AsyncClient, runner: FakeRunner) -> None:
    hero = await client.get("/v1/hero/presets")
    assert hero.status_code == 200 and hero.json()[0]["code"] == "preflop_overview"
    assert hero.json()[0]["request"]["compare_to"] == "population"
    pool = await client.get("/v1/pool/presets")
    assert pool.status_code == 200
    assert [c["code"] for c in pool.json()["cohorts"]] == ["regs", "fish"]
    assert "pool_by_position" in [r["code"] for r in pool.json()["reports"]]


async def test_pool_stats_read_the_population_only(client: AsyncClient, runner: FakeRunner) -> None:
    ok = await client.post(
        "/v1/pool/stats",
        json={"dataset": "population", "hero_only": False, "stats": ["vpip"]},
    )
    assert ok.status_code == 200 and ok.json()["rows"][0]["cells"]["vpip"]["value"] == 25.0
    bad = await client.post("/v1/pool/stats", json={"stats": ["vpip"]})
    assert bad.status_code == 400 and "population dataset" in bad.text


async def test_player_lookup_binds_the_prefix(client: AsyncClient, runner: FakeRunner) -> None:
    res = await client.get("/v1/pool/players?prefix=vil&limit=5")
    assert res.status_code == 200, res.text
    assert res.json()["group_by"] == ["player_key"]
    sql, params = runner.calls[-1]
    assert "startsWith(s.player_key, {p0:String})" in sql and params["p0"] == "vil"
    assert params["limit"] == 5
    assert (await client.get("/v1/pool/players")).status_code == 422
