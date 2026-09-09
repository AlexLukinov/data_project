"""Format sniffing is explicit about ambiguity.

Regression for docs/POKER_AUDIT.md B13: `sniff()` used to return the first registered
parser that matched, so a loose matcher registered later would silently claim another
network's files.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest

from core.enums import Site
from core.models import CanonicalHand
from parser import registry
from parser.errors import FormatDetectionError


class _GreedyParser:
    """A parser whose matcher accepts anything -- the failure mode the check exists for."""

    site = Site.WINAMAX

    def matches(self, text: str) -> bool:
        return True

    def split(self, text: str) -> Iterator[str]:  # pragma: no cover - never called
        yield text

    def parse_hand(
        self, raw_text: str, hero_names: frozenset[str] | None = None
    ) -> CanonicalHand:  # pragma: no cover - never called
        raise NotImplementedError


@pytest.fixture
def greedy_registered() -> Iterator[None]:
    registry.register(_GreedyParser())
    try:
        yield
    finally:
        del registry._REGISTRY[Site.WINAMAX]


def test_sniff_picks_the_single_matching_parser(stars_cash_text: str, gg_text: str) -> None:
    assert registry.sniff(stars_cash_text) is Site.POKERSTARS
    assert registry.sniff(gg_text) is Site.GGPOKER


def test_sniff_refuses_an_ambiguous_match(greedy_registered: None, stars_cash_text: str) -> None:
    with pytest.raises(FormatDetectionError, match="more than one format"):
        registry.sniff(stars_cash_text)


def test_sniff_reports_no_match() -> None:
    with pytest.raises(FormatDetectionError, match="no registered"):
        registry.sniff("this is not a hand history")
