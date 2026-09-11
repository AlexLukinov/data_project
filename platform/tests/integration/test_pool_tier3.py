"""Tier 3, the empirical EQR, and the column both of them rest on (plan F.10).

Requires the stack (`make test-all`). The test pool is the eight-hand corpus, which is far
under every threshold on purpose: what these tests prove is that a question nobody has the data
for comes back as a count and a `false`, never as a number. The arithmetic itself is checked on
hand-worked samples in `tests/test_node_tier3.py`.

The last two tests are the contract between the registry and the built table: `invested_bb` is
a **new column** on `marts.decisions`, and until the chain is rebuilt every dimension that names
it compiles into SQL the table cannot answer. Its *values* are checked where the chain is built,
by the dbt test `assert_invested_bb_is_the_seats_own_chips`.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from analysis.pool.node_query import node_request
from analysis.pool.realization import MEASURES
from api.main import app
from core.settings import get_settings
from ingestion.clickhouse import clickhouse
from stats.ast import All, Leaf
from stats.registry import registry
from stats.service import run_report

pytestmark = pytest.mark.integration

TRANSPORT = ASGITransport(app=app)
CO_BET = {
    "hero_position": "CO",
    "villain_position": "BB",
    "street": "flop",
    "action_sequence": [
        {"position": "BB", "action": "check"},
        {"position": "CO", "action": "bet", "size_pct": 0.5},
    ],
}
PRIOR = {"AA": 1.0, "AKs": 1.0, "72o": 0.5}


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _new_user(client: AsyncClient) -> str:
    email = f"tier3-{uuid.uuid4().hex[:10]}@example.com"
    res = await client.post(
        "/v1/auth/register",
        json={"email": email, "password": "a-long-enough-password", "display_name": "t"},
    )
    assert res.status_code == 201, res.text
    return str(res.json()["access_token"])


async def _estimate(client: AsyncClient, token: str, body: dict[str, Any]) -> Any:
    return await client.post("/v1/pool/node/estimated-range", json=body, headers=_auth(token))


async def test_a_node_nobody_has_played_reconstructs_nothing() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token = await _new_user(c)
        res = await _estimate(c, token, {"node": CO_BET, "prior": PRIOR})
        assert res.status_code == 200, res.text

        body = res.json()
        assert body["tier"] == 3 and body["action"] == "bet"
        assert body["enough"] is False and body["classes"] == []
        assert body["observed_frequency"] is None and body["implied_frequency"] is None
        assert body["min_bucket_n"] >= body["min_n"]


async def test_the_eqr_question_is_refused_no_numbers_rather_than_zeros() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token = await _new_user(c)
        res = await c.post("/v1/pool/node/eqr", json=CO_BET, headers=_auth(token))
        assert res.status_code == 200, res.text

        body = res.json()
        assert body["enough"] is False
        assert body["overall"] is None and body["by_hand_class"] == []


async def test_a_node_with_no_action_of_its_own_is_refused_in_words() -> None:
    """Tier 3 explains one action; a key that names none has no question in it (ADR-028)."""
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token = await _new_user(c)
        silent = {"hero_position": "CO", "villain_position": "BB", "action_sequence": []}

        res = await _estimate(c, token, {"node": silent, "prior": PRIOR})
        assert res.status_code == 400 and "last step" in res.json()["detail"]

        eqr = await c.post("/v1/pool/node/eqr", json=silent, headers=_auth(token))
        assert eqr.status_code == 400

        facing = {**CO_BET, "action_sequence": [{"position": "BB", "action": "bet"}]}
        answered = await _estimate(c, token, {"node": facing, "prior": PRIOR})
        assert answered.status_code == 400 and "hero's own action" in answered.json()["detail"]


async def test_a_prior_that_is_not_a_range_is_refused() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token = await _new_user(c)
        for prior in ({"AXs": 1.0}, {"AA": -1.0}, {}):
            res = await _estimate(c, token, {"node": CO_BET, "prior": prior})
            assert res.status_code == 422, (prior, res.text)


async def test_another_users_cohort_cannot_scope_a_reconstruction() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        owner, stranger = await _new_user(c), await _new_user(c)
        regs = {"name": "regs", "criteria": {"rules": [{"stat": "vpip", "op": "lt", "value": 25}]}}
        made = await c.post("/v1/pool/cohorts", json=regs, headers=_auth(owner))
        assert made.status_code == 201, made.text
        cohort = made.json()["id"]

        url = f"/v1/pool/node/estimated-range?cohort_id={cohort}"
        body = {"node": CO_BET, "prior": PRIOR}
        assert (await c.post(url, json=body, headers=_auth(stranger))).status_code == 404
        assert (await c.post(url, json=body, headers=_auth(owner))).status_code == 200


def test_every_decision_dimension_the_registry_declares_is_a_real_column() -> None:
    """A dimension without its column answers with an empty result, not an error (F.10)."""
    settings = get_settings()
    rows = (
        clickhouse()
        .query(
            "SELECT name FROM system.columns WHERE database = {db:String} AND table = 'decisions'",
            parameters={"db": settings.db("marts")},
        )
        .result_rows
    )
    actual = {name for (name,) in rows}
    declared = {code for code, dim in registry().dimensions.items() if "decisions" in dim.tables}
    assert declared <= actual, sorted(declared - actual)
    assert "invested_bb" in actual


def test_the_eqr_measures_compile_against_the_built_table() -> None:
    """The two custom stats must survive the compiler, or every EQR answer is a 400.

    The integration marts are empty by design (this suite provisions its own), so the rows are
    not the point -- reaching ClickHouse without an UNKNOWN_IDENTIFIER is. That
    `invested_bb` holds the right *values* is the dbt test
    `assert_invested_bb_is_the_seats_own_chips`, which runs wherever the chain is built.
    """
    request = node_request(
        All(all=[Leaf(dim="street", op="eq", value="flop")]),
        ["hand_class"],
        None,
        custom=MEASURES,
    )
    result = run_report(request, tenant_id=1)
    assert result.stats and {stat.code for stat in result.stats} >= {"net_from_here", "pot_bb"}
