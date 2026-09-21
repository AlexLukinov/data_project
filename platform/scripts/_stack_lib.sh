#!/usr/bin/env bash
# Shared helpers for start.sh / pause.sh / stop.sh — the three processes that are not containers.
#
# The compose stack (ClickHouse, Postgres, Kafka, Redis, MinIO) is `docker compose`'s job. The API,
# the parser worker and the Nuxt dev server are plain foreground processes in the make contract
# (`make api`, `make worker`, `make web`), which is why running the whole platform used to mean
# three terminals. These helpers run them in the background instead, with a pid file and a log each.
#
# Sourced, never executed. The caller sets PLATFORM_DIR first.

set -euo pipefail

RUN_DIR="$PLATFORM_DIR/.run"
LOG_DIR="$RUN_DIR/logs"
SERVICES=(api worker web)

API_PORT=8000
WEB_PORT=3000
API_HEALTH="http://localhost:$API_PORT/health"
WEB_URL="http://localhost:$WEB_PORT/"

# How long each service is given to answer before the script gives up and shows its log. Nuxt's
# first dev compile is the slow one; the API answers as soon as it has round-tripped ClickHouse.
API_READY_TIMEOUT=60
WEB_READY_TIMEOUT=180
# A service is asked to stop politely first; the worker uses the pause to finish its current batch
# and leave the Kafka consumer group, which is what keeps the next start from fighting for a
# partition (ADR-055 measured the same thing for the E2E's worker).
STOP_GRACE=15

say()  { printf '>> %s\n' "$*"; }
warn() { printf '!! %s\n' "$*" >&2; }
die()  { printf '!! %s\n' "$*" >&2; exit 1; }

pid_file() { printf '%s/%s.pid\n' "$RUN_DIR" "$1"; }
log_file() { printf '%s/%s.log\n' "$LOG_DIR" "$1"; }

# The pid this script started for a service, if that process is still alive.
service_pid() {
  local file pid
  file="$(pid_file "$1")"
  [ -f "$file" ] || return 1
  pid="$(cat "$file" 2>/dev/null || true)"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  printf '%s\n' "$pid"
}

# Empty when nothing is listening. `|| true` because an empty lsof exits 1, and `set -o pipefail`
# would otherwise turn "the port is free" into a failed command substitution and kill the script.
port_pid() { lsof -ti "tcp:$1" -sTCP:LISTEN 2>/dev/null | head -1 || true; }

# TERM the whole tree, deepest first: uvicorn --reload and `npm run dev` both run their real server
# as a child, and killing only the parent leaves that child holding the port.
kill_tree() {
  local pid="$1" signal="${2:-TERM}" child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do kill_tree "$child" "$signal"; done
  kill "-$signal" "$pid" 2>/dev/null || true
}

stop_service() {
  local name="$1" pid waited=0
  if ! pid="$(service_pid "$name")"; then
    rm -f "$(pid_file "$name")" 2>/dev/null || true
    return 0
  fi
  say "stopping $name (pid $pid)"
  kill_tree "$pid" TERM
  while kill -0 "$pid" 2>/dev/null && [ "$waited" -lt "$STOP_GRACE" ]; do
    sleep 1
    waited=$((waited + 1))
  done
  if kill -0 "$pid" 2>/dev/null; then
    warn "$name did not stop in ${STOP_GRACE}s — killing it"
    kill_tree "$pid" KILL
  fi
  rm -f "$(pid_file "$name")" 2>/dev/null || true
}

stop_all_services() {
  local name
  for name in "${SERVICES[@]}"; do stop_service "$name"; done
}

# The founder's real hands live in core.*/marts.* and the test environment exists so that nothing
# synthetic can reach them (CLAUDE.md). These three processes are the REAL platform, so a test
# variable inherited from the shell would point the API at the wrong databases while looking
# perfectly normal on screen. Refuse instead of guessing.
refuse_test_environment() {
  local wrong=()
  [ "${CLICKHOUSE_DB_PREFIX:-}" = "" ]              || wrong+=("CLICKHOUSE_DB_PREFIX=$CLICKHOUSE_DB_PREFIX")
  case "${POSTGRES_DB:-poker}"        in *_test) wrong+=("POSTGRES_DB=$POSTGRES_DB");; esac
  case "${S3_RAW_BUCKET:-poker-raw}"  in *-test) wrong+=("S3_RAW_BUCKET=$S3_RAW_BUCKET");; esac
  case "${KAFKA_UPLOADS_TOPIC:-}"     in test.*) wrong+=("KAFKA_UPLOADS_TOPIC=$KAFKA_UPLOADS_TOPIC");; esac
  case "${KAFKA_BULK_TOPIC:-}"        in test.*) wrong+=("KAFKA_BULK_TOPIC=$KAFKA_BULK_TOPIC");; esac
  case "${KAFKA_CONSUMER_GROUP:-}"    in test-*) wrong+=("KAFKA_CONSUMER_GROUP=$KAFKA_CONSUMER_GROUP");; esac
  if [ "${#wrong[@]}" -eq 0 ]; then return 0; fi
  warn "this shell carries the TEST environment, and these scripts start the REAL platform:"
  printf '     %s\n' "${wrong[@]}" >&2
  die "open a clean shell, or unset those variables. Tests have their own targets: make seed, make test-all."
}

# Run a command with a deadline, because `docker compose run` occasionally leaves its container in
# `Created` and never starts it (seen twice while building the E2E, ADR-055's consequences; Docker
# Desktop under load, not the command). macOS ships no `timeout`, so this is it: background the
# command, poll, and kill the tree if the deadline passes. Returns 124 on timeout, like GNU's.
run_with_timeout() {
  local seconds="$1" pid waited=0
  shift
  "$@" &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$waited" -ge "$seconds" ]; then
      kill_tree "$pid" TERM
      sleep 2
      kill_tree "$pid" KILL
      return 124
    fi
    sleep 1
    waited=$((waited + 1))
  done
  wait "$pid"
}

wait_for_http() {
  local name="$1" url="$2" timeout="$3" waited=0
  while [ "$waited" -lt "$timeout" ]; do
    # -s, not -sS: a poll that has not answered yet is expected, and one curl error per second
    # would bury the line that matters.
    if curl -fs -o /dev/null --max-time 3 "$url"; then return 0; fi
    if ! service_pid "$name" >/dev/null; then
      warn "$name exited while starting. Its last lines:"
      tail -20 "$(log_file "$name")" 2>/dev/null >&2 || true
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
  warn "$name did not answer $url within ${timeout}s. Its last lines:"
  tail -20 "$(log_file "$name")" 2>/dev/null >&2 || true
  return 1
}

# One line per service: running (with its pid) or stopped, and what holds the port if we did not.
print_services() {
  local name pid other
  for name in "${SERVICES[@]}"; do
    if pid="$(service_pid "$name")"; then
      printf '   %-7s running   pid %-7s log %s\n' "$name" "$pid" "$(log_file "$name")"
    else
      printf '   %-7s stopped\n' "$name"
    fi
  done
  for other in "$API_PORT:api" "$WEB_PORT:web"; do
    local port="${other%%:*}" who="${other##*:}"
    pid="$(port_pid "$port")"
    if [ -n "$pid" ] && ! service_pid "$who" >/dev/null; then
      printf '   note    port %s is held by pid %s, which these scripts did not start\n' "$port" "$pid"
    fi
  done
}
