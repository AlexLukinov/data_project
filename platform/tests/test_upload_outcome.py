"""What the worker writes to an upload row, and in what order (plan D.8, ADR-051).

Two properties the upload page depends on and nothing else would catch:

  * **an exception never reaches `error_text`** -- the uploader reads that column, and a storage
    exception carries hosts and SQL;
  * **the tenant's cached reports are dropped before the terminal status is written** -- a page
    re-reads its reports the moment it sees the upload end.

No stack: the row writes are captured at `upload_status._execute`, and Kafka is a stub message.
"""

from __future__ import annotations

import logging

import pytest

from ingestion import upload_status, worker
from ingestion.messages import UploadMessage
from ingestion.pipeline import IngestResult
from ingestion.upload_status import FAILED_ON_OUR_SIDE, failure_sentence

LEAKY = "DatabaseError: Code: 60. host 10.0.0.5:8123 SELECT secret FROM core.hands s3://poker-raw"


class _Message:
    """The two methods `worker._handle` calls on a confluent_kafka Message."""

    def __init__(self, payload: bytes) -> None:
        self._payload = payload

    def error(self) -> None:
        return None

    def value(self) -> bytes:
        return self._payload


def _payload() -> bytes:
    return UploadMessage(
        upload_id="u-1",
        tenant_id=7,
        site="pokerstars",
        object_key="k",
        sha256="",
        hero_names=[],
    ).to_json()


@pytest.fixture
def journal(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, tuple[object, ...]]]:
    """Every row write and cache drop, in order."""
    events: list[tuple[str, tuple[object, ...]]] = []
    monkeypatch.setattr(upload_status, "_execute", lambda sql, params: events.append((sql, params)))
    monkeypatch.setattr(
        worker, "invalidate_tenant", lambda tenant: events.append(("drop", (tenant,)))
    )
    monkeypatch.setattr(
        worker, "claim", lambda upload_id: events.append(("claim", (upload_id,))) or True
    )
    return events


def _statuses(events: list[tuple[str, tuple[object, ...]]]) -> list[str]:
    """What each event did, as a word: the cache drop, or the status/progress it wrote."""
    words = []
    for sql, params in events:
        if sql in ("drop", "claim"):
            words.append(sql)
        elif "SET status = 'failed'" in sql:
            words.append("failed")
        elif "SET status = %s" in sql:
            words.append(str(params[0]))
        else:
            words.append("progress")
    return words


def test_an_exception_is_logged_and_the_row_gets_a_sentence(
    journal: list[tuple[str, tuple[object, ...]]],
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    def explode(message: UploadMessage, **_: object) -> dict[str, int]:
        raise RuntimeError(LEAKY)

    monkeypatch.setattr(worker, "process", explode)
    caplog.set_level(logging.ERROR, logger="ingestion.worker")
    assert worker._handle(_Message(_payload())) is True  # type: ignore[arg-type]

    (record,) = [r for r in caplog.records if r.name == "ingestion.worker"]
    assert record.exc_info is not None and isinstance(record.exc_info[1], RuntimeError)
    assert LEAKY in caplog.text, "the cause is logged in full -- the row is the one place it is not"

    assert _statuses(journal) == ["claim", "drop", "failed"]
    written = [str(p) for _, params in journal for p in params]
    assert FAILED_ON_OUR_SIDE in written
    assert not any("10.0.0.5" in w or "SELECT" in w or "s3://" in w for w in written)


def test_a_file_that_stored_nothing_ends_failed_in_words(
    journal: list[tuple[str, tuple[object, ...]]], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        worker, "process", lambda message, **_: {"found": 3, "parsed": 0, "failed": 3}
    )
    worker._handle(_Message(_payload()))  # type: ignore[arg-type]

    assert _statuses(journal) == ["claim", "drop", "failed"]
    _, params = journal[-1]
    assert params[0] == "failed"
    assert "None of the 3 hands in this file could be read." in str(params[5])


def test_the_cache_is_dropped_before_completed_is_written(
    journal: list[tuple[str, tuple[object, ...]]], monkeypatch: pytest.MonkeyPatch
) -> None:
    def ingest(message: UploadMessage, *, progress: object = None, **_: object) -> dict[str, int]:
        result = IngestResult(found=2, stored=2, without_hero=1)
        assert callable(progress)
        progress(result)
        return result.as_counts()

    monkeypatch.setattr(worker, "process", ingest)
    worker._handle(_Message(_payload()))  # type: ignore[arg-type]

    assert _statuses(journal) == ["claim", "progress", "drop", "completed"]
    _, progress_params = journal[1]
    assert progress_params == (2, 2, 0, 1, "u-1")
    _, final = journal[-1]
    assert final == ("completed", 2, 2, 0, 1, "", "u-1")


@pytest.mark.parametrize(
    ("counts", "sentence"),
    [
        (
            {"found": 0, "parsed": 0},
            "No hands were found in this file. Check that it is a ggpoker hand history.",
        ),
        (
            {"found": 1, "parsed": 0},
            "The one hand in this file could not be read. It is kept for the parser's backlog.",
        ),
        (
            {"found": 1200, "parsed": 0},
            "None of the 1,200 hands in this file could be read. "
            "They are kept for the parser's backlog.",
        ),
        ({"found": 5, "parsed": 1}, ""),
    ],
)
def test_the_failure_sentence(counts: dict[str, int], sentence: str) -> None:
    assert failure_sentence(counts, "ggpoker") == sentence


def test_a_late_pointer_for_a_failed_upload_is_skipped_and_committed(
    journal: list[tuple[str, tuple[object, ...]]], monkeypatch: pytest.MonkeyPatch
) -> None:
    """The API told the uploader "not sent"; a pointer the broker stored anyway must not undo it."""
    ran: list[str] = []
    monkeypatch.setattr(worker, "claim", lambda upload_id: False)
    monkeypatch.setattr(worker, "process", lambda message, **_: ran.append("ran") or {})

    assert worker._handle(_Message(_payload())) is True  # type: ignore[arg-type]
    assert ran == [] and journal == []
