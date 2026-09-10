"""The range library (plan F.6, spec §11.1): stored ranges with versions, lookup by situation.

Routes with a fixed second segment (`/bulk`, `/lookup`, `/export`) are declared before
`/{range_id}` so they are matched by name and not parsed as ids.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Query, status

from analysis.pool.nodes import NodeKey, Position, Street
from api import range_library as lib
from api.deps import CurrentUserDep, SessionDep
from api.schemas_ranges import (
    BulkIn,
    BulkOut,
    ExportOut,
    RangeIn,
    RangeOut,
    RangeSummary,
    RangeUpdate,
    Source,
    VersionOut,
)

router = APIRouter(prefix="/v1/ranges", tags=["ranges"])

MAX_QUERY = 100


@router.get("", response_model=list[RangeSummary])
async def list_ranges(
    user: CurrentUserDep,
    session: SessionDep,
    source: Source | None = None,
    tag: str | None = Query(default=None, max_length=40),
    hero_position: Position | None = None,
    street: Street | None = None,
    q: str | None = Query(default=None, max_length=MAX_QUERY),
) -> list[RangeSummary]:
    """The user's library, newest first, without bodies; every filter is optional."""
    filters = lib.RangeFilters(
        source=source, tag=tag, hero_position=hero_position, street=street, q=q
    )
    return [lib.summary(row) for row in await lib.list_ranges(session, user.id, filters)]


@router.post("", response_model=RangeOut, status_code=status.HTTP_201_CREATED)
async def create_range(body: RangeIn, user: CurrentUserDep, session: SessionDep) -> RangeOut:
    """Store a range as version 1 under a name unique to the user."""
    row, version = await lib.create_range(session, user.id, body)
    await lib.commit_or_conflict(session, body.name)
    await session.refresh(row)
    await session.refresh(version)
    return lib.out(row, version)


@router.post("/bulk", response_model=BulkOut)
async def bulk_import(body: BulkIn, user: CurrentUserDep, session: SessionDep) -> BulkOut:
    """Commit a reviewed folder import; returns the import report."""
    return await lib.bulk_import(session, user.id, body)


@router.post("/lookup", response_model=list[RangeOut])
async def lookup(body: NodeKey, user: CurrentUserDep, session: SessionDep) -> list[RangeOut]:
    """Every stored range at exactly this situation, with bodies -- the comparison view's input."""
    return await lib.outs(session, await lib.lookup(session, user.id, body))


@router.get("/export", response_model=ExportOut)
async def export_library(user: CurrentUserDep, session: SessionDep) -> ExportOut:
    """The whole library with current bodies, as the JSON format the importer reads back."""
    rows = await lib.list_ranges(session, user.id, lib.RangeFilters())
    return ExportOut(exported_at=datetime.now(UTC), ranges=await lib.outs(session, rows))


@router.get("/{range_id}", response_model=RangeOut)
async def get_range(range_id: uuid.UUID, user: CurrentUserDep, session: SessionDep) -> RangeOut:
    """One range with its current body."""
    return await lib.current_out(session, await lib.get_range(session, user.id, range_id))


@router.put("/{range_id}", response_model=RangeOut)
async def update_range(
    range_id: uuid.UUID, body: RangeUpdate, user: CurrentUserDep, session: SessionDep
) -> RangeOut:
    """Change a range's fields; a body in the request becomes a new version."""
    row = await lib.get_range(session, user.id, range_id)
    lib.apply_update(row, body)
    if body.weights is not None:
        lib.add_version(session, row, body.weights, body.note)
    await lib.commit_or_conflict(session, row.name)
    await session.refresh(row)
    return await lib.current_out(session, row)


@router.delete("/{range_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_range(range_id: uuid.UUID, user: CurrentUserDep, session: SessionDep) -> None:
    """Delete a range and its whole history."""
    await session.delete(await lib.get_range(session, user.id, range_id))
    await session.commit()


@router.get("/{range_id}/versions", response_model=list[VersionOut])
async def list_versions(
    range_id: uuid.UUID, user: CurrentUserDep, session: SessionDep
) -> list[VersionOut]:
    """The history of a range, newest first."""
    row = await lib.get_range(session, user.id, range_id)
    return [lib.version_out(v) for v in await lib.versions_of(session, row)]


@router.post("/{range_id}/revert/{version}", response_model=RangeOut)
async def revert(
    range_id: uuid.UUID, version: int, user: CurrentUserDep, session: SessionDep
) -> RangeOut:
    """Make an old body current again -- as a new version, so the history stays complete."""
    row = await lib.get_range(session, user.id, range_id)
    old = await lib.version_of(session, row, version)
    lib.add_version(session, row, old.weights, lib.REVERT_NOTE.format(version=version))
    await session.commit()
    await session.refresh(row)
    return await lib.current_out(session, row)
