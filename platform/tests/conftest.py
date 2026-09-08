"""Shared test fixtures.

The corpus fixtures load real hand text from `seeds/hands/`. Every parser change is checked
against them — that corpus is the permanent regression fixture, and it is the reason
"re-parse everything after a parser fix" is a safe operation rather than a terrifying one.
"""

from __future__ import annotations

from pathlib import Path

import pytest

SEEDS = Path(__file__).resolve().parent.parent / "seeds" / "hands"


def _read(*parts: str) -> str:
    return (SEEDS.joinpath(*parts)).read_text(encoding="utf-8")


@pytest.fixture(scope="session")
def stars_cash_text() -> str:
    """Two straightforward 6-max NL50 hands."""
    return _read("pokerstars", "cash_6max_nl50.txt")


@pytest.fixture(scope="session")
def stars_edge_text() -> str:
    """The pathological set: 3-bet all-in, side pot, heads-up split pot, PLO."""
    return _read("pokerstars", "edge_cases.txt")


@pytest.fixture(scope="session")
def gg_text() -> str:
    """GGPoker Rush & Cash hands with anonymized opponents."""
    return _read("ggpoker", "rush_nl50.txt")
