"""The replayer's endpoints end to end: paste, search, the pool list and the hero list.

Requires the stack (`make test-all`). The test marts are empty, so the search assertions are
about the query being valid and correctly scoped rather than about rows: what matters here is
that it compiles against the real `decisions` table and refuses what it should.
"""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

import psycopg
import pytest
from httpx import ASGITransport, AsyncClient

from api.main import app
from core.settings import get_settings
from ingestion import worker
from ingestion.clickhouse import clickhouse

pytestmark = pytest.mark.integration

CORPUS = Path(__file__).resolve().parents[1].parent / "seeds" / "hands"
TRANSPORT = ASGITransport(app=app)
GG_FILE = CORPUS / "ggpoker" / "rush_nl50.txt"


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _new_user(client: AsyncClient) -> str:
    email = f"hands-{uuid.uuid4().hex[:10]}@example.com"
    res = await client.post(
        "/v1/auth/register",
        json={"email": email, "password": "a-long-enough-password", "display_name": "h"},
    )
    assert res.status_code == 201, res.text
    return str(res.json()["access_token"])


def _tenant_of(user_uuid: str) -> int:
    """The numeric tenant id for a user UUID (test helper)."""
    with psycopg.connect(get_settings().postgres_libpq_dsn) as conn:
        row = conn.execute("SELECT tenant_id FROM users WHERE id = %s", (user_uuid,)).fetchone()
    assert row is not None
    return int(row[0])


def _one_hand() -> str:
    """The first hand of the GG corpus file, on its own."""
    text = GG_FILE.read_text(encoding="utf-8")
    return text.split("\n\nPoker Hand #")[0]


async def test_pasted_hand_comes_back_as_the_replayer_payload() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token = await _new_user(c)
        res = await c.post("/v1/hands/parse", json={"text": _one_hand()}, headers=_auth(token))
        assert res.status_code == 200, res.text
        hand: dict[str, Any] = res.json()

        assert hand["site"] == "ggpoker" and hand["site_hand_id"] == "RC1851234567"
        assert hand["stake_level"] == "NL50" and hand["big_blind"] == 0.5
        assert hand["board"] == ["8h", "5d", "2s"]
        assert len(hand["players"]) == 6 and len(hand["actions"]) == 13
        hero = next(p for p in hand["players"] if p["is_hero"])
        assert hero["position"] == "SB" and hero["hole_cards"] == "Qh Qs"

        # Nothing was stored: no hand to list, and no upload row (ADR-029).
        assert (await c.get("/v1/hands", headers=_auth(token))).json() == []
        assert (await c.get("/v1/uploads", headers=_auth(token))).json() == []


async def test_a_paste_that_is_not_one_good_hand_is_refused_in_words() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token = await _new_user(c)

        whole_file = GG_FILE.read_text(encoding="utf-8")
        many = await c.post("/v1/hands/parse", json={"text": whole_file}, headers=_auth(token))
        assert many.status_code == 422 and "2 hands" in many.json()["detail"]

        junk = await c.post("/v1/hands/parse", json={"text": "hello"}, headers=_auth(token))
        assert junk.status_code == 400
        assert "no registered hand-history format" in junk.json()["detail"]

        broken = _one_hand().replace("Rake $0.56", "Rake $5.56")
        bad = await c.post("/v1/hands/parse", json={"text": broken}, headers=_auth(token))
        assert bad.status_code == 422 and "does not reconcile" in bad.json()["detail"]


async def test_parse_needs_a_signed_in_user() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        assert (await c.post("/v1/hands/parse", json={"text": _one_hand()})).status_code == 401


async def test_search_compiles_against_the_decision_table() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token = await _new_user(c)
        body = {
            "dataset": "hero",
            "filter": {
                "all": [
                    {"dim": "street", "op": "eq", "value": "flop"},
                    {"dim": "action", "op": "eq", "value": "bet"},
                ]
            },
        }
        res = await c.post("/v1/hands/search", json=body, headers=_auth(token))
        assert res.status_code == 200, res.text
        assert res.json() == []  # the test marts are empty


async def test_search_refuses_a_dimension_the_decisions_table_does_not_have() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token = await _new_user(c)
        bad = {"filter": {"dim": "did_vpip", "op": "eq", "value": 1}}
        res = await c.post("/v1/hands/search", json=bad, headers=_auth(token))
        assert res.status_code == 400, res.text

        pool_with_hero = {"dataset": "population", "hero_only": True}
        res = await c.post("/v1/hands/search", json=pool_with_hero, headers=_auth(token))
        assert res.status_code == 422, res.text


