"""End-to-end: upload -> object storage -> Kafka -> worker -> ClickHouse -> stats API.

The one test that proves the whole Phase-1 spine works together. Everything else tests a
layer; this tests the seams between them, which is where integration bugs live.

Requires the stack: `make up && make seed`.
"""

from __future__ import annotations

import uuid
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from api.db import clickhouse
from api.main import app
from ingestion import worker

pytestmark = pytest.mark.integration

CORPUS = Path(__file__).resolve().parents[1].parent / "seeds" / "hands"
TRANSPORT = ASGITransport(app=app)


async def _client() -> AsyncClient:
    return AsyncClient(transport=TRANSPORT, base_url="http://test")


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _new_user(client: AsyncClient) -> tuple[str, str]:
    email = f"e2e-{uuid.uuid4().hex[:10]}@example.com"
    res = await client.post(
        "/v1/auth/register",
        json={"email": email, "password": "a-long-enough-password", "display_name": "e2e"},
    )
    assert res.status_code == 201, res.text
    return email, res.json()["access_token"]


async def test_upload_to_stats_end_to_end() -> None:
    """Upload a real hand-history file and get correct statistics back from the API."""
    async with await _client() as c:
        _, token = await _new_user(c)

        # Registering the screen name is what lets the parser resolve which seat is hero.
        res = await c.post(
            "/v1/auth/poker-accounts",
            json={"site": "pokerstars", "screen_name": "Hero"},
            headers=_auth(token),
        )
        assert res.status_code == 201, res.text

        raw = (CORPUS / "pokerstars" / "cash_6max_nl50.txt").read_bytes()
        res = await c.post(
            "/v1/uploads",
            files={"file": ("cash_6max_nl50.txt", raw, "text/plain")},
            data={"site": "pokerstars"},
            headers=_auth(token),
        )
        assert res.status_code == 202, res.text
        body = res.json()
        assert body["dedupe"] == "new"
        upload_id = body["upload_id"]

        # The endpoint returns before any parsing happens — that is the design. Run the
        # worker to drain the queue, exactly as a deployed worker would.
        assert worker.drain() >= 1

        status = (await c.get(f"/v1/uploads/{upload_id}", headers=_auth(token))).json()
        assert status["status"] == "completed", status
        assert status["hands_found"] == 2
        assert status["hands_parsed"] == 2
        assert status["hands_failed"] == 0

        # Hands are queryable immediately from core.* (stat marts need a dbt run).
        listing = (await c.get("/v1/hands", headers=_auth(token))).json()
        assert len(listing) == 2
        assert {h["stake_level"] for h in listing} == {"NL50"}
        assert all(h["position"] in ("HJ", "BTN") for h in listing)

        detail = (await c.get(f"/v1/hands/{listing[0]['hand_uid']}", headers=_auth(token))).json()
        assert len(detail["players"]) == 6
        assert detail["actions"], "hand detail must carry the action sequence"


async def test_reupload_is_idempotent() -> None:
    """Re-uploading the same bytes is a no-op, not a duplicate import.

    This is what makes the future desktop agent safe: an agent that crashes and re-scans its
    hand-history folder must be harmless.
    """
    async with await _client() as c:
        _, token = await _new_user(c)
        raw = (CORPUS / "ggpoker" / "rush_nl50.txt").read_bytes()

        first = await c.post(
            "/v1/uploads",
            files={"file": ("rush.txt", raw, "text/plain")},
            data={"site": "ggpoker"},
            headers=_auth(token),
        )
        assert first.json()["dedupe"] == "new"

        second = await c.post(
            "/v1/uploads",
            files={"file": ("rush-again.txt", raw, "text/plain")},
            data={"site": "ggpoker"},
            headers=_auth(token),
        )
        assert second.json()["dedupe"] == "duplicate"
        assert second.json()["upload_id"] == first.json()["upload_id"]

        worker.drain()
        assert len((await c.get("/v1/hands", headers=_auth(token))).json()) == 2


async def test_worker_reprocessing_does_not_duplicate_hands() -> None:
    """Re-running the worker over the same file supersedes rows rather than adding them.

    At-least-once delivery + deterministic `hand_uid` + ReplacingMergeTree = exactly-once
    effect. This asserts that property directly, because it is the one that makes a crashed
    worker safe to restart.
    """
    async with await _client() as c:
        _, token = await _new_user(c)
        raw = (CORPUS / "pokerstars" / "edge_cases.txt").read_bytes()
        res = await c.post(
            "/v1/uploads",
            files={"file": ("edge.txt", raw, "text/plain")},
            data={"site": "pokerstars"},
            headers=_auth(token),
        )
        upload_id = res.json()["upload_id"]
        worker.drain()

        before = len((await c.get("/v1/hands?limit=500", headers=_auth(token))).json())
        assert before == 4

        # Replay the same upload message directly, simulating a redelivery after a crash.
        from ingestion.bus import UploadMessage, publish_upload

        detail = (await c.get(f"/v1/uploads/{upload_id}", headers=_auth(token))).json()
        me = (await c.get("/v1/auth/me", headers=_auth(token))).json()
        rows = (
            clickhouse()
            .query(
                "SELECT raw_object_key FROM core.hands FINAL WHERE hand_uid = {uid:String} LIMIT 1",
                parameters={
                    "uid": (await c.get("/v1/hands", headers=_auth(token))).json()[0]["hand_uid"]
                },
            )
            .result_rows
        )
        assert rows, "hand must carry a pointer back to its raw text"

        publish_upload(
            UploadMessage(
                upload_id=upload_id,
                tenant_id=_tenant_of(me["id"]),
                site=detail["site"],
                object_key=rows[0][0],
                sha256="",
                hero_names=["Hero"],
            )
        )
        worker.drain()

        after = len((await c.get("/v1/hands?limit=500", headers=_auth(token))).json())
        assert after == before, "redelivery must not duplicate hands"


def _tenant_of(user_uuid: str) -> int:
    """Look up the numeric tenant id for a user UUID (test helper)."""
    import psycopg

    from api.settings import get_settings

    with psycopg.connect(get_settings().postgres_libpq_dsn) as conn:
        row = conn.execute("SELECT tenant_id FROM users WHERE id = %s", (user_uuid,)).fetchone()
    assert row is not None
    return int(row[0])
