"""The `uploads` ledger and account lookup for the bulk importer, on plain psycopg.

A synchronous driver on purpose: the importer is a process pool, and dragging an event loop
into each worker just to reuse the API's async session would add complexity for no benefit.
The ledger is a *resume* optimization on top of ReplacingMergeTree idempotency, not the
correctness mechanism — deleting it and re-running is safe, just slower.
"""

from __future__ import annotations

import psycopg

from ingestion.upload_status import ERROR_TEXT_CHARS, failure_sentence

LABEL_CHARS = 250
"""`uploads.filename` width; archive member labels can be longer."""


def already_done(dsn: str, user_uuid: str, digest: str) -> bool:
    """True when this exact content has already been imported for this user.

    Scoped by user, matching the `uq_uploads_user_sha256` constraint: two accounts importing
    the same public archive are two separate imports, not a duplicate.
    """
    with psycopg.connect(dsn, autocommit=True) as conn:
        row = conn.execute(
            "SELECT 1 FROM uploads WHERE user_id = %s AND sha256 = %s "
            "AND status = 'completed' LIMIT 1",
            (user_uuid, digest),
        ).fetchone()
    return row is not None


RECORD_UPLOAD_SQL = (
    "INSERT INTO uploads (id, user_id, site, dataset, filename, object_key, sha256, "
    "byte_size, status, hands_found, hands_parsed, hands_failed, hands_without_hero, "
    "error_text, completed_at, created_at, updated_at) "
    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, "
    "now(), now(), now()) ON CONFLICT (user_id, sha256) DO UPDATE SET "
    "status = EXCLUDED.status, error_text = EXCLUDED.error_text, dataset = EXCLUDED.dataset, "
    "hands_found = EXCLUDED.hands_found, hands_parsed = EXCLUDED.hands_parsed, "
    "hands_failed = EXCLUDED.hands_failed, hands_without_hero = EXCLUDED.hands_without_hero, "
    "completed_at = now(), updated_at = now()"
)


def record_upload(
    dsn: str,
    *,
    upload_id: str,
    user_uuid: str,
    site: str,
    label: str,
    key: str,
    digest: str,
    size: int,
    counts: dict[str, int],
    dataset: str,
) -> None:
    """Write the ledger row that makes a re-run skip this file.

    A file that stored no hands is `failed` in words, as the worker writes it (ADR-051), so a
    re-run and a drop on the upload page both retry it instead of skipping an empty `completed`.
    """
    sentence = failure_sentence(counts, site)
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute(
            RECORD_UPLOAD_SQL,
            (
                upload_id,
                user_uuid,
                site,
                dataset,
                label[-LABEL_CHARS:],
                key,
                digest,
                size,
                "failed" if sentence else "completed",
                counts["found"],
                counts["parsed"],
                counts["failed"],
                counts.get("without_hero", 0),
                sentence[:ERROR_TEXT_CHARS],
            ),
        )


def resolve_user(dsn: str, email: str) -> tuple[str, int, list[str]]:
    """Look up the account to import into: (user uuid, tenant_id, registered screen names)."""
    with psycopg.connect(dsn, autocommit=True) as conn:
        row = conn.execute("SELECT id, tenant_id FROM users WHERE email = %s", (email,)).fetchone()
        if row is None:
            raise SystemExit(f"no user with email {email!r} — run `make seed` or register first")
        user_uuid, tenant_id = str(row[0]), int(row[1])
        names = [
            r[0]
            for r in conn.execute(
                "SELECT screen_name FROM poker_accounts WHERE user_id = %s", (user_uuid,)
            ).fetchall()
        ]
    return user_uuid, tenant_id, names
