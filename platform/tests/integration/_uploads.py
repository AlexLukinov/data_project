"""Helpers for the upload integration tests: accounts, uploads and reports, all over HTTP.

Shared by `test_upload_to_report.py` and `test_upload_contract.py` (plan D.8). Not collected:
the name does not start with `test_`.
"""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

import psycopg
from httpx import ASGITransport, AsyncClient, Response

from api.main import app
from core.settings import get_settings
from ingestion.clickhouse import clickhouse

CORPUS = Path(__file__).resolve().parents[1].parent / "seeds" / "hands"
TRANSPORT = ASGITransport(app=app)
HERO_STATS = ["hands", "vpip"]


def http() -> AsyncClient:
    """An in-process client for the API."""
    return AsyncClient(transport=TRANSPORT, base_url="http://test")


def auth(token: str) -> dict[str, str]:
    """The bearer header for a token."""
    return {"Authorization": f"Bearer {token}"}


async def register(client: AsyncClient) -> str:
    """A fresh account; returns its access token."""
    res = await client.post(
        "/v1/auth/register",
        json={
            "email": f"d8-{uuid.uuid4().hex[:10]}@example.com",
            "password": "a-long-enough-password",
            "display_name": "d8",
        },
    )
    assert res.status_code == 201, res.text
    token: str = res.json()["access_token"]
    return token


async def tenant_of(client: AsyncClient, token: str) -> int:
    """The numeric tenant behind a token, read from Postgres as the API reads it."""
    me = (await client.get("/v1/auth/me", headers=auth(token))).json()
    with psycopg.connect(get_settings().postgres_libpq_dsn) as conn:
        row = conn.execute("SELECT tenant_id FROM users WHERE id = %s", (me["id"],)).fetchone()
    assert row is not None
    return int(row[0])


async def upload(client: AsyncClient, token: str, site: str, name: str, **form: str) -> Response:
    """POST one corpus file; the site is left to detection unless `site=` is in `form`."""
    raw = (CORPUS / site / name).read_bytes()
    return await client.post(
        "/v1/uploads",
        files={"file": (name, raw, "text/plain")},
        data=form,
        headers=auth(token),
    )


async def upload_row(client: AsyncClient, token: str, upload_id: str) -> dict[str, Any]:
    """`GET /v1/uploads/{id}`, asserted to answer."""
    res = await client.get(f"/v1/uploads/{upload_id}", headers=auth(token))
    assert res.status_code == 200, res.text
    row: dict[str, Any] = res.json()
    return row


async def report(client: AsyncClient, token: str, **request: Any) -> dict[str, Any]:
    """`POST /v1/reports/run` with the hero stats unless `stats=` says otherwise."""
    body = {"stats": HERO_STATS, **request}
    res = await client.post("/v1/reports/run", json=body, headers=auth(token))
    assert res.status_code == 200, res.text
    result: dict[str, Any] = res.json()
    return result


def rollup_rows(table: str, tenant_id: int) -> int:
    """Rows a rollup holds for one tenant (`stats_daily` is dbt's; `stats_daily_mv` the view's)."""
    marts = get_settings().db("marts")
    rows = clickhouse().query(
        f"select count() from {marts}.{table} where user_id = %(t)s", parameters={"t": tenant_id}
    )
    return int(rows.result_rows[0][0])


def object_key_of(upload_id: str) -> str:
    """Where an upload's raw text is stored; the API does not expose it."""
    with psycopg.connect(get_settings().postgres_libpq_dsn) as conn:
        row = conn.execute("SELECT object_key FROM uploads WHERE id = %s", (upload_id,)).fetchone()
    assert row is not None
    return str(row[0])
