"""Parser registry — the single public entry point to the parsing layer.

    parse(raw_text, site) -> CanonicalHand

Adding a network is adding one file under `parser/sites/` and one `register()` call. Nothing
else in the system learns about it. That property is what makes the format breadth in the
backlog (iPoker, WPN, partypoker, Winamax, 888) additive work rather than structural work.
"""

from __future__ import annotations

from collections.abc import Iterator

from core.enums import Site
from core.models import CanonicalHand
from parser.base import SiteParser
from parser.errors import FormatDetectionError, UnsupportedSiteError
from parser.sites.ggpoker import GGPokerParser
from parser.sites.pokerstars import PokerStarsParser

_REGISTRY: dict[Site, SiteParser] = {}


def register(parser: SiteParser) -> None:
    """Register a parser for its site, replacing any previous one."""
    _REGISTRY[parser.site] = parser


def get_parser(site: Site) -> SiteParser:
    """Return the parser for `site`, or raise `UnsupportedSiteError`."""
    try:
        return _REGISTRY[site]
    except KeyError as exc:
        supported = ", ".join(sorted(s.value for s in _REGISTRY))
        raise UnsupportedSiteError(f"no parser for {site.value!r}; have: {supported}") from exc


def supported_sites() -> list[Site]:
    """Every site with a registered parser."""
    return sorted(_REGISTRY, key=lambda s: s.value)


def parse(raw_text: str, site: Site, hero_names: frozenset[str] | None = None) -> CanonicalHand:
    """Parse **one** hand. The interface named in ADR-001; keep this signature stable."""
    return get_parser(site).parse_hand(raw_text, hero_names)


def split_hands(raw_text: str, site: Site) -> Iterator[str]:
    """Yield individual hand texts from a file that may hold thousands."""
    return get_parser(site).split(raw_text)


def parse_file(
    raw_text: str, site: Site, hero_names: frozenset[str] | None = None
) -> Iterator[CanonicalHand]:
    """Parse every hand in a file.

    Deliberately does NOT swallow errors: the caller (the worker) decides what to dead-letter,
    because only it has the object key and offset needed to make the failure reproducible.
    """
    parser = get_parser(site)
    for chunk in parser.split(raw_text):
        yield parser.parse_hand(chunk, hero_names)


def sniff(raw_text: str) -> Site:
    """Detect the format when the uploader didn't declare one.

    Users mislabel uploads constantly, and a wrong `site` produces zero parsed hands rather
    than an error — so sniffing is a real robustness feature, not a convenience.

    Every registered parser is asked, and more than one match is an error rather than a
    first-wins pick: registration order is not a specificity order, and a loose matcher added
    later would otherwise silently claim another network's files.
    """
    matched = [site for site, parser in _REGISTRY.items() if parser.matches(raw_text)]
    if not matched:
        raise FormatDetectionError("text matches no registered hand-history format")
    if len(matched) > 1:
        names = ", ".join(sorted(s.value for s in matched))
        raise FormatDetectionError(f"text matches more than one format ({names}); pass `site`")
    return matched[0]


# Registration order carries no meaning (see `sniff`); every parser must match only its own
# format. Adding a network is one import and one line here.
register(PokerStarsParser())
register(GGPokerParser())
