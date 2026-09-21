"""`GET /v1/pool/players` finds a real opponent by the name a person types (plan round 7, ADR-062).

The route it replaces could not. A `player_key` is `<site>:<screen name>` (`core.ids.player_key`)
and the old match was `startsWith(player_key, ...)`, so every name a person typed matched nothing
and the answer was "no such player" -- an assertion of absence that was never true. That is a
wire-level bug, so this is a wire-level test: a population upload over HTTP, then the route.

The corpus is `seeds/hands/ggpoker/observed_nl25.txt`, one six-handed hand with no hero seat and
six invented screen names. Real screen names never appear in this repository (ADR-058).
"""

from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient

from analysis.pool.service import MIN_NAME
from ingestion import worker
from tests.integration._uploads import auth, http, register, upload

pytestmark = pytest.mark.integration

SITE = "ggpoker"
SEEDED = [f"{SITE}:watcher{n}" for n in range(1, 7)]
"""What the six seats of `observed_nl25.txt` become once the key is built and lowered."""


async def _pool(client: AsyncClient, token: str) -> str:
    """A tenant whose pool is the six watchers, loaded the way a person loads one."""
    accepted = await upload(client, token, SITE, "observed_nl25.txt", dataset="population")
    assert accepted.status_code == 202, accepted.text
    worker.drain()
    return token


async def _find(client: AsyncClient, token: str, name: str) -> Any:
    return await client.post("/v1/pool/players", json={"name": name}, headers=auth(token))


async def test_a_name_typed_into_the_search_finds_the_players_it_names() -> None:
    async with http() as c:
        token = await _pool(c, await register(c))

        res = await _find(c, token, "atcher")
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["matched"] == 6 and body["matched_capped"] is False
        assert sorted(row["group"]["player_key"] for row in body["rows"]) == SEEDED
        assert body["group_by"] == ["player_key"]
        assert all(row["cells"]["hands"]["value"] == 1 for row in body["rows"])


async def test_a_whole_key_pasted_back_finds_exactly_the_one_player() -> None:
    """The site is optional, so a key and the name inside it are two ways to the same player."""
    async with http() as c:
        token = await _pool(c, await register(c))

        pasted = await _find(c, token, SEEDED[2])
        assert pasted.status_code == 200, pasted.text
        assert pasted.json()["matched"] == 1
        assert pasted.json()["rows"][0]["group"]["player_key"] == SEEDED[2]

        # The half a person actually types. `startsWith` on the key -- the rule this replaced --
        # answers 0 here, which is the whole reason the route was rewritten.
        by_name = await _find(c, token, "watcher3")
        assert by_name.status_code == 200, by_name.text
        assert [row["group"]["player_key"] for row in by_name.json()["rows"]] == [SEEDED[2]]


async def test_the_site_is_not_part_of_anybody_s_name() -> None:
    """The bug wearing its other face: matching the whole key would return the entire pool."""
    async with http() as c:
        token = await _pool(c, await register(c))

        res = await _find(c, token, SITE)
        assert res.status_code == 200, res.text
        assert res.json()["matched"] == 0 and res.json()["rows"] == []


async def test_too_short_a_name_is_refused_in_a_sentence_not_answered_with_everyone() -> None:
    async with http() as c:
        token = await _pool(c, await register(c))

        short = await _find(c, token, "wa")
        assert short.status_code == 400, short.text
        assert f"at least {MIN_NAME} characters" in short.json()["detail"]
        assert (await _find(c, token, f"{SITE}:wa")).status_code == 400


async def test_another_tenant_finds_none_of_them() -> None:
    """With the owner's own answer beside it, so "nobody" cannot pass for "nobody, ever"."""
    async with http() as c:
        owner = await _pool(c, await register(c))
        stranger = await register(c)

        mine = await _find(c, owner, "atcher")
        assert mine.status_code == 200, mine.text
        assert mine.json()["matched"] == 6, "the positive control this isolation rests on"

        theirs = await _find(c, stranger, "atcher")
        assert theirs.status_code == 200, theirs.text
        assert theirs.json()["matched"] == 0
