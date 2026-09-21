"""Find real players' screen names in text: the matching half of the privacy guard (ADR-058).

Pure -- no git, no database. `scripts/privacy_check.py` hands it the keys and the files.

A screen name reaches this repository in three shapes, and each is matched as far as its context
proves it is a name:

* **a hand-history line** -- `Seat 3: name ($25 in chips)`, `name: folds`, `Dealt to name` --
  where the site's grammar says exactly where the name is. Matched at any length, spaces
  included, and no word is excused: an invented fixture name that is also a real handle has to
  change anyway.
* **a player key** -- `ggpoker:name`, the form the API, the marts and the tests use. The same.
* **any other text** -- prose, code, comments -- where ordinary words are real handles too
  ("board", "facing", "straight flush"). There a name is reported only when `reportable` says
  its shape and length keep dictionary words out -- a name written in quotes or backticks is
  being mentioned, so a digit, a symbol or a space makes it reportable at any length -- and
  never when it is on the committed allowlist of ordinary words.

Matching is case-insensitive because a key is the lower-cased name (`core.ids.player_key`).
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from typing import Literal

Context = Literal["hand history", "player key", "text"]

NAME_CHARS = "a-z0-9_!@\\[\\]\\-"
"""Every character of the real pool's names but the space (measured 2026-09-15 over 94,276
keys). In other text a token is a maximal run of these; a name holding any other character is
still matched in hand-history lines and player keys, and `Matcher.unmatched_in_text` counts it."""
EDGE_CHARS = "_!@[]-"
"""Stripped from a token's ends as a second candidate: `[name]`, `name!`, `@name`."""
MIN_LETTERS = 8
"""A letters-only name in other text is reported from this length (ADR-058)."""
MIN_MIXED = 5
"""A name with a digit or a symbol in it is reported from this length (ADR-058)."""
MIN_SPACED = 13
"""A name with a space in it is reported from this length, spaces counted (ADR-058)."""
MAX_CACHED_LINES = 200_000
"""Distinct lines held in the per-line cache before it is emptied, so a long history is bounded."""

_TOKEN = re.compile(f"[{NAME_CHARS}]+")
_CONTINUES = frozenset("abcdefghijklmnopqrstuvwxyz0123456789" + EDGE_CHARS)
"""A name cannot end before one of these: they are name characters other than the space."""
_QUOTES = re.compile(r"[\"`]|(?<![a-z])'|'(?![a-z])")
_TRAILING_ESCAPES = re.compile(r"(?:\\[nrt])+$")
_DECORATION = "#*>|+- \t"
_HAND_HISTORY = tuple(
    re.compile(pattern)
    for pattern in (
        r"^seat\s+\d+:\s+(?P<name>.+?)\s+\([^()]*\bin\s+chips\)",
        r"^seat\s+\d+:\s+(?P<name>.+?)(?:\s+\((?:button|small\s+blind|big\s+blind)\))?"
        r"\s+(?:folded|showed|mucked|won|collected|lost)\b",
        r"^(?P<name>.+?):\s+(?:folds|checks|calls|bets|raises|posts|shows|mucks|doesn't\s+show"
        r"|does\s+not\s+show|sits\s+out|is\s+sitting\s+out|chooses\s+to\s+ev\s+cashout"
        r"|pays\s+cashout\s+risk)\b",
        r"^dealt\s+to\s+(?P<name>.+?)(?:\s+\[[^\[\]]*\])?$",
        r"^uncalled\s+bet\s+\([^()]*\)\s+returned\s+to\s+(?P<name>.+?)$",
        r"^(?P<name>.+?)\s+collected\s+\S+\s+from\s+(?:main\s+|side\s+)?pot",
    )
)


@dataclass(frozen=True, slots=True)
class Finding:
    """One real player key found on one line. Carries the key and nothing about the player."""

    line: int
    key: str
    context: Context


def reportable(name: str, *, quoted: bool = False) -> bool:
    """Whether a real name found in other text is reported, by its shape and length alone.

    Digits alone never are: numbers are everywhere. Letters alone from `MIN_LETTERS`, quoted
    or not. Otherwise a `quoted` name always is; a bare one with a space from `MIN_SPACED`, and
    with a digit or a symbol from `MIN_MIXED`.
    """
    if name.replace(" ", "").isdigit():
        return False
    if name.isalpha():
        return len(name) >= MIN_LETTERS
    if quoted:
        return True
    if " " in name:
        return len(name) >= MIN_SPACED
    return len(name) >= MIN_MIXED


