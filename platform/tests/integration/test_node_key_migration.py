"""A key saved before ADR-078 still finds its range, and an analysis still reopens on its node.

Requires the stack (`make test-all`). `ranges.lookup` is a JSONB equality over the whole
stored key, so the eight-field keys every range had before H.1 stopped matching the eleven-field
canonical form the client now sends. Migration `b9c0d1e2f3a4` writes the three defaults into
every stored key; these tests save a key the old way, prove the miss, run the migration's own
statements, and prove the hit.
"""

from __future__ import annotations

import importlib.util
import uuid
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from api.db import get_engine
from api.main import app

pytestmark = pytest.mark.integration

TRANSPORT = ASGITransport(app=app)
MIGRATION = "b9c0d1e2f3a4_node_key_line_size_pot_type.py"
NEW_FIELDS = "{line_so_far,size_bucket,pot_type}"
BB_DEFEND: dict[str, Any] = {
    "hero_position": "BB",
    "villain_position": "CO",
    "action_sequence": [
        {"position": "CO", "action": "raise", "size_bb": 2.5},
        {"position": "BB", "action": "call"},
    ],
}
WEIGHTS = "AsAh: 1,AsKs: 1"


def _migration() -> ModuleType:
    """The revision as a module, so the test runs the very statements the upgrade runs."""
    path = Path(__file__).resolve().parents[2] / "migrations" / "versions" / MIGRATION
    spec = importlib.util.spec_from_file_location(path.stem, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def _token(client: AsyncClient) -> dict[str, str]:
    email = f"oldkey-{uuid.uuid4().hex[:10]}@example.com"
    res = await client.post(
        "/v1/auth/register",
        json={"email": email, "password": "a-long-enough-password", "display_name": "k"},
    )
    assert res.status_code == 201, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def _save_the_old_way(table: str, row_id: str, fields: str = NEW_FIELDS) -> None:
    """Rewrite one stored key without `fields` -- the eight it had before ADR-078 by default."""
    async with get_engine().begin() as conn:
        await conn.execute(
            text(f"UPDATE {table} SET node_key = node_key - '{fields}'::text[] WHERE id = :id"),
            {"id": row_id},
        )


async def _run_migration() -> None:
    migration = _migration()
    async with get_engine().begin() as conn:
        for table in migration.TABLES:
            await conn.execute(text(migration.fill_statement(table)))


async def _stored_fields(table: str, row_id: str) -> set[str]:
    async with get_engine().connect() as conn:
        rows = await conn.execute(
            text(f"SELECT jsonb_object_keys(node_key) FROM {table} WHERE id = :id"), {"id": row_id}
        )
        return {str(row[0]) for row in rows}


async def test_a_range_saved_before_adr_078_still_finds_its_node() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        auth = await _token(c)
        created = await c.post(
            "/v1/ranges",
            json={"name": "BB defend vs CO", "node_key": BB_DEFEND, "weights": WEIGHTS},
            headers=auth,
        )
        assert created.status_code == 201, created.text
        range_id = created.json()["id"]
        await _save_the_old_way("ranges", range_id)
        assert "line_so_far" not in await _stored_fields("ranges", range_id)

        # The failure the migration exists for: eight fields never equal the canonical eleven.
        missed = await c.post("/v1/ranges/lookup", json=BB_DEFEND, headers=auth)
        assert missed.json() == []
        # Reading the row by id still works: the model fills the defaults on the way out.
        assert (await c.get(f"/v1/ranges/{range_id}", headers=auth)).json()["node_key"][
            "line_so_far"
        ] is None

        await _run_migration()
        found = await c.post("/v1/ranges/lookup", json=BB_DEFEND, headers=auth)
        assert [r["id"] for r in found.json()] == [range_id]
        assert found.json()[0]["weights"] == WEIGHTS
        # Idempotent: a second run changes nothing and breaks nothing.
        await _run_migration()
        again = await c.post("/v1/ranges/lookup", json=BB_DEFEND, headers=auth)
        assert [r["id"] for r in again.json()] == [range_id]


async def test_the_migration_keeps_a_value_the_key_already_carries() -> None:
    """`defaults || key`: the stored key's own `pot_type` wins over the default null."""
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        auth = await _token(c)
        flop = {
            "hero_position": "BB",
            "villain_position": "CO",
            "street": "flop",
            "line_so_far": "c/x",
            "pot_type": "srp",
            "action_sequence": [
                {"position": "BB", "action": "check"},
                {"position": "CO", "action": "bet", "size_pct": 0.33},
                {"position": "BB", "action": "raise", "size_pct": 3},
            ],
        }
        body = {"name": "BB x/r", "node_key": flop, "weights": WEIGHTS}
        created = await c.post("/v1/ranges", json=body, headers=auth)
        assert created.status_code == 201, created.text
        range_id = created.json()["id"]
        # Missing one field, so the row IS rewritten; still carrying `pot_type`, which must survive.
        await _save_the_old_way("ranges", range_id, "{size_bucket}")
        assert "size_bucket" not in await _stored_fields("ranges", range_id)
        assert (await c.post("/v1/ranges/lookup", json=flop, headers=auth)).json() == []

        await _run_migration()
        assert "size_bucket" in await _stored_fields("ranges", range_id)
        found = await c.post("/v1/ranges/lookup", json=flop, headers=auth)
        assert [r["name"] for r in found.json()] == ["BB x/r"]
        assert found.json()[0]["node_key"]["pot_type"] == "srp"
        assert found.json()[0]["node_key"]["line_so_far"] == "c/x"


async def test_an_analysis_saved_before_adr_078_reopens_and_is_migrated() -> None:
    """Analyses are read by id, never by key equality, so they reopen either way; the
    migration still brings their stored keys to the canonical form."""
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        auth = await _token(c)
        opened = await c.post(
            "/v1/analyses",
            json={"title": "BB vs CO", "source": "manual", "node_key": BB_DEFEND},
            headers=auth,
        )
        assert opened.status_code == 201, opened.text
        analysis_id = opened.json()["id"]
        await _save_the_old_way("analyses", analysis_id)
        assert "pot_type" not in await _stored_fields("analyses", analysis_id)

        reopened = await c.get(f"/v1/analyses/{analysis_id}", headers=auth)
        assert reopened.status_code == 200, reopened.text
        assert reopened.json()["node_key"]["hero_position"] == "BB"
        assert reopened.json()["node_key"]["pot_type"] is None

        await _run_migration()
        assert {"line_so_far", "size_bucket", "pot_type"} <= await _stored_fields(
            "analyses", analysis_id
        )
        assert (await c.get(f"/v1/analyses/{analysis_id}", headers=auth)).json()["node_key"][
            "hero_position"
        ] == "BB"
