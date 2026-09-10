"""Preflop/flop *node* reconstruction from `core.actions`, and the queries that rank them.

A node is one hand's action sequence written the way a player says it out loud --
`BU open, BB call`, `UTG open, CO 3bet, UTG call` -- with folds compressed out preflop, so the
node names only the players who put money in. `spot_frequency.py` turns these into a report.

Two facts about this corpus make the reconstruction cheap and exact:

 1. The button is always seat 1 (GGPoker Rush & Cash renormalises seats every hand), so
    seat -> position is the fixed lookup in `SEATPOS` and needs no join to `core.hand_players`.
 2. `parser_version` is uniform and `hand_uid` is unique, so there are no ReplacingMergeTree
    duplicates to collapse and `FINAL` can be skipped -- a full pass costs ~10s, not ~10min.

Both assumptions are asserted by `verify_corpus_assumptions()`; call it before trusting output.
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass

CH = ["docker", "compose", "exec", "-T", "clickhouse", "clickhouse-client", "--query"]

# Seat 1..6 -> position. Valid only because button_seat is always 1 in this corpus.
SEATPOS = "['BU','SB','BB','UTG','HJ','CO']"
SIX_MAX = "players_dealt_in = 6"
DECISIONS = "('fold','check','call','raise','bet')"

MIN_HANDS = 500  # below this a node is too rare to be worth a study session
WALK = "walk (folded to BB)"


def q(sql: str) -> list[dict]:
    """Run one query against the platform ClickHouse, returning JSONEachRow rows."""
    out = subprocess.run([*CH, sql], capture_output=True, text=True)
    if out.returncode:
        raise SystemExit(f"query failed:\n{out.stderr[:800]}\n{sql[:400]}")
    return [json.loads(x) for x in out.stdout.splitlines() if x.strip()]


def verify_corpus_assumptions() -> int:
    """Fail loudly if the seat-lookup or no-duplicates assumptions no longer hold.

    Returns the number of six-max hands, which is the denominator for every frequency.
    """
    row = q(f"""
        SELECT count() AS hands,
               uniqExact(hand_uid) AS uids,
               countIf(button_seat != 1) AS off_button,
               uniqExact(parser_version) AS versions
        FROM core.hands WHERE {SIX_MAX} FORMAT JSONEachRow""")[0]
    hands, uids = int(row["hands"]), int(row["uids"])
    if hands != uids:
        raise SystemExit(f"duplicate hand_uids ({hands:,} rows, {uids:,} uids) — FINAL needed")
    if int(row["off_button"]):
        raise SystemExit(f"{row['off_button']} hands have button_seat != 1 — SEATPOS is invalid")
    if int(row["versions"]) != 1:
        raise SystemExit(f"{row['versions']} parser versions present — re-parse dupes possible")
    return hands


def _seq(street: str) -> str:
    """Per-hand array of (action_index, seat, action_type), ordered, for one street."""
    return f"""
        SELECT hand_uid,
               arraySort(t -> t.1, groupArray((action_index, seat, toString(action_type)))) AS seq,
               arrayMap(t -> toUInt8(t.3 IN ('raise','bet')), seq) AS aggr0
        FROM core.actions
        WHERE street = '{street}' AND action_type IN {DECISIONS}
        GROUP BY user_id, hand_uid"""


def preflop_node() -> str:
    """SQL for the per-hand preflop node: `BU open, BB call`. Folds are compressed out.

    A raise is named by how many raises preceded it (open / 3bet / 4bet / 5bet), and a call
    with no preceding raise is a limp -- which also makes a later first raise an iso-raise.
    """
    p = SEATPOS
    label = f"""multiIf(
        t.3 = 'fold',                 '',
        t.3 = 'check',                concat({p}[t.2], ' check'),
        (t.3 = 'call') AND (pr = 0),  concat({p}[t.2], ' limp'),
        t.3 = 'call',                 concat({p}[t.2], ' call'),
        (pr = 0) AND (pl = 0),        concat({p}[t.2], ' open'),
        pr = 0,                       concat({p}[t.2], ' iso'),
        pr = 1,                       concat({p}[t.2], ' 3bet'),
        pr = 2,                       concat({p}[t.2], ' 4bet'),
        pr = 3,                       concat({p}[t.2], ' 5bet'),
                                      concat({p}[t.2], ' 6bet+'))"""
    return f"""
        SELECT hand_uid,
               arrayStringConcat(arrayFilter(x -> x != '',
                   arrayMap((t, pr, pl) -> {label}, seq, prior_raises, prior_limps)), ', ') AS node
        FROM (
            SELECT hand_uid, seq,
                   arrayMap((c, f) -> c - f, arrayCumSum(rf), rf) AS prior_raises,
                   arrayMap((c, f) -> c - f, arrayCumSum(lf), lf) AS prior_limps
            FROM (
                SELECT hand_uid, seq,
                       arrayMap(t -> toUInt8(t.3 IN ('raise','bet')), seq) AS rf,
                       arrayMap((t, pr) -> toUInt8((t.3 = 'call') AND (pr = 0)), seq,
                           arrayMap((c, f) -> c - f, arrayCumSum(aggr0), aggr0)) AS lf
                FROM ({_seq("preflop")})
            )
        )"""


def flop_node() -> str:
    """SQL for the per-hand flop line: `BB check, BU bet, BB fold`.

    Folds are kept here, unlike preflop: on the flop a fold ends the hand and is the outcome
    being studied, whereas preflop it only says who was not involved.
    """
    p = SEATPOS
    label = f"""multiIf(
        t.3 = 'fold',   concat({p}[t.2], ' fold'),
        t.3 = 'check',  concat({p}[t.2], ' check'),
        t.3 = 'call',   concat({p}[t.2], ' call'),
        t.3 = 'bet',    concat({p}[t.2], ' bet'),
        pr = 1,         concat({p}[t.2], ' raise'),
        pr = 2,         concat({p}[t.2], ' reraise'),
                        concat({p}[t.2], ' raise+'))"""
    return f"""
        SELECT hand_uid,
               arrayStringConcat(arrayMap((t, pr) -> {label}, seq, prior_aggr), ', ') AS node
        FROM (
            SELECT hand_uid, seq,
                   arrayMap((c, f) -> c - f, arrayCumSum(aggr0), aggr0) AS prior_aggr
            FROM ({_seq("flop")})
        )"""


@dataclass
class Spot:
    """One preflop node with its frequency and what happens to it."""

    spot: str
    hands: int
    pct: float
    flop_hands: int
    avg_pot_bb: float

    @property
    def flop_pct(self) -> float:
        """Share of this node's hands that actually see a flop."""
        return 100 * self.flop_hands / self.hands if self.hands else 0.0

    @property
    def preflop_hands(self) -> int:
        """Hands in this node that ended before a flop was dealt -- a preflop-only decision."""
        return self.hands - self.flop_hands

    @property
    def pattern(self) -> str:
        """The node with positions stripped -- the study theme, e.g. `open, 3bet, call`."""
        if self.spot == WALK:
            return "walk"
        return ", ".join(tok.split(" ", 1)[1] for tok in self.spot.split(", "))

    @property
    def players(self) -> int:
        """How many players put money in voluntarily (or checked their option)."""
        if self.spot == WALK:
            return 0
        return len({tok.split(" ", 1)[0] for tok in self.spot.split(", ")})

    @property
    def level(self) -> str:
        """Coarse pot type, for grouping the curriculum."""
        for token, name in [
            ("6bet+", "5bet+"),
            ("5bet", "5bet+"),
            ("4bet", "4bet"),
            ("3bet", "3bet"),
        ]:
            if f" {token}" in self.spot:
                return name
        if self.spot == WALK:
            return "walk"
        if " open" in self.spot or " iso" in self.spot:
            return "SRP"
        return "limped"

    @property
    def is_playable(self) -> bool:
        """True when the node reaches a flop often enough to build a study session on."""
        return self.flop_hands >= MIN_HANDS and self.spot != WALK


