#!/usr/bin/env bash
# Stop the platform: the API, the worker and the app, then `docker compose down`.
#
# The containers are removed; **the data volumes are not touched** — ClickHouse's 9.1M hands,
# Postgres, MinIO's raw text and Kafka's topics all survive, and scripts/start.sh recreates the
# containers around them. Deleting data is `make nuke` alone, which asks for a typed confirmation
# and is never called from here.
#
# Use scripts/pause.sh instead if you want the containers kept for a faster restart.

set -euo pipefail

PLATFORM_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=_stack_lib.sh
source "$PLATFORM_DIR/scripts/_stack_lib.sh"
cd "$PLATFORM_DIR"

stop_all_services

say "taking the containers down (data volumes preserved)"
docker compose down

say "stopped:"
print_services
say "back up with ./scripts/start.sh"
