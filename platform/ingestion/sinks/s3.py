"""`RawStore` on S3-compatible object storage (MinIO locally; any S3 in production)."""

from __future__ import annotations

from ingestion.storage import get_raw, put_raw


class S3RawStore:
    """Thin object over `ingestion.storage`, which owns the client and the compression."""

    def put(self, key: str, data: bytes) -> int:
        """Compress and store; returns the stored byte count."""
        return put_raw(key, data)

    def get(self, key: str) -> str:
        """Fetch and decompress."""
        return get_raw(key)