def fetch_spots(total: int) -> list[Spot]:
    """Every preflop node above MIN_HANDS, ranked by frequency."""
    sql = f"""
        SELECT if(pf.node = '', '{WALK}', pf.node) AS spot,
               count() AS hands,
               sum(h.saw_flop) AS flop_hands,
               round(avg(h.pot_bb), 2) AS avg_pot_bb
        FROM ({preflop_node()}) AS pf
        INNER JOIN (
            SELECT hand_uid,
                   toUInt8(board_flop_1 != '') AS saw_flop,
                   toFloat64(total_pot / big_blind) AS pot_bb
            FROM core.hands WHERE {SIX_MAX}
        ) AS h USING (hand_uid)
        GROUP BY spot HAVING hands >= {MIN_HANDS}
        ORDER BY hands DESC
        FORMAT JSONEachRow"""
    return [
        Spot(
            r["spot"],
            int(r["hands"]),
            100 * int(r["hands"]) / total,
            int(r["flop_hands"]),
            float(r["avg_pot_bb"]),
        )
        for r in q(sql)
    ]


def fetch_flop_lines(nodes: list[str]) -> dict[str, list[tuple[str, int]]]:
    """Flop continuation lines for the given preflop nodes, most frequent first."""
    quoted = ", ".join("'" + n.replace("'", "''") + "'" for n in nodes)
    sql = f"""
        SELECT pf.node AS spot, fl.node AS line, count() AS hands
        FROM ({preflop_node()}) AS pf
        INNER JOIN ({flop_node()}) AS fl USING (hand_uid)
        WHERE pf.node IN ({quoted})
        GROUP BY spot, line
        ORDER BY spot, hands DESC
        FORMAT JSONEachRow"""
    lines: dict[str, list[tuple[str, int]]] = {}
    for r in q(sql):
        lines.setdefault(r["spot"], []).append((r["line"], int(r["hands"])))
    return lines
