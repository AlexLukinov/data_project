"""An upload over HTTP is counted by a report, with no dbt run and the report cache on (plan D.8).

The chain D.8's "Done means" walks in a browser, minus the browser: `POST /v1/uploads` -> object
storage -> Kafka -> the worker (`drain`, the same `_handle` the long-running worker calls) -> the
hot path -> `POST /v1/reports/run`. `test_hot_path.py` proves the derivation with the worker's
`process` called directly and the cache off; `test_ingest_to_stats.py` goes over HTTP but stops at
`/v1/hands`, which reads `core.*`. Neither would have caught the worker's cache drop deleting
nothing, which this file was written against.

**Every tenant here is registered fresh**, so dbt has never built it: `stats_daily` is asserted
empty for it, and the numbers can only have come from the hot path. Emptiness is asserted per
tenant because other files in the session run dbt.
"""

from __future__ import annotations

from typing import Any

import pytest

from api import upload_intake
from ingestion import sinks, worker
from ingestion.cache import invalidate_tenant
from ingestion.messages import UploadMessage
from tests.integration._uploads import (
    auth,
    http,
    register,
    report,
    rollup_rows,
    tenant_of,
    upload,
    upload_row,
)

pytestmark = pytest.mark.integration


async def test_an_upload_is_counted_by_a_warm_report_with_no_dbt_run() -> None:
    async with http() as c:
        token = await register(c)
        tenant = await tenant_of(c, token)
        invalidate_tenant(tenant)  # tenant ids restart per session; Redis db 1 does not

        before = await report(c, token)
        assert before["hands"] == 0
        assert (await report(c, token))["cached"] is True, "the report cache must be on"

        # No poker account: a PokerStars self-export names its hero on the `Dealt to` line.
        accepted = await upload(c, token, "pokerstars", "cash_6max_nl50.txt")
        assert accepted.status_code == 202, accepted.text
        assert accepted.json()["dedupe"] == "new"
        assert worker.drain() >= 1

        row = await upload_row(c, token, accepted.json()["upload_id"])
        assert (row["status"], row["dataset"], row["site"]) == ("completed", "hero", "pokerstars")
        found = (row["hands_found"], row["hands_parsed"], row["hands_failed"])
        assert found == (2, 2, 0) and row["hands_without_hero"] == 0
        assert row["error_text"] == ""

        after = await report(c, token)
        assert after["cached"] is False, "the worker must have dropped the warm entry"
        assert after["hands"] == 2
        assert rollup_rows("stats_daily", tenant) == 0, "dbt has not built this tenant"
        assert rollup_rows("stats_daily_mv", tenant) > 0, "the hot path fed the view"


async def test_a_pool_file_under_my_hands_is_stored_counted_and_left_out_of_my_game() -> None:
    async with http() as c:
        token = await register(c)
        accepted = await upload(c, token, "ggpoker", "observed_nl25.txt")
        assert accepted.status_code == 202, accepted.text
        worker.drain()

        row = await upload_row(c, token, accepted.json()["upload_id"])
        assert row["status"] == "completed" and row["hands_parsed"] == 1
        assert row["hands_without_hero"] == 1, "the only trace that no seat was the uploader's"
        assert (await report(c, token))["hands"] == 0


async def test_a_pool_upload_reaches_the_pool_report() -> None:
    async with http() as c:
        token = await register(c)
        accepted = await upload(c, token, "ggpoker", "observed_nl25.txt", dataset="population")
        assert accepted.status_code == 202, accepted.text
        worker.drain()

        row = await upload_row(c, token, accepted.json()["upload_id"])
        assert (row["status"], row["dataset"], row["hands_without_hero"]) == (
            "completed",
            "population",
            0,
        )
        pool = await report(c, token, dataset="population", hero_only=False)
        assert pool["hands"] == 6, "one 6-max hand is six player-hands in the pool"


async def test_a_file_over_the_bulk_threshold_goes_to_the_bulk_topic_and_still_reaches_stats(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    published: list[bool] = []
    real = sinks.event_bus()

    class _Recording:
        def publish_upload(self, message: UploadMessage, *, bulk: bool = False) -> None:
            published.append(bulk)
            real.publish_upload(message, bulk=bulk)

    monkeypatch.setattr(upload_intake, "BULK_THRESHOLD_BYTES", 1)
    monkeypatch.setattr(sinks, "event_bus", _Recording)
    async with http() as c:
        token = await register(c)
        accepted = await upload(c, token, "pokerstars", "edge_cases.txt")
        assert accepted.status_code == 202, accepted.text
        assert published == [True]
        assert worker.drain() >= 1

        row: dict[str, Any] = await upload_row(c, token, accepted.json()["upload_id"])
        assert row["status"] == "completed" and row["hands_parsed"] == 4
        hands = (await c.get("/v1/hands?limit=10", headers=auth(token))).json()
        assert len(hands) == 4
        assert (await report(c, token))["hands"] == 4, "every stored hand is in the report"
