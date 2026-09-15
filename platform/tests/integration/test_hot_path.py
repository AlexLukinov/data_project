"""A hand ingested through the worker is in a report before dbt runs (plan E.1b, ADR-047).

The sentence E.1 could not close: "an upload is visible in stats without a dbt run". Four
things have to be true for that, and each is asserted here against the real stack, in order:

  1. the worker's hot path puts the batch in the fact tables and, through the materialized
     view, in a `run_report` answer, with dbt never having seen it;
  2. a redelivery of the same message writes nothing twice;
  3. the rows the hot path derived are the rows dbt derives -- compared with EXCEPT in both
     directions once dbt has replaced them, every column but the provenance;
  4. a partition holding a hot-path row is dirty for dbt even when the watermark says clean,
     which is the guard against the swap race, and the report reads the same before and after.

Requires the stack. Run with `make test-all`.
"""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

import pytest
from clickhouse_connect.driver.client import Client

from core.settings import get_settings
from ingestion import sinks, worker
from ingestion.clickhouse import clickhouse
from ingestion.messages import UploadMessage
from ingestion.sinks import FakeRawStore
from scripts import mv_sync
from scripts.anchors import DEFAULT_ANCHORS, anchor_sql, dirty_sql
from scripts.rollup_sql import disagreements_sql
from stats import tenancy
from stats.registry import registry
from stats.request import ReportRequest
from stats.service import run_report
from tests.integration.test_mv_reconciliation import _dbt

pytestmark = pytest.mark.integration

CORPUS = Path(__file__).resolve().parents[2] / "seeds" / "hands"
KEY = "site=pokerstars/user_id=hot/cash_6max_nl50.txt"
STATS = ["vpip", "pfr", "hands", "cbet_flop", "bb_per_100"]
SNAPSHOT = "__hot_snapshot"


@pytest.fixture(scope="module")
def tenant() -> int:
    """A tenant nobody else in the suite writes for; its ClickHouse user is dropped after."""
    tenant_id = 7000 + int(uuid.uuid4().hex[:3], 16)
    yield tenant_id
    tenancy.drop(tenant_id)


@pytest.fixture(scope="module")
def client() -> Client:
    return clickhouse()


def _message(tenant_id: int) -> UploadMessage:
    return UploadMessage(
        upload_id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        site="pokerstars",
        object_key=KEY,
        sha256="",
        hero_names=["Hero"],
    )


def _ingest(tenant_id: int) -> dict[str, int]:
    """The worker's own `process`, with the real ClickHouse sink and the raw text in memory."""
    store = FakeRawStore({KEY: (CORPUS / "pokerstars" / "cash_6max_nl50.txt").read_text()})
    return worker.process(_message(tenant_id), sink=sinks.hand_sink(), store=store)


def _report(tenant_id: int) -> dict[str, Any]:
    """One ungrouped hero report through the tenant's own connection, as the API runs it."""
    result = run_report(ReportRequest(stats=STATS), tenant_id=tenant_id, cache=None)
    if not result.rows:
        return {"total": 0}
    cells = {code: (cell.value, cell.n) for code, cell in result.rows[0].cells.items()}
    return {"total": result.hands, **cells}


def _counts(client: Client, tenant_id: int) -> dict[str, tuple[int, int]]:
    """(rows, of which hot) per fact table for the tenant."""
    marts = get_settings().db("marts")
    return {
        table: tuple(
            client.query(
                f"select count(), countIf(built_by = 'hot') from {marts}.{table}"
                " where user_id = %(t)s",
                parameters={"t": tenant_id},
            ).result_rows[0]
        )
        for table in ("decisions", "player_hands")
    }


def _disagreements(client: Client, tenant_id: int, left: str, right: str) -> int:
    """`scripts.mv_sync --verify`'s comparison, scoped to one tenant's group-rows."""
    marts = get_settings().db("marts")
    sql = disagreements_sql(marts, left, right, registry(), where=f"user_id = {tenant_id}")
    return int(client.query(sql).result_rows[0][0])


def _rollup_rows(client: Client, table: str, tenant_id: int) -> int:
    marts = get_settings().db("marts")
    return int(
        client.query(
            f"select count() from {marts}.{table} where user_id = %(t)s",
            parameters={"t": tenant_id},
        ).result_rows[0][0]
    )


def test_an_upload_is_in_a_report_with_no_dbt_run(client: Client, tenant: int) -> None:
    assert _report(tenant)["total"] == 0, "a fresh tenant must start empty"

    counts = _ingest(tenant)
    assert counts == {"found": 2, "parsed": 2, "failed": 0}

    facts = _counts(client, tenant)
    assert facts["decisions"][0] > 0 and facts["decisions"] == (facts["decisions"][0],) * 2, (
        "every decision row of the batch must say the worker derived it"
    )
    assert facts["player_hands"] == (12, 12), "two 6-max hands: twelve seats, all hot"
    assert _rollup_rows(client, "stats_daily", tenant) == 0, "dbt has not run for this tenant"
    assert _rollup_rows(client, "stats_daily_mv", tenant) > 0, "the view fired on the insert"

    report = _report(tenant)
    assert report["total"] == 2 and report["hands"] == (2, 2)
    assert report["vpip"][1] == 2 and report["vpip"][0] is not None
    assert report["total"] == report["pfr"][1]


