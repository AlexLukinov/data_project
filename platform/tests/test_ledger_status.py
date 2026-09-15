"""The bulk importer's ledger obeys the upload page's rule: nothing stored is `failed` (ADR-051).

It used to write `completed` whatever the counts, so a file the importer read as the wrong site
(0 hands) was skipped by every re-run and answered "duplicate" by the upload page for ever.
"""

from __future__ import annotations

from typing import Any

import pytest

from ingestion import ledger


class _Conn:
    def __init__(self, calls: list[tuple[str, tuple[Any, ...]]]) -> None:
        self.calls = calls

    def __enter__(self) -> _Conn:
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def execute(self, sql: str, params: tuple[Any, ...]) -> None:
        self.calls.append((sql, params))


def _record(monkeypatch: pytest.MonkeyPatch, counts: dict[str, int]) -> dict[str, Any]:
    calls: list[tuple[str, tuple[Any, ...]]] = []
    monkeypatch.setattr(ledger.psycopg, "connect", lambda *a, **k: _Conn(calls))
    ledger.record_upload(
        "dsn",
        upload_id="u",
        user_uuid="user",
        site="ggpoker",
        label="day.txt",
        key="k",
        digest="d",
        size=10,
        counts=counts,
        dataset="population",
    )
    ((sql, params),) = calls
    columns = sql.split("(", 1)[1].split(")", 1)[0].replace(" ", "").split(",")
    return dict(zip(columns, params, strict=False))


def test_a_file_that_stored_nothing_is_recorded_failed_in_words(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    row = _record(monkeypatch, {"found": 0, "parsed": 0, "failed": 0})
    assert row["status"] == "failed"
    assert row["error_text"] == (
        "No hands were found in this file. Check that it is a ggpoker hand history."
    )


def test_a_file_with_hands_is_recorded_completed(monkeypatch: pytest.MonkeyPatch) -> None:
    row = _record(monkeypatch, {"found": 5, "parsed": 4, "failed": 1, "without_hero": 0})
    assert (row["status"], row["error_text"], row["dataset"]) == ("completed", "", "population")
    assert (row["hands_found"], row["hands_parsed"], row["hands_failed"]) == (5, 4, 1)
