"""`/v1/hands`: the three ways a hand reaches the replayer (plan F.7).

    GET  /v1/hands            recent hands from my own seat
    POST /v1/hands/search     the hands where a situation happened -- the same filter tree
                              the Reports workbench builds (ADR-022)
    POST /v1/hands/parse      raw text pasted in, parsed and returned, never stored (ADR-029)
    GET  /v1/hands/{uid}      one hand in full

All four produce the same `HandDetail`/`HandSummary` shapes, so the replayer never learns
where a hand came from. The reads live in `api/hand_query.py`; this module is the HTTP edge.
"""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from starlette.concurrency import run_in_threadpool

from api import hand_query
from api.deps import CurrentUserDep, SessionDep, hero_names_for
from api.hand_parse import PasteError, detail_from_hand, detect_site, one_hand
from api.ratelimit import tenant_rate_limit
from api.schemas import HandDetail, HandSummary
from api.schemas_hands import HandParseIn
from stats.errors import ReportError
from stats.hands import find_hands
from stats.request import HandSearch

router = APIRouter(prefix="/v1/hands", tags=["hands"], dependencies=[Depends(tenant_rate_limit)])


@router.get("", response_model=list[HandSummary])
async def list_hands(
    user: CurrentUserDep,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = 100,
) -> list[HandSummary]:
    """Recent hands for the authenticated user's hero seat."""
    return await run_in_threadpool(hand_query.hero_hands, user.tenant_id, date_from, date_to, limit)


@router.post("/search", response_model=list[HandSummary])
async def search_hands(body: HandSearch, user: CurrentUserDep) -> list[HandSummary]:
    """The hands where a situation happened, newest first.

    The row is the *decision* that matched, so its seat is the one the replayer opens on --
    which is what makes the pool dataset searchable at all, having no hero seat.
    """
    try:
        refs = await run_in_threadpool(find_hands, body, user.tenant_id)
    except ReportError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return await run_in_threadpool(hand_query.summaries_for, user.tenant_id, refs)


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


@router.get("/{hand_uid}", response_model=HandDetail)
async def get_hand(hand_uid: str, user: CurrentUserDep) -> HandDetail:
    """One hand with all seats and actions -- everything the replayer needs.

    A hand_uid belonging to another tenant returns 404: the response must not reveal that the
    hand exists at all.
    """
    detail = await run_in_threadpool(hand_query.hand_detail, user.tenant_id, hand_uid)
    if detail is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Hand not found")
    return detail
