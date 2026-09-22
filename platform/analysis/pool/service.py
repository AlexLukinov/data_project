"""Pool reports and player lookup (plan §2.8): population stats by situation, per opponent."""

from __future__ import annotations

import re
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

from analysis.presets import Preset, load_presets
from core.enums import Site
from stats.ast import Leaf
from stats.errors import ReportError
from stats.registry import Registry
from stats.request import (
    DATASET_POPULATION,
    MAX_LIMIT,
    CohortSpec,
    OrderKey,
    OrderMatch,
    ReportRequest,
    ReportResult,
)
from stats.service import Cache, Runner, run_report

PRESETS = Path(__file__).with_name("presets.yaml")
PLAYER_STATS = ("hands", "vpip", "pfr", "threebet", "wtsd", "wwsf", "bb_per_100")
"""What a player lookup shows beside each screen name: enough to tell a reg from a fish."""
MAX_PLAYERS = 200

SITE_SEPARATOR = ":"
"""A `player_key` is `<site>:<screen name>` (`core.ids.player_key`): screen names are unique
per site and not across sites, so the site is part of the identity -- and of every key."""

SITES = frozenset(site.value for site in Site)
"""The only things a colon in the typed text may separate off. A colon is common in what people
paste ("Villain: someone") and a screen name may hold one, so reading every left half as a site
would turn those searches into searches for a site that does not exist -- 0 rows, 200 OK, the
false absence this route was fixed for."""

MIN_NAME = 3
"""Characters of a screen name a lookup needs before it runs (ADR-062).

Not a guess: over the pool's 94,276 keys, the worst three-character fragment is inside 2,259
names and the worst two-character one inside 11,829. Three keeps every answer complete -- every
match is seen, so `matched` is a count and the ranking below is over all of them -- and it
costs nobody a player: the shortest screen name in the pool is four characters long.
"""

MAX_MATCHES = MAX_LIMIT
"""Players one lookup will count. Reached only by a fragment far shorter than the corpus makes
possible; when it is reached the answer says so rather than shortening the truth."""


class PlayerSearch(BaseModel):
    """What to look a player up by.

    A body, not a query string: a screen name is personal data, and a query string is written
    into every access log the request passes through (ADR-058).
    """

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=64)
    limit: int = Field(default=50, ge=1, le=MAX_PLAYERS)


class PlayerMatches(ReportResult):
    """Who a typed name matched, and the ones worth reading first.

    A report result with the two facts a list of names needs and a grid of numbers does not.
    `rows` holds at most `MAX_PLAYERS` of the matches; `hands` is the total over everyone
    *counted*, so a shortened list never reads as the whole of it -- and when `matched_capped`
    says the count is a floor, `hands` is a floor with it.
    """

    matched: int
    """How many players the name matched. `len(rows)` is how many of them are here."""

    matched_capped: bool = False
    """True when more players matched than `MAX_MATCHES` counts, making `matched` a floor
    rather than a count -- and the ranking a ranking of what was counted. Unreachable at
    `MIN_NAME` characters on today's corpus; it exists so that stays checkable as it grows."""


def pool_report(
    request: ReportRequest,
    tenant_id: int,
    *,
    cohort: CohortSpec | None = None,
    run: Runner | None = None,
    cache: Cache | None = None,
    reg: Registry | None = None,
) -> ReportResult:
    """A report on the population, optionally restricted to a cohort.

    A per-opponent report is the same call with `player_key` set on the request: the engine
    scopes it, and the cohort (if any) still applies, so "this player, if a reg" is expressible.
    """
    if request.dataset != DATASET_POPULATION:
        raise ReportError("pool reports read the population dataset")
    scoped = request if cohort is None else request.model_copy(update={"cohort": cohort})
    return run_report(scoped, tenant_id, run=run, cache=cache, reg=reg)


def players(
    name: str,
    tenant_id: int,
    *,
    limit: int = MAX_PLAYERS,
    run: Runner | None = None,
    reg: Registry | None = None,
) -> PlayerMatches:
    """Pool players whose screen name contains `name`, the exact one first, then the busiest.

    `name` is part of a screen name, or a whole key pasted back out of an answer
    (`<site>:<part of a name>`). Either way the match is on the **name half** of the key and
    never on the site, so typing the site's own name looks for the people who have it *in their
    name* -- 27 of them on the real pool -- rather than handing back all 94,276 keys that are on
    it. The bug this route had was the reverse of that: it matched the start of the whole key,
    and no screen name is that (ADR-062). Lower-cased because the pipeline stores keys lowered and
    `LIKE` is case-sensitive: were that to change the search would stop matching rather than
    match the wrong player, and the anonymized seat `''` carries no separator to match past.
    """
    site, fragment = _split(name.strip().lower())
    if len(fragment) < MIN_NAME:
        raise ReportError(f"type at least {MIN_NAME} characters of a screen name")
    # Uncached, alone among the reports here: the query is as wide as the match set, which is
    # what makes the ranking exact, and three characters on the real pool measure 1,966 rows
    # and 1.6 MiB of JSON -- which would evict the blocks a screen really does read twice.
    found = run_report(_request(site, fragment), tenant_id, run=run, reg=reg)
    shown = found.model_copy(update={"rows": found.rows[: min(limit, MAX_PLAYERS)]})
    return PlayerMatches(
        **shown.model_dump(),
        matched=len(found.rows),
        matched_capped=len(found.rows) >= MAX_MATCHES,
    )


