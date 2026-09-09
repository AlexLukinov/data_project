"""Object storage for raw hand text. **The actual source of truth of the platform.**

ClickHouse is a derived cache: if you lost every table tomorrow you could re-parse the raw
text and get it all back, slowly. If you lost the raw text, the hands are gone forever. Back
up accordingly (docs/POKER_DECISIONS.md ADR-010).

Everything written here is immutable and zstd-compressed. Hand histories compress roughly
8-12x, so storage cost is not the constraint people expect.
"""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from functools import lru_cache
from typing import Any

import boto3
import zstandard
from botocore.client import Config

from core.settings import get_settings

ZSTD_LEVEL = 10
"""Level 10: near-maximum ratio at a fraction of level 19's CPU. Uploads are latency
sensitive, archives are not read often -- this is the right corner of that tradeoff."""


@lru_cache(maxsize=1)
def s3_client() -> Any:
    """Process-wide S3 client. Path-style addressing, because MinIO.

    Returns `Any` because boto3 generates its client classes at runtime; there is no static
    type to annotate. `types-boto3` stubs exist but only cover a subset.
    """
    settings = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        region_name=settings.s3_region,
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


def sha256_of(data: bytes) -> str:
    """Content hash — the upload dedup key."""
    return hashlib.sha256(data).hexdigest()


def object_key(*, tenant_id: int, site: str, digest: str, filename: str) -> str:
    """Build the storage path.

    Layout is `site=/user_id=/ingested_date=/` — Hive-style partitioning, so batch tools
    (Spark, in Phase 3) can prune on any of those without reading objects, and so a tenant's
    data is contiguous under one prefix for lifecycle rules and per-prefix IAM.

    **Named by content hash, not by upload id.** Re-importing the same archive after a parser
    fix is a routine operation — it is how `parser_version < N` gets repaired — and a random
    key per attempt would leave a full orphaned copy of the raw text in object storage every
    time. Keying on the digest makes the write idempotent: the same bytes always land on the
    same object, so a re-import overwrites rather than accumulates. This also makes the
    storage layout agree with the `uq_uploads_user_sha256` constraint, which already treats
    content as the identity of an upload.
    """
    day = datetime.now(UTC).strftime("%Y-%m-%d")
    safe = filename.replace("/", "_")[-120:] or "upload.txt"
    return f"site={site}/user_id={tenant_id:08d}/ingested_date={day}/{digest[:16]}-{safe}.zst"


def put_raw(key: str, data: bytes) -> int:
    """Compress and store raw hand text. Returns the stored byte count."""
    settings = get_settings()
    compressed = zstandard.ZstdCompressor(level=ZSTD_LEVEL).compress(data)
    s3_client().put_object(
        Bucket=settings.s3_raw_bucket,
        Key=key,
        Body=compressed,
        ContentType="application/zstd",
    )
    return len(compressed)


def get_raw(key: str) -> str:
    """Fetch and decompress raw hand text."""
    settings = get_settings()
    body = s3_client().get_object(Bucket=settings.s3_raw_bucket, Key=key)["Body"].read()
    return zstandard.ZstdDecompressor().decompress(body).decode("utf-8", errors="replace")


def decode_upload(data: bytes) -> str:
    """Decode uploaded bytes to text, trying the encodings hand histories actually use.

    Not decoration: PokerStars writes UTF-8, some iPoker skins write UTF-16, and older
    Russian-language clients write cp1251. Guessing wrong turns every screen name into
    mojibake and silently splits one player into several.
    """
    for encoding in ("utf-8-sig", "utf-16", "cp1251", "latin-1"):
        try:
            return data.decode(encoding)
        except (UnicodeDecodeError, UnicodeError):
            continue
    return data.decode("utf-8", errors="replace")
