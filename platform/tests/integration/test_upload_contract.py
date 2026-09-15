"""The upload contract's unhappy paths, on the real stack (plan D.8, ADR-051).

Written first, because each is a way "a file uploaded through the UI produces stats without
manual steps" fails with nothing red: a failure nothing retries, a file that stored nothing read
as success, an exception shown to the uploader, the same bytes silently ignored under the other
dataset. The refusals that need no database are unit tests (`tests/test_upload_routes.py`).
"""

from __future__ import annotations

import uuid

import psycopg
import pytest

from api.upload_store import QUEUE_SILENT, STORAGE_SILENT
from core.settings import get_settings
from ingestion import sinks, worker
from ingestion.messages import PublishError, UploadMessage
from ingestion.storage import s3_client
from ingestion.upload_status import FAILED_ON_OUR_SIDE
from tests.integration._uploads import (
    CORPUS,
    auth,
    http,
    object_key_of,
    register,
    tenant_of,
    upload,
    upload_row,
)

pytestmark = pytest.mark.integration


async def test_a_real_failure_is_worded_and_the_same_file_dropped_again_retries_it() -> None:
    async with http() as c:
        token = await register(c)
        first = await upload(c, token, "pokerstars", "edge_cases.txt")
        upload_id = first.json()["upload_id"]
        # The worker has not run yet: take its raw text away, so reading it fails for real.
        key = object_key_of(upload_id)
        s3_client().delete_object(Bucket=get_settings().s3_raw_bucket, Key=key)
        assert worker.drain() >= 1

        failed = await upload_row(c, token, upload_id)
        assert failed["status"] == "failed"
        assert failed["error_text"] == FAILED_ON_OUR_SIDE, "a sentence, never the exception"

        # A failed upload may have hands in the marts already; a retry under the other dataset
        # would leave them under this one, so the dataset is checked before the retry.
        elsewhere = await upload(c, token, "pokerstars", "edge_cases.txt", dataset="population")
        assert (elsewhere.status_code, elsewhere.json()["detail"]) == (
            409,
            "This file is already uploaded as My hands. A file belongs to one dataset.",
        )

        again = await upload(c, token, "pokerstars", "edge_cases.txt")
        assert again.status_code == 202, again.text
        assert again.json() == {"upload_id": upload_id, "status": "queued", "dedupe": "requeued"}
        requeued = await upload_row(c, token, upload_id)
        assert (requeued["status"], requeued["error_text"], requeued["hands_found"]) == (
            "queued",
            "",
            0,
        )
        assert worker.drain() >= 1

        done = await upload_row(c, token, upload_id)
        assert (done["status"], done["hands_parsed"]) == ("completed", 4)
        hands = (await c.get("/v1/hands?limit=50", headers=auth(token))).json()
        assert len(hands) == 4, "the retry stored each hand once"


async def test_a_file_whose_hands_cannot_be_read_ends_failed_in_words() -> None:
    # Recognisably PokerStars, so it passes intake, but no pot adds up: every hand is refused.
    text = (CORPUS / "pokerstars" / "cash_6max_nl50.txt").read_text()
    unreadable = text.replace("collected $", "collected $9").encode()
    async with http() as c:
        token = await register(c)
        res = await c.post(
            "/v1/uploads",
            files={"file": ("junk.txt", unreadable, "text/plain")},
            headers=auth(token),
        )
        assert res.status_code == 202, res.text
        worker.drain()

        row = await upload_row(c, token, res.json()["upload_id"])
        assert (row["status"], row["hands_found"], row["hands_parsed"]) == ("failed", 2, 0)
        assert row["error_text"] == (
            "None of the 2 hands in this file could be read. "
            "They are kept for the parser's backlog."
        )

        again = await c.post(
            "/v1/uploads",
            files={"file": ("junk.txt", unreadable, "text/plain")},
            headers=auth(token),
        )
        assert again.json()["dedupe"] == "requeued"
        reset = await upload_row(c, token, row["upload_id"])
        assert (reset["status"], reset["hands_found"], reset["error_text"]) == ("queued", 0, "")
        worker.drain()


async def test_the_same_bytes_under_the_other_dataset_are_refused_in_words() -> None:
    async with http() as c:
        token = await register(c)
        mine = await upload(c, token, "ggpoker", "rush_nl50.txt")
        assert mine.json()["dedupe"] == "new"
        worker.drain()

        pool = await upload(c, token, "ggpoker", "rush_nl50.txt", dataset="population")
        assert pool.status_code == 409
        assert pool.json()["detail"] == (
            "This file is already uploaded as My hands. A file belongs to one dataset."
        )
        same = await upload(c, token, "ggpoker", "rush_nl50.txt", dataset="hero")
        assert same.json() == {
            "upload_id": mine.json()["upload_id"],
            "status": "completed",
            "dedupe": "duplicate",
        }


async def test_another_tenants_upload_is_not_found() -> None:
    async with http() as c:
        owner = await register(c)
        stranger = await register(c)
        upload_id = (await upload(c, owner, "pokerstars", "cash_6max_nl50.txt")).json()["upload_id"]
        worker.drain()

        for path in (f"/v1/uploads/{upload_id}", f"/v1/uploads/{uuid.uuid4()}"):
            res = await c.get(path, headers=auth(stranger))
            assert (res.status_code, res.json()["detail"]) == (404, "Upload not found")
        assert (await c.get("/v1/uploads", headers=auth(stranger))).json() == []
        listed = (await c.get("/v1/uploads", headers=auth(owner))).json()
        assert [row["upload_id"] for row in listed] == [upload_id]


