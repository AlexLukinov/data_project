"""FastAPI application entry point.

Run:  uv run uvicorn api.main:app --reload      (or `make api`)
Docs: http://localhost:8000/docs
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from api.db import clickhouse
from api.routers import auth, hands, stats, uploads

# Structured JSON logs from day one. Retrofitting correlation ids across five services later
# is painful; adding them now costs nothing. See docs/POKER_OBSERVABILITY.md.
logging.basicConfig(
    level=logging.INFO,
    format='{"ts":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","msg":"%(message)s"}',
)
log = logging.getLogger("api")

STATIC_DIR = Path(__file__).resolve().parent / "static"

app = FastAPI(
    title="Poker Analysis Platform",
    version="0.1.0",
    description=(
        "Post-session poker hand analysis. Phase 1 (MVP): ingest, parse, stats.\n\n"
        "Analyses the user's own hands post-session. No real-time assistance."
    ),
)

app.include_router(auth.router)
app.include_router(uploads.router)
app.include_router(stats.router)
app.include_router(hands.router)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception) -> JSONResponse:
    """Log the stack trace server-side; return a sanitized error to the client.

    Never leak internals to API consumers -- a stack trace tells an attacker the framework,
    the file layout and often the query.
    """
    log.exception("unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.get("/health", tags=["ops"])
async def health() -> dict[str, Any]:
    """Liveness plus a real ClickHouse round trip.

    A health check that only proves the process is running is worth very little -- it stays
    green while the thing the process depends on is down.
    """
    checks: dict[str, Any] = {"api": "ok"}
    try:
        clickhouse().command("SELECT 1")
        checks["clickhouse"] = "ok"
    except Exception as exc:
        checks["clickhouse"] = f"error: {type(exc).__name__}"
    return {"status": "ok" if all(v == "ok" for v in checks.values()) else "degraded", **checks}


if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    @app.get("/", include_in_schema=False)
    async def dashboard() -> FileResponse:
        """Serve the minimal dashboard."""
        return FileResponse(STATIC_DIR / "index.html")
