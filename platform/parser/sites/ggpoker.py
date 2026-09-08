"""GGPoker / PokerCraft parser — and the anonymization path.

GG's text export is PokerStars-derived, so the line grammar is reused wholesale. What is
*not* reused is player identity, and that is the architecturally important part:

**GGPoker anonymizes opponents.** Every non-hero seat carries a per-hand pseudonym with no
relationship to the same human's pseudonym in the next hand. This is deliberate on GG's part
and no parser trick defeats it. The model handles it by:

    player_key    = None        <- no cross-hand identity exists
    is_anonymized = 1
    anon_alias    = "1a2b3c4d"  <- valid WITHIN this hand only

Downstream, exactly one rule follows: opponent-level stats are gated on
`player_key IS NOT NULL`, in one place in the dbt intermediate layer. Hero stats work
normally on every site, and anonymous opponents still feed population baselines — you cannot
say "this villain folds too much", but you can say "the NL50 pool folds to a button steal 62%
of the time", which is what the AI coaching layer consumes anyway.

⚠️  **Validate against real exports before trusting this.** It is written to the documented
format shape; GG has changed its export format before and will again. The regression corpus
in `seeds/hands/ggpoker/` is the guard.
"""

from __future__ import annotations

import re
from collections.abc import Iterator

from core.enums import Site, TableFormat
from core.models import CanonicalHand
from parser.errors import HandParseError
from parser.sites.pokerstars import PokerStarsParser

GG_HEADER = re.compile(r"^Poker\s+Hand\s+#(?P<hid>[A-Z]{0,3}\d+):")
HERO_ALIAS = "hero"
RUSH_TABLE = re.compile(r"Rush\s*(?:And|&)?\s*Cash", re.IGNORECASE)
PARSER_VERSION = 2
"""Bumped when `_anonymize` was corrected: hands parsed by v1 have wrongly-nulled
`player_key` values and need re-parsing (`WHERE parser_version < 2`)."""

_HEX_ALIAS = re.compile(r"^[0-9a-f]{8}$")
_SEAT_ALIAS = re.compile(r"^(?:Player|Seat|Villain)[ _]?\d+$", re.IGNORECASE)


def _looks_anonymous(name: str) -> bool:
    """True when a screen name is a machine-generated per-hand alias, not a human handle."""
    return bool(_HEX_ALIAS.match(name) or _SEAT_ALIAS.match(name))


class GGPokerParser(PokerStarsParser):
    """PokerStars grammar, GG identity rules."""

    site = Site.GGPOKER
    default_tz = "UTC"
    """GG stamps UTC and prints no abbreviation, unlike PokerStars' ET."""

    def matches(self, text: str) -> bool:
        """True when the text opens with a GG `Poker Hand #` header."""
        return bool(GG_HEADER.search(text[:400]))

    def split(self, text: str) -> Iterator[str]:
        """Yield one hand at a time, splitting on the GG header."""
        lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
        current: list[str] = []
        for line in lines:
            if GG_HEADER.match(line):
                if current:
                    chunk = "\n".join(current).strip()
                    if chunk:
                        yield chunk
                current = [line]
            elif current:
                current.append(line)
        if current:
            chunk = "\n".join(current).strip()
            if chunk:
                yield chunk

    def parse_hand(self, raw_text: str, hero_names: frozenset[str] | None = None) -> CanonicalHand:
        """Parse one GG hand, then apply the anonymization rules."""
        # Reuse the PokerStars machinery by normalizing the header keyword, then re-tag.
        normalized = self._to_stars_header(raw_text)
        hand = super().parse_hand(normalized, hero_names or frozenset({HERO_ALIAS}))
        hand.site = Site.GGPOKER
        hand.raw_text = raw_text
        hand.parser_version = PARSER_VERSION
        if RUSH_TABLE.search(hand.table_name):
            # Fast-fold: the table dissolves after every hand, so table identity carries no
            # continuity. Nothing downstream may assume table persistence.
            hand.table_format = TableFormat.RUSH
        self._anonymize(hand)
        return hand

    @staticmethod
    def _to_stars_header(raw_text: str) -> str:
        """Rewrite `Poker Hand #...` to `PokerStars Hand #...` so the shared grammar applies.

        A deliberate, contained hack: it keeps one implementation of the line grammar instead
        of two that drift. If GG's grammar ever diverges beyond the header, this class stops
        subclassing and gets its own `_consume`.
        """
        first, sep, rest = raw_text.partition("\n")
        if not GG_HEADER.match(first):
            raise HandParseError("no GGPoker hand header", raw_text, 1)
        return f"{first.replace('Poker Hand', 'PokerStars Hand', 1)}{sep}{rest}"

    @staticmethod
    def _anonymize(hand: CanonicalHand) -> None:
        """Strip cross-hand identity from anonymized seats — and ONLY those.

        **Corrected against a real 147k-hand export.** The original implementation assumed
        every GG table anonymizes opponents and nulled `player_key` unconditionally. Real
        Rush & Cash exports carry genuine screen names (`sample_`, `QueenSample`,
        `Sample Name`), so that assumption silently destroyed usable opponent identity on
        every hand.

        Anonymization is now DETECTED per seat, not assumed per site: GG's anonymous tables
        emit machine-generated aliases (8 hex characters, or `Player`/`Seat` + digits), which
        are distinguishable from human screen names. When in doubt the name is kept — losing
        a real identity is worse than carrying an alias that never recurs, because a
        never-recurring key simply produces a one-hand sample nobody will look at.
        """
        for player in hand.players:
            if player.is_hero or not _looks_anonymous(player.screen_name):
                continue
            player.is_anonymized = True
            player.anon_alias = player.screen_name
            player.player_key = None
