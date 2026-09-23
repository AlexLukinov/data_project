"""How a pool route is told which players to ask about (plan G.4, ADR-080).

Without a database: the user is injected, the ClickHouse runner is a fake that records the
SQL, and the cache is off -- so these assert on the cohort subquery a key turns into, and on
the sentences a wrong key earns.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator, Mapping
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from node_fakes import frequency_answer, is_frequencies_query

from api.deps import CurrentUser, current_user
from api.main import app
from api.routers import pool as pool_router
from api.routers import pool_nodes as nodes_router

TENANT = 7
POOL: dict[str, Any] = {"dataset": "population", "hero_only": False, "stats": ["vpip"]}
"""What the pool page sends (`pool/stats.ts#poolRequest`): the dataset and `hero_only` set."""
BB_DEFENDS = {
    "hero_position": "BB",
    "villain_position": "BTN",
    "action_sequence": [{"position": "BTN", "action": "raise", "size_bb": 2.5}],
}


class FakeRunner:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def __call__(self, sql: str, params: Mapping[str, Any]) -> tuple[list[str], list[Any]]:
        self.calls.append((sql, dict(params)))
        if is_frequencies_query(sql):
            return frequency_answer({"fold": 600, "call": 400})
        return ["position", "vpip", "vpip__n", "__hands"], [("BB", 30.0, 400, 400)]


@pytest.fixture
def runner(monkeypatch: pytest.MonkeyPatch) -> FakeRunner:
    fake = FakeRunner()
    monkeypatch.setattr("stats.tenancy.runner_for", lambda tenant_id: fake)
    monkeypatch.setattr(pool_router, "report_cache", lambda: None)
    monkeypatch.setattr(nodes_router, "report_cache", lambda: None)
    return fake


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    app.dependency_overrides[current_user] = lambda: CurrentUser(
        id=uuid.uuid4(), tenant_id=TENANT, email="t@example.com"
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


async def test_the_presets_carry_the_seven_labels_and_the_five_groups(client: AsyncClient) -> None:
    res = await client.get("/v1/pool/presets")
    assert res.status_code == 200, res.text
    body = res.json()
    assert [c["code"] for c in body["cohorts"]] == [
        "reg",
        "reg_m",
        "mid",
        "fish",
        "reg_s",
        "mid_s",
        "fish_s",
    ]
    assert all(c["group"] in {"reg", "other", "fish", "unknown"} for c in body["cohorts"])
    assert [g["key"] for g in body["groups"]] == ["all", "reg", "other", "fish", "unknown"]
    assert next(g for g in body["groups"] if g["key"] == "all")["cohorts"] == [
        c["code"] for c in body["cohorts"]
    ]


async def test_a_preset_key_scopes_a_pool_report_without_saving_it(
    client: AsyncClient, runner: FakeRunner
) -> None:
    res = await client.post(
        "/v1/pool/stats?cohort=preset:reg", json={**POOL, "group_by": ["position"]}
    )
    assert res.status_code == 200, res.text
    sql, params = runner.calls[-1]
    assert "s.player_key IN (SELECT c.player_key FROM" in sql
    assert " < {p0:Float64} AND sum(c.hands) >= {p1:Float64}" in sql
    assert params["p0"] == 25 and params["p1"] == 1000


async def test_a_group_key_scopes_a_node_answer_to_the_union(
    client: AsyncClient, runner: FakeRunner
) -> None:
    res = await client.post("/v1/pool/node/frequencies?cohort=group:unknown", json=BB_DEFENDS)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["enough"] is True and body["intervals"]["fold"]["method"] == "cluster"
    assert body["players"] == 100 and body["min_players"] == 30
    sql, _ = runner.calls[-1]
    assert sql.count(") OR (") == 2 and "s.player_key_norm IN (SELECT c.player_key" in sql


async def test_the_whole_field_is_no_cohort_at_all(client: AsyncClient, runner: FakeRunner) -> None:
    for key in ("", "group:all"):
        res = await client.post(f"/v1/pool/node/frequencies?cohort={key}", json=BB_DEFENDS)
        assert res.status_code == 200, res.text
        assert "SELECT c.player_key" not in runner.calls[-1][0]


async def test_a_key_that_names_nothing_is_a_400_that_says_what_would(client: AsyncClient) -> None:
    res = await client.post("/v1/pool/node/frequencies?cohort=regs", json=BB_DEFENDS)
    assert res.status_code == 400 and "preset:<code> nor group:<key>" in res.json()["detail"]
    res = await client.post("/v1/pool/node/frequencies?cohort=preset:regs", json=BB_DEFENDS)
    assert res.status_code == 400 and "the presets are: reg, reg_m" in res.json()["detail"]
    res = await client.post("/v1/pool/node/eqr?cohort=group:whales", json=BB_DEFENDS)
    assert res.status_code == 400 and "the groups are: all, reg" in res.json()["detail"]


async def test_two_names_for_the_same_players_is_a_400_not_a_choice(client: AsyncClient) -> None:
    url = f"/v1/pool/node/showdown-range?cohort_id={uuid.uuid4()}&cohort=preset:reg"
    res = await client.post(url, json=BB_DEFENDS)
    assert res.status_code == 400 and "not both" in res.json()["detail"]


async def test_a_body_cohort_and_a_query_cohort_is_a_400_not_an_override(
    client: AsyncClient, runner: FakeRunner
) -> None:
    inline = {"rules": [{"stat": "vpip", "op": "gte", "value": 35}]}
    res = await client.post("/v1/pool/stats?cohort=preset:reg", json={**POOL, "cohort": inline})
    assert res.status_code == 400 and "pick one" in res.json()["detail"]
    # Either alone is fine.
    assert (await client.post("/v1/pool/stats", json={**POOL, "cohort": inline})).status_code == 200
