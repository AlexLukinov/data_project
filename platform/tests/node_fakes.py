"""Fakes for tier 1's clustered query, shared by the node test modules (plan G.3).

Tier 1 asks one two-level report (`node_query.frequencies_request`): one row, and for every
action the registry knows a frequency cell with its five cluster columns and a count cell.
`frequency_answer` builds that row for a node where `players` identical players share every
action equally -- the per-player spread is then exactly zero, the design effect exactly 1,
and the interval the plain Wilson one, which keeps every tier test's arithmetic checkable by
hand. `players_answer` builds it from real per-player counts, for the tests that are about
the clustering itself.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from analysis.pool.node_query import COUNT_SUFFIX
from stats.cluster import CLUSTER_SUFFIXES
from stats.registry import registry

Rows = tuple[list[str], Sequence[Sequence[Any]]]

ACTIONS: tuple[str, ...] = tuple(registry().dimension("action").values)
DEFAULT_PLAYERS = 100
"""Enough players for an interval (`stats.cluster.MIN_PLAYERS`) with room to spare."""

COLUMNS: list[str] = [
    "decisions",
    "decisions__n",
    *[
        column
        for action in ACTIONS
        for column in (
            action,
            f"{action}__n",
            *(f"{action}{suffix}" for suffix in CLUSTER_SUFFIXES),
            f"{action}{COUNT_SUFFIX}",
            f"{action}{COUNT_SUFFIX}__n",
        )
    ],
    "__hands",
]
"""The outer level's columns, as `stats.cluster_query.clustered_columns` names them."""


def is_frequencies_query(sql: str) -> bool:
    """Whether a query is tier 1's: only the two-level shape names a per-player alias."""
    return "__player" in sql


def frequency_answer(groups: Mapping[str, int], players: int = DEFAULT_PLAYERS) -> Rows:
    """The row for `players` identical players sharing every action equally: design effect 1.

    With every player holding `x / K` of an action over `n / K` rows, `Σx_i² = X²/K`,
    `Σx_i·n_i = X·N/K` and `Σn_i² = N²/K`, so `Σ(x_i - p·n_i)²` is exactly zero.
    """
    total = sum(groups.values())
    if total == 0:
        return COLUMNS, []
    row: list[Any] = [total, total]
    for action in ACTIONS:
        taken = groups.get(action, 0)
        row.extend(
            [
                round(100 * taken / total, 2),
                total,
                taken,
                players,
                taken * taken / players,
                taken * total / players,
                total * total / players,
                taken,
                taken,
            ]
        )
    row.append(total)
    return COLUMNS, [row]


def players_answer(players: Sequence[Mapping[str, int]]) -> Rows:
    """The row for a node where each entry is one player's decisions per action."""
    seated = [p for p in players if sum(p.values()) > 0]
    sizes = [sum(p.values()) for p in seated]
    total = sum(sizes)
    if total == 0:
        return COLUMNS, []
    row: list[Any] = [total, total]
    for action in ACTIONS:
        counts = [p.get(action, 0) for p in seated]
        taken = sum(counts)
        row.extend(
            [
                round(100 * taken / total, 2),
                total,
                taken,
                len(seated),
                sum(x * x for x in counts),
                sum(x * n for x, n in zip(counts, sizes, strict=True)),
                sum(n * n for n in sizes),
                taken,
                taken,
            ]
        )
    row.append(total)
    return COLUMNS, [row]
