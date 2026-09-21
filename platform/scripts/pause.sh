#!/usr/bin/env bash
# Pause the platform: stop the API, the worker and the app, then stop the containers.
#
# Nothing is deleted and nothing is recreated — `docker compose stop` leaves the containers and
# their volumes exactly as they are, so scripts/start.sh brings the same stack back in seconds.
# This is the one to use when the laptop needs its memory back (ClickHouse alone is capped at 4 GB)
# or when the minikube lab needs the room.
#
#   ./scripts/pause.sh            stop the processes and the containers
#   ./scripts/pause.sh --apps     stop only the three processes, leave the containers running

set -euo pipefail

PLATFORM_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=_stack_lib.sh
source "$PLATFORM_DIR/scripts/_stack_lib.sh"
cd "$PLATFORM_DIR"

APPS_ONLY=false
if [ "${1:-}" = "--apps" ]; then APPS_ONLY=true; fi

stop_all_services

if [ "$APPS_ONLY" = true ]; then
  say "containers left running"
else
  say "stopping the containers (volumes kept)"
  docker compose stop
fi

say "paused:"
print_services
say "back up with ./scripts/start.sh"
