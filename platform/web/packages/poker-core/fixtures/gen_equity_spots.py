"""Independent expected values for `equity_spots.json` (plan F.2).

Written in Python on purpose, against the `treys` evaluator (MIT, a different code base from
ours), enumerating every runout for every non-conflicting matchup by brute force — no
prefix sums, no by-rank buckets, no shared code with the TypeScript engine. Where this file and
`src/equity/` agree, the TypeScript is right for the right reasons.

Definitions match the spec's §5.2: hero equity = Σᵢ Σⱼ wᵢ wⱼ · result / Σᵢ Σⱼ wᵢ wⱼ · runouts
over pairs that share no card, a tie scoring one half; per-combo equity is
Σⱼ wⱼ · result / Σⱼ wⱼ · runouts.

Run:  ../../../../../<scratch venv>/bin/python gen_equity_spots.py > equity_spots.json
(any Python ≥ 3.10 with `pip install treys`). Preflop spots enumerate 1,712,304 boards each
and take a couple of minutes.
"""

from __future__ import annotations

import itertools
import json
import sys
import time

from treys import Card, Evaluator

RANKS = "23456789TJQKA"
SUITS = "cdhs"
DECK = [r + s for r in RANKS for s in SUITS]
TREYS = {c: Card.new(c) for c in DECK}
EVALUATOR = Evaluator()


def canonical(c1: str, c2: str) -> str:
    """Higher rank first; equal ranks -> higher suit first (c < d < h < s)."""
    k1 = (RANKS.index(c1[0]), SUITS.index(c1[1]))
    k2 = (RANKS.index(c2[0]), SUITS.index(c2[1]))
    return c1 + c2 if k1 > k2 else c2 + c1


def combos_of_class(name: str) -> list[str]:
    """The combos of `AA` (6), `AKs` (4), `AKo` (12) or `AK` (16), spelled canonically."""
    a, b = RANKS.index(name[0].upper()), RANKS.index(name[1].upper())
    hi, lo = max(a, b), min(a, b)
    suffix = name[2:].lower()
    out = []
    if hi == lo:
        for s1, s2 in itertools.combinations(SUITS, 2):
            out.append(canonical(RANKS[hi] + s1, RANKS[hi] + s2))
        return out
    for s1 in SUITS:
        for s2 in SUITS:
            suited = s1 == s2
            if (suffix == "s" and not suited) or (suffix == "o" and suited):
                continue
            out.append(canonical(RANKS[hi] + s1, RANKS[lo] + s2))
    return out


def parse_range(text: str) -> dict[str, float]:
    """A tiny reader for what the fixture uses: classes, exact combos, `:weight`; last wins."""
    out: dict[str, float] = {}
    for entry in text.split(","):
        entry = entry.strip()
        if not entry:
            continue
        name, _, weight = entry.partition(":")
        w = float(weight) if weight else 1.0
        if len(name) == 4 and name[1] in SUITS and name[3] in SUITS:
            out[canonical(name[:2], name[2:])] = w
        else:
            for combo in combos_of_class(name):
                out[combo] = w
    return out


def cards(combo: str) -> tuple[str, str]:
    """The two cards of a canonical combo string."""
    return combo[:2], combo[2:]


