"""Request bodies for the replayer's two POSTs (plan F.7).

Kept out of `api/schemas.py` because they are inputs: `HandDetail` and `HandSummary` are what
the API returns and are shared by four endpoints, while these two are what one endpoint
accepts. The filter tree is `stats.request.HandSearch` itself -- the engine's own document, so
a situation built in the Reports workbench is the same object here.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from api.hand_parse import MAX_TEXT_CHARS
from core.enums import Site


class HandParseIn(BaseModel):
    """Raw hand-history text to replay. Nothing is stored (ADR-029)."""

    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=MAX_TEXT_CHARS)
    site: Site | None = None
    """Left out, the format is detected. Pass it when two formats could match the text."""
