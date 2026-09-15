"""`/v1/hands`: the three ways a hand reaches the replayer (plan F.7), and what is written on it.

    GET  /v1/hands                recent hands from my own seat
    POST /v1/hands/search         the hands where a situation happened -- the same filter tree
                                  the Reports workbench builds (ADR-022)
    POST /v1/hands/parse          raw text pasted in, parsed and returned, never stored (ADR-029)
    GET  /v1/hands/tags           every tag I use, with how many hands carry it
    GET  /v1/hands/{uid}          one hand in full
    GET  /v1/hands/{uid}/note     my note on it       PUT    …/note        write it (blank removes)
    GET  /v1/hands/{uid}/tags     my tags on it       POST   …/tags        add one
                                                      DELETE …/tags/{tag}  take one off

All the list routes produce the same `HandSummary` shape, so the replayer never learns where a
hand came from. The reads live in `api/hand_query.py`; the notes and tags in
`api/hand_note_store.py` (plan D.7b); this module is the HTTP edge.

**A tag filter is an id list, not a filter clause (ADR-048).** `?tag=` on a list looks the tag
up in Postgres and hands the matching `hand_uid`s to the ClickHouse query as a restriction;
the situation filter itself is untouched and the registry knows nothing of tags.
"""

from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from api import hand_note_store as notes
from api import hand_query
from api.deps import CurrentUser, CurrentUserDep, SessionDep, hero_names_for
from api.hand_parse import PasteError, detail_from_hand, detect_site, one_hand
from api.ratelimit import tenant_rate_limit
from api.schemas import HandDetail, HandSummary
from api.schemas_hand_notes import HandNoteIn, HandNoteOut, HandTagsOut, Tag, TagCount, TagIn
from api.schemas_hands import HandParseIn
from stats.errors import ReportError
from stats.hands import find_hands
from stats.request import HandSearch

router = APIRouter(prefix="/v1/hands", tags=["hands"], dependencies=[Depends(tenant_rate_limit)])

TagFilter = Annotated[Tag | None, Query(description="Only hands carrying this tag")]
NOT_FOUND = "Hand not found"


async def owned_hand(hand_uid: str, user: CurrentUserDep) -> str:
    """The `hand_uid` from the path, once this tenant is known to have that hand -- else 404.

    Every route under `/{uid}/` hangs off this, so a note or a tag can never be written on a
    hand the caller cannot see, and the answer for another tenant's hand is the same as for a
    hand that does not exist: the response must not reveal that the hand exists at all.
    """
    if not await run_in_threadpool(hand_query.hand_exists, user.tenant_id, hand_uid):
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
    return hand_uid


OwnedHandDep = Annotated[str, Depends(owned_hand)]


async def tagged(session: AsyncSession, user: CurrentUser, tag: str | None) -> list[str] | None:
    """The hands to restrict a list to: `None` for no tag filter, else the tag's `hand_uid`s."""
    return None if tag is None else await notes.hands_tagged(session, user.id, tag)


@router.get("", response_model=list[HandSummary])
async def list_hands(
    user: CurrentUserDep,
    session: SessionDep,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = 100,
    tag: TagFilter = None,
) -> list[HandSummary]:
    """Recent hands for the authenticated user's hero seat, each with its tags."""
    only = await tagged(session, user, tag)
    if only == []:
        return []
    rows = await run_in_threadpool(
        hand_query.hero_hands, user.tenant_id, date_from, date_to, limit, only=only
    )
    return await notes.attach_tags(session, user.id, rows)


@router.post("/search", response_model=list[HandSummary])
async def search_hands(
    body: HandSearch, user: CurrentUserDep, session: SessionDep, tag: TagFilter = None
) -> list[HandSummary]:
    """The hands where a situation happened, newest first.

    The row is the *decision* that matched, so its seat is the one the replayer opens on --
    which is what makes the pool dataset searchable at all, having no hero seat.
    """
    only = await tagged(session, user, tag)
    if only == []:
        return []
    try:
        refs = await run_in_threadpool(find_hands, body, user.tenant_id, only_hand_uids=only)
    except ReportError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    rows = await run_in_threadpool(hand_query.summaries_for, user.tenant_id, refs)
    return await notes.attach_tags(session, user.id, rows)


