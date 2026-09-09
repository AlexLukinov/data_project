"""The v1 stat vocabulary, frozen: what `scripts/fingerprint.py` compared the registry against.

The v1 engine (`api/queries.py`, deleted in plan C.6) defined every stat as a pair of counter
columns on the v1 rollup `marts.stats_daily`: `sum(action) / sum(opportunity)`. This is that
list, and nothing else from v1, so the parity report stays reproducible: restore the v1 chain
from commit `cab27e3` (see docs/POKER_STATUS.md, "C.6 backup step"), and `fingerprint.py`
runs again. `tests/test_stats_registry.py` also reads it: every v1 code must have a registry
entry, forever.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

StatKind = Literal["ratio", "money", "count"]


@dataclass(frozen=True, slots=True)
class V1Stat:
    """One v1 stat: its counter pair and how the pair became a number."""

    code: str
    kind: StatKind
    numerator: str
    denominator: str

    def expression(self) -> str:
        """The v1 SELECT expression over the v1 rollup aliased `s`."""
        if self.kind == "ratio":
            return f"round(100 * sum(s.{self.numerator}) / nullIf(sum(s.{self.denominator}), 0), 2)"
        if self.kind == "money":
            return f"round(100 * sum(s.{self.numerator}) / nullIf(sum(s.{self.denominator}), 0), 3)"
        return f"sum(s.{self.numerator})"

    def sample_expression(self) -> str:
        """The v1 opportunity count."""
        return f"sum(s.{self.denominator})"


_RATIOS: tuple[tuple[str, str, str], ...] = (
    ("vpip", "vpip_action", "vpip_opp"),
    ("pfr", "pfr_action", "pfr_opp"),
    ("threebet", "threebet_action", "threebet_opp"),
    ("fold_to_3bet", "fold_to_3bet_action", "fold_to_3bet_opp"),
    ("fourbet", "fourbet_action", "fourbet_opp"),
    ("steal", "steal_action", "steal_opp"),
    ("fold_bb_to_steal", "fold_bb_steal_action", "fold_bb_steal_opp"),
    ("cbet_flop", "cbet_flop_action", "cbet_flop_opp"),
    ("cbet_turn", "cbet_turn_action", "cbet_turn_opp"),
    ("fold_to_cbet_flop", "fold_to_cbet_f_action", "fold_to_cbet_f_opp"),
    ("check_raise_flop", "checkraise_f_action", "checkraise_f_opp"),
    ("rfi", "rfi_action", "rfi_opp"),
    ("limp", "limp_action", "limp_opp"),
    ("iso_raise", "iso_action", "iso_opp"),
    ("cold_call", "cold_call_action", "cold_call_opp"),
    ("squeeze", "squeeze_action", "squeeze_opp"),
    ("call_3bet", "call_3bet_action", "call_3bet_opp"),
    ("fivebet", "fivebet_action", "fivebet_opp"),
    ("defend_vs_open", "vs_open_call", "vs_open_opp"),
    ("fold_vs_open", "vs_open_fold", "vs_open_opp"),
    ("call_4bet", "vs_4bet_call", "vs_4bet_opp"),
    ("fold_to_4bet", "fold_to_4bet_action", "fold_to_4bet_opp"),
    ("cbet_river", "cbet_river_action", "cbet_river_opp"),
    ("fold_to_cbet_turn", "fold_to_cbet_t_action", "fold_to_cbet_t_opp"),
    ("fold_to_cbet_river", "fold_to_cbet_r_action", "fold_to_cbet_r_opp"),
    ("donk_flop", "donk_f_action", "donk_f_opp"),
    ("probe_turn", "probe_t_action", "probe_t_opp"),
    ("delayed_cbet", "delayed_cbet_action", "delayed_cbet_opp"),
    ("float_flop", "float_action", "float_opp"),
    ("check_raise_turn", "checkraise_t_action", "checkraise_t_opp"),
    ("check_raise_river", "checkraise_r_action", "checkraise_r_opp"),
    ("wwsf", "wwsf_action", "wwsf_opp"),
    ("wtsd", "wtsd_action", "wtsd_opp"),
    ("wsd", "wsd_action", "wsd_opp"),
    ("limp_fold", "limp_fold_action", "limp_faced_raise_opp"),
    ("limp_call", "limp_call_action", "limp_faced_raise_opp"),
    ("limp_raise", "limp_raise_action", "limp_faced_raise_opp"),
    ("raise_cbet_flop", "raise_cbet_f_action", "fold_to_cbet_f_opp"),
    ("float_fold", "float_fold_action", "float_fold_opp"),
    ("fold_to_donk", "fold_to_donk_action", "fold_to_donk_opp"),
    ("fold_to_flop_raise", "fold_to_flop_raise_action", "fold_to_flop_raise_opp"),
    ("fold_to_turn_raise", "fold_to_turn_raise_action", "fold_to_turn_raise_opp"),
    ("fold_to_river_raise", "fold_to_river_raise_action", "fold_to_river_raise_opp"),
    ("bet_call_river", "bet_call_river_action", "fold_to_river_raise_opp"),
    ("fold_to_probe_turn", "fold_to_probe_t_action", "fold_to_probe_t_opp"),
    ("fold_to_delayed_cbet", "fold_to_delayed_cbet_action", "fold_to_delayed_cbet_opp"),
    ("probe_river", "probe_r_action", "probe_r_opp"),
    ("fold_to_probe_river", "fold_to_probe_r_action", "fold_to_probe_r_opp"),
    ("river_raise", "river_raise_action", "river_face_bet_opp"),
    ("river_check_fold", "river_check_fold_action", "river_check_faced_opp"),
    ("river_check_call", "river_check_call_action", "river_check_faced_opp"),
)

V1_STATS: dict[str, V1Stat] = {
    **{code: V1Stat(code, "ratio", num, den) for code, num, den in _RATIOS},
    "bb_per_100": V1Stat("bb_per_100", "money", "net_won_bb", "hands"),
    "ev_bb_per_100": V1Stat("ev_bb_per_100", "money", "ev_won_bb", "hands"),
    "hands": V1Stat("hands", "count", "hands", "hands"),
}
"""The 54 v1 stats by code, in v1's order."""
