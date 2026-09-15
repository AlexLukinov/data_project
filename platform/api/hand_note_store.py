"""Persistence for hand notes and tags: the queries behind `api/routers/hands.py` (plan D.7b).

Every query is scoped by `user_id` in the WHERE clause. Whether the user *owns* the hand is not
this module's question -- that is answered against ClickHouse at the HTTP edge before anything
here is called -- so a row for a hand the tenant cannot see is simply never written.

The store shapes rows and hits the database; it never commits. The router owns the transaction.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable, Sequence

from fastapi import HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from api.models_hand_notes import HandNote, HandTag
from api.schemas import HandSummary
from api.schemas_hand_notes import MAX_DISTINCT_TAGS, HandNoteOut, TagCount

VOCABULARY_FULL = (
    f"you already have {MAX_DISTINCT_TAGS} distinct tags; reuse one of them or remove one "
    "before adding another"
)


def note_out(hand_uid: str, row: HandNote | None) -> HandNoteOut:
    """The wire shape of a note, or of its absence."""
    if row is None:
        return HandNoteOut(hand_uid=hand_uid, body="", updated_at=None)
    return HandNoteOut(hand_uid=hand_uid, body=row.body, updated_at=row.updated_at)


async def get_note(session: AsyncSession, user_id: uuid.UUID, hand_uid: str) -> HandNote | None:
    """The user's note on one hand, if they wrote one."""
    result = await session.execute(
        select(HandNote).where(HandNote.user_id == user_id, HandNote.hand_uid == hand_uid)
    )
    return result.scalar_one_or_none()


async def put_note(
    session: AsyncSession, user_id: uuid.UUID, hand_uid: str, body: str
) -> HandNote | None:
    """Write the note, replacing any earlier one. **A blank body removes it.**

    A note that says nothing is not a note, and keeping an empty row would list the hand as
    annotated; so the row goes, and the caller sees the same shape as a hand never written on.

    An upsert on the `(user_id, hand_uid)` constraint rather than read-then-write: two first
    saves of the same hand at once (two tabs) would otherwise both insert and the second would
    fail the constraint as a 500. `updated_at` is set here because the ORM's `onupdate` does
    not see a statement-level upsert.
    """
    text = body.strip()
    if text == "":
        await session.execute(
            delete(HandNote).where(HandNote.user_id == user_id, HandNote.hand_uid == hand_uid)
        )
        return None
    upsert = insert(HandNote).values(user_id=user_id, hand_uid=hand_uid, body=text)
    await session.execute(
        upsert.on_conflict_do_update(
            constraint="uq_hand_notes_user_hand", set_={"body": text, "updated_at": func.now()}
        )
    )
    return await get_note(session, user_id, hand_uid)


async def tags_of(session: AsyncSession, user_id: uuid.UUID, hand_uid: str) -> list[str]:
    """The tags on one hand, alphabetically."""
    result = await session.execute(
        select(HandTag.tag)
        .where(HandTag.user_id == user_id, HandTag.hand_uid == hand_uid)
        .order_by(HandTag.tag)
    )
    return [str(tag) for tag in result.scalars().all()]


async def distinct_tag_count(session: AsyncSession, user_id: uuid.UUID) -> int:
    """How many different tags the user has in use, across all their hands."""
    result = await session.execute(
        select(func.count(func.distinct(HandTag.tag))).where(HandTag.user_id == user_id)
    )
    return int(result.scalar_one())


def vocabulary_has_room(distinct_in_use: int, is_known: bool) -> bool:
    """Whether one more tag may be added: a known tag always fits, a new one only under the cap.

    Kept as a plain function so the rule is stated once and testable without a database.
    """
    return is_known or distinct_in_use < MAX_DISTINCT_TAGS


async def add_tag(session: AsyncSession, user_id: uuid.UUID, hand_uid: str, tag: str) -> None:
    """Put a (normalized) tag on a hand. Idempotent: a tag already there is left as it is.

    Refuses in words when it would be the user's 501st distinct tag -- `MAX_DISTINCT_TAGS` --
    which is the cap, not a per-hand one: tagging a second hand with a tag already in use is
    always allowed, however many tags there are. The insert is `ON CONFLICT DO NOTHING` on the
    `(user_id, hand_uid, tag)` constraint, so two requests adding the same tag at once both
    succeed with one row. The cap itself is read-then-write and can be overshot by concurrent
    adds of *different* new tags; it bounds a vocabulary, not an account, so that is accepted
    (ADR-048).
    """
    known = await session.execute(
        select(HandTag.id).where(HandTag.user_id == user_id, HandTag.tag == tag).limit(1)
    )
    is_known = known.scalar_one_or_none() is not None
    if not vocabulary_has_room(await distinct_tag_count(session, user_id), is_known):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, VOCABULARY_FULL)
    row = insert(HandTag).values(user_id=user_id, hand_uid=hand_uid, tag=tag)
    await session.execute(row.on_conflict_do_nothing(constraint="uq_hand_tags_user_hand_tag"))


async def remove_tag(session: AsyncSession, user_id: uuid.UUID, hand_uid: str, tag: str) -> None:
    """Take a tag off a hand. Removing one that is not there is a no-op."""
    await session.execute(
        delete(HandTag).where(
            HandTag.user_id == user_id, HandTag.hand_uid == hand_uid, HandTag.tag == tag
        )
    )


async def vocabulary(session: AsyncSession, user_id: uuid.UUID) -> list[TagCount]:
    """Every tag the user has used, with how many hands carry it; most used first."""
    hands = func.count(HandTag.id)
    result = await session.execute(
        select(HandTag.tag, hands)
        .where(HandTag.user_id == user_id)
        .group_by(HandTag.tag)
        .order_by(hands.desc(), HandTag.tag)
    )
    return [TagCount(tag=str(tag), hands=int(count)) for tag, count in result.all()]


async def hands_tagged(session: AsyncSession, user_id: uuid.UUID, tag: str) -> list[str]:
    """The `hand_uid`s carrying a tag -- the id list a tag filter intersects with (ADR-048)."""
    result = await session.execute(
        select(HandTag.hand_uid).where(HandTag.user_id == user_id, HandTag.tag == tag)
    )
    return [str(uid) for uid in result.scalars().all()]


async def tags_by_hand(
    session: AsyncSession, user_id: uuid.UUID, hand_uids: Iterable[str]
) -> dict[str, list[str]]:
    """The tags on each of the given hands, for decorating a list in one query."""
    uids = list(hand_uids)
    if not uids:
        return {}
    result = await session.execute(
        select(HandTag.hand_uid, HandTag.tag)
        .where(HandTag.user_id == user_id, HandTag.hand_uid.in_(uids))
        .order_by(HandTag.tag)
    )
    found: dict[str, list[str]] = {}
    for uid, tag in result.all():
        found.setdefault(str(uid), []).append(str(tag))
    return found


def with_tags(rows: Sequence[HandSummary], tags: dict[str, list[str]]) -> list[HandSummary]:
    """The list rows with each hand's tags attached; a hand with none keeps an empty list."""
    return [row.model_copy(update={"tags": tags.get(row.hand_uid, [])}) for row in rows]


async def attach_tags(
    session: AsyncSession, user_id: uuid.UUID, rows: Sequence[HandSummary]
) -> list[HandSummary]:
    """Decorate list rows with their tags -- the "tag indicator column" on every hand list."""
    return with_tags(rows, await tags_by_hand(session, user_id, {r.hand_uid for r in rows}))
