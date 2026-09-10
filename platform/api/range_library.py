"""Persistence for the range library: the queries behind `api/routers/ranges.py`.

Every query is scoped by `user_id` in the WHERE clause, never merely by id: another tenant's
range 404s, exactly like the saved documents. Versions are append-only -- `add_version` is the
only writer of `range_versions`, and it only inserts.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from analysis.pool.nodes import NodeKey
from api.models_ranges import FIRST_VERSION, RangeVersion, StoredRange
from api.schemas_ranges import (
    BulkIn,
    BulkOut,
    BulkSkipped,
    RangeIn,
    RangeOut,
    RangeSummary,
    RangeUpdate,
    VersionOut,
)

IMPORT_NOTE = "imported"
REVERT_NOTE = "revert to v{version}"


@dataclass(frozen=True, slots=True, kw_only=True)
class RangeFilters:
    """The list endpoint's optional filters (spec §11.1: by position, street, tag, source, name)."""

    source: str | None = None
    tag: str | None = None
    hero_position: str | None = None
    street: str | None = None
    q: str | None = None


async def list_ranges(
    session: AsyncSession, user_id: uuid.UUID, filters: RangeFilters
) -> Sequence[StoredRange]:
    """The user's ranges, newest first, narrowed by the filters that are set."""
    stmt = select(StoredRange).where(StoredRange.user_id == user_id)
    if filters.source is not None:
        stmt = stmt.where(StoredRange.source == filters.source)
    if filters.tag is not None:
        stmt = stmt.where(StoredRange.tags.contains([filters.tag]))
    if filters.hero_position is not None:
        stmt = stmt.where(StoredRange.node_key["hero_position"].astext == filters.hero_position)
    if filters.street is not None:
        stmt = stmt.where(StoredRange.node_key["street"].astext == filters.street)
    if filters.q:
        stmt = stmt.where(StoredRange.name.ilike(f"%{filters.q}%"))
    result = await session.execute(stmt.order_by(StoredRange.updated_at.desc()))
    return result.scalars().all()


async def get_range(session: AsyncSession, user_id: uuid.UUID, range_id: uuid.UUID) -> StoredRange:
    """One range by id, for its owner only; 404 otherwise."""
    result = await session.execute(
        select(StoredRange).where(StoredRange.id == range_id, StoredRange.user_id == user_id)
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    return row


async def lookup(session: AsyncSession, user_id: uuid.UUID, key: NodeKey) -> Sequence[StoredRange]:
    """Every range stored at exactly this situation, own charts first, then solver, then pool."""
    result = await session.execute(
        select(StoredRange)
        .where(StoredRange.user_id == user_id, StoredRange.node_key == key.canonical())
        .order_by(StoredRange.source, StoredRange.name)
    )
    return result.scalars().all()


async def versions_of(session: AsyncSession, row: StoredRange) -> Sequence[RangeVersion]:
    """The full history of a range, newest first."""
    result = await session.execute(
        select(RangeVersion)
        .where(RangeVersion.range_id == row.id)
        .order_by(RangeVersion.version.desc())
    )
    return result.scalars().all()


async def version_of(session: AsyncSession, row: StoredRange, version: int) -> RangeVersion:
    """One version of a range; 404 when the number was never issued."""
    result = await session.execute(
        select(RangeVersion).where(RangeVersion.range_id == row.id, RangeVersion.version == version)
    )
    found = result.scalar_one_or_none()
    if found is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"version {version} does not exist")
    return found


def add_version(session: AsyncSession, row: StoredRange, weights: str, note: str) -> RangeVersion:
    """Append a version and make it current. Never updates an existing version row."""
    next_version = FIRST_VERSION if row.id is None else row.current_version + 1
    version = RangeVersion(range_id=row.id, version=next_version, weights=weights, note=note)
    row.current_version = next_version
    session.add(version)
    return version


def new_range(user_id: uuid.UUID, body: RangeIn) -> StoredRange:
    """A range row from a request body, version counter at zero until `add_version` runs."""
    return StoredRange(
        user_id=user_id,
        name=body.name,
        node_key=body.node_key.canonical(),
        source=body.source,
        source_tool=body.source_tool,
        format=body.format,
        tags=list(body.tags),
        current_version=FIRST_VERSION - 1,
    )


