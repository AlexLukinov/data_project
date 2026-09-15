"""Notes on a hand over HTTP with a real Postgres and no ClickHouse (plan D.7b).

Ownership of a hand is decided against ClickHouse by `owned_hand`; here it is **overridden**
(`conftest.py`, `support.OWNED`) with a registry of who owns what, so the contract under test
is everything after that check: the migration, the store, the routes and their refusals. The
full path -- a hand really ingested, another tenant really refused by ClickHouse -- is
`tests/integration/test_hand_notes.py`. The tags are `test_hand_tags_pg.py`.

Requires the stack's Postgres; run as `conftest.py` describes.
"""

from __future__ import annotations

import asyncio
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any

import pytest
from httpx import AsyncClient

from api import hand_query
from api.schemas import HandSummary
from tests.postgres.support import HAND, OTHER_HAND, PASSWORD, TRANSPORT, auth, new_user

pytestmark = pytest.mark.integration

NOTE = "3-bet pre was fine; the turn barrel into two callers was not"


async def test_a_note_survives_a_reload_and_a_sign_out_and_in() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token, _ = await new_user(c, HAND)
        before = (await c.get(f"/v1/hands/{HAND}/note", headers=auth(token))).json()
        assert before == {"hand_uid": HAND, "body": "", "updated_at": None}

        saved = await c.put(f"/v1/hands/{HAND}/note", json={"body": NOTE}, headers=auth(token))
        assert saved.status_code == 200, saved.text
        assert saved.json()["body"] == NOTE and saved.json()["updated_at"] is not None

        again = (await c.get(f"/v1/hands/{HAND}/note", headers=auth(token))).json()
        assert again["body"] == NOTE

        # A fresh sign-in is a new token over the same rows.
        me = (await c.get("/v1/auth/me", headers=auth(token))).json()
        login = await c.post("/v1/auth/login", json={"email": me["email"], "password": PASSWORD})
        assert login.status_code == 200, login.text
        fresh = str(login.json()["access_token"])
        assert (await c.get(f"/v1/hands/{HAND}/note", headers=auth(fresh))).json()["body"] == NOTE


async def test_a_rewrite_replaces_the_note_and_a_blank_one_removes_it() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token, _ = await new_user(c, HAND)
        url = f"/v1/hands/{HAND}/note"
        await c.put(url, json={"body": NOTE}, headers=auth(token))
        rewritten = await c.put(url, json={"body": "  shorter  "}, headers=auth(token))
        assert rewritten.json()["body"] == "shorter"

        gone = await c.put(url, json={"body": "   \n"}, headers=auth(token))
        assert gone.status_code == 200 and gone.json() == {
            "hand_uid": HAND,
            "body": "",
            "updated_at": None,
        }
        assert (await c.get(url, headers=auth(token))).json()["body"] == ""


async def test_two_first_saves_of_the_same_note_at_once_both_succeed() -> None:
    """The upsert: neither request sees the other's row, and neither may 500 on the constraint."""
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token, _ = await new_user(c, HAND)
        url = f"/v1/hands/{HAND}/note"
        first, second = await asyncio.gather(
            c.put(url, json={"body": "one"}, headers=auth(token)),
            c.put(url, json={"body": "two"}, headers=auth(token)),
        )
        assert {first.status_code, second.status_code} == {200}, (first.text, second.text)
        assert (await c.get(url, headers=auth(token))).json()["body"] in {"one", "two"}


async def test_a_nul_character_is_a_422_not_a_500() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token, _ = await new_user(c, HAND)
        note = await c.put(f"/v1/hands/{HAND}/note", json={"body": "a\x00b"}, headers=auth(token))
        assert note.status_code == 422 and "NUL" in note.text
        tag = await c.post(f"/v1/hands/{HAND}/tags", json={"tag": "a\x00b"}, headers=auth(token))
        assert tag.status_code == 422 and "NUL" in tag.text


