"""Saved analyses (plan F.9, spec §15): the 9-step analyzer's own store.

The client keeps a Dexie copy and autosaves through these endpoints, so `PUT` is a merge, not a
replacement: it changes the fields it was sent and, for `steps`, only the step numbers in the
body. That makes a save of the step being worked on safe while the rest of the analysis is
untouched, and makes a retry after a dropped connection harmless.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, status

from api import analysis_store as store
from api.deps import CurrentUserDep, SessionDep
from api.schemas_analyses import AnalysisIn, AnalysisOut, AnalysisSummary, AnalysisUpdate

router = APIRouter(prefix="/v1/analyses", tags=["analyses"])


@router.get("", response_model=list[AnalysisSummary])
async def list_analyses(user: CurrentUserDep, session: SessionDep) -> list[AnalysisSummary]:
    """The user's analyses, most recently worked on first."""
    return [store.summary(row) for row in await store.list_analyses(session, user.id)]


@router.post("", response_model=AnalysisOut, status_code=status.HTTP_201_CREATED)
async def create_analysis(
    body: AnalysisIn, user: CurrentUserDep, session: SessionDep
) -> AnalysisOut:
    """Open an analysis on a stored hand, a pasted one, or a situation typed by hand."""
    row = store.create_analysis(session, user.id, body)
    await session.commit()
    await session.refresh(row)
    return store.out(row)


@router.get("/{analysis_id}", response_model=AnalysisOut)
async def get_analysis(
    analysis_id: uuid.UUID, user: CurrentUserDep, session: SessionDep
) -> AnalysisOut:
    """One analysis with all the work done on it."""
    return store.out(await store.get_analysis(session, user.id, analysis_id))


@router.put("/{analysis_id}", response_model=AnalysisOut)
async def update_analysis(
    analysis_id: uuid.UUID, body: AnalysisUpdate, user: CurrentUserDep, session: SessionDep
) -> AnalysisOut:
    """Save progress: the steps in the body replace those step numbers, the rest is left alone."""
    row = await store.get_analysis(session, user.id, analysis_id)
    store.apply_update(row, body)
    await session.commit()
    await session.refresh(row)
    return store.out(row)


@router.delete("/{analysis_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_analysis(
    analysis_id: uuid.UUID, user: CurrentUserDep, session: SessionDep
) -> None:
    """Delete an analysis and everything written on it."""
    await session.delete(await store.get_analysis(session, user.id, analysis_id))
    await session.commit()
