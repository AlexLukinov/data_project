"""dbt and the materialized view must produce the same rollup, row for row (ADR-003, ADR-044).

ADR-003 permits two tiers over one source of truth -- dbt owns the definitions, a ClickHouse
materialized view owns the hot path -- on one condition, stated there in as many words: "add a
reconciliation test asserting the MV output matches a full dbt rebuild for a sample window".
This is that test, and it is the reason the MV is allowed to exist at all.

**Why it compares aggregates and not rows.** `marts.stats_daily` and `marts.stats_daily_mv` are
both `SummingMergeTree`. Rows sharing a sort key collapse only when a merge happens to run, so
the two tables can hold a different NUMBER of rows while meaning exactly the same thing -- the
dbt model writes one part per build, the view writes one per insert block. Comparing raw counts
would fail for a reason that is not a bug. Summing per group key compares what the tables mean,
and is correct whatever the merge state.

**Why the traffic matters.** A view that agrees on a quiet table and diverges under load is
worse than no view, because it is wrong only when it is being used. So the second test drives
rows through the view in many separate insert blocks, which is the case that exercises partial
aggregation: each block produces its own partial row and they must sum to the same total the
dbt model computes in one pass.

Requires the stack. Run with `make test-all`.
"""

from __future__ import annotations

import os
import subprocess
import uuid
from datetime import UTC, date, datetime
from pathlib import Path

import pytest
from clickhouse_connect.driver.client import Client

from core.enums import Site
from core.settings import get_settings
from ingestion.clickhouse import clickhouse
from ingestion.pipeline import ingest_text
from ingestion.sinks import hand_sink
from parser.registry import get_parser
from scripts import mv_sync
from scripts.rollup_sql import (
    KEYS,
    MV_TARGET,
    ROLLUP,
    WATERMARK,
    disagreements_sql,
    value_columns,
)
from stats.registry import registry

pytestmark = pytest.mark.integration

PLATFORM = Path(__file__).resolve().parents[2]
PROJECT = PLATFORM / "dbt" / "poker_dwh"
CORPUS = PLATFORM / "seeds" / "hands"
TENANT = 1
REPLAYS = 12
"""How many separate insert blocks the traffic test pushes through the view. More than one is
the whole point; a dozen is enough for partial aggregates to have to sum."""


