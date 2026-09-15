"""Tags on a hand over HTTP with a real Postgres and no ClickHouse (plan D.7b).

Same footing as `test_hand_notes_pg.py`: ownership faked through `conftest.py`, everything
after it real. What is pinned here is the one spelling of a tag, the vocabulary cap at its
literal boundary, and the DELETE path surviving the characters a client percent-encodes.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient

from api.db import session_factory
from api.models_hand_notes import HandTag
from api.schemas_hand_notes import MAX_DISTINCT_TAGS
from tests.postgres.support import HAND, OTHER_HAND, TRANSPORT, auth, new_user

pytestmark = pytest.mark.integration


async def test_tags_are_added_once_normalized_listed_and_removed() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token, _ = await new_user(c, HAND)
        url = f"/v1/hands/{HAND}/tags"
        assert (await c.get(url, headers=auth(token))).json() == {"hand_uid": HAND, "tags": []}

        first = await c.post(url, json={"tag": "  Bluff "}, headers=auth(token))
        assert first.status_code == 200, first.text
        assert first.json()["tags"] == ["bluff"]

        twice = await c.post(url, json={"tag": "BLUFF"}, headers=auth(token))
        assert twice.json()["tags"] == ["bluff"]  # one spelling, one row

        more = await c.post(url, json={"tag": "3-bet   pot"}, headers=auth(token))
        assert more.json()["tags"] == ["3-bet pot", "bluff"]

        removed = await c.delete(f"{url}/Bluff", headers=auth(token))
        assert removed.status_code == 200 and removed.json()["tags"] == ["3-bet pot"]
        not_there = await c.delete(f"{url}/never-was", headers=auth(token))
        assert not_there.json()["tags"] == ["3-bet pot"]


async def test_a_tag_with_a_slash_can_be_removed_by_the_path_the_client_sends() -> None:
    """`encodeURIComponent('3-bet/4-bet')` is `3-bet%2F4-bet`; the server decodes it before
    routing, so the DELETE route has to capture the slash (`{tag:path}`) or never match."""
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token, _ = await new_user(c, HAND)
        url = f"/v1/hands/{HAND}/tags"
        for tag in ("3-bet/4-bet", "50% pot", "why?"):
            assert (await c.post(url, json={"tag": tag}, headers=auth(token))).status_code == 200
        assert (await c.get(url, headers=auth(token))).json()["tags"] == [
            "3-bet/4-bet",
            "50% pot",
            "why?",
        ]
        for encoded, left in (
            ("3-bet%2F4-bet", ["50% pot", "why?"]),
            ("50%25%20pot", ["why?"]),
            ("why%3F", []),
        ):
            res = await c.delete(f"{url}/{encoded}", headers=auth(token))
            assert res.status_code == 200, (encoded, res.text)
            assert res.json()["tags"] == left


async def test_a_blank_tag_is_refused_in_words() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token, _ = await new_user(c, HAND)
        res = await c.post(f"/v1/hands/{HAND}/tags", json={"tag": "   "}, headers=auth(token))
        assert res.status_code == 422 and "needs some text" in res.text


async def _seed_tags(user_id: uuid.UUID, hand_uid: str, count: int) -> None:
    """The first `count` distinct tags, written as rows rather than as `count` requests.

    An honest loop of 500 POSTs runs into E.3's per-tenant request budget at request 300 and
    is refused with a 429 -- which is the budget working, not the cap under test here.
    """
    async with session_factory()() as session:
        session.add_all(
            HandTag(user_id=user_id, hand_uid=hand_uid, tag=f"t{n}") for n in range(count)
        )
        await session.commit()


async def test_the_501st_distinct_tag_is_refused_and_a_known_one_still_fits() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token, user_id = await new_user(c, HAND, OTHER_HAND)
        url = f"/v1/hands/{HAND}/tags"
        await _seed_tags(user_id, HAND, MAX_DISTINCT_TAGS - 1)
        last = await c.post(url, json={"tag": f"t{MAX_DISTINCT_TAGS - 1}"}, headers=auth(token))
        assert last.status_code == 200, last.text  # the 500th distinct tag still fits

        refused = await c.post(url, json={"tag": "one too many"}, headers=auth(token))
        assert refused.status_code == 422, refused.text
        assert f"{MAX_DISTINCT_TAGS} distinct tags" in refused.json()["detail"]

        # The cap is on the vocabulary, not on a hand: a tag already in use goes anywhere.
        reused = await c.post(
            f"/v1/hands/{OTHER_HAND}/tags", json={"tag": "t7"}, headers=auth(token)
        )
        assert reused.status_code == 200 and reused.json()["tags"] == ["t7"]

        vocabulary = (await c.get("/v1/hands/tags", headers=auth(token))).json()
        assert len(vocabulary) == MAX_DISTINCT_TAGS
        assert vocabulary[0] == {"tag": "t7", "hands": 2}  # most used first


async def test_the_vocabulary_counts_hands_per_tag_and_is_private() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token, _ = await new_user(c, HAND, OTHER_HAND)
        for uid, tag in ((HAND, "bluff"), (OTHER_HAND, "bluff"), (HAND, "study")):
            await c.post(f"/v1/hands/{uid}/tags", json={"tag": tag}, headers=auth(token))
        assert (await c.get("/v1/hands/tags", headers=auth(token))).json() == [
            {"tag": "bluff", "hands": 2},
            {"tag": "study", "hands": 1},
        ]
        stranger, _ = await new_user(c)
        assert (await c.get("/v1/hands/tags", headers=auth(stranger))).json() == []
