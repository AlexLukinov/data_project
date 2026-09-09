"""Query compiler tests — the security boundary.

These run without the stack: they assert on the SQL and parameters the compiler *produces*,
which is where the vulnerabilities would be.
"""

from __future__ import annotations

from datetime import date

import pytest

from api.queries import STATS, StatsQuery, TimelineQuery


def test_tenant_is_always_in_the_where_clause() -> None:
    sql, params = StatsQuery(tenant_id=42).build()
    assert "user_id = {tenant_id:UInt32}" in sql
    assert params["tenant_id"] == 42


def test_tenant_id_is_required() -> None:
    """There is no way to construct a query without a tenant. That is the point."""
    with pytest.raises(TypeError):
        StatsQuery()  # type: ignore[call-arg]


def test_unknown_filter_is_rejected() -> None:
    with pytest.raises(ValueError, match="unknown filter"):
        StatsQuery(tenant_id=1, filters={"user_id": [2]})


def test_unknown_group_by_is_rejected() -> None:
    with pytest.raises(ValueError, match="cannot group by"):
        StatsQuery(tenant_id=1, group_by=["password_hash"])


def test_unknown_stat_is_rejected() -> None:
    with pytest.raises(ValueError, match="unknown stat"):
        StatsQuery(tenant_id=1, stats=["definitely_not_a_stat"])


@pytest.mark.parametrize(
    "payload",
    [
        "'; DROP TABLE core.hands; --",
        "1 OR 1=1",
        "pokerstars') OR user_id=2 --",
        "\\'; SELECT * FROM users; --",
    ],
)
def test_injection_attempts_become_bound_parameters(payload: str) -> None:
    """Hostile values must reach the database as DATA, never as SQL.

    The assertion is deliberately about the generated SQL rather than about the result: if the
    payload text ever appears in the query string, the compiler is broken regardless of
    whether this particular payload happens to be harmless.
    """
    sql, params = StatsQuery(tenant_id=1, filters={"site": [payload]}).build()
    assert payload not in sql
    assert params["f_site"] == [payload]
    assert "{f_site:Array(String)}" in sql


def test_no_user_supplied_string_reaches_the_sql() -> None:
    """Every value a CALLER controls must travel as a bound parameter, never as SQL text.

    Asserted against the caller's own inputs rather than against `params.values()`, because
    the compiler adds parameters of its own whose values legitimately collide with column
    names — `dataset='hero'` is a substring of the column `is_hero`. Iterating everything
    turned that collision into a false failure and would have tempted someone to weaken the
    check that actually matters.
    """
    user_supplied = ["pokerstars:someone'; --", "pokerstars", "NL50"]
    sql, params = StatsQuery(
        tenant_id=7,
        date_from=date(2026, 1, 1),
        date_to=date(2026, 2, 1),
        player_key=user_supplied[0],
        filters={"site": [user_supplied[1]], "stake_level": [user_supplied[2]]},
        group_by=["position"],
        stats=["vpip", "pfr", "bb_per_100"],
    ).build()
    for value in user_supplied:
        assert value not in sql
    assert params["player_key"] == user_supplied[0]


def test_every_stat_returns_its_sample_size() -> None:
    """Sample size travels with every ratio stat. Not optional — a stat without its n is
    a number a user cannot judge."""
    sql, _ = StatsQuery(tenant_id=1, stats=list(STATS)).build()
    for code, stat in STATS.items():
        if stat.kind != "count":
            assert f"AS {code}__n" in sql


def test_division_by_zero_is_guarded() -> None:
    """ClickHouse returns inf/nan for x/0 without complaint; a new user must not see 'nan'."""
    sql, _ = StatsQuery(tenant_id=1, stats=["vpip", "bb_per_100"]).build()
    assert sql.count("nullIf(") >= 2


def test_hero_only_by_default() -> None:
    sql, _ = StatsQuery(tenant_id=1).build()
    assert "is_hero = 1" in sql


def test_limit_is_bounded() -> None:
    with pytest.raises(ValueError, match="limit out of range"):
        StatsQuery(tenant_id=1, limit=10_000_000)


def test_timeline_is_tenant_scoped() -> None:
    sql, params = TimelineQuery(tenant_id=99).build()
    assert "user_id = {tenant_id:UInt32}" in sql
    assert params["tenant_id"] == 99


def test_timeline_rejects_unknown_filters() -> None:
    with pytest.raises(ValueError, match="unknown filter"):
        TimelineQuery(tenant_id=1, filters={"is_hero": [0]})


# ---------------------------------------------------------------------------------------
# Custom stats: the user chooses the OPPORTUNITY, not just the action
# ---------------------------------------------------------------------------------------


def test_custom_stat_lets_the_caller_pick_the_denominator() -> None:
    """The same numerator over two denominators answers two different questions.

    "How often do I fold to a 3-bet when facing one" vs "how often does that happen per hand
    dealt" — only the second is comparable across players with different opening frequencies.
    """
    from api.queries import CustomStat

    per_opportunity = CustomStat(
        code="f3b_faced",
        label="Fold to 3-bet (faced)",
        numerator="fold_to_3bet_action",
        denominator="fold_to_3bet_opp",
    )
    per_hand = CustomStat(
        code="f3b_per_hand",
        label="Fold to 3-bet (per hand)",
        numerator="fold_to_3bet_action",
        denominator="hands",
    )
    sql, _ = StatsQuery(tenant_id=1, stats=[], custom_stats=[per_opportunity, per_hand]).build()
    assert "sum(s.fold_to_3bet_opp)" in sql
    assert "sum(s.hands)" in sql
    assert "AS f3b_faced" in sql and "AS f3b_per_hand" in sql
    assert "AS f3b_faced__n" in sql, "custom stats carry a sample size too"


def test_custom_stat_counters_are_allowlisted() -> None:
    from api.queries import CustomStat

    for bad in ("password_hash", "1); DROP TABLE core.hands; --", "user_id"):
        with pytest.raises(ValueError, match=r"unknown (numerator|denominator) counter"):
            StatsQuery(
                tenant_id=1,
                custom_stats=[CustomStat("x", "X", numerator=bad, denominator="hands")],
            )


def test_custom_stat_code_is_sanitized() -> None:
    from api.queries import CustomStat

    for bad_code in ("DROP", "a b", "x); --", "1abc", ""):
        with pytest.raises(ValueError, match=r"invalid stat code|unknown"):
            StatsQuery(
                tenant_id=1,
                custom_stats=[CustomStat(bad_code, "X", numerator="hands", denominator="hands")],
            )


def test_custom_stat_cannot_shadow_a_builtin() -> None:
    from api.queries import CustomStat

    with pytest.raises(ValueError, match="shadows a built-in"):
        StatsQuery(
            tenant_id=1,
            custom_stats=[CustomStat("vpip", "Fake", numerator="hands", denominator="hands")],
        )


def test_duplicate_custom_codes_are_rejected() -> None:
    from api.queries import CustomStat

    spec = CustomStat("dup", "D", numerator="hands", denominator="hands")
    with pytest.raises(ValueError, match="duplicate custom stat"):
        StatsQuery(tenant_id=1, custom_stats=[spec, spec])


def test_custom_stats_are_still_tenant_scoped() -> None:
    from api.queries import CustomStat

    sql, params = StatsQuery(
        tenant_id=5,
        custom_stats=[CustomStat("c", "C", numerator="wwsf_action", denominator="wwsf_opp")],
    ).build()
    assert "s.user_id = {tenant_id:UInt32}" in sql
    assert params["tenant_id"] == 5