async def test_poker_accounts_are_added_refused_listed_and_removed_per_user() -> None:
    async with http() as c:
        owner = await register(c)
        stranger = await register(c)
        path = "/v1/auth/poker-accounts"

        added = await c.post(
            path, json={"site": "pokerstars", "screen_name": "  Hero "}, headers=auth(owner)
        )
        assert added.status_code == 201, added.text
        account = added.json()
        assert account["screen_name"] == "Hero"

        twice = await c.post(
            path, json={"site": "pokerstars", "screen_name": "hero"}, headers=auth(owner)
        )
        assert (twice.status_code, twice.json()["detail"]) == (
            409,
            "'hero' is already one of your pokerstars screen names.",
        )
        elsewhere = await c.post(
            path, json={"site": "ggpoker", "screen_name": "Hero"}, headers=auth(owner)
        )
        assert elsewhere.status_code == 201, "the same name on another site is another account"

        taken = await c.delete(f"{path}/{account['id']}", headers=auth(stranger))
        assert (taken.status_code, taken.json()["detail"]) == (404, "Poker account not found")
        assert (await c.get(path, headers=auth(stranger))).json() == []

        assert (await c.delete(f"{path}/{account['id']}", headers=auth(owner))).status_code == 204
        remaining = (await c.get(path, headers=auth(owner))).json()
        assert [(a["site"], a["screen_name"]) for a in remaining] == [("ggpoker", "Hero")]
        assert (await c.delete(f"{path}/{account['id']}", headers=auth(owner))).status_code == 404


class _SilentBus:
    def publish_upload(self, message: UploadMessage, *, bulk: bool = False) -> None:
        raise PublishError("no delivery report")


class _BrokenStore:
    def put(self, key: str, data: bytes) -> int:
        raise ConnectionError("endpoint http://minio:9000 refused: bucket poker-raw-test")

    def get(self, key: str) -> str:
        raise AssertionError("never read")


async def test_an_unacknowledged_publish_fails_the_row_ignores_a_late_pointer_and_retries(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with http() as c:
        token = await register(c)
        monkeypatch.setattr(sinks, "event_bus", _SilentBus)
        refused = await upload(c, token, "pokerstars", "cash_6max_nl50.txt")
        assert (refused.status_code, refused.json()["detail"]) == (503, QUEUE_SILENT)
        (row,) = (await c.get("/v1/uploads", headers=auth(token))).json()
        assert (row["status"], row["error_text"]) == ("failed", QUEUE_SILENT)

        # The broker stored the pointer after all and delivers it late: the worker must not undo
        # the failure the uploader was shown.
        monkeypatch.undo()
        sinks.event_bus().publish_upload(
            UploadMessage(
                upload_id=row["upload_id"],
                tenant_id=await tenant_of(c, token),
                site="pokerstars",
                object_key=object_key_of(row["upload_id"]),
                sha256="",
                hero_names=[],
            )
        )
        assert worker.drain() >= 1
        late = await upload_row(c, token, row["upload_id"])
        assert (late["status"], late["hands_parsed"]) == ("failed", 0)
        assert (await c.get("/v1/hands", headers=auth(token))).json() == []

        again = await upload(c, token, "pokerstars", "cash_6max_nl50.txt")
        assert again.json() == {
            "upload_id": row["upload_id"],
            "status": "queued",
            "dedupe": "requeued",
        }
        assert worker.drain() >= 1
        assert (await upload_row(c, token, row["upload_id"]))["status"] == "completed"


async def test_storage_that_does_not_answer_is_a_sentence_and_leaves_no_row(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with http() as c:
        token = await register(c)
        monkeypatch.setattr(sinks, "raw_store", _BrokenStore)
        res = await upload(c, token, "pokerstars", "cash_6max_nl50.txt")
        assert (res.status_code, res.json()["detail"]) == (503, STORAGE_SILENT)
        assert (await c.get("/v1/uploads", headers=auth(token))).json() == []


async def test_a_processing_upload_the_worker_went_silent_on_is_retried() -> None:
    """A lost terminal status must cost a retry, not the file (`upload_store.STALE_PROCESSING`)."""
    async with http() as c:
        token = await register(c)
        upload_id = (await upload(c, token, "ggpoker", "rush_nl50.txt")).json()["upload_id"]
        worker.drain()
        with psycopg.connect(get_settings().postgres_libpq_dsn, autocommit=True) as conn:
            conn.execute(
                "UPDATE uploads SET status = 'processing', updated_at = now() WHERE id = %s",
                (upload_id,),
            )
        busy = await upload(c, token, "ggpoker", "rush_nl50.txt")
        assert busy.json()["dedupe"] == "duplicate", "a worker that spoke just now is still on it"

        with psycopg.connect(get_settings().postgres_libpq_dsn, autocommit=True) as conn:
            conn.execute(
                "UPDATE uploads SET updated_at = now() - interval '1 hour' WHERE id = %s",
                (upload_id,),
            )
        stale = await upload(c, token, "ggpoker", "rush_nl50.txt")
        assert stale.json()["dedupe"] == "requeued"
        worker.drain()
        done = await upload_row(c, token, upload_id)
        assert (done["status"], done["hands_parsed"]) == ("completed", 2)
