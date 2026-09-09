"""Saved filters, reports and stats: named documents a user keeps (plan §2.10).

Every row is scoped by `user_id` in the WHERE clause, never merely by its id: another
tenant's saved report must 404, not 403, and never 200. Documents are validated against the
registry on the way in, so a saved report always runs and a saved stat always compiles.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from typing import Any

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import CurrentUserDep, SessionDep
from api.models_pg import Base, SavedFilter, SavedReport, SavedStat
from api.schemas_saved import (
    SavedFilterIn,
    SavedFilterOut,
    SavedReportIn,
    SavedReportOut,
    SavedStatIn,
    SavedStatOut,
)
from stats.checks import check_node_anywhere
from stats.errors import RegistryError, ReportError
from stats.registry import registry
from stats.request import ReportRequest
from stats.service import validate_request

router = APIRouter(prefix="/v1/saved", tags=["saved"])


async def _rows[Row: (SavedFilter, SavedReport, SavedStat)](
    session: AsyncSession, model: type[Row], user_id: uuid.UUID
) -> Sequence[Row]:
    result = await session.execute(
        select(model).where(model.user_id == user_id).order_by(model.created_at)
    )
    return result.scalars().all()


async def _row[Row: (SavedFilter, SavedReport, SavedStat)](
    session: AsyncSession, model: type[Row], user_id: uuid.UUID, id: uuid.UUID
) -> Row:
    result = await session.execute(select(model).where(model.id == id, model.user_id == user_id))
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    return row


async def _save(session: AsyncSession, row: Base, conflict: str) -> None:
    """Commit, turning the unique-name violation into a 409 the client can act on."""
    try:
        session.add(row)
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, conflict) from exc
    await session.refresh(row)


def _bad_request(exc: Exception) -> HTTPException:
    return HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))


# ---- filters -----------------------------------------------------------------------------


def _checked_filter(body: SavedFilterIn) -> dict[str, Any]:
    try:
        check_node_anywhere(body.ast, registry().dimensions, "ast")
    except RegistryError as exc:
        raise _bad_request(exc) from exc
    return body.ast.model_dump(mode="json", by_alias=True)


@router.get("/filters", response_model=list[SavedFilterOut])
async def list_filters(user: CurrentUserDep, session: SessionDep) -> Sequence[SavedFilter]:
    """The user's saved filters, oldest first."""
    return await _rows(session, SavedFilter, user.id)


@router.post("/filters", response_model=SavedFilterOut, status_code=status.HTTP_201_CREATED)
async def create_filter(
    body: SavedFilterIn, user: CurrentUserDep, session: SessionDep
) -> SavedFilter:
    """Save a filter tree under a name unique to the user."""
    row = SavedFilter(user_id=user.id, name=body.name, ast=_checked_filter(body))
    await _save(session, row, f"a filter named {body.name!r} already exists")
    return row


@router.put("/filters/{filter_id}", response_model=SavedFilterOut)
async def update_filter(
    filter_id: uuid.UUID, body: SavedFilterIn, user: CurrentUserDep, session: SessionDep
) -> SavedFilter:
    """Replace a saved filter's name and tree."""
    row = await _row(session, SavedFilter, user.id, filter_id)
    row.name, row.ast = body.name, _checked_filter(body)
    await _save(session, row, f"a filter named {body.name!r} already exists")
    return row


@router.delete("/filters/{filter_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_filter(filter_id: uuid.UUID, user: CurrentUserDep, session: SessionDep) -> None:
    """Delete a saved filter."""
    await session.delete(await _row(session, SavedFilter, user.id, filter_id))
    await session.commit()


# ---- reports -----------------------------------------------------------------------------


def _checked_report(body: SavedReportIn) -> dict[str, Any]:
    try:
        validate_request(body.definition)
    except (ReportError, RegistryError) as exc:
        raise _bad_request(exc) from exc
    return body.definition.model_dump(mode="json", by_alias=True)


@router.get("/reports", response_model=list[SavedReportOut])
async def list_reports(user: CurrentUserDep, session: SessionDep) -> Sequence[SavedReport]:
    """The user's saved reports, oldest first."""
    return await _rows(session, SavedReport, user.id)


@router.get("/reports/{report_id}", response_model=SavedReportOut)
async def get_report(
    report_id: uuid.UUID, user: CurrentUserDep, session: SessionDep
) -> SavedReport:
    """One saved report, by id, for its owner only."""
    return await _row(session, SavedReport, user.id, report_id)


@router.post("/reports", response_model=SavedReportOut, status_code=status.HTTP_201_CREATED)
async def create_report(
    body: SavedReportIn, user: CurrentUserDep, session: SessionDep
) -> SavedReport:
    """Save a report definition. It is validated end to end first, so it will run."""
    row = SavedReport(
        user_id=user.id, module=body.module, name=body.name, definition=_checked_report(body)
    )
    await _save(session, row, f"a report named {body.name!r} already exists")
    return row


@router.put("/reports/{report_id}", response_model=SavedReportOut)
async def update_report(
    report_id: uuid.UUID, body: SavedReportIn, user: CurrentUserDep, session: SessionDep
) -> SavedReport:
    """Replace a saved report's name, module and definition."""
    row = await _row(session, SavedReport, user.id, report_id)
    row.name, row.module, row.definition = body.name, body.module, _checked_report(body)
    await _save(session, row, f"a report named {body.name!r} already exists")
    return row


@router.delete("/reports/{report_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_report(report_id: uuid.UUID, user: CurrentUserDep, session: SessionDep) -> None:
    """Delete a saved report."""
    await session.delete(await _row(session, SavedReport, user.id, report_id))
    await session.commit()


# ---- stats -------------------------------------------------------------------------------


def _checked_stat(body: SavedStatIn) -> dict[str, Any]:
    """A saved stat must compile like an inline one; the code inside must match the row's."""
    if body.definition.code != body.code:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "definition.code must equal code")
    try:
        validate_request(ReportRequest(custom=[body.definition]))
    except (ReportError, RegistryError) as exc:
        raise _bad_request(exc) from exc
    return body.definition.model_dump(mode="json", by_alias=True)


@router.get("/stats", response_model=list[SavedStatOut])
async def list_stats(user: CurrentUserDep, session: SessionDep) -> Sequence[SavedStat]:
    """The user's saved stats, oldest first."""
    return await _rows(session, SavedStat, user.id)


@router.post("/stats", response_model=SavedStatOut, status_code=status.HTTP_201_CREATED)
async def create_stat(body: SavedStatIn, user: CurrentUserDep, session: SessionDep) -> SavedStat:
    """Save a user-defined stat under a code unique to the user."""
    row = SavedStat(
        user_id=user.id, code=body.code, label=body.label, definition=_checked_stat(body)
    )
    await _save(session, row, f"a stat with code {body.code!r} already exists")
    return row


@router.put("/stats/{stat_id}", response_model=SavedStatOut)
async def update_stat(
    stat_id: uuid.UUID, body: SavedStatIn, user: CurrentUserDep, session: SessionDep
) -> SavedStat:
    """Replace a saved stat."""
    row = await _row(session, SavedStat, user.id, stat_id)
    row.code, row.label, row.definition = body.code, body.label, _checked_stat(body)
    await _save(session, row, f"a stat with code {body.code!r} already exists")
    return row


@router.delete("/stats/{stat_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_stat(stat_id: uuid.UUID, user: CurrentUserDep, session: SessionDep) -> None:
    """Delete a saved stat."""
    await session.delete(await _row(session, SavedStat, user.id, stat_id))
    await session.commit()
