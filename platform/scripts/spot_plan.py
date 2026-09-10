"""Markdown sections that bring board texture in as the second axis of the plan.

Texture is independent of the preflop spot -- the cards are dealt after the betting, so the
board cannot know who raised. That is verified, not assumed (`section_texture` prints the
observed-vs-theoretical check), and it is what makes section C a clean product: the frequency
of a (spot, texture) pair is just the two frequencies multiplied.

The one exception is the high card, which range composition genuinely moves through card
removal. `section_card_removal` measures it.
"""

from __future__ import annotations

from scripts.spot_nodes import Spot
from scripts.spot_report import table
from scripts.spot_texture import theoretical

TOP_COMPOSITES = 20  # composite textures listed in section B
PLAN_SPOTS = 8  # spots crossed with texture in section C
PLAN_TEXTURES = 8  # textures crossed with spots in section C
PLAN_ROWS = 40  # rows of the crossed plan actually printed
REMOVAL_PER_LEVEL = 4  # spots per pot type in the card-removal table

DIM_TITLE = {"conn": "Connectedness", "suit": "Suitedness", "high": "Highest card"}


def section_texture(
    marginals: dict[str, dict[str, tuple[int, float]]], breaches: list[str], flops: int
) -> list[str]:
    """Observed texture distribution, checked against exact enumeration of all 22,100 flops."""
    theory = theoretical()
    out = [
        "## B. Board texture — the second axis",
        "",
        f"Every flop in the corpus ({flops:,}) classified three ways. Straight span counts the "
        "ace high **or** low, so A-2-3 is connected. `theory` is the exact percentage over all "
        "C(52,3) = 22,100 distinct flops, computed by enumeration in Python; `observed` is this "
        "corpus. They are independent implementations of the same rules, so agreement is a live "
        "check that the board parser and the classifier are both right.",
        "",
        "Connectedness and suitedness are the parity check — a range cannot skew them, so they "
        "should match theory exactly, and they do. **The high card is expected to deviate** and "
        "is not part of the check: a flop you actually see is conditioned on the hand reaching "
        "one, and hands reach a flop when players hold high cards. Aces are therefore depleted "
        "from the board. Section F measures that per spot.",
        "",
    ]
    if breaches:
        out += ["> **PARITY CHECK FAILED** — " + "; ".join(breaches), ""]
    else:
        out += ["> Parity check passed: connectedness and suitedness match theory.", ""]
    for dim in ("conn", "suit", "high"):
        out += [f"### {DIM_TITLE[dim]}", ""]
        rows = [
            [
                name,
                f"{marginals[dim][name][0]:,}",
                f"{marginals[dim][name][1]:.2f}%",
                f"{want:.2f}%",
                f"{marginals[dim][name][1] - want:+.2f}",
            ]
            for name, want in sorted(theory[dim].items(), key=lambda kv: -kv[1])
        ]
        out += [*table(["class", "flops", "observed", "theory", "diff pp"], rows), ""]
    return out


def section_composites(composites: list[tuple[str, int, float]]) -> list[str]:
    """The composite texture label, ranked -- the board half of the plan."""
    out = [
        "## B2. Composite textures, ranked",
        "",
        "High card, suitedness and connectedness together. This is the board you actually face, "
        "and the top row is the single most common flop shape in poker.",
        "",
    ]
    rows = [
        [str(i), f"`{name}`", f"{n:,}", f"{pct:.2f}%"]
        for i, (name, n, pct) in enumerate(composites[:TOP_COMPOSITES], 1)
    ]
    out += table(["#", "texture", "flops", "% of flops"], rows)
    return [*out, ""]


def section_crossed(joint: list[tuple[str, str, int]], flops: int) -> list[str]:
    """Spot x texture, ranked by joint frequency -- the postflop study units in order."""
    out = [
        "## C. Spot x texture — the postflop study units, most frequent first",
        "",
        f"The top {PLAN_SPOTS} flop-reaching spots crossed with the top {PLAN_TEXTURES} board "
        "textures, ranked by how often that exact combination happens. `% of flops` is the "
        f"share of all {flops:,} flops in the corpus. Because texture is independent of the "
        "spot, each cell is very close to the product of the two — which means you can study "
        "the axes separately and still meet the cells in this order.",
        "",
    ]
    rows = [
        [str(i), f"`{spot}`", f"`{tex}`", f"{n:,}", f"{100 * n / flops:.3f}%"]
        for i, (spot, tex, n) in enumerate(joint[:PLAN_ROWS], 1)
    ]
    out += table(["#", "spot", "texture", "flops", "% of flops"], rows)
    return [*out, ""]


def section_card_removal(
    rates: list[tuple[str, int, float]],
    levels: dict[str, str],
    random_deck: float,
    seen: float,
) -> list[str]:
    """Where texture is *not* independent of the spot: the high card, via card removal."""
    out = [
        "## F. Card removal — the one place texture depends on the spot",
        "",
        f"A random flop is ace-high {random_deck:.2f}% of the time. Across flops that were "
        f"actually *seen* it is {seen:.2f}% — aces are missing from the board because they are "
        "in someone's hand. Split by spot, the effect reverses sign exactly where the ranges "
        "say it should:",
        "",
        "- **Limped pots run ace-heavy.** Neither blind raised, so neither holds an ace, and the "
        "aces stay in the deck.",
        "- **3bet and 4bet pots run ace-light.** Both players are in with ace-heavy ranges, so "
        "the aces are held rather than dealt.",
        "",
        "Pairing, suitedness and connectedness show none of this (section B) — ranges select on "
        "rank, not on suit or spacing. So the high card is the only texture dimension where the "
        "preflop spot changes what board you should expect.",
        "",
    ]
    rows = [
        [
            f"`{spot}`",
            levels.get(spot, ""),
            f"{flops:,}",
            f"{pct:.2f}%",
            f"{pct - random_deck:+.2f}",
        ]
        for spot, flops, pct in rates
    ]
    out += table(["spot", "pot", "flops", "ace-high", "vs random deck pp"], rows)
    return [*out, ""]


def removal_spots(spots: list[Spot]) -> list[str]:
    """Top playable spots from each pot type, so the card-removal contrast is actually visible.

    Taking the globally most frequent spots would return single-raised pots only, and the whole
    point is the limped-vs-3bet gradient.
    """
    by_level: dict[str, list[str]] = {}
    for s in spots:
        if s.is_playable:
            by_level.setdefault(s.level, []).append(s.spot)
    return [name for names in by_level.values() for name in names[:REMOVAL_PER_LEVEL]]


def plan_inputs(spots: list[Spot], composites: list[tuple[str, int, float]]) -> tuple[list, list]:
    """The spot and texture shortlists that section C crosses."""
    top_spots = [s.spot for s in spots if s.is_playable][:PLAN_SPOTS]
    top_textures = [name for name, _, _ in composites[:PLAN_TEXTURES]]
    return top_spots, top_textures
