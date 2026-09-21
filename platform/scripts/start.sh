#!/usr/bin/env bash
# Start the whole platform: the compose stack, the API, a parser worker and the Nuxt app.
#
# Idempotent — run it as often as you like. A service already running is left alone; a port held by
# something this script did not start is reported rather than fought over. Logs and pid files live
# in platform/.run/ (gitignored), and each service is started under nohup so closing the terminal
# does not take the platform down with it.
#
#   ./scripts/start.sh          everything
#   ./scripts/start.sh api web  only those services (the stack comes up either way)
#
# Stop it with scripts/pause.sh (keeps the containers, frees the memory) or scripts/stop.sh.

set -euo pipefail

PLATFORM_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=_stack_lib.sh
source "$PLATFORM_DIR/scripts/_stack_lib.sh"
cd "$PLATFORM_DIR"

WANTED=("$@")
if [ "${#WANTED[@]}" -eq 0 ]; then WANTED=("${SERVICES[@]}"); fi

wants() {
  local name want
  name="$1"
  for want in "${WANTED[@]}"; do
    if [ "$want" = "$name" ]; then return 0; fi
  done
  return 1
}

# Launch one service in the background, with its output in .run/logs and its pid in .run.
# Refuses rather than starting a second copy, and refuses a port someone else is holding.
start_service() {
  local name="$1" port="$2"
  shift 2
  local pid
  if pid="$(service_pid "$name")"; then
    say "$name already running (pid $pid)"
    return 0
  fi
  if [ -n "$port" ]; then
    pid="$(port_pid "$port")"
    if [ -n "$pid" ]; then
      die "port $port is already held by pid $pid — stop it first (scripts/stop.sh, or the terminal running it)"
    fi
  fi
  say "starting $name → $(log_file "$name")"
  ( nohup "$@" >>"$(log_file "$name")" 2>&1 </dev/null & echo $! >"$(pid_file "$name")" )
}

# Not applied automatically: a schema change to the founder's real database is a decision, not a
# side effect of starting the app. Said out loud instead, because the API fails in less obvious
# ways when the tables are behind the code.
warn_if_migrations_pending() {
  local current
  if ! current="$(uv run --frozen alembic current 2>/dev/null | tail -1)"; then
    warn "could not read the Alembic revision — is Postgres up?"
    return 0
  fi
  case "$current" in
    *"(head)"*) : ;;
    *) warn "Postgres is behind the migrations (at '${current:-nothing}'). Run: make migrate" ;;
  esac
}

refuse_test_environment
mkdir -p "$LOG_DIR"

say "bringing the stack up (ClickHouse, Postgres, Kafka, Redis, MinIO)"
docker compose up -d --wait

# Creating the buckets is a one-off that is re-run for safety, so a Docker hang here must not hold
# the platform hostage: warn and carry on. If the buckets really are missing, the first upload says
# so and `make up` is one command away.
say "checking the MinIO buckets"
if ! run_with_timeout 90 docker compose run --rm minio-init >/dev/null 2>&1; then
  warn "minio-init did not finish in 90s (a known Docker Desktop hang) — carrying on."
  warn "if uploads fail, run: docker compose run --rm minio-init"
  docker rm -f "$(docker ps -aq --filter 'name=minio-init-run' | head -1)" >/dev/null 2>&1 || true
fi
warn_if_migrations_pending

if wants api; then
  start_service api "$API_PORT" uv run --frozen uvicorn api.main:app --reload --port "$API_PORT"
fi
if wants worker; then
  start_service worker "" uv run --frozen python -m ingestion.worker
fi
if wants web; then
  if [ ! -d "$PLATFORM_DIR/web/node_modules" ]; then
    die "web/node_modules is missing — run: make web-install"
  fi
  start_service web "$WEB_PORT" npm --prefix "$PLATFORM_DIR/web" run dev
fi

if wants api; then
  wait_for_http api "$API_HEALTH" "$API_READY_TIMEOUT" || die "the API never became healthy"
fi
if wants web; then
  wait_for_http web "$WEB_URL" "$WEB_READY_TIMEOUT" || die "the app never answered"
fi

say "up:"
print_services
cat <<EOF

   app     http://localhost:$WEB_PORT      (My game, Pool, Hands, Analyze, Ranges, Train, Help)
   API     http://localhost:$API_PORT/docs
   logs    tail -f $LOG_DIR/*.log
   stop    ./scripts/pause.sh   (keeps the containers, frees the memory)
           ./scripts/stop.sh    (containers down too; data volumes are kept either way)
EOF