def exact(
    hero: dict[str, float], villain: dict[str, float], board: list[str], dead: list[str]
) -> tuple[float, dict[str, float]]:
    """Hero's range equity and per-combo equities by enumerating every matchup and runout."""
    used = set(board) | set(dead)
    missing = 5 - len(board)
    board_ints = [TREYS[c] for c in board]
    num = den = 0.0
    per: dict[str, float] = {}
    for h, wh in hero.items():
        h1, h2 = cards(h)
        if h1 in used or h2 in used:
            continue
        hn = hd = 0.0
        hero_ints = [TREYS[h1], TREYS[h2]]
        for v, wv in villain.items():
            v1, v2 = cards(v)
            if v1 in used or v2 in used or v1 in (h1, h2) or v2 in (h1, h2):
                continue
            villain_ints = [TREYS[v1], TREYS[v2]]
            avail = [TREYS[c] for c in DECK if c not in used and c not in (h1, h2, v1, v2)]
            for runout in itertools.combinations(avail, missing):
                full = board_ints + list(runout)
                rh = EVALUATOR.evaluate(full, hero_ints)
                rv = EVALUATOR.evaluate(full, villain_ints)
                result = 1.0 if rh < rv else 0.5 if rh == rv else 0.0
                hn += wv * result
                hd += wv
        if hd > 0:
            per[h] = hn / hd
        num += wh * hn
        den += wh * hd
    if den == 0:
        raise ValueError(f"no live matchup: board {board} dead {dead} leave no hero/villain pair")
    return num / den, per


