"""Persistence for the heuristic log: the queries behind `api/routers/heuristics.py`.

Every query is scoped by `user_id` in the WHERE clause, never merely by id -- another tenant's
heuristic 404s, exactly like the analyses, the ranges and the saved documents.

The store shapes rows and hits the database; it never commits. The router owns the transaction,
so a request that touches two rows still commits once.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from analysis.pool.nodes import NodeKey
from api.models_analyses import Analysis
from api.models_heuristics import Heuristic
from api.schemas_heuristics import (
    REVIEW_DAYS,
    HeuristicCandidate,
    HeuristicIn,
    HeuristicOut,
    HeuristicUpdate,
    review_due_at,
)


def due_cutoff(now: datetime) -> datetime:
    """The last anchor date whose review has already come due -- `review_due_at` rearranged.

    `review_due_at(anchor) <= now` is the same statement as `anchor <= now - REVIEW_DAYS`, and
    the second form is the one SQL wants: it binds a plain timestamp against the column instead
    of asking Postgres to add an interval to every row.
    """
    return now - timedelta(days=REVIEW_DAYS)


async def list_heuristics(
    session: AsyncSession, user_id: uuid.UUID, *, due_only: bool = False
) -> Sequence[Heuristic]:
    """The user's heuristics, newest first; `due_only` keeps just the ones awaiting review."""
    query = select(Heuristic).where(Heuristic.user_id == user_id)
    if due_only:
        anchor = func.coalesce(Heuristic.confirmed_at, Heuristic.created_at)
        query = query.where(anchor <= due_cutoff(datetime.now(UTC)))
    result = await session.execute(query.order_by(Heuristic.created_at.desc()))
    return result.scalars().all()


async def get_heuristic(session: AsyncSession, user_id: uuid.UUID, row_id: uuid.UUID) -> Heuristic:
    """One heuristic by id, for its owner only; 404 otherwise."""
    result = await session.execute(
        select(Heuristic).where(Heuristic.id == row_id, Heuristic.user_id == user_id)
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    return row


def create_heuristic(session: AsyncSession, user_id: uuid.UUID, body: HeuristicIn) -> Heuristic:
    """Write a heuristic into the log, unreviewed: its clock starts at `created_at`."""
    row = Heuristic(
        user_id=user_id,
        analysis_id=body.analysis_id,
        text=body.text.strip(),
        street=body.street,
        position=body.position,
        texture=body.texture,
        tags=list(body.tags),
        status=body.status,
        confirmed_at=None,
    )
    session.add(row)
    return row


def apply_update(row: Heuristic, body: HeuristicUpdate) -> None:
    """Apply the fields that were sent and leave the omitted ones exactly as they were.

    **Sending `status` stamps `confirmed_at` with the current time**, whatever the status is:
    answering "still true?" -- with yes, no, or "retired" -- is itself the review, so it resets
    the fourteen-day clock. A rewrite that leaves `status` out does not, because correcting the
    wording of a lesson is not the same as having re-examined it.

    **The stamp is the database's `now()`, never this process's clock**, because the schedule
    compares it with `created_at`, which the database stamps. Two clocks let a review move
    *earlier* by however far they disagree -- measured at 0.22 s between Docker Desktop's VM and
    the host, and seconds between two production machines. The router's refresh reads it back.
    """
    if body.text is not None:
        row.text = body.text.strip()
    if body.analysis_id is not None:
        row.analysis_id = body.analysis_id
    if body.street is not None:
        row.street = body.street
    if body.position is not None:
        row.position = body.position
    if body.texture is not None:
        row.texture = body.texture
    if body.tags is not None:
        row.tags = list(body.tags)
    if body.status is not None:
        row.status = body.status
        row.confirmed_at = func.now()


async def delete(session: AsyncSession, user_id: uuid.UUID, row_id: uuid.UUID) -> None:
    """Remove one heuristic, for its owner only."""
    await session.delete(await get_heuristic(session, user_id, row_id))


async def candidates(session: AsyncSession, user_id: uuid.UUID) -> list[HeuristicCandidate]:
    """The user's analyses whose step 9 wrote a takeaway that the log has not adopted yet.

    ADR-034 kept `analyses.heuristic` as a column of its own precisely so this stayed a query
    rather than a copy. The `NOT IN` subquery excludes the null `analysis_id`s deliberately:
    `NOT IN` against a set containing NULL is never true, which would empty the whole list.
    """
    adopted = select(Heuristic.analysis_id).where(
        Heuristic.user_id == user_id, Heuristic.analysis_id.is_not(None)
    )
    columns = select(
        Analysis.id, Analysis.title, Analysis.heuristic, Analysis.node_key, Analysis.created_at
    )
    result = await session.execute(
        columns.where(
            Analysis.user_id == user_id, Analysis.heuristic != "", Analysis.id.not_in(adopted)
        ).order_by(Analysis.created_at.desc())
    )
    return [
        HeuristicCandidate(
            analysis_id=row.id,
            title=row.title,
            heuristic=row.heuristic,
            node_key=None if row.node_key is None else NodeKey.model_validate(row.node_key),
            created_at=row.created_at,
        )
        for row in result.all()
    ]


def out(row: Heuristic, now: datetime | None = None) -> HeuristicOut:
    """One row of the log with its review state worked out against `now` (default: this moment)."""
    moment = now or datetime.now(UTC)
    due_at = review_due_at(row.confirmed_at, row.created_at)
    return HeuristicOut(
        id=row.id,
        analysis_id=row.analysis_id,
        text=row.text,
        street=row.street,
        position=row.position,
        texture=row.texture,
        tags=list(row.tags),
        status=row.status,
        confirmed_at=row.confirmed_at,
        review_due_at=due_at,
        is_due=due_at <= moment,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )
