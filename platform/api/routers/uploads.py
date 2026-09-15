"""Hand-history ingestion. **The contract the future desktop HUD agent will use.**

Design rules, from docs/POKER_DECISIONS.md ADR-014 — worth keeping stable because by the time
the agent ships, this contract is load-bearing on machines you do not control:

  1. **Content-addressed idempotency.** Re-uploading the same bytes is a no-op, not a
     duplicate. An agent that crashes and re-scans a folder must be harmless.
  2. **Tenancy from the token, never from the payload.** There is no `user_id` parameter.
  3. **Clients send raw text, never parsed structures.** The server parses. That is what makes
     "fix the parser, re-parse everything" possible and keeps the agent thin.

The endpoint does no parsing: it stores the bytes, records the row, publishes a pointer, and
returns 202. Storage and the publish run in a thread, so a large file does not stall the status
polls every open upload page is making (plan D.8).

**Idempotency has one exception, and it is what makes a failure recoverable without a command
(ADR-051):** the same bytes dropped again after the upload *failed* are requeued on the same row
rather than answered "duplicate" for ever. The worker commits the offset of a failed message, so
nothing else would ever retry it. The rules live in `api/upload_store.py`.
"""

from __future__ import annotations

import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select

from api import upload_store
from api.deps import CurrentUserDep, SessionDep
from api.models_pg import Upload
from api.schemas_uploads import SitesResponse, UploadAccepted, UploadResponse
from api.upload_intake import inspect
from core.settings import get_settings
from ingestion.loader import DATASET_HERO
from parser.registry import supported_sites
from stats.request import DATASETS

log = logging.getLogger(__name__)
router = APIRouter(prefix="/v1", tags=["ingestion"])

DEFAULT_LIST = 50
MAX_LIST = 200


@router.get("/sites", response_model=SitesResponse)
async def sites() -> SitesResponse:
    """Networks with a registered parser. Adding one is a new file in `parser/sites/`."""
    return SitesResponse(sites=[s.value for s in supported_sites()])


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
    or `population` (an observed pool export with no hero seat). It is stored on the row and
    travels on the queue message, so the worker never has to guess.
    """
    if dataset not in DATASETS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Unknown dataset {dataset!r}. Use 'hero' or 'population'.",
        )
    data = await file.read()
    limit = get_settings().max_upload_bytes
    incoming = await run_in_threadpool(inspect, data, file.filename or "", site, limit)

    previous = await upload_store.existing(session, user, incoming.digest)
    if previous is not None:
        return await upload_store.again(session, user, previous, incoming, dataset)
    upload = await upload_store.store(session, user, incoming, dataset)
    if upload is None:
        raced = await upload_store.existing(session, user, incoming.digest)
        if raced is None:  # pragma: no cover - the constraint that refused the row names it
            raise RuntimeError("upload row refused, and no row holds its digest")
        return await upload_store.again(session, user, raced, incoming, dataset)
    await upload_store.publish(session, user, upload, bulk=incoming.is_bulk)
    return UploadAccepted(upload_id=upload.id, status="queued", dedupe="new")


@router.get("/uploads", response_model=list[UploadResponse])
async def list_uploads(
    user: CurrentUserDep,
    session: SessionDep,
    limit: Annotated[int, Query(ge=1, le=MAX_LIST)] = DEFAULT_LIST,
) -> list[Upload]:
    """Recent uploads for this user, newest first.

    Doubles as the first observability tool: status and per-file counts answer most
    operational questions before any dashboard exists.
    """
    result = await session.execute(
        select(Upload)
        .where(Upload.user_id == user.id)
        .order_by(Upload.created_at.desc())
        .limit(limit)
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