def _dbt(*args: str) -> None:
    """Run dbt against the test databases.

    `CLICKHOUSE_PORT` is exported deliberately: `profiles.yml` defaults to 8123, which is the
    minikube lab's ClickHouse, not the platform's on 8124.
    """
    binary = PLATFORM / ".venv-dbt" / "bin" / "dbt"
    if not binary.exists():
        pytest.skip(f"{binary} not found; run `make dbt-install`")
    result = subprocess.run(
        [str(binary), *args, "--project-dir", str(PROJECT), "--profiles-dir", str(PROJECT)],
        cwd=PLATFORM,
        env={**os.environ, "CLICKHOUSE_PORT": str(get_settings().clickhouse_port)},
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, f"dbt {' '.join(args)} failed:\n{result.stdout}\n{result.stderr}"


def _value_columns() -> list[str]:
    """Every rollup column that carries a number, so every one of them gets compared."""
    return value_columns(registry())


def _disagreements(client: Client, left: str, right: str) -> int:
    """Group-rows present in `left` that `right` does not match exactly.

    The SQL is `scripts/rollup_sql.py`'s, which `scripts/mv_sync.py --verify` runs on the
    real database; this test is that check with traffic driven through the view first.
    """
    sql = disagreements_sql(get_settings().db("marts"), left, right, registry())
    return int(client.query(sql).result_rows[0][0])


def _mass(client: Client, table: str) -> float:
    """Every counter in the table, added together.

    A blunt instrument on purpose: it exists so a test can prove it did not pass vacuously.
    Two rollups that are both empty, or both untouched by the traffic a test thinks it drove,
    compare equal and tell you nothing -- so the tests below assert this number MOVED before
    they assert the two tables agree about it.
    """
    total = " + ".join(f"toFloat64(sum({c}))" for c in _value_columns())
    return float(
        client.query(f"select {total} from {get_settings().db('marts')}.{table}").result_rows[0][0]
    )


def assert_identical(client: Client) -> None:
    """The two rollups must agree in both directions -- neither missing nor extra."""
    missing = _disagreements(client, ROLLUP, MV_TARGET)
    extra = _disagreements(client, MV_TARGET, ROLLUP)
    assert (missing, extra) == (0, 0), (
        f"dbt and the materialized view disagree: {missing} group-rows the model has that the "
        f"view does not match, {extra} the other way. Compared {len(_value_columns())} counters "
        f"across {len(KEYS)} group keys."
    )


def _ingest_corpus() -> int:
    """Load every seed hand through the real pipeline, as an upload would."""
    sink = hand_sink()
    total = 0
    for site_dir in sorted(CORPUS.iterdir()):
        site = Site(site_dir.name)
        for path in sorted(site_dir.glob("*.txt")):
            result = ingest_text(
                sink,
                get_parser(site),
                path.read_text(),
                tenant_id=TENANT,
                site=site_dir.name,
                object_key=f"test/{site_dir.name}/{path.name}",
                upload_id=str(uuid.uuid4()),
                hero_names=frozenset({"hero"}),
            )
            total += result.stored
    return total


@pytest.fixture(scope="module")
def built() -> Client:
    """Hands in `core`, the whole chain built by dbt, and the views re-fenced over it.

    `recreate`, not `create`: the views exist since provisioning (ADR-047) and the ingest
    below reaches them through the worker's hot path, so the target already holds a
    hot-derived copy of the corpus. Emptying it and backfilling from dbt's own rows is what
    keeps this the test of the BACKFILL path; the hot-derived copy is compared with dbt's in
    `test_hot_path.py`.
    """
    client = clickhouse()
    assert _ingest_corpus() > 0, "the seed corpus must parse"
    _dbt("run")
    mv_sync.recreate(client, margin=2.0)
    return client


def _replay_day(client: Client, day: date, *, tag: str, limit: str = "") -> None:
    """Insert one more block of decisions into the fact table, as a hot path would.

    Plain `INSERT`, which is the only thing that reaches a materialized view -- dbt writes the
    marts with `ALTER TABLE ... REPLACE PARTITION`, a part-level swap that triggers no view at
    all. `hand_uid` is `FixedString(16)` here while `core.*` uses the hex form, so a tag cannot
    be appended to it; `hex(cityHash64(...))` is exactly 16 characters and gives each block its
    own distinct hands.
    """
    marts = get_settings().db("marts")
    where = limit or "where played_date = %(day)s and src_parsed_at < %(cut)s"
    client.command(
        f"insert into {marts}.decisions select * replace ("
        "  now64(3) as src_parsed_at,"
        "  toFixedString(hex(cityHash64(hand_uid, %(tag)s)), 16) as hand_uid"
        f") from {marts}.decisions {where}",
        parameters={"tag": tag, "day": day, "cut": _boundary(client)},
    )


def test_the_view_reproduces_the_dbt_rollup_exactly(built: Client) -> None:
    """The boundary backfill plus the view equals a full dbt rebuild -- ADR-003's condition.

    Every counter of every cached stat, across every group key, in both directions. Nothing is
    sampled: the corpus is small enough to compare in full, which is strictly stronger than the
    "sample window" ADR-003 asks for.
    """
    assert_identical(built)


def test_the_view_captures_traffic_arriving_after_the_boundary(built: Client) -> None:
    """Rows inserted in many blocks reach the view and sum to what dbt computes from the same table.

    This is the case that matters. The rows are pushed in as separate INSERTs so each produces
    its own partial aggregate in the target, and dbt is then made to rebuild the rollup over the
    *same* `marts.decisions` -- so any disagreement is the view's, not a difference of input.
    """
    marts = get_settings().db("marts")
    day = built.query(f"select min(played_date) from {marts}.decisions").result_rows[0][0]

    before = built.query(f"select count() from {marts}.decisions").result_rows[0][0]
    mass_before = _mass(built, MV_TARGET)
    for replay in range(REPLAYS):
        _replay_day(built, day, tag=f"r{replay}")
    after = built.query(f"select count() from {marts}.decisions").result_rows[0][0]
    assert after > before, "the replays must actually have landed in the fact table"

    # Non-vacuity, and it is the whole test: if the view had not fired, both rollups would
    # simply be unchanged and would still compare equal.
    mass_after = _mass(built, MV_TARGET)
    assert mass_after > mass_before, (
        "the view did not capture the replayed traffic -- the comparison below would have "
        f"passed without testing anything (mass {mass_before} -> {mass_after})"
    )

    # dbt rebuilds the rollup over the fact table as it now stands. `rebuild_from` is required:
    # the dirty gate asks whether the SOURCE changed, and these rows never went through `core`,
    # so nothing would look dirty and the rebuild would quietly do nothing.
    _dbt("run", "--select", ROLLUP, "--vars", f"{{rebuild_from: {day:%Y%m%d}}}")
    assert _mass(built, ROLLUP) == pytest.approx(mass_after), (
        "dbt did not rebuild over the replayed rows, so the two sides were never compared on "
        "the same input"
    )
    assert_identical(built)


def test_the_view_never_writes_into_the_dbt_anchor(built: Client) -> None:
    """`marts.stats_daily` is the incremental chain's anchor and the view must not touch it.

    `dirty_partitions()` decides whether a day needs rebuilding by comparing
    `max(core.hands.parsed_at)` against the `max(src_parsed_at)` already built in
    `marts.stats_daily`. `parsed_at` is stamped once per ingest batch and flows straight through
    to `src_parsed_at`, so a view writing its own rows into that table makes the two sides equal
    at the instant a batch lands -- and the gate is a strict `>`, so the day would read clean for
    ever and the fact tables would silently never be built for it. Hence the separate target;
    this asserts the separation holds.
    """
    marts = get_settings().db("marts")
    fingerprint = f"select count(), sum(vpip_opp), max({WATERMARK}) from {marts}.{ROLLUP}"
    before = built.query(fingerprint).result_rows[0]
    mass_before = _mass(built, MV_TARGET)
    day = built.query(f"select min(played_date) from {marts}.decisions").result_rows[0][0]

    _replay_day(built, day, tag=uuid.uuid4().hex[:6], limit="limit 25")

    # The insert must reach the view, or "the anchor did not move" is true for the boring
    # reason that nothing happened at all.
    assert _mass(built, MV_TARGET) > mass_before, "the view did not fire; the test proves nothing"
    assert built.query(fingerprint).result_rows[0] == before, (
        "an insert into marts.decisions changed marts.stats_daily -- a materialized view is "
        "writing into the dbt anchor, which makes the dirty-partition gate compare a value "
        "against itself"
    )

    # Leave the two rollups reconciled, so these tests do not depend on running in file order.
    _dbt("run", "--select", ROLLUP, "--vars", f"{{rebuild_from: {day:%Y%m%d}}}")
    assert_identical(built)


def _boundary(client: Client) -> datetime:
    """The decisions view's boundary, below which rows belong to the backfill."""
    at = mv_sync.boundaries(client).get(mv_sync.view_name("decisions"))
    assert at is not None, "the boundary must be recorded before the view exists"
    return at if at.tzinfo else at.replace(tzinfo=UTC)