def _request(site: str | None, fragment: str) -> ReportRequest:
    """The report behind a lookup: every match on the rollup, ranked, with the headline stats.

    The database does the ranking (ADR-065). The rows arrive in the order a reader wants them
    in, so `players()` above takes a slice rather than sorting a second time -- and at the cap
    the rows counted are the busiest `MAX_MATCHES`, not an arbitrary `MAX_MATCHES`.
    """
    return ReportRequest(
        dataset=DATASET_POPULATION,
        hero_only=False,
        stats=list(PLAYER_STATS),
        group_by=["player_key"],
        filter=Leaf(dim="player_key", op="like", value=_pattern(site, fragment)),
        order_by=_ranking(site, fragment),
        limit=MAX_MATCHES,
    )


def _ranking(site: str | None, fragment: str) -> list[OrderKey | OrderMatch]:
    """The exact name first, then the busiest, then alphabetically (ADR-062 decision 3).

    What happens to a name that is a substring of many. The player meant is either the one
    whose name was typed in full or one there are hands on -- never the alphabetically first
    of two thousand, which is what a bare `ORDER BY player_key` and a cap would have shown.

    "Whose name was typed in full" is the whole key against one candidate per site, not a
    pattern: `core.ids.player_key` builds every key as `<site>:<screen name>`, so the name
    half IS the fragment exactly when the key is one of those -- while a trailing-anchored
    `LIKE` would also match a name that merely *ends* `:<fragment>`. Equality, not `LIKE`,
    is also why these values are the typed text unescaped: `%` and `_` are LIKE's own and
    are nobody else's.

    The last term breaks a tie on **the whole key**, so it is the site's name and then the
    player's. On a single-site pool -- the only kind there has ever been here, and 94,276 of
    the 94,277 keys today -- that is the same order as by screen name alone, which is what
    this ranking did in Python. Import a second site and two equally busy matches sort by site
    first. Ordering on the name half would mean cutting the key up in SQL, and an expression
    around a column is exactly what `stats/order.py` exists to keep out (ADR-065).
    """
    exact = Leaf(dim="player_key", op="in", value=_exact_keys(site, fragment))
    return [
        OrderMatch(match=exact, direction="desc"),
        OrderKey(key="hands", direction="desc"),
        OrderKey(key="player_key", direction="asc"),
    ]


def _exact_keys(site: str | None, fragment: str) -> list[str]:
    """Every `player_key` whose screen name is exactly `fragment`: one per site in play."""
    return sorted(f"{one}{SITE_SEPARATOR}{fragment}" for one in ([site] if site else SITES))


def _split(text: str) -> tuple[str | None, str]:
    """`(site, fragment)` when a real site was typed before a colon, else the whole text.

    The colon separates only when what precedes it is a site this product parses, which is what
    a key pasted back out of an answer looks like. Everything else with a colon in it is a name
    fragment and is searched for as one, so `MIN_NAME` also measures what was actually typed.
    """
    site, separator, fragment = text.partition(SITE_SEPARATOR)
    return (site, fragment) if separator and site in SITES else (None, text)


def _pattern(site: str | None, fragment: str) -> str:
    """A `LIKE` pattern matching `fragment` anywhere inside the name half of a `player_key`.

    With no site: `%:%<fragment>%` -- a separator, then anything, then the fragment. Every key
    holds exactly one separator and no screen name holds one, so the fragment can only be
    matched to the right of it. With a site the site must match it exactly.
    """
    if site is None:
        return f"%{SITE_SEPARATOR}%{_literal(fragment)}%"
    return f"{_literal(site)}{SITE_SEPARATOR}%{_literal(fragment)}%"


_WILDCARD = re.compile(r"[\\%_]")


def _literal(text: str) -> str:
    r"""Typed text as itself: `%`, `_` and `\` are LIKE's own and were typed as characters."""
    return _WILDCARD.sub(lambda match: "\\" + match.group(), text)


def presets(reg: Registry | None = None) -> list[Preset]:
    """The pool's report presets, validated against the registry."""
    return load_presets(PRESETS, DATASET_POPULATION, reg)
