"""Flop board texture, and how it combines with the preflop spot.

Texture is classified the way the study brief defines it, which differs from
`int_board_texture.sql` in one way that matters: the straight span is computed with the ace
counted high *or* low, so A-2-3 is connected (span 2), not disconnected (span 12). The dbt
model is ace-high only. If the two are ever reconciled, this is the correct definition.

The classifier is cross-validated on every run. `theoretical()` enumerates all C(52,3) = 22,100
flops in Python and classifies them with an independent implementation of the same rules; the
observed ClickHouse distribution must match it to within `TOLERANCE_PP`. Two implementations
agreeing is the check that the SQL is right -- and a parser change that corrupted board cards
would break it loudly instead of quietly skewing every texture number in the report.
"""

from __future__ import annotations

from collections import Counter
from itertools import combinations

from scripts.spot_nodes import SIX_MAX, q

RANKS = "23456789TJQKA"  # index 1..13 via position(); 9 is the first broadway (T)
SUITS = "cdhs"
BROADWAY = 9  # rank index of T, the lowest broadway card
ACE = 13
TOLERANCE_PP = 0.5  # observed vs theoretical, in percentage points
# Dimensions a player's range cannot skew, so they parity-check the parser. The high card is
# excluded on purpose -- see check_against_theory().
STRUCTURAL_DIMS = ("conn", "suit")

FLOP_ROWS = f"core.hands WHERE board_flop_1 != '' AND {SIX_MAX}"


def classify(cards: list[tuple[int, str]]) -> tuple[str, str, str]:
    """Classify one flop into (connectedness, suitedness, high-card) -- the Python side.

    Deliberately a separate implementation from `texture_sql()`: the two are compared against
    each other by `check_against_theory()`, so they must not share code.
    """
    ranks = [r for r, _ in cards]
    wheel = [0 if r == ACE else r for r in ranks]
    span = min(max(ranks) - min(ranks), max(wheel) - min(wheel))
    if len(set(ranks)) < 3:
        conn = "paired"
    else:
        conn = {2: "connected", 3: "one-gap", 4: "two-gap"}.get(span, "disconnected")
    suits = {s for _, s in cards}
    suit = {1: "monotone", 2: "two-tone", 3: "rainbow"}[len(suits)]
    hi = max(ranks)
    return conn, suit, (RANKS[hi - 1] if hi >= BROADWAY else "9-or-lower")


def theoretical() -> dict[str, dict[str, float]]:
    """Exact percentages over all 22,100 distinct flops, by enumeration."""
    deck = [(r, s) for r in range(1, 14) for s in SUITS]
    counts: dict[str, Counter] = {"conn": Counter(), "suit": Counter(), "high": Counter()}
    total = 0
    for flop in combinations(deck, 3):
        conn, suit, high = classify(list(flop))
        counts["conn"][conn] += 1
        counts["suit"][suit] += 1
        counts["high"][high] += 1
        total += 1
    return {dim: {k: 100 * v / total for k, v in c.items()} for dim, c in counts.items()}


def texture_sql() -> str:
    """Per-hand flop texture: connectedness, suitedness, high card, broadway count."""
    return f"""
        SELECT hand_uid, conn, suit, high, bw,
               concat(if(high = '9-or-lower', 'low', concat(high, '-high')),
                      ' ', suit, ' ', conn) AS texture
        FROM (
            SELECT hand_uid, bw,
                   multiIf(nd < 3, 'paired', span = 2, 'connected', span = 3, 'one-gap',
                           span = 4, 'two-gap', 'disconnected') AS conn,
                   multiIf(s1 = s2 AND s2 = s3, 'monotone',
                           s1 = s2 OR s2 = s3 OR s1 = s3, 'two-tone', 'rainbow') AS suit,
                   if(hi >= {BROADWAY}, substring('{RANKS}', hi, 1), '9-or-lower') AS high
            FROM (
                SELECT hand_uid, s1, s2, s3,
                       length(arrayDistinct(ranks)) AS nd,
                       arrayMax(ranks) AS hi,
                       arrayCount(x -> x >= {BROADWAY}, ranks) AS bw,
                       least(arrayMax(ranks) - arrayMin(ranks),
                             arrayMax(wheel) - arrayMin(wheel)) AS span
                FROM (
                    SELECT hand_uid,
                           [position('{RANKS}', substring(board_flop_1, 1, 1)),
                            position('{RANKS}', substring(board_flop_2, 1, 1)),
                            position('{RANKS}', substring(board_flop_3, 1, 1))] AS ranks,
                           arrayMap(x -> if(x = {ACE}, 0, x), ranks) AS wheel,
                           substring(board_flop_1, 2, 1) AS s1,
                           substring(board_flop_2, 2, 1) AS s2,
                           substring(board_flop_3, 2, 1) AS s3
                    FROM {FLOP_ROWS}
                )
            )
        )"""


