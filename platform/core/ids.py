"""Stable identifiers: hand deduplication keys and the solver-seam `spot_key`.

The dedup key is what makes re-uploading a file free and what lets an at-least-once Kafka
consumer be safe. It must be **deterministic** — the same hand parsed twice, by two parser
versions, on two machines, must produce the same `hand_uid`, or `ReplacingMergeTree` cannot
collapse the duplicate.

**A hand id has two forms, and this module is where they meet** (plan B.5b, ADR-064): the
32-character lowercase hex that Postgres, the API, every URL and every log line speak, and the
16 raw bytes that `core.*` and the marts key on. `uid_bytes` converts on the write side;
`UID_HEX`, `UID_MATCH` and `uid_in` are the read side, in SQL; `is_hand_uid` is the guard for a
value that came from a URL. Nothing else may spell the conversion out.
"""

from __future__ import annotations

import hashlib
import re

from core.enums import GameType, LimitType, Site

_UID_BYTES = 16
"""128 bits. Birthday collision risk at 10^11 hands is ~10^-16 — irrelevant."""

_WS = re.compile(r"\s+")


def hand_uid(site: Site, site_hand_id: str) -> str:
    """Deterministic dedup key for a hand.

    Site hand ids are unique *within* a site but collide across sites, so the site is part of
    the key. Use `content_uid` for sites that print no usable hand id.
    """
    digest = hashlib.sha256(f"{site.value}:{site_hand_id}".encode())
    return digest.hexdigest()[: _UID_BYTES * 2]


def uid_bytes(hex_uid: str) -> bytes:
    """The 16 raw bytes ClickHouse stores for a hex `hand_uid` (plan B.5b).

    `core.*` and the marts key on `FixedString(16)`; Postgres, the API, every URL and every
    log line keep the 32-character hex form. This is where the two meet on the write side --
    `UID_HEX` and `UID_MATCH` are the read half, in SQL. `bytes.fromhex` raises on anything
    that is not an even number of hex digits, which is the loud failure we want.
    """
    return bytes.fromhex(hex_uid)


def is_hand_uid(value: str) -> bool:
    """Whether `value` could be a hand id at all: exactly 32 lowercase hex characters.

    Checked before a value taken from a URL reaches `UID_MATCH`, because `toFixedString` of
    anything longer than 16 bytes raises `TOO_LARGE_STRING_SIZE` -- which would turn a typed
    URL into a 500 instead of the 404 it has always been.
    """
    return len(value) == _UID_BYTES * 2 and all(c in "0123456789abcdef" for c in value)


UID_HEX = "lower(hex({0}hand_uid)) AS hand_uid"
"""Project the stored bytes as the hex everything outside ClickHouse speaks.

`lower` is not decoration: ClickHouse's `hex()` is upper-case, and every id in Postgres, in
every URL and in every log line is lower-case. `{0}` is a table alias with its dot, or empty.
"""

UID_MATCH = "{0}hand_uid = toFixedString(unhex({{{1}:String}}), 16)"
"""Match one bound hex id against the stored bytes.

`toFixedString` rather than a bare `unhex`, which yields a `String`: a `FixedString` compares
zero-padded against one, so the bare form would also match a shorter id. Measured on the
server (25.8.16): comparing the column to the hex string itself is **silently false**, so
forgetting this conversion costs rows rather than raising.
"""


def uid_in(column: str, param: str) -> str:
    """The `IN` term matching a bound array of hex ids against stored bytes.

    A subquery, not `arrayMap` over the parameter: ClickHouse's `IN` takes a constant or a
    table expression, and a function applied to a bound array is neither -- the `arrayMap`
    form is accepted by a unit test and refused by the server with `UNSUPPORTED_METHOD`
    (found in plan D.7b, ADR-048). Passing the hex list straight in does raise, loudly:
    `TOO_LARGE_STRING_SIZE`, since 32 characters do not fit a `FixedString(16)`.
    """
    return (
        f"{column} IN (SELECT toFixedString(unhex(x), 16) "
        f"FROM (SELECT arrayJoin({{{param}:Array(String)}}) AS x))"
    )


def content_uid(site: Site, raw_text: str) -> str:
    """Fallback dedup key derived from the hand text itself.

    Whitespace is collapsed first so that a re-export with different line endings or trailing
    spaces still hashes to the same value. Never use this when a real hand id exists — content
    hashing makes a hand that was legitimately re-dealt identically look like a duplicate.
    """
    normalized = _WS.sub(" ", raw_text).strip()
    digest = hashlib.sha256(f"{site.value}:{normalized}".encode())
    return digest.hexdigest()[: _UID_BYTES * 2]


def player_key(site: Site, screen_name: str) -> str:
    """Cross-hand identity for a player.

    Screen names are unique per site and NOT across sites, so the site is part of the key.
    Lower-cased because several networks are case-insensitive on login but inconsistent in
    hand histories.
    """
    return f"{site.value}:{screen_name.strip().lower()}"


def stake_bucket(limit_type: LimitType, big_blind_cents: int) -> str:
    """Coarse stake label used for grouping and for `spot_key`.

    Buckets, not exact stakes: NL48 and NL50 are the same population for analysis purposes,
    and exact-stake grouping fragments the sample past usefulness.
    """
    for edge in (2, 5, 10, 25, 50, 100, 200, 500, 1000, 2000, 5000):
        if big_blind_cents <= edge:
            return f"{limit_type.value.upper()}{edge}"
    return f"{limit_type.value.upper()}5000+"


def spot_key(
    *,
    game_type: GameType,
    stake: str,
    hero_position: str,
    villain_position: str,
    street: str,
    action_sequence: str,
    stack_depth_bucket: str,
    board_texture: str = "",
) -> str:
    """Deterministic key for a strategic situation. **The solver / baseline seam.**

    This is the join key between a user's observed frequencies, population baselines, and
    (eventually) solver output. Anything that wants to be compared must bucket into the same
    `spot_key` space — see docs/POKER_DECISIONS.md ADR-011.

    Emitted from Phase 1 even though nothing joins against it yet: an unjoined column costs
    nothing, and retrofitting one costs a full reprocess of every hand.
    """
    parts = (
        game_type.value,
        stake,
        hero_position,
        villain_position,
        street,
        action_sequence,
        stack_depth_bucket,
        board_texture,
    )
    return hashlib.sha256("|".join(parts).encode()).hexdigest()[:16]


def stack_depth_bucket(effective_bb: float) -> str:
    """Bucket effective stack depth. Strategy is a function of depth, not of exact stack."""
    for edge, label in ((20, "0-20bb"), (40, "20-40bb"), (75, "40-75bb"), (150, "75-150bb")):
        if effective_bb <= edge:
            return label
    return "150bb+"
