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

# Allowlist: filter name -> (column, ClickHouse parameter type). Anything not in here is not
# filterable, by construction.
FILTERABLE: dict[str, tuple[str, str]] = {
    "site": ("site", "Array(String)"),
    "stake_level": ("stake_level", "Array(String)"),
    "game_type": ("game_type", "Array(String)"),
    "table_format": ("table_format", "Array(String)"),
    "position": ("position", "Array(String)"),
    "players_dealt_in": ("players_dealt_in", "Array(UInt8)"),
}

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
        StatDef("wwsf", "WWSF", "ratio", "wwsf_action", "wwsf_opp"),
        StatDef("wtsd", "WTSD", "ratio", "wtsd_action", "wtsd_opp"),
        StatDef("wsd", "W$SD", "ratio", "wsd_action", "wsd_opp"),
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
    filters: dict[str, list[Any]] = field(default_factory=dict)
    group_by: list[str] = field(default_factory=list)
    stats: list[str] = field(default_factory=list)
    custom_stats: list[CustomStat] = field(default_factory=list)
    limit: int = 500

    def __post_init__(self) -> None:
        """Reject anything not on the allowlist, before it can reach SQL."""
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

        # tenant_id first, always, and never from the caller's payload.
        where = ["s.user_id = {tenant_id:UInt32}"]
        params: dict[str, Any] = {"tenant_id": self.tenant_id}

        if self.hero_only:
            where.append("s.is_hero = 1")
        if self.player_key is not None:
            where.append("s.player_key = {player_key:String}")
            params["player_key"] = self.player_key
        if self.date_from is not None:
            where.append("s.day >= {date_from:Date}")
            params["date_from"] = self.date_from
        if self.date_to is not None:
            where.append("s.day <= {date_to:Date}")
            params["date_to"] = self.date_to

        for name, values in self.filters.items():
            if not values:
                continue
            column, ch_type = FILTERABLE[name]
            where.append(f"s.{column} IN {{f_{name}:{ch_type}}}")
            params[f"f_{name}"] = values

        sql = (
            f"SELECT {', '.join(select_parts)} "
            f"FROM marts.stats_daily AS s "
            f"WHERE {' AND '.join(where)} "
        )
        if self.group_by:
            sql += f"GROUP BY {', '.join(self.group_by)} ORDER BY {self.group_by[0]} "
        else:
            sql += "GROUP BY () "
        sql += "LIMIT {limit:UInt32}"
        params["limit"] = self.limit
        return sql, params


@dataclass(slots=True)
class TimelineQuery:
    """Daily winnings and EV-adjusted winnings, for the graph."""

    tenant_id: int
    date_from: date | None = None
    date_to: date | None = None
    filters: dict[str, list[Any]] = field(default_factory=dict)

    def __post_init__(self) -> None:
        """Reject unknown filters."""
        for name in self.filters:
            if name not in FILTERABLE:
                raise ValueError(f"unknown filter {name!r}")

    def build(self) -> tuple[str, dict[str, Any]]:
        """Return (sql, parameters) for the cumulative winnings series."""
        where = ["s.user_id = {tenant_id:UInt32}", "s.is_hero = 1"]
        params: dict[str, Any] = {"tenant_id": self.tenant_id}
        if self.date_from is not None:
            where.append("s.day >= {date_from:Date}")
            params["date_from"] = self.date_from
        if self.date_to is not None:
            where.append("s.day <= {date_to:Date}")
            params["date_to"] = self.date_to
        for name, values in self.filters.items():
            if not values:
                continue
            column, ch_type = FILTERABLE[name]
            where.append(f"s.{column} IN {{f_{name}:{ch_type}}}")
            params[f"f_{name}"] = values

        sql = (
            "SELECT s.day AS day, sum(s.hands) AS hands, "
            "sum(s.net_won_bb) AS won_bb, sum(s.ev_won_bb) AS ev_bb, "
            "sum(s.showdown_won_bb) AS sd_bb, sum(s.nonshowdown_won_bb) AS nsd_bb "
            "FROM marts.stats_daily AS s "
            f"WHERE {' AND '.join(where)} "
            "GROUP BY day ORDER BY day"
        )
        return sql, params
