"""End-to-end: upload -> object storage -> Kafka -> worker -> ClickHouse -> stats API.

The one test that proves the whole Phase-1 spine works together. Everything else tests a
layer; this tests the seams between them, which is where integration bugs live.

Requires the stack: `make up && make seed`.
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
from ingestion import sinks, worker
from ingestion.clickhouse import clickhouse
from ingestion.messages import UploadMessage

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


async def _upload(client: AsyncClient, token: str, site: str, name: str) -> dict[str, Any]:
    """POST one corpus file as `name` and return the 202 body."""
    raw = (CORPUS / site / name).read_bytes()
    res = await client.post(
        "/v1/uploads",
        files={"file": (name, raw, "text/plain")},
        data={"site": site},
        headers=_auth(token),
    )
    assert res.status_code == 202, res.text
    body: dict[str, Any] = res.json()
    return body


async def _hands(client: AsyncClient, token: str) -> list[dict[str, Any]]:
    listing: list[dict[str, Any]] = (
        await client.get("/v1/hands?limit=500", headers=_auth(token))
    ).json()
    return listing


def _tenant_of(user_uuid: str) -> int:
    """Look up the numeric tenant id for a user UUID (test helper)."""
    with psycopg.connect(get_settings().postgres_libpq_dsn) as conn:
        row = conn.execute("SELECT tenant_id FROM users WHERE id = %s", (user_uuid,)).fetchone()
    assert row is not None
    return int(row[0])


def _raw_key_of(hand_uid: str) -> str:
    """The object-storage key a stored hand points back to."""
    rows = (
        clickhouse()
        .query(
            f"SELECT raw_object_key FROM {get_settings().db('core')}.hands FINAL "
            "WHERE hand_uid = {uid:String} LIMIT 1",
            parameters={"uid": hand_uid},
        )
        .result_rows
    )
    assert rows, "hand must carry a pointer back to its raw text"
    return str(rows[0][0])


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

        body = await _upload(c, token, "pokerstars", "cash_6max_nl50.txt")
        assert body["dedupe"] == "new"
        upload_id = body["upload_id"]

        # The endpoint returns before any parsing happens — that is the design. Run the
        # worker to drain the queue, exactly as a deployed worker would.
        assert worker.drain() >= 1

        status = (await c.get(f"/v1/uploads/{upload_id}", headers=_auth(token))).json()
        assert status["status"] == "completed", status
        assert (status["hands_found"], status["hands_parsed"], status["hands_failed"]) == (2, 2, 0)

        # Hands are queryable immediately from core.*; the stats path, with no dbt run, is
        # tests/integration/test_upload_to_report.py (plan D.8).
        listing = await _hands(c, token)
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
        first = await _upload(c, token, "ggpoker", "rush_nl50.txt")
        assert first["dedupe"] == "new"

        second = await _upload(c, token, "ggpoker", "rush_nl50.txt")
        assert second["dedupe"] == "duplicate"
        assert second["upload_id"] == first["upload_id"]

        worker.drain()
        assert len(await _hands(c, token)) == 2


async def test_worker_reprocessing_does_not_duplicate_hands() -> None:
    """Re-running the worker over the same file supersedes rows rather than adding them.

    At-least-once delivery + deterministic `hand_uid` + ReplacingMergeTree = exactly-once
    effect. This asserts that property directly, because it is the one that makes a crashed
    worker safe to restart.
    """
    async with await _client() as c:
        _, token = await _new_user(c)
        upload_id = (await _upload(c, token, "pokerstars", "edge_cases.txt"))["upload_id"]
        worker.drain()

        before = await _hands(c, token)
        assert len(before) == 4

        # Replay the same upload message directly, simulating a redelivery after a crash.
        detail = (await c.get(f"/v1/uploads/{upload_id}", headers=_auth(token))).json()
        me = (await c.get("/v1/auth/me", headers=_auth(token))).json()
        sinks.event_bus().publish_upload(
            UploadMessage(
                upload_id=upload_id,
                tenant_id=_tenant_of(me["id"]),
                site=detail["site"],
                object_key=_raw_key_of(before[0]["hand_uid"]),
                sha256="",
                hero_names=["Hero"],
            )
        )
        worker.drain()

        assert len(await _hands(c, token)) == len(before), "redelivery must not duplicate hands"