def fetch_marginals() -> dict[str, dict[str, tuple[int, float]]]:
    """Observed distribution of each texture dimension over every flop in the corpus."""
    out: dict[str, dict[str, tuple[int, float]]] = {}
    for dim in ("conn", "suit", "high"):
        rows = q(f"""
            SELECT {dim} AS k, count() AS n,
                   round(100.0 * count() / sum(count()) OVER (), 3) AS pct
            FROM ({texture_sql()})
            GROUP BY k ORDER BY n DESC FORMAT JSONEachRow""")
        out[dim] = {r["k"]: (int(r["n"]), float(r["pct"])) for r in rows}
    return out


def check_against_theory(observed: dict[str, dict[str, tuple[int, float]]]) -> list[str]:
    """Compare the *structural* texture dimensions to exact enumeration; return any breaches.

    Only connectedness and suitedness are checked. The high card is deliberately excluded: a
    flop that was actually seen is conditioned on the hand reaching one, and hands reach a flop
    when players hold high cards -- so aces are systematically depleted from the board relative
    to a random deal. That is card removal, measured in `fetch_high_card_by_spot()`, not a
    parser fault. Connectedness and suitedness carry no such selection, so they are the honest
    parity check on the board parser.
    """
    theory = theoretical()
    breaches = []
    for dim in STRUCTURAL_DIMS:
        for name, want in theory[dim].items():
            got = observed[dim].get(name, (0, 0.0))[1]
            if abs(got - want) > TOLERANCE_PP:
                breaches.append(f"{dim}/{name}: observed {got:.2f}% vs theoretical {want:.2f}%")
    return breaches


def fetch_composites(limit: int) -> list[tuple[str, int, float]]:
    """The composite texture label (`A-high two-tone disconnected`), ranked."""
    rows = q(f"""
        SELECT texture, count() AS n,
               round(100.0 * count() / sum(count()) OVER (), 3) AS pct
        FROM ({texture_sql()})
        GROUP BY texture ORDER BY n DESC LIMIT {limit} FORMAT JSONEachRow""")
    return [(r["texture"], int(r["n"]), float(r["pct"])) for r in rows]


def fetch_joint(node_sql: str, nodes: list[str]) -> list[tuple[str, str, int]]:
    """Joint (preflop spot, composite texture) counts for the given nodes."""
    quoted = ", ".join("'" + n.replace("'", "''") + "'" for n in nodes)
    rows = q(f"""
        SELECT pf.node AS spot, b.texture AS texture, count() AS n
        FROM ({node_sql}) AS pf
        INNER JOIN ({texture_sql()}) AS b USING (hand_uid)
        WHERE pf.node IN ({quoted})
        GROUP BY spot, texture ORDER BY n DESC FORMAT JSONEachRow""")
    return [(r["spot"], r["texture"], int(r["n"])) for r in rows]


def fetch_high_card_by_spot(node_sql: str, nodes: list[str]) -> list[tuple[str, int, float]]:
    """Ace-high flop rate per spot -- the one texture dimension ranges actually move.

    Both players in a 3bet pot hold aces more often, so fewer aces remain in the deck; in a
    limped pot neither player has one. This is card removal, and it is measurable.
    """
    quoted = ", ".join("'" + n.replace("'", "''") + "'" for n in nodes)
    rows = q(f"""
        SELECT pf.node AS spot, count() AS flops,
               round(100.0 * countIf(b.high = 'A') / count(), 2) AS ace_pct
        FROM ({node_sql}) AS pf
        INNER JOIN ({texture_sql()}) AS b USING (hand_uid)
        WHERE pf.node IN ({quoted})
        GROUP BY spot HAVING flops > 0 ORDER BY ace_pct DESC FORMAT JSONEachRow""")
    return [(r["spot"], int(r["flops"]), float(r["ace_pct"])) for r in rows]
