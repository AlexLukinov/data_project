"""Filter AST -> parameterized ClickHouse SQL. **The security boundary of the product.**

This is the one place where user input becomes a database query, so three rules are absolute
(docs/POKER_DATA_MODEL.md §11.4):

  1. **`tenant_id` is a constructor argument, not a filter field.** It cannot be omitted, and
     it cannot be supplied by a client. `StatsQuery(tenant_id=...)` -- there is no code path
     that builds a query without one.
  2. **Every value is a bound parameter.** No f-strings, no `.format()`, no concatenation of
     user data into SQL. Ever.
  3. **Identifiers come from an allowlist**, never from input. A column name the caller sends
     is looked up in `FILTERABLE`; anything else is rejected before it reaches SQL.

`tests/test_tenant_isolation.py` actively tries to break all three and fails the build if it
succeeds.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any, Literal

from core.settings import get_settings
from ingestion.loader import DATASET_HERO, DATASET_POPULATION

Dataset = Literal["hero", "population"]
"""Must list exactly the `ingestion.loader.DATASET_*` values (they are `Final`, so mypy checks
the defaults below against this union); `DATASETS` is the runtime allowlist."""
DATASETS: frozenset[str] = frozenset({DATASET_HERO, DATASET_POPULATION})

# Allowlist: filter name -> (column, ClickHouse parameter type). Anything not in here is not
# filterable, by construction.
#
# Split in two because the two tables answer different questions at different costs:
#
#   COARSE  live on `marts.stats_daily`, a small pre-aggregated rollup. Millisecond answers.
#   FINE    exist only on `marts.player_hand_flags`, the full per-hand fact. Putting these in
#           the rollup's GROUP BY would multiply its rows (hand_class alone is 169 values)
#           until it was no smaller than the fact table and therefore pointless.
#
# `_source_for` picks the table automatically, so callers never think about this: ask for
# anything fine and the query silently moves to the fact table.
#
# `dataset` is deliberately NOT here. It is a required scalar on every query
# (`StatsQuery.dataset`), and letting it also arrive as a filter once produced
# `dataset = 'hero' AND dataset IN ('population')` -- zero rows and no error, which made the
# whole population corpus unreachable through the API (docs/POKER_AUDIT.md, B1).
COARSE_FILTERABLE: dict[str, tuple[str, str]] = {
    "site": ("site", "Array(String)"),
    "stake_level": ("stake_level", "Array(String)"),
    "game_type": ("game_type", "Array(String)"),
    "table_format": ("table_format", "Array(String)"),
    "position": ("position", "Array(String)"),
}

FINE_FILTERABLE: dict[str, tuple[str, str]] = {
    "players_dealt_in": ("players_dealt_in", "Array(UInt8)"),
    # Preflop shape
    "pot_type": ("pot_type", "Array(String)"),
    "players_to_flop": ("players_to_flop", "Array(UInt8)"),
    "is_multiway": ("is_multiway", "Array(UInt8)"),
    "vs_position": ("vs_position", "Array(String)"),
    # Holding and depth
    "hand_class": ("hand_class", "Array(String)"),
    "hand_shape": ("hand_shape", "Array(String)"),
    "spr_bucket": ("spr_bucket", "Array(String)"),
    "stack_bucket": ("stack_bucket", "Array(String)"),
    "is_ip": ("is_ip", "Array(UInt8)"),
    # Board texture
    "flop_suitedness": ("flop_suitedness", "Array(String)"),
    "flop_pairing": ("flop_pairing", "Array(String)"),
    "flop_high_card": ("flop_high_card", "Array(String)"),
    "flop_connectedness": ("flop_connectedness", "Array(String)"),
    "board_paired_final": ("board_paired_final", "Array(UInt8)"),
    "board_flush_possible": ("board_flush_possible", "Array(UInt8)"),
    # Bet sizing
    "bet_size_bucket_f": ("bet_size_bucket_f", "Array(String)"),
    "bet_size_bucket_t": ("bet_size_bucket_t", "Array(String)"),
    "bet_size_bucket_r": ("bet_size_bucket_r", "Array(String)"),
    "faced_size_bucket_f": ("faced_size_bucket_f", "Array(String)"),
    "faced_size_bucket_t": ("faced_size_bucket_t", "Array(String)"),
    "faced_size_bucket_r": ("faced_size_bucket_r", "Array(String)"),
}

FILTERABLE: dict[str, tuple[str, str]] = {**COARSE_FILTERABLE, **FINE_FILTERABLE}

MARTS = get_settings().db("marts")
"""The marts database, prefixed for the test suite (`test_marts`) and bare in production."""
ROLLUP_TABLE = f"{MARTS}.stats_daily"
FACT_TABLE = f"{MARTS}.player_hand_flags"
ROLLUP_DATE = "day"
FACT_DATE = "played_date"


def coerce_filters(raw: dict[str, list[str | int]]) -> dict[str, list[Any]]:
    """Cast filter values to the ClickHouse parameter type of their dimension.

    JSON bodies and query strings carry everything as text, but six dimensions are bound as
    `Array(UInt8)`; `is_ip IN {f_is_ip:Array(UInt8)}` with `['1']` is a type error at query
    time, not a match. Unknown names pass through untouched so `StatsQuery` rejects them with
    its own message; a non-integer literal for an integer dimension raises here.
    """
    coerced: dict[str, list[Any]] = {}
    for name, values in raw.items():
        if name in FILTERABLE and FILTERABLE[name][1] == "Array(UInt8)":
            try:
                coerced[name] = [int(v) for v in values]
            except (TypeError, ValueError) as exc:
                raise ValueError(f"filter {name!r} expects integer values") from exc
        else:
            coerced[name] = list(values)
    return coerced


def _source_for(names: list[str]) -> tuple[str, str, str]:
    """Pick (table, date column, player-key column) for the dimensions requested.

    Any fine dimension forces the full fact table; otherwise the rollup serves it. The
    player-key column differs because the fact table keeps `player_key` NULLable for the
    opponent-stat gate and carries a non-null `player_key_norm` for grouping.
    """
    if any(name in FINE_FILTERABLE for name in names):
        return FACT_TABLE, FACT_DATE, "player_key_norm"
    return ROLLUP_TABLE, ROLLUP_DATE, "player_key"


# Stat definitions live in ONE place so the API, the dashboard and (later) the LLM prompt all
# read the same formula instead of three drifting copies. Mirrors marts.dim_stat_definitions.
#
# Every stat is sum(action) / sum(opportunity) -- that is the entire design. See
# docs/POKER_DATA_MODEL.md §4.3.
StatKind = Literal["ratio", "money", "count"]


@dataclass(frozen=True, slots=True)
class StatDef:
    """One stat: how to compute it and how to describe it."""

    code: str
    label: str
    kind: StatKind
    numerator: str
    denominator: str
    higher_is_better: bool | None = None

    def expression(self) -> str:
        """The SELECT expression for this stat, as a percentage or a per-100 rate.

        Columns are qualified with the table alias `s`. Without it, `sum(hands) AS hands`
        makes the alias shadow the source column, and any later `sum(hands)` resolves to the
        aggregate — which ClickHouse rejects as a nested aggregation.
        """
        if self.kind == "ratio":
            return f"round(100 * sum(s.{self.numerator}) / nullIf(sum(s.{self.denominator}), 0), 2)"
        if self.kind == "money":
            # bb/100. nullIf guards ClickHouse returning inf/nan for x/0 without complaint --
            # a brand-new user would otherwise see "nan" on their dashboard.
            return f"round(100 * sum(s.{self.numerator}) / nullIf(sum(s.{self.denominator}), 0), 3)"
        return f"sum(s.{self.numerator})"

    def sample_expression(self) -> str:
        """The opportunity count behind this stat.

        Returned with EVERY stat, always. A 3-bet% over 40 opportunities is noise, and a
        product that displays it as a bare number is actively misleading its users.
        """
        return f"sum(s.{self.denominator})"


STATS: dict[str, StatDef] = {
    s.code: s
    for s in (
        StatDef("vpip", "VPIP", "ratio", "vpip_action", "vpip_opp", higher_is_better=None),
        StatDef("pfr", "PFR", "ratio", "pfr_action", "pfr_opp"),
        StatDef("threebet", "3-Bet%", "ratio", "threebet_action", "threebet_opp"),
        StatDef(
            "fold_to_3bet", "Fold to 3-Bet", "ratio", "fold_to_3bet_action", "fold_to_3bet_opp"
        ),
        StatDef("fourbet", "4-Bet%", "ratio", "fourbet_action", "fourbet_opp"),
        StatDef("steal", "Steal%", "ratio", "steal_action", "steal_opp"),
        StatDef(
            "fold_bb_to_steal",
            "Fold BB to Steal",
            "ratio",
            "fold_bb_steal_action",
            "fold_bb_steal_opp",
        ),
        StatDef("cbet_flop", "C-Bet Flop", "ratio", "cbet_flop_action", "cbet_flop_opp"),
        StatDef("cbet_turn", "C-Bet Turn", "ratio", "cbet_turn_action", "cbet_turn_opp"),
        StatDef(
            "fold_to_cbet_flop",
            "Fold to C-Bet Flop",
            "ratio",
            "fold_to_cbet_f_action",
            "fold_to_cbet_f_opp",
        ),
        StatDef(
            "check_raise_flop",
            "Check-Raise Flop",
            "ratio",
            "checkraise_f_action",
            "checkraise_f_opp",
        ),
        # ---- added with the wide-flag expansion --------------------------------------
        StatDef("rfi", "RFI (Open%)", "ratio", "rfi_action", "rfi_opp"),
        StatDef("limp", "Limp%", "ratio", "limp_action", "limp_opp"),
        StatDef("iso_raise", "Isolation Raise%", "ratio", "iso_action", "iso_opp"),
        StatDef("cold_call", "Cold Call%", "ratio", "cold_call_action", "cold_call_opp"),
        StatDef("squeeze", "Squeeze%", "ratio", "squeeze_action", "squeeze_opp"),
        StatDef("call_3bet", "Call 3-Bet%", "ratio", "call_3bet_action", "call_3bet_opp"),
        StatDef("fivebet", "5-Bet%", "ratio", "fivebet_action", "fivebet_opp"),
        StatDef("defend_vs_open", "Defend vs Open", "ratio", "vs_open_call", "vs_open_opp"),
        StatDef("fold_vs_open", "Fold vs Open", "ratio", "vs_open_fold", "vs_open_opp"),
        StatDef("call_4bet", "Call 4-Bet%", "ratio", "vs_4bet_call", "vs_4bet_opp"),
        StatDef(
            "fold_to_4bet", "Fold to 4-Bet", "ratio", "fold_to_4bet_action", "fold_to_4bet_opp"
        ),
        StatDef("cbet_river", "C-Bet River", "ratio", "cbet_river_action", "cbet_river_opp"),
        StatDef(
            "fold_to_cbet_turn",
            "Fold to C-Bet Turn",
            "ratio",
            "fold_to_cbet_t_action",
            "fold_to_cbet_t_opp",
        ),
        StatDef(
            "fold_to_cbet_river",
            "Fold to C-Bet River",
            "ratio",
            "fold_to_cbet_r_action",
            "fold_to_cbet_r_opp",
        ),
        StatDef("donk_flop", "Donk Bet Flop", "ratio", "donk_f_action", "donk_f_opp"),
        StatDef("probe_turn", "Probe Turn", "ratio", "probe_t_action", "probe_t_opp"),
        StatDef(
            "delayed_cbet", "Delayed C-Bet", "ratio", "delayed_cbet_action", "delayed_cbet_opp"
        ),
        StatDef("float_flop", "Float Flop", "ratio", "float_action", "float_opp"),
        StatDef(
            "check_raise_turn",
            "Check-Raise Turn",
            "ratio",
            "checkraise_t_action",
            "checkraise_t_opp",
        ),
        StatDef(
            "check_raise_river",
            "Check-Raise River",
            "ratio",
            "checkraise_r_action",
            "checkraise_r_opp",
        ),
        StatDef("wwsf", "WWSF", "ratio", "wwsf_action", "wwsf_opp"),
        StatDef("wtsd", "WTSD", "ratio", "wtsd_action", "wtsd_opp"),
        StatDef("wsd", "W$SD", "ratio", "wsd_action", "wsd_opp"),
        # ---- leak stats: counters that existed on the flag table but were unreachable ------
        StatDef(
            "limp_fold", "Limp, fold to raise", "ratio", "limp_fold_action", "limp_faced_raise_opp"
        ),
        StatDef(
            "limp_call", "Limp, call raise", "ratio", "limp_call_action", "limp_faced_raise_opp"
        ),
        StatDef("limp_raise", "Limp-raise", "ratio", "limp_raise_action", "limp_faced_raise_opp"),
        StatDef(
            "raise_cbet_flop",
            "Raise C-Bet Flop",
            "ratio",
            "raise_cbet_f_action",
            "fold_to_cbet_f_opp",
        ),
        StatDef("float_fold", "Float, fold turn", "ratio", "float_fold_action", "float_fold_opp"),
        StatDef(
            "fold_to_donk", "Fold to Donk Bet", "ratio", "fold_to_donk_action", "fold_to_donk_opp"
        ),
        StatDef(
            "fold_to_flop_raise",
            "Fold to Flop Raise",
            "ratio",
            "fold_to_flop_raise_action",
            "fold_to_flop_raise_opp",
        ),
        StatDef(
            "fold_to_turn_raise",
            "Fold to Turn Raise",
            "ratio",
            "fold_to_turn_raise_action",
            "fold_to_turn_raise_opp",
        ),
        StatDef(
            "fold_to_river_raise",
            "Fold to River Raise",
            "ratio",
            "fold_to_river_raise_action",
            "fold_to_river_raise_opp",
        ),
        StatDef(
            "bet_call_river",
            "Bet-Call River",
            "ratio",
            "bet_call_river_action",
            "fold_to_river_raise_opp",
        ),
        StatDef(
            "fold_to_probe_turn",
            "Fold to Probe Turn",
            "ratio",
            "fold_to_probe_t_action",
            "fold_to_probe_t_opp",
        ),
        StatDef(
            "fold_to_delayed_cbet",
            "Fold to Delayed C-Bet",
            "ratio",
            "fold_to_delayed_cbet_action",
            "fold_to_delayed_cbet_opp",
        ),
        StatDef("probe_river", "Probe River", "ratio", "probe_r_action", "probe_r_opp"),
        StatDef(
            "fold_to_probe_river",
            "Fold to Probe River",
            "ratio",
            "fold_to_probe_r_action",
            "fold_to_probe_r_opp",
        ),
        StatDef("river_raise", "River Raise", "ratio", "river_raise_action", "river_face_bet_opp"),
        StatDef(
            "river_check_fold",
            "River Check-Fold",
            "ratio",
            "river_check_fold_action",
            "river_check_faced_opp",
        ),
        StatDef(
            "river_check_call",
            "River Check-Call",
            "ratio",
            "river_check_call_action",
            "river_check_faced_opp",
        ),
        StatDef("bb_per_100", "bb/100", "money", "net_won_bb", "hands", higher_is_better=True),
        StatDef("ev_bb_per_100", "EV bb/100", "money", "ev_won_bb", "hands", higher_is_better=True),
        StatDef("hands", "Hands", "count", "hands", "hands"),
    )
}


# Every counter column on the rollup, and what it means. This is the vocabulary a user gets
# to build custom stats out of — an ALLOWLIST, not free-form SQL.
#
# Why an allowlist and not an expression parser: PT4's custom stats are effectively SQL, which
# is powerful and is also a remote-code-execution surface in a multi-tenant cloud product. A
# ratio of two named counters covers the overwhelming majority of what people actually build,
# with none of the risk. Richer expressions can come later behind a real parser (F-313).
COUNTERS: dict[str, str] = {
    "hands": "Hands dealt in",
    "vpip_opp": "Hands dealt in (VPIP opportunity)",
    "vpip_action": "Voluntarily put money in preflop",
    "pfr_opp": "Hands dealt in (PFR opportunity)",
    "pfr_action": "Raised preflop",
    "threebet_opp": "Faced exactly one raise",
    "threebet_action": "3-bet",
    "fold_to_3bet_opp": "Open-raised then faced a 3-bet",
    "fold_to_3bet_action": "Folded to a 3-bet",
    "fourbet_opp": "Faced two raises",
    "fourbet_action": "4-bet",
    "steal_opp": "First-in from CO/BTN/SB",
    "steal_action": "Raised first-in from CO/BTN/SB",
    "fold_bb_steal_opp": "In BB facing a steal",
    "fold_bb_steal_action": "Folded BB to a steal",
    "cbet_flop_opp": "Preflop aggressor, saw the flop",
    "cbet_flop_action": "Bet the flop as aggressor",
    "cbet_turn_opp": "C-bet the flop and saw the turn",
    "cbet_turn_action": "Bet the turn (double barrel)",
    "fold_to_cbet_f_opp": "Faced a flop c-bet",
    "fold_to_cbet_f_action": "Folded to a flop c-bet",
    "checkraise_f_opp": "Checked the flop and faced a bet",
    "checkraise_f_action": "Check-raised the flop",
    "wwsf_opp": "Saw the flop",
    "wwsf_action": "Won after seeing the flop",
    "wtsd_opp": "Saw the flop",
    "wtsd_action": "Went to showdown",
    "wsd_opp": "Reached showdown",
    "wsd_action": "Won at showdown",
    # ---- added with the wide-flag expansion; all live on player_hand_flags -------------
    "rfi_opp": "First to act with nobody in (RFI opportunity)",
    "rfi_action": "Raised first in",
    "limp_opp": "First in, outside the big blind",
    "limp_action": "Limped",
    "iso_opp": "Limpers in front, no raise yet",
    "iso_action": "Isolation-raised the limpers",
    "cold_call_opp": "Faced a raise, not in the blinds",
    "cold_call_action": "Cold-called a raise",
    "squeeze_opp": "Faced a raise with cold callers behind it",
    "squeeze_action": "Squeezed",
    "call_3bet_opp": "Opened and faced a 3-bet",
    "call_3bet_action": "Called the 3-bet",
    "fivebet_opp": "Faced three raises",
    "fivebet_action": "5-bet",
    "fold_to_4bet_opp": "3-bet and faced a 4-bet",
    "vs_open_opp": "Faced exactly one raise (any seat, blinds included)",
    "vs_open_call": "Called the open",
    "vs_open_fold": "Folded to the open",
    "vs_4bet_opp": "3-bet and faced a 4-bet",
    "vs_4bet_call": "Called the 4-bet",
    "fold_to_4bet_action": "Folded to a 4-bet",
    "cbet_river_opp": "C-bet the turn and saw the river",
    "cbet_river_action": "Bet the river (triple barrel)",
    "fold_to_cbet_t_opp": "Faced a turn c-bet",
    "fold_to_cbet_t_action": "Folded to a turn c-bet",
    "fold_to_cbet_r_opp": "Faced a river c-bet",
    "fold_to_cbet_r_action": "Folded to a river c-bet",
    "donk_f_opp": "Out of position vs the aggressor on the flop",
    "donk_f_action": "Donk-bet the flop",
    "probe_t_opp": "Aggressor checked back the flop; saw the turn",
    "probe_t_action": "Probe-bet the turn",
    "delayed_cbet_opp": "Aggressor who checked the flop and saw the turn",
    "delayed_cbet_action": "Delayed c-bet on the turn",
    "float_opp": "Called a flop bet in position and saw the turn",
    "float_action": "Bet the turn after floating",
    "checkraise_t_opp": "Checked the turn and faced a bet",
    "checkraise_t_action": "Check-raised the turn",
    "checkraise_r_opp": "Checked the river and faced a bet",
    "checkraise_r_action": "Check-raised the river",
    # ---- leak counters ----------------------------------------------------------------
    "limp_faced_raise_opp": "Open-limped and someone raised behind",
    "limp_fold_action": "Folded the limp to the raise",
    "limp_call_action": "Called the raise after limping",
    "limp_raise_action": "Re-raised after limping",
    "raise_cbet_f_action": "Raised the flop c-bet",
    "float_fold_opp": "Called the flop c-bet in position and saw the turn",
    "float_fold_action": "Folded the turn after calling the flop c-bet",
    "fold_to_donk_opp": "Aggressor led into on the flop",
    "fold_to_donk_action": "Folded to the donk bet",
    "fold_to_flop_raise_opp": "Bet the flop and was raised",
    "fold_to_flop_raise_action": "Folded the flop to the raise",
    "fold_to_turn_raise_opp": "Bet the turn and was raised",
    "fold_to_turn_raise_action": "Folded the turn to the raise",
    "fold_to_river_raise_opp": "Bet the river and was raised",
    "fold_to_river_raise_action": "Folded the river to the raise",
    "bet_call_river_action": "Called the river raise after betting",
    "fold_to_probe_t_opp": "Aggressor checked the flop and faced a turn bet",
    "fold_to_probe_t_action": "Folded to the turn probe",
    "fold_to_delayed_cbet_opp": "Faced the aggressor's turn bet after a checked flop",
    "fold_to_delayed_cbet_action": "Folded to the delayed c-bet",
    "probe_r_opp": "Non-aggressor saw the river after the turn checked through",
    "probe_r_action": "Probe-bet the river",
    "fold_to_probe_r_opp": "Aggressor faced a river bet after the turn checked through",
    "fold_to_probe_r_action": "Folded to the river probe",
    "river_face_bet_opp": "Faced a river bet",
    "river_raise_action": "Raised the river bet",
    "river_check_faced_opp": "Checked the river and faced a bet",
    "river_check_fold_action": "Folded the river after checking",
    "river_check_call_action": "Called the river after checking",
    "aggr_f": "Bets + raises on the flop",
    "aggr_t": "Bets + raises on the turn",
    "aggr_r": "Bets + raises on the river",
    "call_f": "Calls on the flop",
    "call_t": "Calls on the turn",
    "call_r": "Calls on the river",
    "fold_f": "Folds on the flop",
    "fold_t": "Folds on the turn",
    "fold_r": "Folds on the river",
    "saw_flop": "Saw the flop",
    "saw_turn": "Saw the turn",
    "saw_river": "Saw the river",
    "saw_river_opp": "Saw the turn (river-progression opportunity)",
    "saw_river_action": "Saw the river",
    "net_won_bb": "Net won (bb)",
    "ev_won_bb": "All-in-adjusted won (bb)",
    "showdown_won_bb": "Won at showdown (bb)",
    "nonshowdown_won_bb": "Won without showdown (bb)",
}


@dataclass(frozen=True, slots=True)
class CustomStat:
    """A user-defined statistic: pick the action AND the opportunity.

    **Choosing the denominator is the whole feature.** "How often do I fold to a 3-bet" and
    "how often does folding to a 3-bet happen per hand dealt" are different questions with
    the same numerator, and only the second is comparable across players with different
    opening frequencies. Every serious tracker lets you set the opportunity; this is that.

    Both fields are validated against `COUNTERS`, so nothing a user types reaches SQL.
    """

    code: str
    label: str
    numerator: str
    denominator: str
    kind: StatKind = "ratio"

    def validate(self) -> None:
        """Reject anything outside the counter allowlist or with an unsafe code."""
        if not _SAFE_CODE.match(self.code):
            raise ValueError(f"invalid stat code {self.code!r}")
        if self.code in STATS:
            raise ValueError(f"{self.code!r} shadows a built-in stat")
        for role, column in (("numerator", self.numerator), ("denominator", self.denominator)):
            if column not in COUNTERS:
                raise ValueError(f"unknown {role} counter {column!r}")

    def to_def(self) -> StatDef:
        """Convert to the same `StatDef` the built-ins use, so one code path builds both."""
        return StatDef(
            code=self.code,
            label=self.label or self.code,
            kind=self.kind,
            numerator=self.numerator,
            denominator=self.denominator,
        )


_SAFE_CODE = __import__("re").compile(r"^[a-z][a-z0-9_]{0,39}$")


@dataclass(slots=True)
class StatsQuery:
    """A tenant-scoped stats query.

    `tenant_id` is positional and required -- that is the whole point of this class.
    """

    tenant_id: int
    date_from: date | None = None
    date_to: date | None = None
    player_key: str | None = None
    hero_only: bool = True
    """Restrict to the tenant's own seat. Only meaningful on the hero dataset: population
    exports contain no hero seat, so `hero_only` there would match nothing."""
    dataset: Dataset = DATASET_HERO
    """Which body of hands to measure. Defaults to `hero` — the user's OWN play — because the
    alternative is silently averaging in millions of observed pool hands they never played.
    Pass `population` (with `hero_only=False`) for pool baselines. Always a scalar predicate,
    never a filter; there is no query that spans both bodies."""

    filters: dict[str, list[Any]] = field(default_factory=dict)
    group_by: list[str] = field(default_factory=list)
    stats: list[str] = field(default_factory=list)
    custom_stats: list[CustomStat] = field(default_factory=list)
    limit: int = 500

    def __post_init__(self) -> None:
        """Reject anything not on the allowlist, before it can reach SQL."""
        _check_dataset(self.dataset, self.hero_only)
        for name in self.filters:
            if name not in FILTERABLE:
                raise ValueError(f"unknown filter {name!r}")
        for name in self.group_by:
            if name not in FILTERABLE:
                raise ValueError(f"cannot group by {name!r}")
        for code in self.stats:
            if code not in STATS:
                raise ValueError(f"unknown stat {code!r}")
        seen: set[str] = set()
        for custom in self.custom_stats:
            custom.validate()
            if custom.code in seen:
                raise ValueError(f"duplicate custom stat {custom.code!r}")
            seen.add(custom.code)
        if self.limit < 1 or self.limit > 10_000:
            raise ValueError("limit out of range")

    def definitions(self) -> list[StatDef]:
        """Built-in plus custom stats, as one uniform list."""
        selected = self.stats or ["hands", "vpip", "pfr", "threebet", "bb_per_100"]
        return [STATS[c] for c in selected] + [c.to_def() for c in self.custom_stats]

    def build(self) -> tuple[str, dict[str, Any]]:
        """Return (sql, parameters). The SQL contains no user data — only placeholders."""
        table, date_column, key_column = _source_for(list(self.filters) + self.group_by)

        select_parts: list[str] = []
        for name in self.group_by:
            column, _ = FILTERABLE[name]
            select_parts.append(f"s.{column} AS {name}")
        # Built-in and custom stats go through the SAME expression builder — a custom stat is
        # not a second code path, it is a StatDef the user supplied.
        for stat in self.definitions():
            select_parts.append(f"{stat.expression()} AS {stat.code}")
            if stat.kind != "count":
                select_parts.append(f"{stat.sample_expression()} AS {stat.code}__n")
        select_parts.append("sum(s.hands) AS hands_total")

        # tenant_id first, always, and never from the caller's payload. The dataset predicate
        # is unconditional for the same reason: no query may span both bodies of hands.
        where = ["s.user_id = {tenant_id:UInt32}", "s.dataset = {dataset:String}"]
        params: dict[str, Any] = {"tenant_id": self.tenant_id, "dataset": self.dataset}

        if self.hero_only:
            where.append("s.is_hero = 1")
        if self.player_key is not None:
            where.append(f"s.{key_column} = {{player_key:String}}")
            params["player_key"] = self.player_key
        if self.date_from is not None:
            where.append(f"s.{date_column} >= {{date_from:Date}}")
            params["date_from"] = self.date_from
        if self.date_to is not None:
            where.append(f"s.{date_column} <= {{date_to:Date}}")
            params["date_to"] = self.date_to

        for name, values in self.filters.items():
            if not values:
                continue
            column, ch_type = FILTERABLE[name]
            where.append(f"s.{column} IN {{f_{name}:{ch_type}}}")
            params[f"f_{name}"] = values

        sql = f"SELECT {', '.join(select_parts)} FROM {table} AS s WHERE {' AND '.join(where)} "
        if self.group_by:
            sql += f"GROUP BY {', '.join(self.group_by)} ORDER BY {self.group_by[0]} "
        else:
            sql += "GROUP BY () "
        sql += "LIMIT {limit:UInt32}"
        params["limit"] = self.limit
        return sql, params


def _check_dataset(dataset: str, hero_only: bool) -> None:
    """Fail loudly on a dataset the schema does not know, or on a contradiction.

    `hero_only` on the population dataset is a contradiction rather than a harmless no-op:
    those exports contain no hero seat, so the query would return nothing and look like an
    empty database.
    """
    if dataset not in DATASETS:
        raise ValueError(f"unknown dataset {dataset!r}")
    if dataset == DATASET_POPULATION and hero_only:
        raise ValueError("hero_only cannot be combined with the population dataset")


@dataclass(slots=True)
class TimelineQuery:
    """Daily winnings and EV-adjusted winnings, for the graph."""

    tenant_id: int
    date_from: date | None = None
    date_to: date | None = None
    dataset: Dataset = DATASET_HERO
    filters: dict[str, list[Any]] = field(default_factory=dict)

    def __post_init__(self) -> None:
        """Reject unknown filters and unknown datasets."""
        _check_dataset(self.dataset, hero_only=False)
        for name in self.filters:
            if name not in FILTERABLE:
                raise ValueError(f"unknown filter {name!r}")

    def build(self) -> tuple[str, dict[str, Any]]:
        """Return (sql, parameters) for the cumulative winnings series.

        Routed through `_source_for` like `StatsQuery`: a fine filter (SPR, hand class, ...)
        moves the series to the per-hand fact table, whose date column is `played_date`.
        Hardcoding the rollup here once made every fine filter a runtime UNKNOWN_IDENTIFIER.
        """
        table, date_column, _ = _source_for(list(self.filters))
        where = ["s.user_id = {tenant_id:UInt32}", "s.dataset = {dataset:String}"]
        params: dict[str, Any] = {"tenant_id": self.tenant_id, "dataset": self.dataset}
        if self.dataset == DATASET_HERO:
            # Own results only. The pool has no hero seat, and summing every seat's result
            # there is minus the rake, not a win rate -- so no seat gate applies to it.
            where.append("s.is_hero = 1")
        if self.date_from is not None:
            where.append(f"s.{date_column} >= {{date_from:Date}}")
            params["date_from"] = self.date_from
        if self.date_to is not None:
            where.append(f"s.{date_column} <= {{date_to:Date}}")
            params["date_to"] = self.date_to
        for name, values in self.filters.items():
            if not values:
                continue
            column, ch_type = FILTERABLE[name]
            where.append(f"s.{column} IN {{f_{name}:{ch_type}}}")
            params[f"f_{name}"] = values

        sql = (
            f"SELECT s.{date_column} AS day, sum(s.hands) AS hands, "
            "sum(s.net_won_bb) AS won_bb, sum(s.ev_won_bb) AS ev_bb, "
            "sum(s.showdown_won_bb) AS sd_bb, sum(s.nonshowdown_won_bb) AS nsd_bb "
            f"FROM {table} AS s "
            f"WHERE {' AND '.join(where)} "
            "GROUP BY day ORDER BY day"
        )
        return sql, params
