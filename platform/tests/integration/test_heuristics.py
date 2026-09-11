"""The heuristic log end to end (plan F.11, spec §16): write a lesson, review it, keep it private.

Requires the stack (`make test-all`). The contract worth testing over HTTP is the review loop --
a fresh lesson is not due, fourteen days later it is, answering it pushes it out again -- and the
bridge to the analyzer, where a step-9 takeaway stops being offered once it has been adopted.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from api.main import app
from api.schemas_heuristics import REVIEW_DAYS

pytestmark = pytest.mark.integration

TRANSPORT = ASGITransport(app=app)
NODE = {"hero_position": "BB", "villain_position": "CO", "street": "turn", "stake": "NL50"}
LESSON = "the pool folds the turn far more than MDF on paired boards -- barrel more"


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _new_user(client: AsyncClient) -> str:
    email = f"heuristic-{uuid.uuid4().hex[:10]}@example.com"
    res = await client.post(
        "/v1/auth/register",
        json={"email": email, "password": "a-long-enough-password", "display_name": "a"},
    )
    assert res.status_code == 201, res.text
    return str(res.json()["access_token"])


async def _write(client: AsyncClient, token: str, **fields: Any) -> dict[str, Any]:
    body = {"text": LESSON, "street": "turn", "position": "BB", "texture": "paired", **fields}
    res = await client.post("/v1/heuristics", json=body, headers=_auth(token))
    assert res.status_code == 201, res.text
    return dict(res.json())


async def _analysis_with_a_takeaway(client: AsyncClient, token: str, takeaway: str) -> str:
    opened = await client.post(
        "/v1/analyses",
        json={"title": "BB vs CO on a paired turn", "source": "manual", "node_key": NODE},
        headers=_auth(token),
    )
    assert opened.status_code == 201, opened.text
    analysis_id = str(opened.json()["id"])
    saved = await client.put(
        f"/v1/analyses/{analysis_id}", json={"heuristic": takeaway}, headers=_auth(token)
    )
    assert saved.status_code == 200, saved.text
    return analysis_id


async def test_a_heuristic_is_written_and_read_back_whole() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token = await _new_user(c)
        written = await _write(c, token, tags=["turn", "paired"])

        reopened = (await c.get(f"/v1/heuristics/{written['id']}", headers=_auth(token))).json()
        assert reopened["text"] == LESSON
        assert reopened["street"] == "turn" and reopened["position"] == "BB"
        assert reopened["texture"] == "paired" and reopened["tags"] == ["turn", "paired"]
        assert reopened["status"] == "open" and reopened["confirmed_at"] is None
        assert reopened["analysis_id"] is None


async def test_a_blank_heuristic_is_refused_in_words() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token = await _new_user(c)
        res = await c.post("/v1/heuristics", json={"text": "   "}, headers=_auth(token))
        assert res.status_code == 422
        assert "cannot be blank" in res.text

        camel = {"text": LESSON, "analysisId": str(uuid.uuid4())}
        assert (await c.post("/v1/heuristics", json=camel, headers=_auth(token))).status_code == 422


async def test_a_fresh_heuristic_is_not_due_and_its_review_is_fourteen_days_out() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token = await _new_user(c)
        written = await _write(c, token)

        assert written["is_due"] is False
        created = datetime.fromisoformat(written["created_at"])
        due_at = datetime.fromisoformat(written["review_due_at"])
        assert due_at - created == timedelta(days=REVIEW_DAYS)
        assert due_at > datetime.now(UTC)


async def test_answering_still_true_stamps_the_review_and_pushes_the_next_one_out() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token = await _new_user(c)
        written = await _write(c, token)
        before = datetime.fromisoformat(written["review_due_at"])

        answered = await c.put(
            f"/v1/heuristics/{written['id']}", json={"status": "confirmed"}, headers=_auth(token)
        )
        assert answered.status_code == 200, answered.text
        row = answered.json()

        assert row["status"] == "confirmed"
        assert row["confirmed_at"] is not None
        confirmed = datetime.fromisoformat(row["confirmed_at"])
        assert datetime.fromisoformat(row["review_due_at"]) - confirmed == timedelta(
            days=REVIEW_DAYS
        )
        assert datetime.fromisoformat(row["review_due_at"]) > before


async def test_rewording_a_lesson_leaves_the_rest_of_it_and_its_review_alone() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token = await _new_user(c)
        written = await _write(c, token, tags=["turn"])

        changed = await c.put(
            f"/v1/heuristics/{written['id']}",
            json={"text": "barrel the turn on paired boards"},
            headers=_auth(token),
        )
        assert changed.status_code == 200, changed.text
        row = changed.json()

        assert row["text"] == "barrel the turn on paired boards"
        assert row["texture"] == "paired" and row["tags"] == ["turn"]
        assert row["confirmed_at"] is None
        assert row["review_due_at"] == written["review_due_at"]


async def test_the_due_filter_shows_only_what_is_waiting_for_a_review() -> None:
    """Nothing written in this test is fourteen days old, so the due queue is empty."""
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token = await _new_user(c)
        written = await _write(c, token)

        everything = (await c.get("/v1/heuristics", headers=_auth(token))).json()
        assert [row["id"] for row in everything] == [written["id"]]

        due = (await c.get("/v1/heuristics?due=true", headers=_auth(token))).json()
        assert due == []


async def test_a_step_nine_takeaway_is_offered_until_the_log_adopts_it() -> None:
    """ADR-034's bridge: `analyses.heuristic` is the candidate list, not a second copy."""
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token = await _new_user(c)
        takeaway = "my pool folds 12 points more than MDF here -- bluff the turn more"
        analysis_id = await _analysis_with_a_takeaway(c, token, takeaway)

        offered = (await c.get("/v1/heuristics/candidates", headers=_auth(token))).json()
        assert [(row["analysis_id"], row["heuristic"]) for row in offered] == [
            (analysis_id, takeaway)
        ]
        assert offered[0]["node_key"]["hero_position"] == "BB"

        adopted = await _write(c, token, text=takeaway, analysis_id=analysis_id)
        assert adopted["analysis_id"] == analysis_id
        assert (await c.get("/v1/heuristics/candidates", headers=_auth(token))).json() == []