async def test_another_users_hand_is_not_found_on_every_route() -> None:
    """The same 404 as `GET /v1/hands/{uid}`: nothing may say the hand exists."""
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        owner, _ = await new_user(c, HAND)
        await c.put(f"/v1/hands/{HAND}/note", json={"body": NOTE}, headers=auth(owner))
        stranger, _ = await new_user(c, OTHER_HAND)

        for method, path, body in (
            ("GET", f"/v1/hands/{HAND}/note", None),
            ("PUT", f"/v1/hands/{HAND}/note", {"body": "mine now"}),
            ("GET", f"/v1/hands/{HAND}/tags", None),
            ("POST", f"/v1/hands/{HAND}/tags", {"tag": "stolen"}),
            ("DELETE", f"/v1/hands/{HAND}/tags/stolen", None),
        ):
            res = await c.request(method, path, json=body, headers=auth(stranger))
            assert res.status_code == 404, (method, path, res.text)
            assert res.json()["detail"] == "Hand not found"

        # Nothing of the stranger's attempt reached the owner's rows.
        assert (await c.get(f"/v1/hands/{HAND}/note", headers=auth(owner))).json()["body"] == NOTE
        assert (await c.get(f"/v1/hands/{HAND}/tags", headers=auth(owner))).json()["tags"] == []


async def test_a_hand_that_does_not_exist_is_not_found() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token, _ = await new_user(c, HAND)
        unknown = "ab" * 16
        res = await c.put(f"/v1/hands/{unknown}/note", json={"body": NOTE}, headers=auth(token))
        assert res.status_code == 404 and res.json()["detail"] == "Hand not found"
        res = await c.post(f"/v1/hands/{unknown}/tags", json={"tag": "x"}, headers=auth(token))
        assert res.status_code == 404


def _summary(uid: str) -> HandSummary:
    return HandSummary(
        hand_uid=uid,
        site="ggpoker",
        played_at_utc=datetime(2026, 1, 16, 14, 22, 31, tzinfo=UTC),
        stake_level="NL50",
        seat=2,
        position="SB",
        hole_cards="Qh Qs",
        board="8h 5d 2s",
        net_won_bb=4.5,
        went_to_showdown=False,
    )


async def test_the_list_carries_each_hands_tags_and_a_tag_filter_narrows_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """ClickHouse is stood in for by a fake `hero_hands` that answers with whatever it is
    restricted to, so what is asserted is the id-list intersection itself (ADR-048)."""
    calls: list[Sequence[str] | None] = []

    def fake_hero_hands(tenant_id: int, *args: Any, only: Sequence[str] | None = None) -> list[Any]:
        calls.append(only)
        uids = [HAND, OTHER_HAND] if only is None else list(only)
        return [_summary(uid) for uid in uids]

    monkeypatch.setattr(hand_query, "hero_hands", fake_hero_hands)
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token, _ = await new_user(c, HAND, OTHER_HAND)
        await c.post(f"/v1/hands/{HAND}/tags", json={"tag": "bluff"}, headers=auth(token))

        listed = (await c.get("/v1/hands", headers=auth(token))).json()
        assert [(row["hand_uid"], row["tags"]) for row in listed] == [
            (HAND, ["bluff"]),
            (OTHER_HAND, []),
        ]
        assert calls == [None]

        narrowed = (await c.get("/v1/hands?tag=Bluff", headers=auth(token))).json()
        assert [row["hand_uid"] for row in narrowed] == [HAND]
        assert calls[-1] == [HAND]  # the tag's ids went to ClickHouse as the restriction

        # A tag nobody used answers nothing without asking ClickHouse at all.
        assert (await c.get("/v1/hands?tag=unused", headers=auth(token))).json() == []
        assert len(calls) == 2

        blank = await c.get("/v1/hands?tag=%20", headers=auth(token))
        assert blank.status_code == 422
