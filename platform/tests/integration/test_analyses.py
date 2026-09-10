"""Saved analyses end to end (plan F.9): open one, work it, reopen it, and keep it private.

Requires the stack (`make test-all`). The point of these tests is the autosave contract: the
analyzer saves the step it is on, over and over, and must never lose the steps before it.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from api.main import app

pytestmark = pytest.mark.integration

TRANSPORT = ASGITransport(app=app)
NODE = {"hero_position": "BB", "villain_position": "CO", "street": "flop", "stake": "NL50"}


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _new_user(client: AsyncClient) -> str:
    email = f"analyze-{uuid.uuid4().hex[:10]}@example.com"
    res = await client.post(
        "/v1/auth/register",
        json={"email": email, "password": "a-long-enough-password", "display_name": "a"},
    )
    assert res.status_code == 201, res.text
    return str(res.json()["access_token"])


def _step(number: int, answer: str, *, takeaway: str = "") -> dict[str, Any]:
    return {
        "step": number,
        "takeaway": takeaway,
        "prediction": {
            "question": "how often does the pool fold here?",
            "answer_type": "percent",
            "answer": answer,
            "actual": "",
            "committed_at": datetime.now(UTC).isoformat(),
        },
    }


async def _open(client: AsyncClient, token: str) -> dict[str, Any]:
    body = {"title": "BB vs CO on a paired flop", "source": "manual", "node_key": NODE}
    res = await client.post("/v1/analyses", json=body, headers=_auth(token))
    assert res.status_code == 201, res.text
    return dict(res.json())


async def test_an_analysis_opens_at_step_one_with_nothing_done() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token = await _new_user(c)
        opened = await _open(c, token)

        assert opened["current_step"] == 1
        assert opened["completed_steps"] == [] and opened["steps"] == []
        assert opened["node_key"]["hero_position"] == "BB"
        assert opened["heuristic"] == ""


async def test_saving_a_later_step_does_not_lose_the_earlier_ones() -> None:
    """The autosave sends the step being worked on; everything before it must survive."""
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token = await _new_user(c)
        opened = await _open(c, token)
        url = f"/v1/analyses/{opened['id']}"

        for number in (1, 2, 3):
            saved = await c.put(
                url,
                json={"current_step": number, "steps": [_step(number, "55")]},
                headers=_auth(token),
            )
            assert saved.status_code == 200, saved.text

        reopened = (await c.get(url, headers=_auth(token))).json()
        assert reopened["completed_steps"] == [1, 2, 3]
        assert [s["step"] for s in reopened["steps"]] == [1, 2, 3]
        assert reopened["current_step"] == 3


async def test_all_nine_steps_and_a_heuristic_survive_a_reopen() -> None:
    """Acceptance 9 as the API sees it: nine committed predictions and one saved heuristic."""
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token = await _new_user(c)
        opened = await _open(c, token)
        url = f"/v1/analyses/{opened['id']}"

        for number in range(1, 10):
            body = {"current_step": number, "steps": [_step(number, "40", takeaway=f"t{number}")]}
            assert (await c.put(url, json=body, headers=_auth(token))).status_code == 200
        heuristic = "my pool folds 12 points more than MDF here — bluff the turn more"
        final = await c.put(url, json={"heuristic": heuristic}, headers=_auth(token))
        assert final.status_code == 200, final.text

        reopened = (await c.get(url, headers=_auth(token))).json()
        assert reopened["completed_steps"] == list(range(1, 10))
        assert reopened["heuristic"] == heuristic
        assert [s["takeaway"] for s in reopened["steps"]] == [f"t{n}" for n in range(1, 10)]

        listed = (await c.get("/v1/analyses", headers=_auth(token))).json()
        assert [(row["id"], row["heuristic"]) for row in listed] == [(opened["id"], heuristic)]
        assert "steps" not in listed[0]  # the list is a summary


async def test_another_users_analysis_is_not_found() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        mine = await _open(c, await _new_user(c))
        stranger = await _new_user(c)

        url = f"/v1/analyses/{mine['id']}"
        assert (await c.get(url, headers=_auth(stranger))).status_code == 404
        assert (await c.put(url, json={"title": "x"}, headers=_auth(stranger))).status_code == 404
        assert (await c.delete(url, headers=_auth(stranger))).status_code == 404
        assert (await c.get("/v1/analyses", headers=_auth(stranger))).json() == []


async def test_an_analysis_of_a_pasted_hand_keeps_the_text_it_was_started_from() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token = await _new_user(c)
        text = "PokerStars Hand #1: Hold'em No Limit ($0.25/$0.50 USD)"
        body = {"title": "a pasted spot", "source": "pasted", "hand_text": text}
        created = await c.post("/v1/analyses", json=body, headers=_auth(token))
        assert created.status_code == 201, created.text

        reopened = (
            await c.get(f"/v1/analyses/{created.json()['id']}", headers=_auth(token))
        ).json()
        assert reopened["hand_text"] == text and reopened["node_key"] is None


async def test_an_analysis_that_names_no_hand_is_refused_in_words() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token = await _new_user(c)
        bad = {"title": "nothing", "source": "stored"}
        res = await c.post("/v1/analyses", json=bad, headers=_auth(token))
        assert res.status_code == 422
        assert "32 lowercase hex" in res.text

        camel = {"title": "t", "source": "manual", "nodeKey": NODE}
        assert (await c.post("/v1/analyses", json=camel, headers=_auth(token))).status_code == 422


async def test_deleting_an_analysis_removes_it_from_the_list() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token = await _new_user(c)
        opened = await _open(c, token)
        url = f"/v1/analyses/{opened['id']}"

        assert (await c.delete(url, headers=_auth(token))).status_code == 204
        assert (await c.get(url, headers=_auth(token))).status_code == 404
        assert (await c.get("/v1/analyses", headers=_auth(token))).json() == []


async def test_an_analysis_needs_a_signed_in_user() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        assert (await c.get("/v1/analyses")).status_code == 401


async def test_two_clickhouse_reads_at_once_do_not_collide() -> None:
    """The analyzer opens a hand and asks the pool at the same time (plan F.9).

    One ClickHouse client is shared by the whole process; with the driver's default session id
    the second of two concurrent queries is refused outright, which showed up as a page that
    waited for ever. Nothing here needs a session, so they are off (`ingestion/clickhouse.py`).
    """
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token = await _new_user(c)
        node = {"hero_position": "BB", "villain_position": "CO", "street": "flop"}
        answers = await asyncio.gather(
            c.get("/v1/hands?limit=5", headers=_auth(token)),
            c.post("/v1/pool/node/frequencies", json=node, headers=_auth(token)),
            c.post("/v1/pool/node/showdown-range", json=node, headers=_auth(token)),
        )
        assert [a.status_code for a in answers] == [200, 200, 200], [a.text for a in answers]
