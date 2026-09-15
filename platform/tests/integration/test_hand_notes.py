"""Notes and tags on a hand, end to end (plan D.7b): the hand really in ClickHouse, the note
really in Postgres, and ownership really decided by `core.hands`.

Requires the stack (`make test-all`). `tests/postgres/test_hand_notes_pg.py` covers the store
and the routes with ownership faked; what is added here is the check that cannot be faked --
a hand another tenant ingested, and a hand nobody did, are both "not found" -- plus the tag
filter on a search that compiles against the real decision mart.
"""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

import psycopg
import pytest
from httpx import ASGITransport, AsyncClient

from api.db import session_factory
from api.main import app
from api.models_hand_notes import HandTag
from api.schemas_hand_notes import MAX_DISTINCT_TAGS
from core.settings import get_settings
from ingestion import worker
from ingestion.clickhouse import clickhouse

pytestmark = pytest.mark.integration

CORPUS = Path(__file__).resolve().parents[1].parent / "seeds" / "hands"
TRANSPORT = ASGITransport(app=app)
GG_FILE = CORPUS / "ggpoker" / "rush_nl50.txt"
NOTE = "the turn barrel into two callers was the mistake, not the 3-bet"


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _new_user(client: AsyncClient) -> str:
    email = f"notes-{uuid.uuid4().hex[:10]}@example.com"
    res = await client.post(
        "/v1/auth/register",
        json={"email": email, "password": "a-long-enough-password", "display_name": "n"},
    )
    assert res.status_code == 201, res.text
    return str(res.json()["access_token"])


async def _user_with_hands(client: AsyncClient) -> tuple[str, list[dict[str, Any]]]:
    """A fresh account with the two-hand GG corpus file ingested; (token, its hand list)."""
    token = await _new_user(client)
    await client.post(
        "/v1/auth/poker-accounts",
        json={"site": "ggpoker", "screen_name": "Hero"},
        headers=_auth(token),
    )
    res = await client.post(
        "/v1/uploads",
        files={"file": ("rush_nl50.txt", GG_FILE.read_bytes(), "text/plain")},
        data={"site": "ggpoker"},
        headers=_auth(token),
    )
    assert res.status_code == 202, res.text
    assert worker.drain() >= 1
    listing = (await client.get("/v1/hands?limit=10", headers=_auth(token))).json()
    assert len(listing) == 2, "the upload must have produced hands to annotate"
    return token, list(listing)


def _tenant_of(user_uuid: str) -> int:
    with psycopg.connect(get_settings().postgres_libpq_dsn) as conn:
        row = conn.execute("SELECT tenant_id FROM users WHERE id = %s", (user_uuid,)).fetchone()
    assert row is not None
    return int(row[0])


def _decision(tenant_id: int, hand_uid: str, seat: int) -> None:
    """One flop decision in the mart, so a search can find the hand (as `test_hands.py` does)."""
    clickhouse().command(
        f"INSERT INTO {get_settings().db('marts')}.decisions "
        "(user_id, dataset, hand_uid, played_at_utc, played_date, seat, is_hero, street, action) "
        "VALUES ({tenant:UInt32}, 'hero', unhex({uid:String}), {at:DateTime64(3)}, "
        "{day:Date}, {seat:UInt8}, 1, 'flop', 'bet')",
        parameters={
            "tenant": tenant_id,
            "uid": hand_uid,
            "at": "2026-01-16 14:22:31",
            "day": "2026-01-16",
            "seat": seat,
        },
    )


async def test_a_note_on_a_real_hand_survives_a_reload() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token, hands = await _user_with_hands(c)
        uid = hands[0]["hand_uid"]
        saved = await c.put(f"/v1/hands/{uid}/note", json={"body": NOTE}, headers=_auth(token))
        assert saved.status_code == 200, saved.text
        assert (await c.get(f"/v1/hands/{uid}/note", headers=_auth(token))).json()["body"] == NOTE


