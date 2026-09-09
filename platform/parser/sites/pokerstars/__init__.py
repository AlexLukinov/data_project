"""PokerStars-format parser package. `PokerStarsParser` is the registry's entry point."""

from __future__ import annotations

from parser.sites.pokerstars.parser import PARSER_VERSION, PokerStarsParser, split_on

__all__ = ["PARSER_VERSION", "PokerStarsParser", "split_on"]
