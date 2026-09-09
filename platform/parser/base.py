"""The parser boundary.

Everything site-specific lives behind `SiteParser`. Nothing downstream — not the worker, not
dbt, not the API — branches on `site` for anything except display and the anonymization flag.

**This is also the Rust seam** (docs/POKER_DECISIONS.md ADR-001). When one format eventually
dominates the CPU budget, you reimplement `parse_hand` for that one site in Rust via PyO3 and
register it here. Nothing else in the codebase changes. Keeping this boundary clean costs
nothing today and preserves that option.
"""

from __future__ import annotations

import re
from collections.abc import Iterator
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Protocol, runtime_checkable
from zoneinfo import ZoneInfo

from core.enums import Site
from core.models import CanonicalHand

UTC = ZoneInfo("UTC")

SNIFF_WINDOW_CHARS = 400
"""How much of a file `SiteParser.matches` looks at. Every site prints its header in the
first line or two; a longer window only makes sniffing a 200 MB archive slower. A file with a
preamble longer than this sniffs as nothing and must be uploaded with `site` set."""

# Hand histories print a site-local timezone abbreviation. Mapping them to real zones is the
# difference between correct session boundaries and a silent multi-hour shift in every
# date-filtered stat. Unknown abbreviations fall back to UTC and the original string is kept
# on the hand as `tz_source`, so the mistake is diagnosable rather than invisible.
TZ_MAP: dict[str, ZoneInfo] = {
    "ET": ZoneInfo("America/New_York"),
    "EST": ZoneInfo("America/New_York"),
    "EDT": ZoneInfo("America/New_York"),
    "CET": ZoneInfo("Europe/Paris"),
    "CEST": ZoneInfo("Europe/Paris"),
    "WET": ZoneInfo("Europe/Lisbon"),
    "MSK": ZoneInfo("Europe/Moscow"),
    "UTC": UTC,
    "GMT": UTC,
}

_MONEY_STRIP = re.compile(r"[^\d.\-]")


def parse_money(raw: str) -> Decimal:
    """Parse a printed amount into `Decimal`.

    Handles currency symbols, thousands separators and bare tournament chip counts.
    `Decimal`, never `float` — money that doesn't sum exactly is a support ticket, and the
    pot-math validator in `core.validation` would start failing on rounding noise.
    """
    if not raw:
        return Decimal(0)
    cleaned = _MONEY_STRIP.sub("", raw.replace(",", ""))
    if cleaned in ("", "-", "."):
        return Decimal(0)
    try:
        return Decimal(cleaned)
    except InvalidOperation:  # pragma: no cover - defensive
        return Decimal(0)


def to_utc(naive: datetime, tz_abbr: str) -> datetime:
    """Attach the site's timezone to a naive timestamp and convert to UTC."""
    zone = TZ_MAP.get(tz_abbr.upper(), UTC)
    return naive.replace(tzinfo=zone).astimezone(UTC)


@runtime_checkable
class SiteParser(Protocol):
    """What every site parser must provide."""

    site: Site

    def matches(self, text: str) -> bool:
        """True when `text` looks like this site's format. Used for format sniffing."""
        ...

    def split(self, text: str) -> Iterator[str]:
        """Yield individual hand texts from a file that may contain thousands."""
        ...

    def parse_hand(self, raw_text: str, hero_names: frozenset[str] | None = None) -> CanonicalHand:
        """Parse one hand. Raises `HandParseError` if this hand is unusable.

        `hero_names` are the uploading user's registered screen names, lower-cased. Formats
        that reveal the hero themselves (PokerStars prints `Dealt to <hero>`) may ignore it;
        formats that don't need it to resolve which seat is the user.
        """
        ...
