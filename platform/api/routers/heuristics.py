"""The heuristic log (plan F.11, spec §16): the lessons, and the prompt that keeps them honest.

A takeaway written once and never looked at again is a note, not a heuristic. These endpoints
are the two halves of that: the log itself, and `?due=true` -- the fourteen-day "still true?"
queue. Answering the prompt is a `PUT` with a `status`, which restarts the clock.

`/candidates` is the bridge to the analyzer: the step-9 takeaways in `analyses.heuristic` that
have not been adopted into the log yet (ADR-034).
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, status

from api import heuristic_store as store
from api.deps import CurrentUserDep, SessionDep
from api.schemas_heuristics import (
    HeuristicCandidate,
    HeuristicIn,
    HeuristicOut,
    HeuristicUpdate,
)

router = APIRouter(prefix="/v1/heuristics", tags=["heuristics"])


@router.get("", response_model=list[HeuristicOut])
async def list_heuristics(
    user: CurrentUserDep, session: SessionDep, due: bool = False
) -> list[HeuristicOut]:
    """The user's heuristics, newest first; `due=true` keeps only those awaiting their review."""
    rows = await store.list_heuristics(session, user.id, due_only=due)
    return [store.out(row) for row in rows]


@router.post("", response_model=HeuristicOut, status_code=status.HTTP_201_CREATED)
async def create_heuristic(
    body: HeuristicIn, user: CurrentUserDep, session: SessionDep
) -> HeuristicOut:
    """Write a heuristic into the log, either from an analysis or straight from the hand."""
    row = store.create_heuristic(session, user.id, body)
    await session.commit()
    await session.refresh(row)
    return store.out(row)


@router.get("/candidates", response_model=list[HeuristicCandidate])
async def list_candidates(user: CurrentUserDep, session: SessionDep) -> list[HeuristicCandidate]:
    """Step-9 takeaways from the user's analyses that are not in the log yet."""
    return await store.candidates(session, user.id)


@router.get("/{heuristic_id}", response_model=HeuristicOut)
async def get_heuristic(
    heuristic_id: uuid.UUID, user: CurrentUserDep, session: SessionDep
) -> HeuristicOut:
    """One heuristic, with its review state worked out."""
    return store.out(await store.get_heuristic(session, user.id, heuristic_id))


@router.put("/{heuristic_id}", response_model=HeuristicOut)
async def update_heuristic(
    heuristic_id: uuid.UUID, body: HeuristicUpdate, user: CurrentUserDep, session: SessionDep
) -> HeuristicOut:
    """Change a heuristic; sending `status` answers "still true?" and resets the 14-day clock."""
    row = await store.get_heuristic(session, user.id, heuristic_id)
    store.apply_update(row, body)
    await session.commit()
    await session.refresh(row)
    return store.out(row)


@router.delete("/{heuristic_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_heuristic(
    heuristic_id: uuid.UUID, user: CurrentUserDep, session: SessionDep
) -> None:
    """Remove a heuristic from the log."""
    await store.delete(session, user.id, heuristic_id)
    await session.commit()