def _segments(line: str) -> Iterator[str]:
    """The quoted and unquoted pieces of a line, bare, as a hand-history line may start each."""
    for part in _QUOTES.split(line):
        piece = _TRAILING_ESCAPES.sub("", part.strip()).strip()
        if piece:
            yield piece
            bare = piece.lstrip(_DECORATION)
            if bare and bare != piece:
                yield bare


class Matcher:
    """Real player keys, indexed for matching lines of text."""

    def __init__(self, keys: Iterable[str], allowlist: Iterable[str] = ()) -> None:
        """Index `site:name` keys; `allowlist` excuses ordinary words in other text only."""
        by_name: dict[str, list[str]] = {}
        for key in keys:
            _, sep, name = key.partition(":")
            if not sep or not name:
                raise ValueError(f"not a player key: {key!r}")
            by_name.setdefault(name.lower(), []).append(key)
        if not by_name:
            raise ValueError("no player keys to match against")
        self._keys = {name: ", ".join(sorted(found)) for name, found in by_name.items()}
        self._max = max(map(len, by_name))
        self._allowlist = frozenset(word.strip().lower() for word in allowlist)
        sites = sorted(
            {key.split(":", 1)[0].lower() for found in by_name.values() for key in found}
        )
        self._prefix = re.compile(rf"(?<![a-z0-9_])(?:{'|'.join(map(re.escape, sites))}):")
        # Overlapping, so an apostrophe earlier on the line cannot swallow a quote's opening mark.
        self._quoted = re.compile(rf"(?=([`\"'])([^`\"'\n]{{1,{self._max + 2}}})\1)")
        outside = re.compile(f"[^{NAME_CHARS} ]")
        self.unmatched_in_text = sum(1 for name in by_name if outside.search(name))
        """Names with a character outside `NAME_CHARS`: matched in the two exact contexts only."""
        self._cache: dict[str, tuple[tuple[str, Context], ...]] = {}

    def scan(self, text: str) -> list[Finding]:
        """Every real key on every line of `text`, one finding per line, key and context.

        Lines are split on the newline character alone, so a number here is the number an editor
        shows -- unlike `str.splitlines`, which also breaks on form feeds and unicode separators.
        """
        findings: list[Finding] = []
        if len(self._cache) > MAX_CACHED_LINES:
            self._cache.clear()
        for number, line in enumerate(text.split("\n"), start=1):
            hits = self._cache.get(line)
            if hits is None:
                hits = self._cache[line] = self._line(line.lower())
            findings.extend(Finding(number, key, context) for key, context in hits)
        return findings

    def _line(self, low: str) -> tuple[tuple[str, Context], ...]:
        found: dict[str, Context] = {}
        for name in self._free_text(low):
            found[name] = "text"
        for name in self._player_keys(low):
            found[name] = "player key"
        for name in self._hand_history(low):
            found[name] = "hand history"
        return tuple((self._keys[name], context) for name, context in sorted(found.items()))

    def _hand_history(self, low: str) -> Iterator[str]:
        if ":" not in low and " to " not in low and "collected" not in low:
            return
        for piece in _segments(low):
            for pattern in _HAND_HISTORY:
                match = pattern.match(piece)
                if match and (name := match["name"].strip()) in self._keys:
                    yield name

    def _player_keys(self, low: str) -> Iterator[str]:
        for match in self._prefix.finditer(low):
            start = match.end()
            for end in range(min(len(low), start + self._max), start, -1):
                # The longest name that ends where a name can end: the next character is not one
                # a name continues with, so `ggpoker:ab_cd` never reads as the key `ab`.
                if low[start:end] in self._keys and low[end : end + 1] not in _CONTINUES:
                    yield low[start:end]
                    break

    def _free_text(self, low: str) -> Iterator[str]:
        for candidate in self._phrases(low):
            for name in {candidate, candidate.strip(EDGE_CHARS)}:
                if self._real(name) and reportable(name):
                    yield name
        for match in self._quoted.finditer(low):
            name = match[2].strip()
            if self._real(name) and reportable(name, quoted=True):
                yield name

    def _real(self, name: str) -> bool:
        """A real name that the allowlist does not excuse."""
        return name in self._keys and name not in self._allowlist

    def _phrases(self, low: str) -> Iterator[str]:
        """Every token, and every run of tokens joined by single spaces up to the longest name."""
        spans = [match.span() for match in _TOKEN.finditer(low)]
        for first, (start, end) in enumerate(spans):
            yield low[start:end]
            for next_start, next_end in spans[first + 1 :]:
                if next_start != end + 1 or low[end] != " " or next_end - start > self._max:
                    break
                end = next_end
                yield low[start:end]