SPOTS: list[dict] = [
    # --- river: one runout, pure showdown arithmetic ---------------------------------------
    {"name": "river: AA vs KK, no help", "hero": "AA", "villain": "KK", "board": "Qs Jd 7h 3c 2d"},
    {"name": "river: nuts vs air", "hero": "AsKs", "villain": "2c3d", "board": "Qs Js Ts 4h 5h"},
    {
        "name": "river: mirror AA vs AA is a tie",
        "hero": "AA",
        "villain": "AA",
        "board": "Kh 9d 7c 4s 2h",
    },
    {
        "name": "river: AK vs AK, blockers and ties",
        "hero": "AK",
        "villain": "AK",
        "board": "Qh 7d 2c 9s 3h",
    },
    {
        "name": "river: range vs range",
        "hero": "AA,KK,QQ,AKs,AKo",
        "villain": "JJ,TT,99,AQs",
        "board": "Qd 8c 4s 2h 2c",
    },
    {
        "name": "river: weighted value vs bluff-catchers",
        "hero": "AA:0.5,KK,76s:0.25",
        "villain": "QQ,JJ,ATs",
        "board": "Kd 9c 5s 3h 2c",
    },
    {
        "name": "river: board plays, chopped",
        "hero": "2c3d",
        "villain": "4h5s",
        "board": "As Ks Qs Js Ts",
    },
    {
        "name": "river: flush over straight",
        "hero": "Ah2h",
        "villain": "JcTd",
        "board": "Kh Qh 9h 3c 2d",
    },
    # --- turn: one card to come ----------------------------------------------------------
    {"name": "turn: set vs overpair", "hero": "7c7d", "villain": "AhAd", "board": "Kh 7h 2c 4s"},
    {
        "name": "turn: flush draw vs top pair",
        "hero": "Ah5h",
        "villain": "KcQd",
        "board": "Kh 9h 2c 4s",
    },
    {
        "name": "turn: open-ender vs two pair",
        "hero": "JcTd",
        "villain": "9h8s",
        "board": "9d 8c 2h Kh",
    },
    {
        "name": "turn: range vs range",
        "hero": "QQ,JJ,AKs",
        "villain": "TT,99,KQs,AJs",
        "board": "Th 6d 2c 9s",
    },
    {
        "name": "turn: weighted range vs pair",
        "hero": "QQ:0.5,AKs",
        "villain": "JJ",
        "board": "Th 6d 2c 9s",
    },
    {
        "name": "turn: dead cards remove outs",
        "hero": "Ah5h",
        "villain": "KcQd",
        "board": "Kh 9h 2c 4s",
        "dead": "Qh Jh",
    },
    {"name": "turn: combo draw vs set", "hero": "Jh9h", "villain": "8c8d", "board": "Th 8h 2c 3s"},
    {
        "name": "turn: underpair vs overcards",
        "hero": "5c5d",
        "villain": "AhKd",
        "board": "Qs 9h 4c 2d",
    },
    # --- flop: two cards to come ---------------------------------------------------------
    {"name": "flop: AKs vs QQ, king high", "hero": "AsKs", "villain": "QhQd", "board": "Kh 7d 2c"},
    {"name": "flop: AKs vs QQ, queen high", "hero": "AsKs", "villain": "QhQd", "board": "Qc 7d 2h"},
    {
        "name": "flop: flush draw vs top pair",
        "hero": "Ah5h",
        "villain": "KcQd",
        "board": "Kh 9h 2c",
    },
    {
        "name": "flop: open-ender vs overcards",
        "hero": "9c8d",
        "villain": "AhKh",
        "board": "7h 6s 2c",
    },
    {"name": "flop: mirror AA vs AA is a tie", "hero": "AA", "villain": "AA", "board": "Kh 9d 7c"},
    {
        "name": "flop: AK vs AK, blockers and ties",
        "hero": "AK",
        "villain": "AK",
        "board": "Qh 7d 2c",
    },
    {
        "name": "flop: range vs range",
        "hero": "AA,KK,QQ,AKs",
        "villain": "JJ,TT,AQs",
        "board": "Jh 7d 2c",
    },
    {
        "name": "flop: weighted range vs pair",
        "hero": "QQ:0.5,AKs",
        "villain": "JJ",
        "board": "Th 6d 2c",
    },
    {
        "name": "flop: monotone, flush vs set",
        "hero": "QhJd",
        "villain": "AcAd",
        "board": "Ah Kh 5h",
    },
    {
        "name": "flop: straight vs flush draw",
        "hero": "Jc7c",
        "villain": "Ah2h",
        "board": "Th 9h 8h",
    },
    {
        "name": "flop: paired board, overcards vs trips draw",
        "hero": "AcKc",
        "villain": "7h6h",
        "board": "7d 7c 2s",
    },
    {
        "name": "flop: dead cards remove outs",
        "hero": "Ah5h",
        "villain": "KcQd",
        "board": "Kh 9h 2c",
        "dead": "Qh Jh",
    },
    {
        "name": "flop: small pairs vs broadway",
        "hero": "22,33",
        "villain": "AKo",
        "board": "Jh 7d 4c",
    },
    {
        "name": "flop: wheel draw vs top pair",
        "hero": "Ac4d",
        "villain": "KhQs",
        "board": "Kd 5c 2h",
    },
    {
        "name": "flop: overpair vs set-and-draws",
        "hero": "KsKd",
        "villain": "77,98s",
        "board": "7h 8d 2c",
    },
    {"name": "flop: same class both sides", "hero": "QQ", "villain": "QQ,AKs", "board": "Js 6d 3c"},
    # --- preflop: hand vs hand, exact by enumerating all 1,712,304 boards -----------------
    {"name": "preflop: AA vs KK", "hero": "AhAd", "villain": "KsKc", "board": ""},
    {"name": "preflop: AKs vs QQ", "hero": "AsKs", "villain": "QhQd", "board": ""},
    {"name": "preflop: JTs vs AKo", "hero": "JhTh", "villain": "AcKd", "board": ""},
]


def main() -> None:
    """Compute every spot and write the fixture JSON to stdout, timings to stderr."""
    out = []
    for spot in SPOTS:
        started = time.time()
        hero = parse_range(spot["hero"])
        villain = parse_range(spot["villain"])
        board = spot["board"].split()
        dead = spot.get("dead", "").split()
        equity, per = exact(hero, villain, board, dead)
        record = {
            "name": spot["name"],
            "hero": spot["hero"],
            "villain": spot["villain"],
            "board": spot["board"],
            "dead": spot.get("dead", ""),
            "heroEquity": round(equity, 10),
        }
        if len(hero) <= 24:
            record["perCombo"] = {k: round(v, 10) for k, v in per.items()}
        out.append(record)
        print(f"{spot['name']:<48} {equity:.6f}   {time.time() - started:6.1f}s", file=sys.stderr)
    json.dump(
        {"source": "treys 0.1.8, brute-force enumeration (gen_equity_spots.py)", "spots": out},
        sys.stdout,
        indent=1,
    )


if __name__ == "__main__":
    main()
