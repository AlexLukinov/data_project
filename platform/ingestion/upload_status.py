"""What the parser worker writes back to an `uploads` row (plan D.8, ADR-051).

The row is the upload page's only view of the worker. The API writes `queued`; this module writes
the rest: `processing` when the worker takes the file, the counts so far after every stored
batch, and `completed` or `failed` at the end.

**A file that stored no hands is `failed`, never `completed`.** A mislabelled file splits into
zero hands and a file of unreadable ones stores none; both used to end `completed` with nothing
in them, which the page would have shown as success.

**`error_text` is read by the uploader, so it is a sentence, never an exception.** A ClickHouse or
S3 exception carries hosts, bucket names and SQL. The worker logs it in full; the row gets one of
the sentences below -- the rule `api/main.py` applies to every HTTP error, applied to the one
error that reaches a client through a table instead.

A synchronous driver on purpose: the worker is a plain loop, and dragging an event loop into it
just to reuse the API's async session would add complexity for no benefit.

**Every write is logged and swallowed on failure, and here is what each loss costs.** A lost
`record_progress` costs a stale count. A lost `record_outcome` leaves the row `processing` over
hands already durably in ClickHouse; a lost `record_failure` leaves it `processing` over nothing.
Either way `updated_at` stops moving, and `api/upload_store.py` requeues a `processing` row once
it has been silent for `STALE_PROCESSING` -- so a status write lost during a Postgres blip costs a
retry, never a file. Raising instead would skip the Kafka message, not redeliver it: the consumer's
position has already moved past it.
"""

from __future__ import annotations

import logging

import psycopg

from core.settings import get_settings

log = logging.getLogger(__name__)

ERROR_TEXT_CHARS = 2000
"""How much of a sentence the `uploads.error_text` column keeps."""

FAILED_ON_OUR_SIDE = "Processing failed on our side. Upload the file again to retry."


def failure_sentence(counts: dict[str, int], site: str) -> str:
    """Why an upload that raised nothing still failed, or '' when it stored at least one hand."""
    if counts.get("parsed", 0) > 0:
        return ""
    found = counts.get("found", 0)
    if found == 0:
        return f"No hands were found in this file. Check that it is a {site} hand history."
    if found == 1:
        return "The one hand in this file could not be read. It is kept for the parser's backlog."
    return (
        f"None of the {found:,} hands in this file could be read. "
        "They are kept for the parser's backlog."
    )


def _execute(sql: str, params: tuple[object, ...]) -> None:
    """One statement on a short-lived autocommit connection; a failure is logged, not raised."""
    try:
        with psycopg.connect(get_settings().postgres_libpq_dsn, autocommit=True) as conn:
            conn.execute(sql, params)
    except Exception as exc:
        log.warning("could not update an upload row: %s", exc)


def claim(upload_id: str) -> bool:
    """The worker takes the file: `processing`, counts from zero, no error.

    False for an upload already `failed`: its pointer is a late one -- a publish the API reported
    as not sent that the broker stored anyway -- and running it would overwrite the failure the
    uploader was shown. A retry is never skipped, because a requeue sets `queued` before it
    publishes. A row that does not exist (a pointer published outside the API) is claimed.
    """
    try:
        with psycopg.connect(get_settings().postgres_libpq_dsn, autocommit=True) as conn:
            row = conn.execute("SELECT status FROM uploads WHERE id = %s", (upload_id,)).fetchone()
            if row is not None and row[0] == "failed":
                return False
            conn.execute(
                "UPDATE uploads SET status = 'processing', hands_found = 0, hands_parsed = 0, "
                "hands_failed = 0, hands_without_hero = 0, error_text = '', completed_at = NULL, "
                "updated_at = now() WHERE id = %s AND status <> 'failed'",
                (upload_id,),
            )
    except Exception as exc:
        log.warning("could not claim upload %s: %s", upload_id, exc)
    return True


def record_progress(upload_id: str, counts: dict[str, int]) -> None:
    """The counts so far, after a stored batch. `updated_at` moves, so a stalled file shows."""
    _execute(
        "UPDATE uploads SET hands_found = %s, hands_parsed = %s, hands_failed = %s, "
        "hands_without_hero = %s, updated_at = now() WHERE id = %s AND status = 'processing'",
        (
            counts.get("found", 0),
            counts.get("parsed", 0),
            counts.get("failed", 0),
            counts.get("without_hero", 0),
            upload_id,
        ),
    )


def record_outcome(upload_id: str, counts: dict[str, int], site: str) -> None:
    """The final counts, and `completed` -- or `failed` in words when nothing was stored."""
    sentence = failure_sentence(counts, site)
    _execute(
        "UPDATE uploads SET status = %s, hands_found = %s, hands_parsed = %s, hands_failed = %s, "
        "hands_without_hero = %s, error_text = %s, completed_at = now(), updated_at = now() "
        "WHERE id = %s",
        (
            "failed" if sentence else "completed",
            counts.get("found", 0),
            counts.get("parsed", 0),
            counts.get("failed", 0),
            counts.get("without_hero", 0),
            sentence[:ERROR_TEXT_CHARS],
            upload_id,
        ),
    )


def record_failure(upload_id: str, sentence: str = FAILED_ON_OUR_SIDE) -> None:
    """`failed`, with a sentence for the uploader. The counts so far are left as they were."""
    _execute(
        "UPDATE uploads SET status = 'failed', error_text = %s, completed_at = now(), "
        "updated_at = now() WHERE id = %s",
        (sentence[:ERROR_TEXT_CHARS], upload_id),
    )
