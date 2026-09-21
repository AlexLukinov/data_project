"""Parity of the v2 stat engine against the v1 flag table, stat by stat (plan C.6).

    uv run python -m scripts.fingerprint                  # writes reports/parity_<date>.md
    uv run python -m scripts.fingerprint --out -          # print instead

For every built-in stat that existed in v1 (same code on both sides), the v1 value and
opportunity count come from the v1 rollup `marts.stats_daily` (its counters, the pairs frozen
in `scripts/v1_stats.py`), the v2 ones from `stats.service.run_report` -- the same path the
API uses -- with `hero_only` off so both sides measure every seat of a dataset, as the STATUS
fingerprint does. Overall and by position, hero and population.

Verdicts: a stat whose registry entry carries no `v1_parity` must agree within rounding
(MISMATCH otherwise); one with `v1_parity` says there how its v2 definition departs from v1,
so it is expected to differ and is shown as `noted`. Before ADR-062 the field read was
`notes`, which now holds a caveat for a reader and says nothing about v1. Stats new in v2 (no
v1 counterpart) are listed at the end.

The v1 chain was dropped after `reports/parity_2026-09-09.md` (plan C.6). To run this again,
restore it first: check out the v1 dbt models at commit `cab27e3`, create them empty with
`dbt run --full-refresh --vars 'empty_chain: true'`, backfill, and rename the v2 rollup aside
(the v1 rollup takes the `marts.stats_daily` name this script reads).
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

from ingestion.clickhouse import clickhouse
from scripts.v1_stats import V1_STATS
from stats.registry import registry
from stats.request import ReportRequest
from stats.service import run_report

PLATFORM = Path(__file__).resolve().parent.parent
TENANT = 1
DATASETS = ("hero", "population")
VALUE_TOLERANCE = 0.011
"""Percentage points (or bb/100): both sides round to two decimals, so 0.01 is rounding."""
MAX_STATS_PER_REQUEST = 40


@dataclass(frozen=True, slots=True)
class Row:
    """One comparison cell."""

    code: str
    dataset: str
    position: str
    v1_value: float | None
    v2_value: float | None
    v1_n: int
    v2_n: int
    noted: bool

    @property
    def delta(self) -> float | None:
        """v2 minus v1, in the stat's own unit."""
        if self.v1_value is None or self.v2_value is None:
            return None
        return round(self.v2_value - self.v1_value, 3)

    @property
    def verdict(self) -> str:
        """`ok`, `noted` (documented definition change) or `MISMATCH`."""
        if self.noted:
            return "noted"
        if self.delta is None:
            return "ok" if self.v1_value == self.v2_value else "MISMATCH"
        return "ok" if abs(self.delta) <= VALUE_TOLERANCE and self.v1_n == self.v2_n else "MISMATCH"


def v1_values(codes: list[str], dataset: str, by_position: bool) -> dict[str, dict[str, Any]]:
    """{position: {code: value, code__n: n}} from the v1 rollup, keyed '' when ungrouped."""
    selects = []
    for code in codes:
        stat = V1_STATS[code]
        selects.append(f"{stat.expression()} AS {code}")
        selects.append(f"{stat.sample_expression()} AS {code}__n")
    group = "s.position" if by_position else "''"
    sql = (
        f"SELECT {group} AS position, {', '.join(selects)} FROM marts.stats_daily AS s "
        "WHERE s.user_id = {tenant:UInt32} AND s.dataset = {dataset:String} "
        "GROUP BY position ORDER BY position"
    )
    result = clickhouse().query(sql, parameters={"tenant": TENANT, "dataset": dataset})
    rows = [dict(zip(result.column_names, r, strict=True)) for r in result.result_rows]
    return {str(r["position"]): r for r in rows}


def v2_values(codes: list[str], dataset: str, by_position: bool) -> dict[str, dict[str, Any]]:
    """The same shape from the v2 engine, in requests of at most 40 stats."""
    merged: dict[str, dict[str, Any]] = {}
    for start in range(0, len(codes), MAX_STATS_PER_REQUEST):
        request = ReportRequest(
            dataset=dataset,
            hero_only=False,
            stats=codes[start : start + MAX_STATS_PER_REQUEST],
            group_by=["position"] if by_position else [],
        )
        result = run_report(request, tenant_id=TENANT)
        for row in result.rows:
            key = str(row.group.get("position", "")) if by_position else ""
            cell = merged.setdefault(key, {})
            for code, value in row.cells.items():
                cell[code] = value.value
                cell[f"{code}__n"] = value.n
    return merged


