"""Write the files derived from the stat registry (`make gen`), or check them (`--check`).

    uv run python -m scripts.gen_stats            # rewrite the generated files
    uv run python -m scripts.gen_stats --check    # exit 1 if any file differs (CI)

Generated (ADR-021), each carrying a `GENERATED` header and never edited by hand:
  dbt/poker_dwh/models/marts/stats_daily.sql          the daily rollup: one `<code>_opp` /
                                                      `<code>_action` pair per `cached` stat,
                                                      decision-grain from `decisions`, hand-grain
                                                      from `player_hands`, UNION ALL on the keys
  dbt/poker_dwh/seeds/stat_definitions.csv            labels, categories, typical ranges
  dbt/poker_dwh/tests/assert_action_le_opportunity.sql
                                                      the law of arithmetic for EVERY pair
  ch/migrations/0011_mv_stats_daily.sql               the MV's target table and its boundary
  ch/views/stats_daily_mv.sql                         one MATERIALIZED VIEW per source table,
                                                      the SAME SELECT as the dbt model (ADR-003)

The last two are the freshness half (ADR-025, ADR-044). dbt and the materialized view express
the same statistics, and `select_body()` below emits BOTH, so drift between them is not a thing
to guard against but a thing that cannot be written down.
"""

from __future__ import annotations

import argparse
import csv
import io
import sys
from pathlib import Path

from scripts.rollup_sql import (
    HEADER,
    MV_MIGRATION,
    MV_TARGET,
    ROLLUP,
    _branch,
    _group_by,
    render_mv_migration,
    render_mv_views,
)
from stats.registry import Registry, registry

PROJECT = Path(__file__).resolve().parent.parent / "dbt" / "poker_dwh"

SEED_COLUMNS = (
    "code", "label", "category", "grain", "format", "higher_is_better",
    "typical_low", "typical_high", "cached", "description", "notes",
)  # fmt: skip


def render_rollup(reg: Registry) -> str:
    """The generated `stats_daily` model."""
    order_by = _group_by()
    config = (
        "{{\n  config(\n    materialized='incremental',\n"
        "    incremental_strategy='insert_overwrite',\n    engine='SummingMergeTree()',\n"
        f"    order_by='({order_by})',\n    partition_by='toYYYYMMDD(day)',\n  )\n}}}}\n"
    )
    doc = (
        "-- The daily stat rollup (POKER_PLAN.md §2.3, ADR-021): every group key is in the ORDER\n"
        "-- BY, one opportunity / action pair per `cached` stat. Decision-grain stats are counted\n"
        "-- on `decisions`, hand-grain on `player_hands`; the two branches zero-fill each other's\n"
        "-- columns and SummingMergeTree adds rows sharing a key, so `sum(x)` is exact before and\n"
        "-- after merges. Adding a stat is one registry entry and `make gen`.\n"
    )
    return (
        f"{HEADER}\n{doc}\n{config}\n"
        + _branch(reg, "decisions", "decisions")
        + "\n\nunion all\n\n"
        + _branch(reg, "player_hands", "player_hands")
        + "\n"
    )


def render_seed(reg: Registry) -> str:
    """`stat_definitions.csv`: what the UI and the API need to describe a stat."""
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(SEED_COLUMNS)
    for stat in reg.stats.values():
        low, high = stat.typical if stat.typical is not None else (None, None)
        better = "" if stat.higher_is_better is None else int(stat.higher_is_better)
        writer.writerow(
            [
                stat.code,
                stat.label,
                stat.category,
                stat.grain,
                stat.format,
                better,
                "" if low is None else low,
                "" if high is None else high,
                int(stat.cached),
                stat.description,
                stat.notes,
            ]
        )
    return out.getvalue()


def render_law_test(reg: Registry) -> str:
    """The v2 law test: no `_action` may exceed its `_opp`, for every cached pair."""
    pairs = [
        f"    ('{stat.code}_action', '{stat.code}_opp'),"
        for stat in reg.stats.values()
        if stat.cached and stat.denominator_expr is not None
    ]
    return (
        f"{HEADER}\n"
        "-- LAW OF ARITHMETIC: an action can never be counted more often than the opportunity\n"
        "-- that allowed it. Every cached stat is action / opportunity, so a violation means the\n"
        "-- opportunity predicate is narrower than the action predicate for some rows.\n\n"
        "{% set pairs = [\n" + "\n".join(pairs) + "\n] %}\n\n"
        "with totals as (\n    select\n        user_id,\n        dataset,\n"
        "        {%- for action, opp in pairs %}\n"
        "        sum({{ action }}) as {{ action }}__a,\n"
        '        sum({{ opp }}) as {{ opp }}__o{{ "," if not loop.last }}\n'
        "        {%- endfor %}\n"
        f"    from {{{{ ref('{ROLLUP}') }}}}\n    group by user_id, dataset\n)\n\n"
        "select * from totals\nwhere\n"
        "    {%- for action, opp in pairs %}\n"
        '    {{ action }}__a > {{ opp }}__o{{ " or" if not loop.last }}\n'
        "    {%- endfor %}\n"
    )


def expected_files(reg: Registry, project: Path = PROJECT) -> dict[Path, str]:
    """Path -> content for every generated file."""
    platform = project.parents[1]
    return {
        project / "models" / "marts" / f"{ROLLUP}.sql": render_rollup(reg),
        project / "seeds" / "stat_definitions.csv": render_seed(reg),
        project / "tests" / "assert_action_le_opportunity.sql": render_law_test(reg),
        platform / "ch" / "migrations" / f"{MV_MIGRATION}.sql": render_mv_migration(reg),
        platform / "ch" / "views" / f"{MV_TARGET}.sql": render_mv_views(reg),
    }


def _display(path: Path) -> Path:
    """The path relative to `platform/` when it is under it (tests render elsewhere)."""
    root = PROJECT.parents[1]
    return path.relative_to(root) if path.is_relative_to(root) else path


def main(argv: list[str] | None = None) -> int:
    """Write or check the generated files."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true", help="fail instead of writing")
    args = ap.parse_args(argv)

    stale = []
    for path, content in expected_files(registry()).items():
        current = path.read_text() if path.exists() else None
        if current == content:
            continue
        stale.append(path)
        if not args.check:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
            print(f"wrote {_display(path)}")

    if args.check and stale:
        names = ", ".join(p.name for p in stale)
        print(f"stale generated files: {names} -- run `make gen`", file=sys.stderr)
        return 1
    if not stale:
        print("generated stat files are up to date")
    return 0


if __name__ == "__main__":
    sys.exit(main())
