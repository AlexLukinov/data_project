"""The upload and poker-account routes' refusals, without a stack (plan D.8, ADR-051).

Each case here is refused before the route touches Postgres, object storage or Kafka -- by the
form, by `api.upload_intake`, or by request validation -- so it runs with only the user injected.
The paths that need a database (dedupe, requeue, another tenant's rows) are integration tests:
`tests/integration/test_upload_contract.py`.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

from api.deps import CurrentUser, current_user
from api.main import app
from api.upload_intake import UNDETECTED, ZIP
from core.settings import get_settings


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    app.dependency_overrides[current_user] = lambda: CurrentUser(
        id=uuid.uuid4(), tenant_id=7, email="t@example.com"
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


async def _post(client: AsyncClient, data: bytes, **form: str) -> tuple[int, object]:
    res = await client.post(
        "/v1/uploads", files={"file": ("hh.txt", data, "text/plain")}, data=form
    )
    return res.status_code, res.json()["detail"]


async def test_an_unknown_dataset_is_refused_in_words(client: AsyncClient) -> None:
    assert await _post(client, b"x", dataset="mine") == (
        400,
        "Unknown dataset 'mine'. Use 'hero' or 'population'.",
    )


async def test_a_zip_is_refused_in_words(client: AsyncClient) -> None:
    assert await _post(client, b"PK\x03\x04rest-of-archive") == (415, ZIP)


async def test_a_file_over_the_limit_is_refused_in_words(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "max_upload_bytes", 1024 * 1024)
    status, detail = await _post(client, b"x" * (1024 * 1024 + 1))
    assert (status, detail) == (413, "The file is larger than 1 MB. Split it and upload the parts.")


async def test_an_undetectable_file_asks_for_the_site(client: AsyncClient) -> None:
    assert await _post(client, b"a shopping list\n") == (422, UNDETECTED)


async def test_the_sites_route_is_typed(client: AsyncClient) -> None:
    res = await client.get("/v1/sites")
    assert res.status_code == 200 and res.json() == {"sites": ["ggpoker", "pokerstars"]}
    schema = (await client.get("/openapi.json")).json()
    ok = schema["paths"]["/v1/sites"]["get"]["responses"]["200"]["content"]["application/json"]
    assert ok["schema"] == {"$ref": "#/components/schemas/SitesResponse"}


@pytest.mark.parametrize("limit", ["0", "-1", "201"])
async def test_the_list_limit_is_bounded(client: AsyncClient, limit: str) -> None:
    assert (await client.get(f"/v1/uploads?limit={limit}")).status_code == 422


@pytest.mark.parametrize(
    "body",
    [
        {"site": "wpn", "screen_name": "Hero"},
        {"site": "pokerstars", "screen_name": "   "},
        {"site": "pokerstars", "screen_name": "Hero", "is_verified": True},
    ],
    ids=["a-site-with-no-parser", "a-blank-name", "a-field-the-client-may-not-set"],
)
async def test_a_poker_account_body_is_validated(
    client: AsyncClient, body: dict[str, object]
) -> None:
    res = await client.post("/v1/auth/poker-accounts", json=body)
    assert res.status_code == 422, res.text
    assert isinstance(res.json()["detail"], list)


async def test_an_unsupported_site_names_the_supported_ones(client: AsyncClient) -> None:
    res = await client.post("/v1/auth/poker-accounts", json={"site": "wpn", "screen_name": "Hero"})
    (problem,) = res.json()["detail"]
    assert "unsupported site 'wpn' (supported: ggpoker, pokerstars)" in problem["msg"]
