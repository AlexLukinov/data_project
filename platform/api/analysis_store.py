"""Persistence for saved analyses: the queries behind `api/routers/analyses.py`.

Every query is scoped by `user_id` in the WHERE clause, never merely by id -- another tenant's
analysis 404s, exactly like the ranges and the saved documents.

Steps arrive one at a time as the user works, so an update **merges by step number** rather than
replacing the list: a client that autosaves step 4 must not wipe steps 1-3 it did not send.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from analysis.pool.nodes import NodeKey
from api.models_analyses import FIRST_STEP, Analysis
from api.schemas_analyses import (
    AnalysisIn,
    AnalysisOut,
    AnalysisStep,
    AnalysisSummary,
    AnalysisUpdate,
)


async def list_analyses(session: AsyncSession, user_id: uuid.UUID) -> Sequence[Analysis]:
    """The user's analyses, most recently worked on first."""
    result = await session.execute(
        select(Analysis).where(Analysis.user_id == user_id).order_by(Analysis.updated_at.desc())
    )
    return result.scalars().all()


async def get_analysis(session: AsyncSession, user_id: uuid.UUID, row_id: uuid.UUID) -> Analysis:
    """One analysis by id, for its owner only; 404 otherwise."""
    result = await session.execute(
        select(Analysis).where(Analysis.id == row_id, Analysis.user_id == user_id)
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    return row


def create_analysis(session: AsyncSession, user_id: uuid.UUID, body: AnalysisIn) -> Analysis:
    """Open an analysis at step 1 with no work done."""
    row = Analysis(
        user_id=user_id,
        title=body.title,
        source=body.source,
        hand_uid=body.hand_uid,
        hand_text=body.hand_text,
        node_key=None if body.node_key is None else body.node_key.canonical(),
        action_index=body.action_index,
        current_step=FIRST_STEP,
        steps=[],
        heuristic="",
        tags=list(body.tags),
    )
    session.add(row)
    return row


def steps_of(row: Analysis) -> list[AnalysisStep]:
    """The stored steps as models, in step order; a step never written is simply absent."""
    steps = [AnalysisStep.model_validate(step) for step in row.steps]
    return sorted(steps, key=lambda step: step.step)


def merge_steps(row: Analysis, sent: Sequence[AnalysisStep]) -> None:
    """Overwrite the steps that were sent and leave the rest alone."""
    by_number = {step.step: step for step in steps_of(row)}
    for step in sent:
        by_number[step.step] = step
    row.steps = [step.model_dump(mode="json") for step in sorted(by_number.values(), key=_number)]


def _number(step: AnalysisStep) -> int:
    return step.step


def apply_update(row: Analysis, body: AnalysisUpdate) -> None:
    """Apply the fields that were sent; `steps` merges, everything else replaces."""
    if body.title is not None:
        row.title = body.title
    if body.node_key is not None:
        row.node_key = body.node_key.canonical()
    if body.current_step is not None:
        row.current_step = body.current_step
    if body.heuristic is not None:
        row.heuristic = body.heuristic
    if body.tags is not None:
        row.tags = list(body.tags)
    if body.steps is not None:
        merge_steps(row, body.steps)


def completed(steps: Sequence[AnalysisStep]) -> list[int]:
    """The steps whose prediction was committed -- what the stepper marks as done (spec §15)."""
    return [step.step for step in steps if step.prediction is not None]


def summary(row: Analysis) -> AnalysisSummary:
    """A list row: the spot and how far it got, without the steps themselves."""
    return AnalysisSummary(
        id=row.id,
        title=row.title,
        source=row.source,
        hand_uid=row.hand_uid,
        node_key=None if row.node_key is None else NodeKey.model_validate(row.node_key),
        current_step=row.current_step,
        completed_steps=completed(steps_of(row)),
        heuristic=row.heuristic,
        tags=list(row.tags),
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def out(row: Analysis) -> AnalysisOut:
    """The whole analysis, steps included."""
    steps = steps_of(row)
    return AnalysisOut(
        **summary(row).model_dump(),
        hand_text=row.hand_text,
        action_index=row.action_index,
        steps=steps,
    )
