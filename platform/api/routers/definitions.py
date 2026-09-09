"""`GET /v1/definitions`: the stat registry, as the UI reads it (ADR-021, plan §2.7).

Labels, categories, descriptions, typical ranges, and every dimension's type, allowed ops,
enum values and presentation buckets -- so the client holds no stat logic of its own. The
response models ARE the registry's models: one source of truth, serialized.
"""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from api.deps import CurrentUserDep
from stats.definitions import Dimension, Stat
from stats.registry import registry

router = APIRouter(prefix="/v1", tags=["definitions"])


class DefinitionsResponse(BaseModel):
    """Every built-in stat and every dimension, in registry order."""

    stats: list[Stat]
    dimensions: list[Dimension]


@router.get("/definitions", response_model=DefinitionsResponse)
async def definitions(user: CurrentUserDep) -> DefinitionsResponse:
    """The registry. Authenticated like everything else, cheap, and safe to cache client-side."""
    reg = registry()
    return DefinitionsResponse(
        stats=list(reg.stats.values()), dimensions=list(reg.dimensions.values())
    )
