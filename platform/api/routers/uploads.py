"""Hand-history ingestion. **The contract the future desktop HUD agent will use.**

Design rules, from docs/POKER_DECISIONS.md ADR-014 — worth keeping stable because by the time
the agent ships, this contract is load-bearing on machines you do not control:

  1. **Content-addressed idempotency.** Re-uploading the same bytes is a no-op, not a
     duplicate. An agent that crashes and re-scans a folder must be harmless.
  2. **Tenancy from the token, never from the payload.** There is no `user_id` parameter.
  3. **Clients send raw text, never parsed structures.** The server parses. That is what makes
     "fix the parser, re-parse everything" possible and keeps the agent thin.

The endpoint does no parsing: it stores the bytes, records the row, publishes a pointer, and
returns 202. Under 200 ms regardless of file size.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import CurrentUser, CurrentUserDep, SessionDep, hero_names_for
from api.models_pg import Upload
from api.queries import DATASETS
from api.schemas import UploadAccepted, UploadResponse
from core.enums import Site
from core.settings import get_settings
from ingestion import sinks
from ingestion.loader import DATASET_HERO
from ingestion.messages import UploadMessage
from ingestion.storage import decode_upload, object_key, sha256_of
from parser.errors import FormatDetectionError
from parser.registry import sniff, supported_sites

log = logging.getLogger(__name__)
router = APIRouter(prefix="/v1", tags=["ingestion"])

BULK_THRESHOLD_BYTES = 5 * 1024 * 1024
"""Above this, route to the isolated bulk topic so one user's backfill cannot starve
everyone else's live uploads sharing a partition."""


@router.get("/sites")
async def sites() -> dict[str, list[str]]:
    """Networks with a registered parser. Adding one is a new file in `parser/sites/`."""
    return {"sites": [s.value for s in supported_sites()]}


@dataclass(slots=True, frozen=True)
class _Incoming:
    """One accepted file: decoded, fingerprinted and attributed to a site, before storage."""

    data: bytes
    text: str
    digest: str
    site: Site
    filename: str

    @property
    def is_bulk(self) -> bool:
        return len(self.data) > BULK_THRESHOLD_BYTES


def _resolve_site(site: str, text: str) -> Site:
    """The declared site when given, otherwise sniffed from the text.

    Users mislabel uploads constantly, and a wrong `site` yields ZERO parsed hands rather
    than an error -- so sniffing is a robustness feature, not a convenience.
    """
    if site:
        try:
            return Site(site)
        except ValueError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown site {site!r}") from exc
    try:
        return sniff(text)
    except FormatDetectionError as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Could not detect the hand-history format; pass `site` explicitly",
        ) from exc


async def _incoming(file: UploadFile, site: str) -> _Incoming:
    """Read and size-check the file, decode it, resolve its site. Raises the 4xx that apply."""
    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty file")
    if len(data) > get_settings().max_upload_bytes:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "File too large")
    text = decode_upload(data)
    return _Incoming(
        data=data,
        text=text,
        digest=sha256_of(data),
        site=_resolve_site(site, text),
        filename=file.filename or "",
    )


async def _store(
    session: AsyncSession, user: CurrentUser, incoming: _Incoming
) -> tuple[uuid.UUID, str]:
    """Raw text to object storage first, then the ledger row. Returns (upload id, object key)."""
    upload_id = uuid.uuid4()
    key = object_key(
        tenant_id=user.tenant_id,
        site=incoming.site.value,
        digest=incoming.digest,
        filename=incoming.filename or "upload.txt",
    )
    sinks.raw_store().put(key, incoming.text.encode("utf-8"))
    session.add(
        Upload(
            id=upload_id,
            user_id=user.id,
            site=incoming.site.value,
            filename=incoming.filename,
            object_key=key,
            sha256=incoming.digest,
            byte_size=len(incoming.data),
            status="queued",
        )
    )
    await session.commit()
    return upload_id, key


@router.post(
    "/uploads",
    response_model=UploadAccepted,
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_upload(
    user: CurrentUserDep,
    session: SessionDep,
    file: UploadFile = File(...),  # noqa: B008 - FastAPI's dependency idiom
    site: str = Form(default=""),
    dataset: str = Form(default=DATASET_HERO),
) -> UploadAccepted:
    """Accept a hand-history file. Returns immediately; parsing happens downstream.

    `dataset` says which body of hands this is: `hero` (the uploader's own play, the default)
    or `population` (an observed pool export with no hero seat). It travels on the queue
    message so the worker never has to guess.
    """
    if dataset not in DATASETS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown dataset {dataset!r}")
    incoming = await _incoming(file, site)

    # Idempotency: the same bytes from the same user are the same upload.
    existing = await session.execute(
        select(Upload).where(Upload.user_id == user.id, Upload.sha256 == incoming.digest)
    )
    previous = existing.scalar_one_or_none()
    if previous is not None:
        return UploadAccepted(upload_id=previous.id, status=previous.status, dedupe="duplicate")

    upload_id, key = await _store(session, user, incoming)
    hero_names = await hero_names_for(session, user.id, incoming.site.value)
    sinks.event_bus().publish_upload(
        UploadMessage(
            upload_id=str(upload_id),
            tenant_id=user.tenant_id,
            site=incoming.site.value,
            object_key=key,
            sha256=incoming.digest,
            hero_names=hero_names,
            dataset=dataset,
        ),
        bulk=incoming.is_bulk,
    )
    return UploadAccepted(upload_id=upload_id, status="queued", dedupe="new")


@router.get("/uploads", response_model=list[UploadResponse])
async def list_uploads(user: CurrentUserDep, session: SessionDep, limit: int = 50) -> list[Upload]:
    """Recent uploads for this user.

    Doubles as the first observability tool: status and per-file counts answer most
    operational questions before any dashboard exists.
    """
    result = await session.execute(
        select(Upload)
        .where(Upload.user_id == user.id)
        .order_by(Upload.created_at.desc())
        .limit(min(limit, 200))
    )
    return list(result.scalars().all())


@router.get("/uploads/{upload_id}", response_model=UploadResponse)
async def get_upload(upload_id: uuid.UUID, user: CurrentUserDep, session: SessionDep) -> Upload:
    """One upload's status.

    Scoped by `user_id` in the WHERE clause, not merely by the path parameter: an upload id
    belonging to another tenant must 404, not 403, and certainly not 200.
    """
    result = await session.execute(
        select(Upload).where(Upload.id == upload_id, Upload.user_id == user.id)
    )
    upload = result.scalar_one_or_none()
    if upload is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Upload not found")
    return upload