def _decision(tenant_id: int, hand_uid: str, seat: int, street: str, action: str) -> None:
    """One row in the decision mart, enough for a search to find it.

    Written directly rather than through dbt: this test is about the search reading the mart
    correctly, and the mart's own build is covered by the ingest test and by `make seed`.
    """
    clickhouse().command(
        f"INSERT INTO {get_settings().db('marts')}.decisions "
        "(user_id, dataset, hand_uid, played_at_utc, played_date, seat, is_hero, street, action) "
        "VALUES ({tenant:UInt32}, 'hero', unhex({uid:String}), {at:DateTime64(3)}, "
        "{day:Date}, {seat:UInt8}, 1, {street:String}, {action:String})",
        parameters={
            "tenant": tenant_id,
            "uid": hand_uid,
            "at": "2026-01-16 14:22:31",
            "day": "2026-01-16",
            "seat": seat,
            "street": street,
            "action": action,
        },
    )


async def test_search_finds_the_hand_and_the_seat_that_made_the_decision() -> None:
    """The mart keys hands by 16 raw bytes and `core.*` by their hex; the search must bridge it."""
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token = await _new_user(c)
        me = (await c.get("/v1/auth/me", headers=_auth(token))).json()
        await c.post(
            "/v1/auth/poker-accounts",
            json={"site": "ggpoker", "screen_name": "Hero"},
            headers=_auth(token),
        )
        await c.post(
            "/v1/uploads",
            files={"file": ("rush_nl50.txt", GG_FILE.read_bytes(), "text/plain")},
            data={"site": "ggpoker"},
            headers=_auth(token),
        )
        worker.drain()
        listing = (await c.get("/v1/hands?limit=10", headers=_auth(token))).json()
        assert listing, "the upload must have produced hands to search for"
        wanted = listing[0]

        _decision(_tenant_of(me["id"]), wanted["hand_uid"], wanted["seat"], "flop", "bet")

        body = {"filter": {"all": [{"dim": "street", "op": "eq", "value": "flop"}]}}
        found = (await c.post("/v1/hands/search", json=body, headers=_auth(token))).json()
        # Since plan E.1b the worker derives the upload's own decisions into the mart, so the
        # flop holds real decisions beside the synthetic one; the bridge is proven by finding it.
        pairs = [(h["hand_uid"], h["seat"]) for h in found]
        assert (wanted["hand_uid"], wanted["seat"]) in pairs
        hit = found[pairs.index((wanted["hand_uid"], wanted["seat"]))]
        assert hit["board"] == wanted["board"] and hit["position"] == wanted["position"]


async def test_pool_hands_list_runs_and_is_scoped_to_the_pool() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token = await _new_user(c)
        res = await c.get("/v1/pool/hands?limit=5", headers=_auth(token))
        assert res.status_code == 200, res.text
        assert res.json() == []  # this tenant has uploaded no pool hands


async def test_my_hand_list_says_which_seat_to_open_on() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token = await _new_user(c)
        await c.post(
            "/v1/auth/poker-accounts",
            json={"site": "ggpoker", "screen_name": "Hero"},
            headers=_auth(token),
        )
        res = await c.post(
            "/v1/uploads",
            files={"file": ("rush_nl50.txt", GG_FILE.read_bytes(), "text/plain")},
            data={"site": "ggpoker"},
            headers=_auth(token),
        )
        assert res.status_code == 202, res.text
        assert worker.drain() >= 1

        listing = (await c.get("/v1/hands?limit=10", headers=_auth(token))).json()
        assert len(listing) == 2
        assert all(row["seat"] > 0 for row in listing)

        detail = (await c.get(f"/v1/hands/{listing[0]['hand_uid']}", headers=_auth(token))).json()
        seat = next(p for p in detail["players"] if p["seat"] == listing[0]["seat"])
        assert seat["is_hero"] is True


async def test_a_node_the_pool_has_never_played_says_so_rather_than_guessing() -> None:
    """The `min_n` gate, end to end: no numbers, only the count that fell short (spec §10.5)."""
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token = await _new_user(c)
        node = {
            "hero_position": "BTN",
            "villain_position": "UTG",
            "action_sequence": [
                {"position": "UTG", "action": "raise", "size_bb": 3},
                {"position": "BTN", "action": "raise", "size_bb": 9},
            ],
        }
        res = await c.post("/v1/pool/node/frequencies", json=node, headers=_auth(token))
        assert res.status_code == 200, res.text
        body = res.json()
        assert body == {
            "tier": 1,
            "sample_size": 0,
            "enough": False,
            "min_n": body["min_n"],
            "actions": {},
            "frequencies": {},
        }

        shown = await c.post("/v1/pool/node/showdown-range", json=node, headers=_auth(token))
        assert shown.status_code == 200, shown.text
        assert shown.json()["enough"] is False
        assert shown.json()["weights"] == {}


async def test_a_node_the_registry_cannot_express_is_refused() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token = await _new_user(c)
        bad = {"hero_position": "BTN", "street": "flop", "board_texture": ["soggy"]}
        res = await c.post("/v1/pool/node/frequencies", json=bad, headers=_auth(token))
        assert res.status_code == 400 and "unknown board texture" in res.json()["detail"]

        camel = {"heroPosition": "BTN"}
        assert (
            await c.post("/v1/pool/node/frequencies", json=camel, headers=_auth(token))
        ).status_code == 422
