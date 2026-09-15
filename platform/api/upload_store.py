"""The upload row, the raw object and the queue pointer, kept consistent (plan D.8, ADR-051).

The router decides nothing about storage; this module does, in three rules:

  1. **A failed upload is retried by dropping the same file again**, on its own row. A row the
     worker has been silent on for `STALE_PROCESSING` is treated the same way: its terminal
     status was lost (a status write swallowed during a Postgres blip), and nothing else would
     ever finish it.
  2. **A file belongs to one dataset.** The same bytes under the other dataset are refused in
     words, *before* a failed row is considered for a retry: a failed upload may already have
     hands in the marts from its earlier batches, and the hot path's anti-join skips a hand
     already there whatever its dataset, so a retry under the other dataset would leave those
     hands under the old one until dbt rebuilt their days.
  3. **Nothing the uploader reads is an exception.** Object storage and the queue each have a
     503 sentence; the exception is logged here.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import CurrentUser, hero_names_for
from api.models_pg import Upload
from api.schemas_uploads import UploadAccepted
from api.upload_intake import Incoming
from ingestion import sinks
from ingestion.loader import DATASET_HERO, DATASET_POPULATION
from ingestion.messages import UploadMessage
from ingestion.storage import object_key

log = logging.getLogger(__name__)

DATASET_LABELS = {DATASET_HERO: "My hands", DATASET_POPULATION: "Pool hands"}
"""How the upload page names the two datasets; a refusal uses the same words."""
QUEUE_SILENT = "The upload queue did not answer. Upload the file again in a minute."
STORAGE_SILENT = "Storage did not answer. Upload the file again in a minute."
STALE_PROCESSING = timedelta(minutes=15)
"""A `processing` row whose `updated_at` has not moved for this long has no worker behind it.
The worker moves `updated_at` after every stored batch of 5,000 hands, which takes seconds."""


async def existing(session: AsyncSession, user: CurrentUser, digest: str) -> Upload | None:
    """The earlier upload of the same bytes by the same user, if any."""
    result = await session.execute(
        select(Upload).where(Upload.user_id == user.id, Upload.sha256 == digest)
    )
    return result.scalar_one_or_none()


async def _put(key: str, incoming: Incoming) -> None:
    """The raw text to object storage, or a 503 in words."""
    try:
        await run_in_threadpool(sinks.raw_store().put, key, incoming.text.encode("utf-8"))
    except Exception as exc:
        log.exception("could not store the raw text under %s", key)
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, STORAGE_SILENT) from exc


async def store(
    session: AsyncSession, user: CurrentUser, incoming: Incoming, dataset: str
) -> Upload | None:
    """Raw text to object storage first, then the ledger row.

    Returns None when a concurrent drop of the same bytes committed its row first.
    """
    key = object_key(
        tenant_id=user.tenant_id,
        site=incoming.site.value,
        digest=incoming.digest,
        filename=incoming.filename or "upload.txt",
    )
    await _put(key, incoming)
    upload = Upload(
        id=uuid.uuid4(),
        user_id=user.id,
        site=incoming.site.value,
        dataset=dataset,
        filename=incoming.filename,
        object_key=key,
        sha256=incoming.digest,
        byte_size=len(incoming.data),
        status="queued",
    )
    session.add(upload)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        return None
    return upload


async def publish(session: AsyncSession, user: CurrentUser, upload: Upload, *, bulk: bool) -> None:
    """Hand the worker its pointer.

    A bus that does not acknowledge it fails the row, in words, so the next drop of the same file
    requeues it -- but only a row still `queued`: a pointer the broker took late may already have
    reached a worker, whose status is not overwritten.
    """
    message = UploadMessage(
        upload_id=str(upload.id),
        tenant_id=user.tenant_id,
        site=upload.site,
        object_key=upload.object_key,
        sha256=upload.sha256,
        hero_names=await hero_names_for(session, user.id, upload.site),
        dataset=upload.dataset or DATASET_HERO,
    )
    try:
        await run_in_threadpool(sinks.event_bus().publish_upload, message, bulk=bulk)
    except Exception as exc:  # PublishError, or the client's own BufferError/KafkaException
        log.exception("could not publish upload %s", upload.id)
        await session.execute(
            update(Upload)
            .where(Upload.id == upload.id, Upload.status == "queued")
            .values(status="failed", error_text=QUEUE_SILENT, updated_at=datetime.now(UTC))
        )
        await session.commit()
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, QUEUE_SILENT) from exc


async def _requeue(
    session: AsyncSession, user: CurrentUser, upload: Upload, incoming: Incoming, dataset: str
) -> UploadAccepted:
    """Run an upload again on its own row.

    The bytes are put back under the row's key first: the object may be what was missing, and
    the key is content-addressed, so rewriting it is idempotent. The dataset stays the row's
    (rule 2); only a row written before the dataset was recorded takes this drop's.
    """
    await _put(upload.object_key, incoming)
    upload.status = "queued"
    upload.site = incoming.site.value
    upload.dataset = upload.dataset or dataset
    upload.hands_found = upload.hands_parsed = upload.hands_failed = 0
    upload.hands_without_hero = 0
    upload.error_text = ""
    upload.completed_at = None
    await session.commit()
    await publish(session, user, upload, bulk=incoming.is_bulk)
    return UploadAccepted(upload_id=upload.id, status="queued", dedupe="requeued")


def _unfinished(upload: Upload) -> bool:
    """Failed, or `processing` with no word from a worker for `STALE_PROCESSING`."""
    if upload.status == "failed":
        return True
    silent_since = datetime.now(UTC) - STALE_PROCESSING
    return upload.status == "processing" and upload.updated_at < silent_since


async def again(
    session: AsyncSession, user: CurrentUser, previous: Upload, incoming: Incoming, dataset: str
) -> UploadAccepted:
    """Answer a drop of bytes this user uploaded before.

    Refused under the other dataset; requeued if that upload never finished; otherwise answered
    with the earlier upload itself.
    """
    if previous.dataset is not None and previous.dataset != dataset:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"This file is already uploaded as {DATASET_LABELS[previous.dataset]}. "
            "A file belongs to one dataset.",
        )
    if _unfinished(previous):
        return await _requeue(session, user, previous, incoming, dataset)
    return UploadAccepted.model_validate(
        {"upload_id": previous.id, "status": previous.status, "dedupe": "duplicate"}
    )