async def test_a_tag_added_on_one_hand_is_listed_on_the_hand_list() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token, hands = await _user_with_hands(c)
        tagged, plain = hands[0]["hand_uid"], hands[1]["hand_uid"]
        res = await c.post(f"/v1/hands/{tagged}/tags", json={"tag": "Bluff"}, headers=_auth(token))
        assert res.status_code == 200 and res.json()["tags"] == ["bluff"]

        listed = {
            r["hand_uid"]: r["tags"]
            for r in (await c.get("/v1/hands", headers=_auth(token))).json()
        }
        assert listed == {tagged: ["bluff"], plain: []}

        narrowed = (await c.get("/v1/hands?tag=bluff", headers=_auth(token))).json()
        assert [r["hand_uid"] for r in narrowed] == [tagged]
        assert (await c.get("/v1/hands?tag=nothing", headers=_auth(token))).json() == []


async def test_a_tag_filter_on_a_search_compiles_against_the_decision_mart() -> None:
    """`only_hand_uids` is unhexed into the mart's FixedString key; a wrong form finds nothing."""
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token, hands = await _user_with_hands(c)
        me = (await c.get("/v1/auth/me", headers=_auth(token))).json()
        tenant = _tenant_of(me["id"])
        for hand in hands:
            _decision(tenant, hand["hand_uid"], hand["seat"])
        await c.post(
            f"/v1/hands/{hands[1]['hand_uid']}/tags", json={"tag": "study"}, headers=_auth(token)
        )

        body = {"filter": {"all": [{"dim": "street", "op": "eq", "value": "flop"}]}}
        everything = (await c.post("/v1/hands/search", json=body, headers=_auth(token))).json()
        assert {r["hand_uid"] for r in everything} == {h["hand_uid"] for h in hands}

        found = (await c.post("/v1/hands/search?tag=study", json=body, headers=_auth(token))).json()
        assert [(r["hand_uid"], r["tags"]) for r in found] == [(hands[1]["hand_uid"], ["study"])]


async def test_another_tenants_hand_is_not_found_by_clickhouse_itself() -> None:
    """The real check: the hand exists, in `core.hands`, under someone else's `user_id`."""
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        _, hands = await _user_with_hands(c)
        uid = hands[0]["hand_uid"]
        stranger = await _new_user(c)
        for method, path, body in (
            ("GET", f"/v1/hands/{uid}/note", None),
            ("PUT", f"/v1/hands/{uid}/note", {"body": "mine now"}),
            ("POST", f"/v1/hands/{uid}/tags", {"tag": "stolen"}),
            ("DELETE", f"/v1/hands/{uid}/tags/stolen", None),
        ):
            res = await c.request(method, path, json=body, headers=_auth(stranger))
            assert res.status_code == 404, (method, path, res.text)


async def test_a_hand_that_does_not_exist_is_not_found() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token = await _new_user(c)
        unknown = "ab" * 16
        res = await c.put(f"/v1/hands/{unknown}/note", json={"body": NOTE}, headers=_auth(token))
        assert res.status_code == 404 and res.json()["detail"] == "Hand not found"


async def _seed_tags(user_id: str, hand_uid: str, count: int) -> None:
    """The first `count` distinct tags as rows: 500 POSTs would meet E.3's per-tenant budget
    (a 429 at request 300), which is that budget working rather than the cap under test."""
    async with session_factory()() as session:
        session.add_all(
            HandTag(user_id=uuid.UUID(user_id), hand_uid=hand_uid, tag=f"t{n}")
            for n in range(count)
        )
        await session.commit()


async def test_the_501st_distinct_tag_is_refused_in_words() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token, hands = await _user_with_hands(c)
        me = (await c.get("/v1/auth/me", headers=_auth(token))).json()
        url = f"/v1/hands/{hands[0]['hand_uid']}/tags"
        await _seed_tags(me["id"], hands[0]["hand_uid"], MAX_DISTINCT_TAGS - 1)
        last = await c.post(url, json={"tag": f"t{MAX_DISTINCT_TAGS - 1}"}, headers=_auth(token))
        assert last.status_code == 200, last.text  # the 500th distinct tag still fits
        refused = await c.post(url, json={"tag": "one too many"}, headers=_auth(token))
        assert refused.status_code == 422 and f"{MAX_DISTINCT_TAGS} distinct tags" in refused.text
        # A tag already in use is not new vocabulary, so it still goes on another hand.
        reused = await c.post(
            f"/v1/hands/{hands[1]['hand_uid']}/tags", json={"tag": "t1"}, headers=_auth(token)
        )
        assert reused.status_code == 200
