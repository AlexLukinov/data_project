"""Pool leak extraction: every stat as one set-based ClickHouse aggregation.

Extraction only — no strategy commentary anywhere in the output, by design.

Every stat is `sum(action) / sum(opportunity)` over `marts.player_hand_flags`, filtered to
`dataset='population'`. That dataset contains zero hero seats, so hero exclusion needs no
predicate; it is structural.

Emits: pool_leaks.md (report) + pool_leaks.csv (raw) + every SQL string, for audit.
"""

from __future__ import annotations

import csv
import json
import subprocess
from dataclasses import dataclass

CH = ["docker", "compose", "exec", "-T", "clickhouse", "clickhouse-client", "--query"]
TABLE = "marts.player_hand_flags"
POOL = "dataset='population'"

POS_ORDER = ["UTG", "HJ", "CO", "BTN", "SB", "BB"]
POS_LABEL = {"BTN": "BU"}

# Postflop acting order, used to decide preflop IP/OOP relative to the opener.
ORDER_ARR = "['SB','BB','UTG','HJ','CO','BTN']"
IS_IP_PF = f"indexOf({ORDER_ARR}, position) > indexOf({ORDER_ARR}, vs_position)"

# Flop-texture buckets, evaluated in priority order so each flop lands in exactly one.
TEXTURE = """multiIf(
    flop_pairing IN ('paired','trips'), 'paired',
    flop_suitedness = 'monotone', 'monotone',
    flop_high_card IN ('9','8','7','6','5','4','3','2')
        AND flop_connectedness IN ('connected','semi_connected'), 'low-connected',
    flop_high_card IN ('A','K','Q') AND flop_suitedness = 'rainbow'
        AND flop_connectedness = 'disconnected', 'dry-high',
    flop_suitedness = 'two_tone' OR flop_connectedness = 'connected', 'two-tone/wet',
    'other')"""

SEC_A, SEC_B, SEC_C = "A. Preflop", "B. Flop", "C. Turn"
SEC_D, SEC_E, SEC_F = "D. River", "E. Summary", "F. Per-stake split"

SQL_LOG: list[tuple[str, str]] = []


def q(label: str, sql: str) -> list[dict]:
    """Run one query, remember it for the audit appendix."""
    SQL_LOG.append((label, " ".join(sql.split())))
    out = subprocess.run([*CH, sql], capture_output=True, text=True)
    if out.returncode:
        raise SystemExit(f"query failed [{label}]:\n{out.stderr[:600]}\n{sql[:400]}")
    return [json.loads(x) for x in out.stdout.splitlines() if x.strip()]


@dataclass
class Row:
    """One computed stat: its segment, frequency, and the N behind it."""

    section: str
    stat: str
    segment: str
    freq: float | None
    n: int
    k: int
    flag: str = ""
    note: str = ""


ROWS: list[Row] = []


def rate(
    section: str,
    stat: str,
    opp: str,
    act: str,
    *,
    seg_sql: str = "''",
    where: str = "",
    postflop: bool = False,
    note: str = "",
    order: list[str] | None = None,
) -> None:
    """Compute one stat, optionally split by a segment expression."""
    extra = f" AND {where}" if where else ""
    sql = f"""
        SELECT {seg_sql} AS segment, sum({opp}) AS n, sum({act}) AS k
        FROM {TABLE}
        WHERE {POOL} AND {opp} = 1{extra}
        GROUP BY segment HAVING n > 0
        FORMAT JSONEachRow"""
    res = q(f"{section} · {stat}", sql)
    if order:
        res.sort(key=lambda r: order.index(r["segment"]) if r["segment"] in order else 99)
    else:
        res.sort(key=lambda r: -int(r["n"]))
    limit = 500 if postflop else 1000
    for r in res:
        n, k = int(r["n"]), int(r["k"])
        seg = POS_LABEL.get(r["segment"], r["segment"]) or "all"
        ROWS.append(
            Row(
                section,
                stat,
                seg,
                100 * k / n if n else None,
                n,
                k,
                "LOW-N — don't trust" if n < limit else "",
                note,
            )
        )