def compare(codes: list[str], noted: set[str], by_position: bool) -> list[Row]:
    """Every (stat, dataset, position) cell, both sides."""
    rows: list[Row] = []
    for dataset in DATASETS:
        v1 = v1_values(codes, dataset, by_position)
        v2 = v2_values(codes, dataset, by_position)
        for position in sorted(set(v1) | set(v2)):
            a, b = v1.get(position, {}), v2.get(position, {})
            for code in codes:
                rows.append(
                    Row(
                        code=code,
                        dataset=dataset,
                        position=position,
                        v1_value=_float(a.get(code)),
                        v2_value=_float(b.get(code)),
                        v1_n=int(a.get(f"{code}__n") or 0),
                        v2_n=int(b.get(f"{code}__n") or 0),
                        noted=code in noted,
                    )
                )
    return rows


def _float(value: Any) -> float | None:
    return None if value is None else round(float(value), 3)


def render(overall: list[Row], by_position: list[Row], new_codes: list[str]) -> str:
    """The Markdown report."""
    mismatches = [r for r in overall + by_position if r.verdict == "MISMATCH"]
    lines = [
        f"# v1 → v2 stat parity — {date.today().isoformat()}",
        "",
        f"Tenant {TENANT}, every seat of each dataset (hero_only off on both sides). "
        f"v1 = `marts.stats_daily` counters; v2 = `stats.service.run_report`.",
        "",
        f"**{len(overall)} overall cells and {len(by_position)} by-position cells; "
        f"{len(mismatches)} MISMATCH.** `noted` = the registry entry documents a definition "
        "change; `ok` = within rounding.",
        "",
        "## Overall",
        "",
    ]
    lines += _table(overall)
    lines += ["", "## By position", ""]
    lines += _table(by_position)
    lines += [
        "",
        "## New in v2 (no v1 counterpart)",
        "",
        ", ".join(f"`{c}`" for c in new_codes),
        "",
    ]
    return "\n".join(lines)


def _table(rows: list[Row]) -> list[str]:
    out = [
        "| stat | dataset | position | v1 | v2 | Δ | v1 n | v2 n | verdict |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for r in rows:
        cells = (
            f"`{r.code}`",
            r.dataset,
            r.position or "—",
            _fmt(r.v1_value),
            _fmt(r.v2_value),
            _fmt(r.delta),
            f"{r.v1_n:,}",
            f"{r.v2_n:,}",
            r.verdict,
        )
        out.append("| " + " | ".join(cells) + " |")
    return out


def _fmt(value: float | None) -> str:
    return "—" if value is None else f"{value:g}"


def main(argv: list[str] | None = None) -> int:
    """Compute the parity report; exit 1 when an un-noted stat mismatches."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default=f"reports/parity_{date.today().isoformat()}.md")
    args = ap.parse_args(argv)

    reg = registry()
    shared = [code for code in reg.stats if code in V1_STATS]
    new_codes = [code for code in reg.stats if code not in V1_STATS]
    # `v1_parity`, not `notes`: since ADR-062 `notes` is the caveat a reader sees and says
    # nothing about v1, while `v1_parity` is exactly "this definition departs from v1, here is
    # how much" -- which is the thing that makes a mismatch expected rather than a regression.
    noted = {code for code in shared if reg.stats[code].v1_parity}
    overall = compare(shared, noted, by_position=False)
    by_position = compare(shared, noted, by_position=True)
    text = render(overall, by_position, new_codes)

    if args.out == "-":
        print(text)
    else:
        path = PLATFORM / args.out
        path.write_text(text)
        print(f"wrote {path.relative_to(PLATFORM)}")
    mismatches = sum(1 for r in overall + by_position if r.verdict == "MISMATCH")
    print(f"{len(overall)} overall cells, {len(by_position)} by position, {mismatches} MISMATCH")
    return 1 if mismatches else 0


if __name__ == "__main__":
    sys.exit(main())