@router.post("/parse", response_model=HandDetail)
async def parse_hand(body: HandParseIn, user: CurrentUserDep, session: SessionDep) -> HandDetail:
    """Parse one pasted hand and return it. Nothing is stored (ADR-029).

    The user's registered screen names for the site resolve which seat is hero, exactly as an
    upload does; without them the parser falls back to the format's own hero line.
    """
    try:
        site = body.site or detect_site(body.text)
    except PasteError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    names = await hero_names_for(session, user.id, site.value)
    try:
        hand = await run_in_threadpool(
            one_hand, body.text, site, frozenset(n.lower() for n in names)
        )
    except PasteError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    return detail_from_hand(hand)


@router.get("/tags", response_model=list[TagCount])
async def list_tags(user: CurrentUserDep, session: SessionDep) -> list[TagCount]:
    """Every tag the user has put on a hand, with how many hands carry it; most used first.

    Declared before `/{hand_uid}` so the literal path wins the match.
    """
    return await notes.vocabulary(session, user.id)


@router.get("/{hand_uid}", response_model=HandDetail)
async def get_hand(hand_uid: str, user: CurrentUserDep) -> HandDetail:
    """One hand with all seats and actions -- everything the replayer needs.

    A hand_uid belonging to another tenant returns 404: the response must not reveal that the
    hand exists at all.
    """
    detail = await run_in_threadpool(hand_query.hand_detail, user.tenant_id, hand_uid)
    if detail is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
    return detail


@router.get("/{hand_uid}/note", response_model=HandNoteOut)
async def get_note(
    hand_uid: OwnedHandDep, user: CurrentUserDep, session: SessionDep
) -> HandNoteOut:
    """My note on this hand; an empty body and a null `updated_at` when there is none."""
    return notes.note_out(hand_uid, await notes.get_note(session, user.id, hand_uid))


@router.put("/{hand_uid}/note", response_model=HandNoteOut)
async def put_note(
    hand_uid: OwnedHandDep, body: HandNoteIn, user: CurrentUserDep, session: SessionDep
) -> HandNoteOut:
    """Write my note on this hand, replacing any earlier one. A blank body removes it."""
    row = await notes.put_note(session, user.id, hand_uid, body.body)
    await session.commit()
    return notes.note_out(hand_uid, row)


@router.get("/{hand_uid}/tags", response_model=HandTagsOut)
async def get_tags(
    hand_uid: OwnedHandDep, user: CurrentUserDep, session: SessionDep
) -> HandTagsOut:
    """My tags on this hand, alphabetically."""
    return HandTagsOut(hand_uid=hand_uid, tags=await notes.tags_of(session, user.id, hand_uid))


@router.post("/{hand_uid}/tags", response_model=HandTagsOut)
async def add_tag(
    hand_uid: OwnedHandDep, body: TagIn, user: CurrentUserDep, session: SessionDep
) -> HandTagsOut:
    """Put a tag on this hand and answer with all of them.

    Adding one already there changes nothing; a 501st distinct tag is refused in words
    (`MAX_DISTINCT_TAGS`).
    """
    await notes.add_tag(session, user.id, hand_uid, body.tag)
    await session.commit()
    return HandTagsOut(hand_uid=hand_uid, tags=await notes.tags_of(session, user.id, hand_uid))


@router.delete("/{hand_uid}/tags/{tag:path}", response_model=HandTagsOut)
async def remove_tag(
    hand_uid: OwnedHandDep, tag: Tag, user: CurrentUserDep, session: SessionDep
) -> HandTagsOut:
    """Take a tag off this hand and answer with the ones left. A tag not there is a no-op.

    `{tag:path}`, because a tag may contain `/` (`3-bet/4-bet`): the client sends it as `%2F`,
    the server decodes the path before routing, and a plain `{tag}` would then never match.
    """
    await notes.remove_tag(session, user.id, hand_uid, tag)
    await session.commit()
    return HandTagsOut(hand_uid=hand_uid, tags=await notes.tags_of(session, user.id, hand_uid))
