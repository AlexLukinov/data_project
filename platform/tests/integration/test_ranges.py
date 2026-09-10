"""The range library end to end: versions, revert, lookup, bulk import, export, tenancy.

Requires the stack (`make test-all`): the rows live in the test Postgres database.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from api.main import app

pytestmark = pytest.mark.integration

TRANSPORT = ASGITransport(app=app)

UTG_RFI = {"hero_position": "UTG", "action_sequence": [{"position": "UTG", "action": "raise"}]}
BTN_3BET = {
    "hero_position": "BTN",
    "villain_position": "UTG",
    "action_sequence": [
        {"position": "UTG", "action": "raise"},
        {"position": "BTN", "action": "raise"},
    ],
}
V1 = "AsAh: 1,AsKs: 1"
V2 = "AsAh: 1,AsKs: 1,KsKh: 0.5"


async def _token(client: AsyncClient, email: str) -> dict[str, str]:
    res = await client.post(
        "/v1/auth/register",
        json={"email": email, "password": "a-long-enough-password", "display_name": "r"},
    )
    if res.status_code == 409:
        res = await client.post(
            "/v1/auth/login", json={"email": email, "password": "a-long-enough-password"}
        )
    assert res.status_code in (200, 201), res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def _body(name: str, node: dict[str, object], weights: str, **extra: object) -> dict[str, object]:
    return {"name": name, "node_key": node, "weights": weights, **extra}


async def test_editing_the_body_appends_versions_and_revert_is_a_new_version() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        auth = await _token(c, "ranges-a@example.com")
        created = await c.post(
            "/v1/ranges", json=_body("UTG RFI", UTG_RFI, V1, tags=["rfi"]), headers=auth
        )
        assert created.status_code == 201, created.text
        item = created.json()
        range_id = item["id"]
        assert item["version"] == 1 and item["weights"] == V1 and item["source"] == "own"
        assert item["node_key"]["eff_stack_bb"] == 100 and item["node_key"]["stake"] == ""

        edited = await c.put(
            f"/v1/ranges/{range_id}", json={"weights": V2, "note": "added KK"}, headers=auth
        )
        assert edited.status_code == 200, edited.text
        assert edited.json()["version"] == 2 and edited.json()["weights"] == V2
        # Metadata alone does not make a version.
        renamed = await c.put(
            f"/v1/ranges/{range_id}",
            json={"name": "UTG open", "tags": ["rfi", "6max"]},
            headers=auth,
        )
        assert renamed.json()["version"] == 2 and renamed.json()["tags"] == ["rfi", "6max"]

        history = await c.get(f"/v1/ranges/{range_id}/versions", headers=auth)
        assert [(v["version"], v["weights"], v["note"]) for v in history.json()] == [
            (2, V2, "added KK"),
            (1, V1, ""),
        ]

        reverted = await c.post(f"/v1/ranges/{range_id}/revert/1", headers=auth)
        assert reverted.status_code == 200, reverted.text
        assert reverted.json()["version"] == 3 and reverted.json()["weights"] == V1
        assert reverted.json()["note"] == "revert to v1"
        assert (await c.post(f"/v1/ranges/{range_id}/revert/9", headers=auth)).status_code == 404

        duplicate = await c.post("/v1/ranges", json=_body("UTG open", UTG_RFI, V1), headers=auth)
        assert duplicate.status_code == 409


async def test_lookup_matches_the_canonical_situation_and_the_list_filters() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        auth = await _token(c, "ranges-c@example.com")
        created = await c.post(
            "/v1/ranges", json=_body("UTG open", UTG_RFI, V1, tags=["6max"]), headers=auth
        )
        assert created.status_code == 201, created.text
        range_id = created.json()["id"]

        # Spelled with the default filled in explicitly, the key is the same situation.
        found = await c.post(
            "/v1/ranges/lookup", json={**UTG_RFI, "eff_stack_bb": 100}, headers=auth
        )
        assert [r["name"] for r in found.json()] == ["UTG open"]
        assert found.json()[0]["weights"] == V1
        assert (await c.post("/v1/ranges/lookup", json=BTN_3BET, headers=auth)).json() == []
        assert (
            await c.post("/v1/ranges/lookup", json={"hero_position": "LJ"}, headers=auth)
        ).status_code == 422

        listed = await c.get("/v1/ranges", params={"hero_position": "UTG"}, headers=auth)
        assert [r["name"] for r in listed.json()] == ["UTG open"]
        assert "weights" not in listed.json()[0]
        assert (await c.get("/v1/ranges", params={"tag": "6max"}, headers=auth)).json() != []
        assert (await c.get("/v1/ranges", params={"tag": "nope"}, headers=auth)).json() == []
        assert (await c.get("/v1/ranges", params={"street": "flop"}, headers=auth)).json() == []
        assert (await c.get("/v1/ranges", params={"q": "open"}, headers=auth)).json() != []
        assert (await c.get("/v1/ranges", params={"source": "pool"}, headers=auth)).json() == []

        assert (await c.delete(f"/v1/ranges/{range_id}", headers=auth)).status_code == 204
        assert (await c.get(f"/v1/ranges/{range_id}", headers=auth)).status_code == 404
        assert (await c.get(f"/v1/ranges/{range_id}/versions", headers=auth)).status_code == 404


async def test_bulk_import_creates_versions_or_skips() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        auth = await _token(c, "ranges-b@example.com")
        first = await c.post(
            "/v1/ranges/bulk",
            json={
                "ranges": [
                    _body("UTG RFI", UTG_RFI, V1, source="solver", source_tool="SPH"),
                    _body("BTN 3bet vs UTG", BTN_3BET, V1),
                    _body("BTN 3bet vs UTG", BTN_3BET, V2),
                ]
            },
            headers=auth,
        )
        assert first.status_code == 200, first.text
        report = first.json()
        assert [r["name"] for r in report["created"]] == ["UTG RFI", "BTN 3bet vs UTG"]
        assert report["updated"] == []
        assert report["skipped"] == [
            {"name": "BTN 3bet vs UTG", "reason": "listed twice in this import"}
        ]

        again = await c.post(
            "/v1/ranges/bulk",
            json={"ranges": [_body("UTG RFI", UTG_RFI, V2, source="solver")]},
            headers=auth,
        )
        assert again.json()["created"] == []
        assert [(r["name"], r["version"], r["weights"]) for r in again.json()["updated"]] == [
            ("UTG RFI", 2, V2)
        ]
        skipped = await c.post(
            "/v1/ranges/bulk",
            json={"ranges": [_body("UTG RFI", UTG_RFI, V1)], "on_conflict": "skip"},
            headers=auth,
        )
        assert skipped.json()["skipped"] == [
            {"name": "UTG RFI", "reason": "already in the library"}
        ]


async def test_bulk_import_is_all_or_nothing_and_export_reads_back() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        auth = await _token(c, "ranges-d@example.com")
        seeded = await c.post(
            "/v1/ranges/bulk",
            json={"ranges": [_body("UTG RFI", UTG_RFI, V2, source="solver", source_tool="SPH")]},
            headers=auth,
        )
        assert seeded.status_code == 200, seeded.text

        # A bad entry fails the whole import, before anything is written.
        bad = await c.post(
            "/v1/ranges/bulk",
            json={"ranges": [_body("new", UTG_RFI, V1), _body("broken", UTG_RFI, "AKs: 1")]},
            headers=auth,
        )
        assert bad.status_code == 422 and "not combo notation" in bad.text
        names = {r["name"] for r in (await c.get("/v1/ranges", headers=auth)).json()}
        assert names == {"UTG RFI"}

        exported = await c.get("/v1/ranges/export", headers=auth)
        assert exported.status_code == 200
        assert exported.json()["format"] == "poker-ranges/1"
        by_name = {r["name"]: r for r in exported.json()["ranges"]}
        assert by_name["UTG RFI"]["weights"] == V2 and by_name["UTG RFI"]["version"] == 1
        assert by_name["UTG RFI"]["source_tool"] == "SPH"
        assert by_name["UTG RFI"]["node_key"]["action_sequence"][0]["position"] == "UTG"


async def test_another_tenant_cannot_see_or_touch_ranges() -> None:
    async with AsyncClient(transport=TRANSPORT, base_url="http://test") as c:
        owner = await _token(c, "ranges-owner@example.com")
        thief = await _token(c, "ranges-thief@example.com")
        created = await c.post("/v1/ranges", json=_body("private", UTG_RFI, V1), headers=owner)
        assert created.status_code == 201, created.text
        range_id = created.json()["id"]

        assert (await c.get("/v1/ranges", headers=thief)).json() == []
        assert (await c.post("/v1/ranges/lookup", json=UTG_RFI, headers=thief)).json() == []
        assert (await c.get("/v1/ranges/export", headers=thief)).json()["ranges"] == []
        assert (await c.get(f"/v1/ranges/{range_id}", headers=thief)).status_code == 404
        assert (
            await c.put(f"/v1/ranges/{range_id}", json={"weights": V2}, headers=thief)
        ).status_code == 404
        assert (await c.post(f"/v1/ranges/{range_id}/revert/1", headers=thief)).status_code == 404
        assert (await c.delete(f"/v1/ranges/{range_id}", headers=thief)).status_code == 404
        assert (await c.get(f"/v1/ranges/{uuid.uuid4()}", headers=thief)).status_code == 404
        # The thief may use the same name: uniqueness is per user.
        mine = await c.post("/v1/ranges", json=_body("private", UTG_RFI, V2), headers=thief)
        assert mine.status_code == 201
        assert (await c.get(f"/v1/ranges/{range_id}", headers=owner)).json()["weights"] == V1
        assert (await c.get("/v1/ranges")).status_code == 401