def test_a_redelivery_writes_nothing_twice(client: Client, tenant: int) -> None:
    """At-least-once delivery, exactly-once effect -- now for the fact tables and the view too."""
    before = _counts(client, tenant)
    mv_before = _rollup_rows(client, "stats_daily_mv", tenant)
    report_before = _report(tenant)

    _ingest(tenant)

    assert _counts(client, tenant) == before
    assert _rollup_rows(client, "stats_daily_mv", tenant) == mv_before, "the view fired again"
    assert _report(tenant) == report_before


def test_hot_path_rows_are_dbt_rows(client: Client, tenant: int) -> None:
    """The derivation is written once: dbt replaces the hot rows with its own and nothing but
    the provenance differs, over every column of both tables, in both directions.

    The watermark is left out of the comparison on purpose: the redelivery above re-stamped the
    core rows (the loader stamps every batch afresh), so dbt's rebuild carries the newer stamp
    while the hot rows keep the one they were derived under. That is the gate working -- the
    newer stamp is what made the partition dirty -- not a difference in what a decision is.
    """
    marts = get_settings().db("marts")
    report_before = _report(tenant)
    for table in ("decisions", "player_hands"):
        client.command(f"drop table if exists {marts}.{SNAPSHOT}_{table}")
        client.command(
            f"create table {marts}.{SNAPSHOT}_{table} engine = MergeTree order by tuple() as "
            f"select * except (built_by, src_parsed_at) from {marts}.{table}"
            " where user_id = %(t)s and built_by = 'hot'",
            parameters={"t": tenant},
        )

    _dbt("run")

    for table in ("decisions", "player_hands"):
        rebuilt = (
            f"select * except (built_by, src_parsed_at) from {marts}.{table}"
            f" where user_id = {tenant}"
        )
        snapshot = f"select * from {marts}.{SNAPSHOT}_{table}"
        for left, right in ((rebuilt, snapshot), (snapshot, rebuilt)):
            diff = client.query(f"select count() from ({left} except {right})").result_rows[0][0]
            assert diff == 0, f"{table}: {diff} row(s) the hot path and dbt derive differently"
        assert _counts(client, tenant)[table][1] == 0, "dbt's swap replaced every hot row"
        client.command(f"drop table {marts}.{SNAPSHOT}_{table}")

    # The report now comes from dbt's rollup (the slice is clean) and says the same thing.
    assert _rollup_rows(client, "stats_daily", tenant) > 0
    assert _report(tenant) == report_before
    assert _disagreements(client, tenant, "stats_daily", "stats_daily_mv") == 0, (
        "for this tenant the view's copy equals dbt's, group-row for group-row"
    )


def test_a_partition_with_a_hot_row_is_dirty_whatever_the_watermark_says(
    client: Client, tenant: int
) -> None:
    """The race guard. A hot row carrying a stamp far in the past -- so the watermark clause
    `src_max > built_max` is false -- still makes dbt rebuild the partition, which is what
    removes it. The stamp is also below the views' boundary, so the row never reaches the
    view target: what is being tested is the gate, not a second insert of the same decision."""
    marts, prefix = get_settings().db("marts"), get_settings().clickhouse_db_prefix
    partition = client.query(
        f"select toYYYYMMDD(played_at_utc) from {marts}.decisions where user_id = %(t)s limit 1",
        parameters={"t": tenant},
    ).result_rows[0][0]
    built = anchor_sql(prefix, DEFAULT_ANCHORS)
    watermark_only = (
        f"select count() from (select toYYYYMMDD(played_at_utc) as m, max(parsed_at) as src_max"
        f" from {prefix}core.hands group by m) as src left join ({built}) as built"
        " on built.m = src.m where src.m = %(m)s and src.src_max > built.built_max"
    )
    assert client.query(watermark_only, parameters={"m": partition}).result_rows[0][0] == 0, (
        "the watermark clause must call the partition clean first"
    )
    gate = dirty_sql(prefix, DEFAULT_ANCHORS).removesuffix(" FORMAT TSV")

    client.command(
        f"insert into {marts}.decisions select * replace ('hot'::LowCardinality(String)"
        " as built_by, toDateTime64('2000-01-01 00:00:00', 3, 'UTC') as src_parsed_at)"
        f" from {marts}.decisions where user_id = %(t)s limit 1",
        parameters={"t": tenant},
    )
    dirty_after = {row[0] for row in client.query(gate).result_rows}
    assert partition in dirty_after, "the mirror in scripts/anchors.py must see the hot row"

    _dbt("run", "--select", "decisions")
    assert _counts(client, tenant)["decisions"][1] == 0, (
        "the macro's gate must have rebuilt the partition, which is what removes the hot row"
    )


def test_verify_reports_no_drift_for_the_tenant(client: Client, tenant: int) -> None:
    """What `scripts.mv_sync --verify` runs on the real database, scoped to this tenant."""
    assert _disagreements(client, tenant, "stats_daily_mv", "stats_daily") == 0
    assert mv_sync.present_views(client) >= {mv_sync.view_name(s) for s in mv_sync.SOURCES}