def scalar(section: str, stat: str, expr: str, where: str = "", note: str = "") -> None:
    """A non-ratio summary number (averages, shares)."""
    extra = f" AND {where}" if where else ""
    sql = f"SELECT {expr} AS v, count() AS n FROM {TABLE} WHERE {POOL}{extra} FORMAT JSONEachRow"
    r = q(f"{section} · {stat}", sql)[0]
    ROWS.append(Row(section, stat, "all", float(r["v"]), int(r["n"]), 0, "", note))


def build() -> None:
    """Every requested stat, in the order of the brief."""
    pos_col, pos = "position", POS_ORDER

    # ---------------- A) Preflop ----------------
    for stat, opp, act in [
        ("VPIP", "vpip_opp", "vpip_action"),
        ("PFR", "pfr_opp", "pfr_action"),
        ("RFI (raise first in)", "rfi_opp", "rfi_action"),
        ("Open-limp%", "limp_opp", "limp_action"),
        ("Cold-call%", "cold_call_opp", "cold_call_action"),
        ("3bet%", "threebet_opp", "threebet_action"),
        ("Fold to 3bet (as opener)", "fold_to_3bet_opp", "fold_to_3bet_action"),
        ("Call 3bet (as opener)", "call_3bet_opp", "call_3bet_action"),
        ("Squeeze%", "squeeze_opp", "squeeze_action"),
        ("4bet%", "fourbet_opp", "fourbet_action"),
        ("Fold to 4bet (as 3bettor)", "fold_to_4bet_opp", "fold_to_4bet_action"),
        ("Call 4bet (as 3bettor)", "vs_4bet_opp", "vs_4bet_call"),
    ]:
        rate(SEC_A, stat, opp, act, seg_sql=pos_col, order=pos)

    for stat, act in [
        ("Limp-fold%", "limp_fold_action"),
        ("Limp-call%", "limp_call_action"),
        ("Limp-raise%", "limp_raise_action"),
    ]:
        rate(
            SEC_A,
            stat,
            "limp_faced_raise_opp",
            act,
            seg_sql=pos_col,
            order=pos,
            note="denom = limped AND faced a raise behind",
        )

    # Blind defence vs a steal-position open, SB and BB separately.
    steal = "vs_position IN ('CO','BTN','SB')"
    for lbl, act in [("Fold to steal", "vs_open_fold"), ("Call vs steal", "vs_open_call")]:
        rate(
            SEC_A,
            lbl,
            "vs_open_opp",
            act,
            seg_sql="concat(position, ' vs ', vs_position)",
            where=f"position IN ('SB','BB') AND {steal}",
            note="denom = in blind, faced a CO/BU/SB open",
        )
    rate(
        SEC_A,
        "3bet vs steal",
        "threebet_opp",
        "threebet_action",
        seg_sql="concat(position, ' vs ', vs_position)",
        where=f"position IN ('SB','BB') AND {steal}",
        note="denom = in blind, faced a CO/BU/SB open",
    )

    rate(
        SEC_A,
        "3bet% by relative position",
        "threebet_opp",
        "threebet_action",
        seg_sql=f"if({IS_IP_PF}, 'IP vs opener', 'OOP vs opener')",
        where="vs_position != ''",
        note="IP/OOP from postflop acting order vs the opener",
    )
    rate(
        SEC_A,
        "3bet% blinds vs late",
        "threebet_opp",
        "threebet_action",
        seg_sql="concat(if(position IN ('SB','BB'),'blinds','non-blind'), ' vs ', vs_position)",
        where=steal,
    )

    # ---------------- B) Flop ----------------
    node = "concat(pot_type, ' · ', if(is_multiway=1,'multiway','HU'))"
    rate(
        SEC_B,
        "C-bet flop (as PFR)",
        "cbet_flop_opp",
        "cbet_flop_action",
        seg_sql=node,
        postflop=True,
    )
    rate(
        SEC_B,
        "C-bet flop — size mix",
        "cbet_flop_action",
        "cbet_flop_action",
        seg_sql="bet_size_bucket_f",
        postflop=True,
        note="share of c-bets in each size bucket (freq column = 100% by construction; read N)",
    )
    rate(
        SEC_B,
        "Fold to flop c-bet",
        "fold_to_cbet_f_opp",
        "fold_to_cbet_f_action",
        seg_sql="concat(pot_type,' · ',if(is_multiway=1,'MW','HU'),' · ',if(is_ip=1,'IP','OOP'))",
        postflop=True,
    )
    rate(
        SEC_B,
        "Fold to flop c-bet — by texture",
        "fold_to_cbet_f_opp",
        "fold_to_cbet_f_action",
        seg_sql=f"concat({TEXTURE}, ' · ', if(is_ip=1,'IP','OOP'))",
        where="pot_type='srp' AND is_multiway=0",
        postflop=True,
        note="SRP heads-up only, to keep the texture split clean",
    )
    rate(
        SEC_B,
        "Fold to flop c-bet — by size faced",
        "fold_to_cbet_f_opp",
        "fold_to_cbet_f_action",
        seg_sql="faced_size_bucket_f",
        where="pot_type='srp' AND is_multiway=0",
        postflop=True,
    )
    rate(
        SEC_B,
        "Raise flop c-bet",
        "fold_to_cbet_f_opp",
        "raise_cbet_f_action",
        seg_sql=node,
        postflop=True,
        note="same denom as fold-to-c-bet",
    )
    rate(
        SEC_B,
        "Float-fold (call flop c-bet, fold turn)",
        "float_fold_opp",
        "float_fold_action",
        seg_sql=node,
        postflop=True,
    )
    rate(SEC_B, "Donk-bet flop", "donk_f_opp", "donk_f_action", seg_sql=node, postflop=True)
    rate(
        SEC_B,
        "Fold to donk (as PFR)",
        "fold_to_donk_opp",
        "fold_to_donk_action",
        seg_sql=node,
        postflop=True,
    )
    rate(
        SEC_B,
        "Flop check-raise",
        "checkraise_f_opp",
        "checkraise_f_action",
        seg_sql=node,
        postflop=True,
    )
    rate(
        SEC_B,
        "Fold to flop raise (after betting)",
        "fold_to_flop_raise_opp",
        "fold_to_flop_raise_action",
        seg_sql=node,
        postflop=True,
    )

    # ---------------- C) Turn ----------------
    rate(
        SEC_C,
        "Second barrel (turn c-bet)",
        "cbet_turn_opp",
        "cbet_turn_action",
        seg_sql=node,
        postflop=True,
    )
    rate(
        SEC_C,
        "Second barrel — size mix",
        "cbet_turn_action",
        "cbet_turn_action",
        seg_sql="bet_size_bucket_t",
        postflop=True,
        note="read N, not the frequency",
    )
    rate(
        SEC_C,
        "Fold to turn c-bet",
        "fold_to_cbet_t_opp",
        "fold_to_cbet_t_action",
        seg_sql="concat(pot_type,' · ',if(is_multiway=1,'MW','HU'),' · ',if(is_ip=1,'IP','OOP'))",
        postflop=True,
    )
    rate(
        SEC_C,
        "Fold to turn c-bet — by size faced",
        "fold_to_cbet_t_opp",
        "fold_to_cbet_t_action",
        seg_sql="faced_size_bucket_t",
        postflop=True,
    )
    rate(
        SEC_C,
        "Turn probe (non-PFR bets after flop checked through)",
        "probe_t_opp",
        "probe_t_action",
        seg_sql=node,
        postflop=True,
    )
    rate(
        SEC_C,
        "Fold to turn probe (as PFR who checked)",
        "fold_to_probe_t_opp",
        "fold_to_probe_t_action",
        seg_sql=node,
        postflop=True,
    )
    rate(
        SEC_C,
        "Delayed c-bet (PFR checks flop, bets turn)",
        "delayed_cbet_opp",
        "delayed_cbet_action",
        seg_sql=node,
        postflop=True,
    )
    rate(
        SEC_C,
        "Fold to delayed c-bet",
        "fold_to_delayed_cbet_opp",
        "fold_to_delayed_cbet_action",
        seg_sql=node,
        postflop=True,
    )
    rate(
        SEC_C,
        "Turn check-raise",
        "checkraise_t_opp",
        "checkraise_t_action",
        seg_sql=node,
        postflop=True,
    )
    rate(
        SEC_C,
        "Fold to turn raise (after betting)",
        "fold_to_turn_raise_opp",
        "fold_to_turn_raise_action",
        seg_sql=node,
        postflop=True,
    )

    # ---------------- D) River ----------------
    rate(
        SEC_D,
        "Triple barrel (river c-bet)",
        "cbet_river_opp",
        "cbet_river_action",
        seg_sql=node,
        postflop=True,
    )
    rate(
        SEC_D,
        "Triple barrel — size mix",
        "cbet_river_action",
        "cbet_river_action",
        seg_sql="bet_size_bucket_r",
        postflop=True,
        note="read N, not the frequency",
    )
    rate(
        SEC_D,
        "Fold to river c-bet",
        "fold_to_cbet_r_opp",
        "fold_to_cbet_r_action",
        seg_sql="concat(pot_type,' · ',if(is_multiway=1,'MW','HU'),' · ',if(is_ip=1,'IP','OOP'))",
        postflop=True,
    )
    rate(
        SEC_D,
        "Fold to river bet — by size faced",
        "fold_to_cbet_r_opp",
        "fold_to_cbet_r_action",
        seg_sql="faced_size_bucket_r",
        postflop=True,
        note="'overbet' = >110% pot",
    )
    rate(
        SEC_D,
        "River probe (turn checked through)",
        "probe_r_opp",
        "probe_r_action",
        seg_sql=node,
        postflop=True,
    )
    rate(
        SEC_D,
        "Fold to river probe (as PFR)",
        "fold_to_probe_r_opp",
        "fold_to_probe_r_action",
        seg_sql=node,
        postflop=True,
    )
    rate(
        SEC_D,
        "River raise (facing a bet)",
        "river_face_bet_opp",
        "river_raise_action",
        seg_sql=node,
        postflop=True,
    )
    rate(
        SEC_D,
        "Fold to river raise (after betting)",
        "fold_to_river_raise_opp",
        "fold_to_river_raise_action",
        seg_sql=node,
        postflop=True,
    )
    rate(
        SEC_D,
        "Bet-call river (after betting, facing raise)",
        "fold_to_river_raise_opp",
        "bet_call_river_action",
        seg_sql=node,
        postflop=True,
        note="same denom as fold-to-river-raise; the two are the fold/call split",
    )
    rate(
        SEC_D,
        "Check-fold river",
        "river_check_faced_opp",
        "river_check_fold_action",
        seg_sql=node,
        postflop=True,
        note="denom = checked river then faced a bet",
    )
    rate(
        SEC_D,
        "Check-call river",
        "river_check_faced_opp",
        "river_check_call_action",
        seg_sql=node,
        postflop=True,
        note="denom = checked river then faced a bet",
    )

    # ---------------- E) Summary ----------------
    for stat, opp, act in [
        ("WWSF", "wwsf_opp", "wwsf_action"),
        ("WTSD", "wtsd_opp", "wtsd_action"),
        ("W$SD", "wsd_opp", "wsd_action"),
    ]:
        rate(SEC_E, stat, opp, act)
        rate(SEC_E, f"{stat} by position", opp, act, seg_sql=pos_col, order=pos)

    for street, a, c, f in [
        ("flop", "aggr_f", "call_f", "fold_f"),
        ("turn", "aggr_t", "call_t", "fold_t"),
        ("river", "aggr_r", "call_r", "fold_r"),
    ]:
        sql = f"""SELECT '' AS segment, sum({a}+{c}+{f}) AS n, sum({a}) AS k
                  FROM {TABLE} WHERE {POOL} AND saw_{street if street != "flop" else "flop"} = 1
                  FORMAT JSONEachRow"""
        r = q(f"{SEC_E} · AFq {street}", sql)[0]
        n, k = int(r["n"]), int(r["k"])
        ROWS.append(
            Row(
                SEC_E,
                f"Aggression frequency — {street}",
                "all",
                100 * k / n if n else None,
                n,
                k,
                "",
                "(bet+raise) / (bet+raise+call+fold)",
            )
        )

    scalar(SEC_E, "Average players to flop", "round(avgIf(players_to_flop, saw_flop=1), 3)")
    rate(
        SEC_E,
        "Pot-type share (of hands that saw a flop)",
        "saw_flop",
        "saw_flop",
        seg_sql="pot_type",
        postflop=True,
        note="read N — share of flops by pot type",
    )
    rate(
        SEC_E,
        "Multiway share (of flops)",
        "saw_flop",
        "is_multiway",
        seg_sql="''",
        postflop=True,
        note="3+ players to the flop",
    )

    # ---------------- per-stake split ----------------
    for stat, opp, act in [
        ("VPIP", "vpip_opp", "vpip_action"),
        ("PFR", "pfr_opp", "pfr_action"),
        ("3bet%", "threebet_opp", "threebet_action"),
        ("Fold to 3bet", "fold_to_3bet_opp", "fold_to_3bet_action"),
        ("C-bet flop", "cbet_flop_opp", "cbet_flop_action"),
        ("Fold to flop c-bet", "fold_to_cbet_f_opp", "fold_to_cbet_f_action"),
        ("Fold to turn c-bet", "fold_to_cbet_t_opp", "fold_to_cbet_t_action"),
        ("Fold to river c-bet", "fold_to_cbet_r_opp", "fold_to_cbet_r_action"),
        ("WTSD", "wtsd_opp", "wtsd_action"),
        ("W$SD", "wsd_opp", "wsd_action"),
    ]:
        rate(SEC_F, stat, opp, act, seg_sql="stake_level", order=["NL10", "NL25"])


