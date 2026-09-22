"""FastAPI application entry point.

Run:  uv run uvicorn api.main:app --reload      (or `make api`)
Docs: http://localhost:8000/docs
"""

from __future__ import annotations

import logging
from typing import Any

from clickhouse_connect.driver.exceptions import DatabaseError
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from api.db import clickhouse
from api.ratelimit import RETRY_AFTER_SECONDS
from api.routers import (
    analyses,
    auth,
    definitions,
    hands,
    hero,
    heuristics,
    pool,
    pool_nodes,
    ranges,
    reports,
    saved,
    uploads,
)
from core.settings import DEFAULT_JWT_SECRET, Settings, get_settings
from stats import tenancy

# Structured JSON logs from day one. Retrofitting correlation ids across five services later
# is painful; adding them now costs nothing. See docs/POKER_OBSERVABILITY.md.
logging.basicConfig(
    level=logging.INFO,
    format='{"ts":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","msg":"%(message)s"}',
)
log = logging.getLogger("api")


def refuse_unsafe_config(settings: Settings) -> None:
    """Refuse to serve outside development with settings that make tenancy meaningless.

    A placeholder JWT secret lets anyone mint a token for any tenant; a refresh cookie
    without `Secure` travels over plain http. Both are fine on a laptop and fatal in
    production, so the process must not start rather than start quietly wrong.
    """
    if settings.environment == "dev":
        return
    if settings.jwt_secret == DEFAULT_JWT_SECRET:
        raise RuntimeError(
            f"JWT_SECRET is the development placeholder (ENVIRONMENT={settings.environment})"
        )
    if settings.environment == "prod" and not settings.cookie_secure:
        raise RuntimeError("COOKIE_SECURE must be true in production")


refuse_unsafe_config(get_settings())

app = FastAPI(
    title="Poker Analysis Platform",
    version="0.1.0",
    description=(
        "Post-session poker hand analysis. Phase 1 (MVP): ingest, parse, stats.\n\n"
        "Analyses the user's own hands post-session. No real-time assistance."
    ),
)

# Explicit origins only. `allow_credentials` is what lets the HttpOnly refresh cookie ride
# along, and browsers refuse credentials with a wildcard origin -- which is the right default.
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(auth.router)
app.include_router(uploads.router)
app.include_router(hands.router)
app.include_router(definitions.router)
app.include_router(reports.router)
app.include_router(saved.router)
app.include_router(hero.router)
app.include_router(pool.router)
app.include_router(pool_nodes.router)
app.include_router(ranges.router)
app.include_router(analyses.router)
app.include_router(heuristics.router)


@app.exception_handler(DatabaseError)
async def clickhouse_refused(request: Request, exc: Exception) -> JSONResponse:
    """Turn a ClickHouse refusal into a status, without repeating what the server said.

    A budget rejection (plan E.3) is not a server fault and not the caller's syntax error: the
    query was well formed and cost more than this account is allowed, so it gets a status that
    says so. Anything else is a 500 -- an unknown table or a dead server must not be reported to
    the caller as "you asked for too much".

    The server's own message is never forwarded either way. A ClickHouse exception body contains
    the SQL that failed, which names every table, column and filter value in it.
    """
    refusal = tenancy.rejection(exc) if isinstance(exc, DatabaseError) else None
    if refusal is None:
        log.exception("clickhouse error on %s %s", request.method, request.url.path)
        return JSONResponse(status_code=500, content={"detail": "Internal server error"})
    log.warning(
        "clickhouse refused a query on %s %s: %s",
        request.method,
        request.url.path,
        refusal.clickhouse,
    )
    headers = {"Retry-After": RETRY_AFTER_SECONDS} if refusal.status_code == 429 else None
    return JSONResponse(
        status_code=refusal.status_code, content={"detail": refusal.detail}, headers=headers
    )


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
    except Exception:
        # Logged server-side; the unauthenticated caller learns only that it is down. The
        # exception class name was once returned here, which names the driver and its failure
        # mode to anyone on the network.
        log.exception("health check: clickhouse unreachable")
        checks["clickhouse"] = "error"
    return {"status": "ok" if all(v == "ok" for v in checks.values()) else "degraded", **checks}