async def test_an_analysis_with_no_takeaway_is_never_a_candidate() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token = await _new_user(c)
        opened = await c.post(
            "/v1/analyses",
            json={"title": "unfinished", "source": "manual", "node_key": NODE},
            headers=_auth(token),
        )
        assert opened.status_code == 201, opened.text
        assert (await c.get("/v1/heuristics/candidates", headers=_auth(token))).json() == []


async def test_deleting_a_heuristic_removes_it_from_the_log() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        token = await _new_user(c)
        written = await _write(c, token)
        url = f"/v1/heuristics/{written['id']}"

        assert (await c.delete(url, headers=_auth(token))).status_code == 204
        assert (await c.get(url, headers=_auth(token))).status_code == 404
        assert (await c.get("/v1/heuristics", headers=_auth(token))).json() == []


async def test_another_users_heuristic_is_not_found() -> None:
    """404, never 403: a stranger must not learn that the id exists at all."""
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        mine = await _write(c, await _new_user(c))
        stranger = await _new_user(c)

        url = f"/v1/heuristics/{mine['id']}"
        assert (await c.get(url, headers=_auth(stranger))).status_code == 404
        assert (await c.put(url, json={"text": "x"}, headers=_auth(stranger))).status_code == 404
        assert (await c.delete(url, headers=_auth(stranger))).status_code == 404
        assert (await c.get("/v1/heuristics", headers=_auth(stranger))).json() == []
        assert (await c.get("/v1/heuristics/candidates", headers=_auth(stranger))).json() == []


async def test_the_heuristic_log_needs_a_signed_in_user() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        assert (await c.get("/v1/heuristics")).status_code == 401
        assert (await c.get("/v1/heuristics/candidates")).status_code == 401
        assert (await c.post("/v1/heuristics", json={"text": LESSON})).status_code == 401
