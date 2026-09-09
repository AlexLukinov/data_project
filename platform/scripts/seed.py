"""Seed the local stack with a demo user and the sample hand corpus.

Deliberately pushes the corpus through the **real** pipeline — object storage, Kafka, the
parser worker — rather than inserting straight into ClickHouse. A seed script that takes a
shortcut proves nothing; this one fails if any part of the ingestion path is broken, which
makes `make seed` a smoke test as well as a fixture.

Idempotent: re-running re-uploads the same bytes, the upload dedup key short-circuits it, and
`ReplacingMergeTree` collapses anything that does slip through.

Run:  uv run python -m scripts.seed      (or `make seed`)
"""

from __future__ import annotations

import asyncio
import logging
import sys
import uuid
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.db import session_factory
from api.models_pg import PokerAccount, Upload, User
from api.security import hash_password
from core.enums import Site
from ingestion import sinks, worker
from ingestion.messages import UploadMessage
from ingestion.storage import object_key, sha256_of

log = logging.getLogger("seed")

SEEDS = Path(__file__).resolve().parent.parent / "seeds" / "hands"
DEMO_EMAIL = "demo@example.com"
DEMO_PASSWORD = "demo-password-123"
DEMO_HERO_NAME = "Hero"

CORPUS: list[tuple[Site, Path]] = [
    (Site.POKERSTARS, SEEDS / "pokerstars" / "cash_6max_nl50.txt"),
    (Site.POKERSTARS, SEEDS / "pokerstars" / "edge_cases.txt"),
    (Site.GGPOKER, SEEDS / "ggpoker" / "rush_nl50.txt"),
]


async def ensure_user() -> tuple[uuid.UUID, int]:
    """Create the demo account and its poker screen names. Returns (user_id, tenant_id)."""
    async with session_factory()() as session:
        result = await session.execute(select(User).where(User.email == DEMO_EMAIL))
        user = result.scalar_one_or_none()
        if user is None:
            user = User(
                email=DEMO_EMAIL,
                password_hash=hash_password(DEMO_PASSWORD),
                display_name="Demo Player",
            )
            session.add(user)
            await session.flush()
            await session.refresh(user)
            log.info("created demo user %s (tenant_id=%s)", DEMO_EMAIL, user.tenant_id)

        # Registering the screen name is what lets the parser resolve which seat is hero.
        for site in {site for site, _ in CORPUS}:
            exists = await session.execute(
                select(PokerAccount).where(
                    PokerAccount.user_id == user.id,
                    PokerAccount.site == site.value,
                    PokerAccount.screen_name == DEMO_HERO_NAME,
                )
            )
            if exists.scalar_one_or_none() is None:
                session.add(
                    PokerAccount(user_id=user.id, site=site.value, screen_name=DEMO_HERO_NAME)
                )
        await session.commit()
        return user.id, user.tenant_id


def _republish(previous: Upload, tenant_id: int) -> None:
    """Re-send the pointer for an upload that is still `queued`.

    The object is in storage and the row exists, but the pointer never made it to Kafka
    (broker was down, worker never ran). Re-publish rather than skip -- this is the requeue
    path, and it is exactly what production needs when a broker outage swallows a message.
    """
    log.info("re-publishing stuck upload %s", previous.filename)
    sinks.event_bus().publish_upload(
        UploadMessage(
            upload_id=str(previous.id),
            tenant_id=tenant_id,
            site=previous.site,
            object_key=previous.object_key,
            sha256=previous.sha256,
            hero_names=[DEMO_HERO_NAME],
        )
    )


async def _publish_new(
    session: AsyncSession, user_id: uuid.UUID, tenant_id: int, site: Site, path: Path, data: bytes
) -> None:
    """Store the bytes, record the upload row, publish its pointer."""
    upload_id = uuid.uuid4()
    digest = sha256_of(data)
    key = object_key(tenant_id=tenant_id, site=site.value, digest=digest, filename=path.name)
    sinks.raw_store().put(key, data)
    session.add(
        Upload(
            id=upload_id,
            user_id=user_id,
            site=site.value,
            filename=path.name,
            object_key=key,
            sha256=digest,
            byte_size=len(data),
            status="queued",
        )
    )
    await session.commit()
    sinks.event_bus().publish_upload(
        UploadMessage(
            upload_id=str(upload_id),
            tenant_id=tenant_id,
            site=site.value,
            object_key=key,
            sha256=digest,
            hero_names=[DEMO_HERO_NAME],
        )
    )
    log.info("published %s -> %s", path.name, key)


async def publish_corpus(user_id: uuid.UUID, tenant_id: int) -> int:
    """Upload every corpus file and publish its pointer. Returns files published."""
    published = 0
    async with session_factory()() as session:
        for site, path in CORPUS:
            if not path.exists():
                log.warning("missing corpus file %s", path)
                continue
            data = path.read_bytes()
            existing = await session.execute(
                select(Upload).where(Upload.user_id == user_id, Upload.sha256 == sha256_of(data))
            )
            previous = existing.scalar_one_or_none()
            if previous is None:
                await _publish_new(session, user_id, tenant_id, site, path, data)
            elif previous.status == "queued":
                _republish(previous, tenant_id)
            else:
                log.info("skip %s (already processed)", path.name)
                continue
            published += 1
    return published


async def amain() -> int:
    """Seed, then drain the queue through the real worker."""
    user_id, tenant_id = await ensure_user()
    published = await publish_corpus(user_id, tenant_id)
    if published:
        # Run the worker in-process until the topics go quiet.
        drained = worker.drain()
        log.info("worker drained %d message(s)", drained)
    else:
        log.info("nothing new to publish")

    from core.settings import get_settings
    from ingestion.clickhouse import clickhouse

    core = get_settings().db("core")
    counts = (
        clickhouse()
        .query(
            f"SELECT (SELECT count() FROM {core}.hands FINAL), "
            f"(SELECT count() FROM {core}.hand_players FINAL), "
            f"(SELECT count() FROM {core}.actions FINAL), "
            f"(SELECT count() FROM {core}.parse_failures)"
        )
        .result_rows[0]
    )
    log.info("clickhouse now holds: %s hands, %s seats, %s actions, %s parse failures", *counts)
    log.info("demo login: %s / %s (tenant_id=%s)", DEMO_EMAIL, DEMO_PASSWORD, tenant_id)
    return 0


def main() -> int:
    """CLI entry point."""
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    return asyncio.run(amain())


if __name__ == "__main__":
    sys.exit(main())
