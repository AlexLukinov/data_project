"""Spot frequency across the pool: which situations occur, how often, and on what boards.

Answers "what should I study first" by counting, not by opinion. Every hand in `core.actions`
is folded into a node (see `spot_nodes.py`), every flop into a texture class
(`spot_texture.py`), and both are ranked by frequency -- flop-reaching and preflop-only spots
in one list, because that is the order they are met at the table.

Hero seats are *not* excluded: they are 0.22% of hands and this is a pool-wide census, not a
leak report. `pool_report.py` is the hero-excluded one.

Emits: reports/spot_frequency.md (report) + reports/spot_frequency.csv (every node).
"""

from __future__ import annotations

import csv
from pathlib import Path

from scripts import spot_plan, spot_report
from scripts.spot_nodes import (
    WALK,
    Spot,
    fetch_flop_lines,
    fetch_spots,
    preflop_node,
    verify_corpus_assumptions,
)
from scripts.spot_texture import (
    check_against_theory,
    fetch_composites,
    fetch_high_card_by_spot,
    fetch_joint,
    fetch_marginals,
    theoretical,
)

OUT = Path(__file__).resolve().parent.parent / "reports"


def build_md(spots: list[Spot], lines: dict, total: int) -> str:
    """Run the texture queries and assemble the whole report."""
    walk = next((s.hands for s in spots if s.spot == WALK), 0)
    flops = sum(s.flop_hands for s in spots)
    marginals = fetch_marginals()
    composites = fetch_composites(spot_plan.TOP_COMPOSITES)
    top_spots, _ = spot_plan.plan_inputs(spots, composites)
    joint = fetch_joint(preflop_node(), top_spots)
    keep = {name for name, _, _ in composites[: spot_plan.PLAN_TEXTURES]}
    removal = fetch_high_card_by_spot(preflop_node(), spot_plan.removal_spots(spots))
    levels = {s.spot: s.level for s in spots}
    seen_ace = marginals["high"].get("A", (0, 0.0))[1]
    random_ace = theoretical()["high"]["A"]
    body = [
        *spot_report.header(total, flops, walk),
        *spot_report.section_plan(spots, total - walk),
        *spot_plan.section_texture(marginals, check_against_theory(marginals), flops),
        *spot_plan.section_composites(composites),
        *spot_plan.section_crossed([j for j in joint if j[1] in keep], flops),
        *spot_report.section_patterns(spots, total),
        *spot_report.section_flop(spots, lines),
        *spot_plan.section_card_removal(removal, levels, random_ace, seen_ace),
        *spot_report.caveats(),
    ]
    return "\n".join(body)


def write_csv(spots: list[Spot]) -> None:
    """Every node above the threshold, machine-readable."""
    with open(OUT / "spot_frequency.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(
            [
                "spot",
                "pattern",
                "level",
                "work",
                "players",
                "hands",
                "pct_hands",
                "flop_hands",
                "preflop_hands",
                "pct_sees_flop",
                "avg_pot_bb",
            ]
        )
        for s in spots:
            w.writerow(
                [
                    s.spot,
                    s.pattern,
                    s.level,
                    spot_report.work_kind(s),
                    s.players,
                    s.hands,
                    f"{s.pct:.4f}",
                    s.flop_hands,
                    s.preflop_hands,
                    f"{s.flop_pct:.2f}",
                    f"{s.avg_pot_bb:.2f}",
                ]
            )


if __name__ == "__main__":
    hand_total = verify_corpus_assumptions()
    all_spots = fetch_spots(hand_total)
    top_nodes = [s.spot for s in all_spots if s.is_playable][: spot_report.TOP_FLOP_NODES]
    flop_lines = fetch_flop_lines(top_nodes)
    (OUT / "spot_frequency.md").write_text(build_md(all_spots, flop_lines, hand_total))
    write_csv(all_spots)
    print(f"hands: {hand_total:,}  nodes: {len(all_spots)}")
    print(f"wrote {OUT / 'spot_frequency.md'} and {OUT / 'spot_frequency.csv'}")
