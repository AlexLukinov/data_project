"""The seven cohorts against a real rollup: disjoint and total on the built table (plan G.4).

Requires the stack (`make test-all`). `tests/test_cohort_presets.py` proves the partition on
the rules; this proves it on `stats_daily` as the engine evaluates it -- the sum of the seven
sizes is the number of players with a VPIP, and a group's size is the sum of its labels'.
The test corpus is small, so the numbers are small; the identity is what matters.
"""

from __future__ import annotations

import pytest

from analysis.pool import cohorts
from core.settings import get_settings
from ingestion.clickhouse import clickhouse
from stats.cohort import cohort_size
from stats.service import clickhouse_runner

pytestmark = pytest.mark.integration

TENANT = 1


def _players_with_a_vpip() -> int:
    marts = get_settings().db("marts")
    rows = (
        clickhouse()
        .query(
            f"SELECT count() FROM (SELECT player_key FROM {marts}.stats_daily"
            " WHERE user_id = {tenant:UInt32} AND dataset = 'population' AND player_key != ''"
            " GROUP BY player_key HAVING sum(vpip_opp) > 0)",
            parameters={"tenant": TENANT},
        )
        .result_rows
    )
    return int(rows[0][0])


def test_the_seven_labels_partition_the_players_the_rollup_knows() -> None:
    presets = cohorts.cohort_presets()
    sizes = {p.code: cohort_size(p.spec, TENANT, run=clickhouse_runner) for p in presets}
    assert sum(sizes.values()) == _players_with_a_vpip()


def test_a_group_is_exactly_the_sum_of_its_labels() -> None:
    presets = cohorts.cohort_presets()
    by_code = {p.code: p for p in presets}
    for group in cohorts.groups(presets):
        spec = cohorts.group_spec(group.key, presets)
        if spec is None:
            continue
        whole = cohort_size(spec, TENANT, run=clickhouse_runner)
        parts = sum(
            cohort_size(by_code[c].spec, TENANT, run=clickhouse_runner) for c in group.cohorts
        )
        assert whole == parts, group.key