async def create_range(
    session: AsyncSession, user_id: uuid.UUID, body: RangeIn
) -> tuple[StoredRange, RangeVersion]:
    """Insert a range with its first version; 409 when the user already has that name."""
    row = new_range(user_id, body)
    session.add(row)
    try:
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"a range named {body.name!r} already exists"
        ) from exc
    version = add_version(session, row, body.weights, body.note)
    return row, version


def apply_update(row: StoredRange, body: RangeUpdate) -> None:
    """Copy the fields the update carries onto the row; weights are the caller's business."""
    if body.name is not None:
        row.name = body.name
    if body.node_key is not None:
        row.node_key = body.node_key.canonical()
    if body.source is not None:
        row.source = body.source
    if body.source_tool is not None:
        row.source_tool = body.source_tool
    if body.format is not None:
        row.format = body.format
    if body.tags is not None:
        row.tags = list(body.tags)


async def commit_or_conflict(session: AsyncSession, name: str) -> None:
    """Commit, turning the unique-name violation into a 409 the client can act on."""
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"a range named {name!r} already exists"
        ) from exc


def summary(row: StoredRange) -> RangeSummary:
    """The list view of a row."""
    return RangeSummary(
        id=row.id,
        name=row.name,
        node_key=NodeKey.model_validate(row.node_key),
        source=row.source,
        source_tool=row.source_tool,
        format=row.format,
        tags=list(row.tags),
        version=row.current_version,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def out(row: StoredRange, version: RangeVersion) -> RangeOut:
    """A row with the body of one of its versions (normally the current one)."""
    return RangeOut(**summary(row).model_dump(), weights=version.weights, note=version.note)


def version_out(version: RangeVersion) -> VersionOut:
    """One history entry."""
    return VersionOut(
        version=version.version,
        weights=version.weights,
        note=version.note,
        created_at=version.created_at,
    )


async def current_out(session: AsyncSession, row: StoredRange) -> RangeOut:
    """A row with its current body."""
    return out(row, await version_of(session, row, row.current_version))


async def outs(session: AsyncSession, rows: Sequence[StoredRange]) -> list[RangeOut]:
    """Rows with their current bodies, fetched in one query."""
    if not rows:
        return []
    by_id = {row.id: row for row in rows}
    result = await session.execute(
        select(RangeVersion).where(RangeVersion.range_id.in_(list(by_id)))
    )
    current = {
        v.range_id: v
        for v in result.scalars().all()
        if v.version == by_id[v.range_id].current_version
    }
    return [out(row, current[row.id]) for row in rows]


async def _existing_by_name(
    session: AsyncSession, user_id: uuid.UUID, names: list[str]
) -> dict[str, StoredRange]:
    result = await session.execute(
        select(StoredRange).where(StoredRange.user_id == user_id, StoredRange.name.in_(names))
    )
    return {row.name: row for row in result.scalars().all()}


async def bulk_import(session: AsyncSession, user_id: uuid.UUID, body: BulkIn) -> BulkOut:
    """Import a reviewed folder in one transaction: every range lands, or none does."""
    existing = await _existing_by_name(session, user_id, [r.name for r in body.ranges])
    created: list[tuple[StoredRange, RangeVersion]] = []
    updated: list[tuple[StoredRange, RangeVersion]] = []
    skipped: list[BulkSkipped] = []
    seen: set[str] = set()
    for item in body.ranges:
        if item.name in seen:
            skipped.append(BulkSkipped(name=item.name, reason="listed twice in this import"))
            continue
        seen.add(item.name)
        row = existing.get(item.name)
        if row is None:
            created.append(await create_range(session, user_id, item))
        elif body.on_conflict == "skip":
            skipped.append(BulkSkipped(name=item.name, reason="already in the library"))
        else:
            apply_update(row, RangeUpdate(**item.model_dump(exclude={"weights", "note"})))
            updated.append((row, add_version(session, row, item.weights, IMPORT_NOTE)))
    await session.commit()
    for row, version in created + updated:
        await session.refresh(row)
        await session.refresh(version)
    return BulkOut(
        created=[out(r, v) for r, v in created],
        updated=[out(r, v) for r, v in updated],
        skipped=skipped,
    )
