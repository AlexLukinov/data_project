"""The generated rollup, seed and law test follow the registry exactly, and `--check` bites."""

from __future__ import annotations

import csv
import io
import re
from pathlib import Path

import pytest

from scripts.gen_stats import (
    HEADER,
    ROLLUP,
    expected_files,
    main,
    render_law_test,
    render_rollup,
    render_seed,
)
from stats.registry import registry

_ALIAS = re.compile(r"\bas\s+([a-z][a-z0-9_]*),?\s*$", re.MULTILINE)


def _branches(sql: str) -> tuple[list[str], list[str]]:
    first, second = sql.split("union all")
    return _ALIAS.findall(first), _ALIAS.findall(second)


def test_rollup_branches_have_identical_columns() -> None:
    decisions, hands = _branches(render_rollup(registry()))
    assert decisions == hands
    assert decisions[:4] == ["player_key", "day", "hands", "vpip_opp"] or "hands" in decisions


def test_every_cached_stat_is_in_the_rollup() -> None:
    columns = set(_branches(render_rollup(registry()))[0])
    for stat in registry().stats.values():
        if not stat.cached:
            continue
        if stat.denominator_expr is None:
            assert stat.code in columns, stat.code
        else:
            assert {f"{stat.code}_opp", f"{stat.code}_action"} <= columns, stat.code
    assert "af_flop_opp" not in columns  # not cached: arithmetic does not sum across days


def test_rollup_reads_each_grain_from_its_own_table() -> None:
    sql = render_rollup(registry())
    first, second = sql.split("union all")
    assert "ref('decisions')" in first and "ref('player_hands')" in second
    opportunity = "countIf(street = 'flop' AND facing = 'bet' AND facing_is_cbet = 1)"
    assert f"{opportunity} as fold_to_cbet_flop_opp" in first
    assert "toUInt64(0) as fold_to_cbet_flop_opp" in second
    assert "sum(toDecimal128(net_won_bb, 4)) as bb_per_100_action" in second
    assert "toDecimal128(0, 4) as bb_per_100_action" in first
    assert "count() as hands" in second and "toUInt64(0) as hands" in first
    assert sql.startswith(HEADER)
    keys = "user_id, dataset, player_key, day, site, stake_level, game_type, table_format"
    assert f"order_by='({keys}, position, is_hero, is_anonymized)'" in sql


def test_seed_has_one_row_per_stat() -> None:
    rows = list(csv.DictReader(io.StringIO(render_seed(registry()))))
    assert [r["code"] for r in rows] == list(registry().stats)
    vpip = next(r for r in rows if r["code"] == "vpip")
    assert (
        vpip["typical_low"] == "18.0" and vpip["cached"] == "1" and vpip["higher_is_better"] == ""
    )
    assert next(r for r in rows if r["code"] == "wwsf")["higher_is_better"] == "1"


def test_law_test_lists_every_cached_pair() -> None:
    pairs = set(re.findall(r"\('([a-z0-9_]+)', '([a-z0-9_]+)'\)", render_law_test(registry())))
    expected = {
        (f"{s.code}_action", f"{s.code}_opp")
        for s in registry().stats.values()
        if s.cached and s.denominator_expr is not None
    }
    assert pairs == expected
    assert f"ref('{ROLLUP}')" in render_law_test(registry())


def test_generated_files_are_current() -> None:
    """What `make gen-check` enforces in CI, as a unit test too."""
    for path, content in expected_files(registry()).items():
        assert path.exists(), f"{path.name} missing -- run `make gen`"
        assert path.read_text() == content, f"{path.name} is stale -- run `make gen`"


def test_check_mode_reports_a_stale_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from scripts import gen_stats

    original = gen_stats.expected_files
    monkeypatch.setattr(
        gen_stats, "expected_files", lambda reg, project=tmp_path: original(reg, tmp_path)
    )
    assert main(["--check"]) == 1  # nothing written yet
    assert main([]) == 0  # writes
    assert main(["--check"]) == 0  # now current
    (tmp_path / "seeds" / "stat_definitions.csv").write_text("edited by hand\n")
    assert main(["--check"]) == 1