def pick(stat: str, segment: str | None = None) -> Row | None:
    """First row matching a stat (and optionally a segment)."""
    for r in ROWS:
        if r.stat == stat and (segment is None or r.segment == segment):
            return r
    return None


def fnum(r: Row | None) -> str:
    """Format a frequency, or n/a."""
    if r is None or r.freq is None:
        return "n/a"
    return f"{r.freq:.1f}%"


def write_md(path: str, meta: dict[str, str]) -> None:
    """Write the full markdown report, including the SQL audit appendix."""
    lines: list[str] = []
    lines.append("# Pool statistics — GGPoker Rush & Cash 6-max\n")
    lines.append("Extraction only. No strategy or exploit commentary.\n")
    lines.append("## Dataset\n")
    lines.append("| Field | Value |\n|---|---|")
    for k, v in meta.items():
        lines.append(f"| {k} | {v} |")

    lines.append("\n## Cheat sheet\n")
    lines.append("| Stat | Segment | Pool freq | N | Flag |\n|---|---|---:|---:|---|")
    # Section is part of the key: section F repeats stat names like "VPIP" for the per-stake
    # split, and matching on the name alone silently summed A and F together — doubling every
    # headline N. Always scope a lookup to the section that owns the stat.
    cheat = [
        ("A. Preflop", "VPIP", None),
        ("A. Preflop", "PFR", None),
        ("A. Preflop", "3bet%", None),
        ("A. Preflop", "Fold to 3bet (as opener)", None),
        ("B. Flop", "Fold to flop c-bet", "srp · HU · IP"),
        ("B. Flop", "Fold to flop c-bet", "srp · HU · OOP"),
        ("C. Turn", "Fold to turn c-bet", "srp · HU · IP"),
        ("C. Turn", "Fold to turn c-bet", "srp · HU · OOP"),
        ("D. River", "Fold to river c-bet", "srp · HU · IP"),
        ("D. River", "Fold to river c-bet", "srp · HU · OOP"),
        ("E. Summary", "WTSD", "all"),
        ("E. Summary", "W$SD", "all"),
        ("E. Summary", "WWSF", "all"),
        ("E. Summary", "Aggression frequency — flop", None),
        ("E. Summary", "Aggression frequency — turn", None),
        ("E. Summary", "Aggression frequency — river", None),
    ]
    for sect, stat, seg in cheat:
        rows = [
            r
            for r in ROWS
            if r.section == sect and r.stat == stat and (seg is None or r.segment == seg)
        ]
        if not rows:
            lines.append(f"| {stat} | {seg or '—'} | n/a | 0 | not derivable |")
            continue
        if seg is None and len(rows) > 1:
            n = sum(r.n for r in rows)
            k = sum(r.k for r in rows)
            lines.append(f"| {stat} | all seats | {100 * k / n:.1f}% | {n:,} | |")
        else:
            r = rows[0]
            lines.append(f"| {stat} | {r.segment} | {fnum(r)} | {r.n:,} | {r.flag} |")

    sections: dict[str, list[Row]] = {}
    for r in ROWS:
        sections.setdefault(r.section, []).append(r)

    for sec in sorted(sections):
        lines.append(f"\n## {sec}\n")
        lines.append("| Stat | Segment | Pool freq | N | Flag | Note |")
        lines.append("|---|---|---:|---:|---|---|")
        for r in sections[sec]:
            val = f"{r.freq:.1f}%" if r.freq is not None else "n/a"
            if r.stat.startswith("Average"):
                val = f"{r.freq:.2f}"
            lines.append(f"| {r.stat} | {r.segment} | {val} | {r.n:,} | {r.flag} | {r.note} |")

    lines.append("\n## Assumptions and interpretations\n")
    for line in ASSUMPTIONS:
        lines.append(f"- {line}")

    lines.append("\n## Not derivable from this schema\n")
    for line in NOT_DERIVABLE:
        lines.append(f"- {line}")

    lines.append("\n## SQL appendix\n")
    lines.append(f"All {len(SQL_LOG)} queries, in execution order.\n")
    for i, (label, sql) in enumerate(SQL_LOG, 1):
        lines.append(f"**{i}. {label}**\n")
        lines.append("```sql")
        lines.append(sql)
        lines.append("```\n")

    with open(path, "w") as fh:
        fh.write("\n".join(lines) + "\n")


