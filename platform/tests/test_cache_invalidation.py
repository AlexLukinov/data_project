"""The worker's cache drop reaches every key a tenant's reports are cached under (ADR-051).

It once scanned `stats:{tenant}:*` while every report was written as `report:{tenant}:...`, and so
deleted nothing: an upload was in ClickHouse and not on screen for the cache's TTL, with no test
red. These pin the two writers to the prefixes the invalidation scans, and the scan to one tenant.
"""

from __future__ import annotations

import fnmatch
from collections.abc import Iterator

import pytest

from api.cache import stats_key
from ingestion import cache
from ingestion.cache import REPORT_PREFIX, STATS_PREFIX, TENANT_PREFIXES, invalidate_tenant
from stats.request import ReportRequest


class _FakeRedis:
    def __init__(self, keys: set[str]) -> None:
        self.keys = keys

    def scan_iter(self, match: str, count: int) -> Iterator[str]:
        return iter([k for k in sorted(self.keys) if fnmatch.fnmatchcase(k, match)])

    def delete(self, key: str) -> None:
        self.keys.discard(key)


def test_both_writers_use_a_prefix_the_invalidation_scans() -> None:
    report = ReportRequest(stats=["vpip"]).cache_key(7)
    block = stats_key(7, "timeline", {"a": 1})
    assert report.startswith(f"{REPORT_PREFIX}:7:") and REPORT_PREFIX in TENANT_PREFIXES
    assert block.startswith(f"{STATS_PREFIX}:7:") and STATS_PREFIX in TENANT_PREFIXES


def test_one_tenants_reports_and_blocks_go_and_nobody_elses(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mine = {ReportRequest(stats=["vpip"]).cache_key(7), stats_key(7, "timeline", {})}
    others = {
        ReportRequest(stats=["vpip"]).cache_key(70),
        ReportRequest(stats=["vpip"]).cache_key(8),
        stats_key(77, "timeline", {}),
        "ratelimit:7:reports",
    }
    fake = _FakeRedis(mine | others)
    monkeypatch.setattr(cache, "client", lambda: fake)

    assert invalidate_tenant(7) == 2
    assert fake.keys == others