def write_csv(path: str) -> None:
    """Dump every row flat, for further slicing."""
    with open(path, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(
            [
                "section",
                "stat",
                "segment",
                "pool_freq_pct",
                "n_opportunities",
                "k_actions",
                "low_n_flag",
                "note",
            ]
        )
        for r in ROWS:
            w.writerow(
                [
                    r.section,
                    r.stat,
                    r.segment,
                    "" if r.freq is None else round(r.freq, 3),
                    r.n,
                    r.k,
                    r.flag,
                    r.note,
                ]
            )


ASSUMPTIONS: list[str] = [
    "**Stakes are NL10 + NL25, not NL2-NL5.** The brief specified NL2-NL5, but the only "
    "NL2-NL5 data in this database is 18,215 hero-export hands (~91k villain seats) — far too "
    "few for the requested postflop splits. The 9.07M-hand pool is NL10 (2.97M) + NL25 (6.11M).",
    "**Hero exclusion is structural, not filtered.** The population dataset contains zero hero "
    "seats, so no hero rows can enter any aggregate. The hero ID placeholder in the brief was "
    "never filled in and was not needed.",
    "**Opponents in this dataset are NOT anonymised.** The brief assumed GG anonymisation; this "
    "export carries real screen names (94,276 distinct ids across 54.4M seats). Everything below "
    "is still reported as a single pool aggregate as requested — no per-player stats.",
    "**Bet-size buckets do not match the brief's boundaries.** The pipeline buckets at "
    "<=37% / 37-60% / 60-85% / 85-110% / >110% of pot (labelled small/mid/large/pot/overbet), "
    "not <=33 / 33-66 / 66-100 / >100. The underlying ratio is stored, so re-bucketing to the "
    "brief's exact boundaries is a schema change plus a rebuild, not a re-query.",
    "**'Fold to river bet' uses the aggressor's river bet** (fold_to_cbet_r), i.e. facing the "
    "player who was betting the previous streets — not any river bet from any player.",
    "**IP/OOP postflop** = acts last on the flop among live players, read from the action "
    "stream rather than inferred from seat numbers. Preflop IP/OOP (3bet split) is relative to "
    "the opener, using postflop acting order SB<BB<UTG<HJ<CO<BU.",
    "**Flop-texture buckets are evaluated in priority order** (paired > monotone > "
    "low-connected > dry-high > two-tone/wet), so every flop lands in exactly one bucket. A "
    "paired monotone board counts as paired.",
    "**Limp-fold/call/raise denominator is 'limped AND faced a raise behind'.** A limp that "
    "walked to the flop was never a fold/call/raise decision.",
    "**'Size mix' rows are distributions, not frequencies.** Their freq column is 100% by "
    "construction; the information is in N — the count of actions in each size bucket.",
    "Rush & Cash dissolves the table every hand, so there is no table-level or session-level "
    "context; every hand is independent.",
    "Date range is 2023-08-29 to 2025-05-13, dominated by Dec 2024 - May 2025. The brief's "
    "optional 'last 3 months' filter was not applied — full database, as instructed by default.",
]

NOT_DERIVABLE: list[str] = [
    "**Hole cards for the pool are only known at showdown** (~2-13% of actions depending on "
    "street). Any range-composition stat is therefore showdown-biased. No stat in this report "
    "depends on hole cards, so all numbers here are unaffected.",
    "**Folding ranges are permanently invisible** — a folded hand never shows its cards, on any "
    "site. This limits future range work, not the frequencies reported here.",
    "**'Bet-fold vs bet-call' is reported for the river only.** It is the fold/call split of the "
    "same opportunity (bet, then faced a raise). Flop and turn equivalents exist in the schema "
    "as fold_to_flop_raise / fold_to_turn_raise but the call half was not added.",
    "**Effective stack is ~100BB by table type but not filtered on.** Short stacks are included; "
    "stack_bucket exists in the schema if a depth filter is wanted later.",
]


if __name__ == "__main__":
    meta = {
        "Source table": "marts.player_hand_flags (54.56M player-hand rows)",
        "Filter": "dataset = 'population' (zero hero seats by construction)",
        "Hands": "9,079,995",
        "Stakes": "NL10 (2.97M hands) + NL25 (6.11M hands) — see assumptions",
        "Game": "GGPoker Rush & Cash, 6-max NL Hold'em, fast-fold",
        "Date range": "2023-08-29 to 2025-05-13",
        "Low-N rule": "preflop N<1000, postflop N<500 flagged",
    }
    build()
    write_md("pool_leaks.md", meta)
    write_csv("pool_leaks.csv")
    print(f"rows: {len(ROWS)}  queries: {len(SQL_LOG)}")
    print(f"low-N cells: {sum(1 for r in ROWS if r.flag)}")
