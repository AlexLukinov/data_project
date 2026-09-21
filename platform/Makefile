# Poker platform — local development contract. Every target is idempotent.
#
# This is the PRODUCT. The minikube data-engineering lab lives one directory up and has its
# own Makefile; the two are deliberately separate (docs/POKER_DECISIONS.md ADR-015).
.DEFAULT_GOAL := help

COMPOSE := docker compose
# --frozen: every run uses uv.lock as written and never re-locks, here and in CI alike (ADR-054).
# After editing pyproject.toml by hand, run `uv lock`.
UV      := uv run --frozen
DBT_DIR := dbt/poker_dwh
DBT     := .venv-dbt/bin/dbt

export CLICKHOUSE_HOST     ?= localhost
export CLICKHOUSE_PORT     ?= 8124
export CLICKHOUSE_USER     ?= poker
export CLICKHOUSE_PASSWORD ?= poker

# The TEST environment: its own ClickHouse databases (`test_core`, `test_marts`, ...), its own
# Postgres database, raw bucket, Kafka topics + consumer group, and Redis logical database.
# Every target that loads synthetic hands (seed, test-all) runs under this, so nothing a test
# does can touch the founder's real hands, raw text, queue or cache (ADR-023). The integration
# conftest refuses to run unless every one of these is set.
# The auth rate limit is raised because the whole suite signs in from one address in one
# minute, which the production budget is meant to stop; the limiter itself is unit-tested
# (tests/test_security_config.py), so nothing is lost by not throttling the tests.
TEST_ENV := CLICKHOUSE_DB_PREFIX=test_ POSTGRES_DB=poker_test S3_RAW_BUCKET=poker-raw-test \
  KAFKA_UPLOADS_TOPIC=test.hands.uploads.v1 KAFKA_BULK_TOPIC=test.hands.bulkimport.v1 \
  KAFKA_CONSUMER_GROUP=test-parser-workers REDIS_URL=redis://localhost:6380/1 \
  AUTH_RATE_LIMIT_PER_MINUTE=1000

.PHONY: help
help: ## Show this help
	@grep -hE '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) | sort | \
	  awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

# ── stack ────────────────────────────────────────────────────────────────────
.PHONY: up
up: ## Start ClickHouse + Postgres + Kafka + Redis + MinIO, wait for health, then create the buckets
	$(COMPOSE) up -d --wait
	$(COMPOSE) run --rm minio-init
	@echo ">> stack healthy. Next: make seed"

.PHONY: down
down: ## Stop the stack (volumes preserved)
	$(COMPOSE) down

# ── the whole platform in one command ────────────────────────────────────────
# `up`/`down` are the containers alone. These three add the API, the parser worker and the Nuxt app,
# which are foreground processes in this contract (`make api`, `make worker`, `make web`) and so
# used to need three terminals. The scripts run them in the background with a pid file and a log
# each in platform/.run/, and refuse to start against the TEST environment.
.PHONY: start
start: ## Start EVERYTHING: the stack + API + worker + app, in the background (logs in .run/logs)
	./scripts/start.sh

.PHONY: pause
pause: ## Stop the API, worker and app, then stop the containers — memory freed, data and containers kept
	./scripts/pause.sh

.PHONY: stop
stop: ## Stop the API, worker and app, then `compose down` — containers removed, data volumes kept
	./scripts/stop.sh

.PHONY: nuke
nuke: ## DESTRUCTIVE: stop the stack and delete all local data volumes
	@echo "!! This deletes ALL local poker-platform data (ClickHouse, Postgres, MinIO, Kafka)."
	@read -p "Type 'nuke poker' to confirm: " ans; \
	  if [ "$$ans" = "nuke poker" ]; then $(COMPOSE) down -v; else echo "aborted."; fi

.PHONY: ps
ps: ## Show stack status
	$(COMPOSE) ps

.PHONY: logs
logs: ## Tail stack logs
	$(COMPOSE) logs -f --tail=100

# ── install ──────────────────────────────────────────────────────────────────
.PHONY: install
install: ## Install Python deps (app + dev) exactly as uv.lock pins them
	uv sync --frozen

.PHONY: dbt-install
dbt-install: ## Install dbt into its OWN venv (its pins clash with the app's — same lesson as the lab)
	uv venv .venv-dbt --python 3.12
	VIRTUAL_ENV=.venv-dbt uv pip install "dbt-core~=1.9" "dbt-clickhouse~=1.8"

# The dbt binary as a prerequisite, so a fresh clone's `make seed` or `make test-all` installs dbt
# instead of failing on a missing .venv-dbt (api/provision.py runs it too).
$(DBT):
	$(MAKE) dbt-install

# ── migrations ───────────────────────────────────────────────────────────────
.PHONY: migrate
migrate: pg-migrate ch-migrate ## Apply Postgres + ClickHouse migrations

.PHONY: pg-migrate
pg-migrate: ## Apply Alembic migrations to Postgres
	$(UV) alembic upgrade head

.PHONY: pg-revision
pg-revision: ## Autogenerate an Alembic revision (usage: make pg-revision M="add notes")
	$(UV) alembic revision --autogenerate -m "$(M)"

.PHONY: ch-migrate
ch-migrate: ## Apply ClickHouse SQL migrations
	$(UV) python -m ch.migrate

# ── data ─────────────────────────────────────────────────────────────────────
.PHONY: seed
seed: $(DBT) ## Provision the TEST databases, load the sample corpus into them, build dbt there
	$(TEST_ENV) $(UV) python -m api.provision
	$(TEST_ENV) $(UV) python -m scripts.seed
	$(TEST_ENV) $(DBT) build --project-dir $(DBT_DIR) --profiles-dir $(DBT_DIR)
	@echo ">> seeded the test databases (test_core, test_marts, poker_test)."
	@echo ">> To serve them: $(TEST_ENV) make api"

.PHONY: dbt-build
dbt-build: $(DBT) ## Run dbt (models + tests)
	$(DBT) build --project-dir $(DBT_DIR) --profiles-dir $(DBT_DIR)

.PHONY: dbt-test
dbt-test: $(DBT) ## Run dbt tests only
	$(DBT) test --project-dir $(DBT_DIR) --profiles-dir $(DBT_DIR)

.PHONY: dbt-docs
dbt-docs: $(DBT) ## Generate and serve dbt lineage docs
	$(DBT) docs generate --project-dir $(DBT_DIR) --profiles-dir $(DBT_DIR)
	$(DBT) docs serve --project-dir $(DBT_DIR) --profiles-dir $(DBT_DIR)

# ── run ──────────────────────────────────────────────────────────────────────
.PHONY: api
api: ## Run the API (http://localhost:8000 — OpenAPI at /docs; the UI is `make web`)
	$(UV) uvicorn api.main:app --reload --port 8000

.PHONY: worker
worker: ## Run a parser worker (consumes Kafka, writes ClickHouse)
	$(UV) python -m ingestion.worker

# ── web (platform/web: npm workspace — poker-core, poker-ui, the Nuxt app; ADR-027) ─────────
WEB_DIR := web

.PHONY: web-install
web-install: ## Install the JavaScript workspace (npm ci from the lockfile)
	cd $(WEB_DIR) && npm ci

.PHONY: web
web: ## Run the Nuxt app (http://localhost:3000 — the Range Lab; needs `make api` for the API pages)
	cd $(WEB_DIR) && npm run dev

.PHONY: web-test
web-test: ## Run the JavaScript unit tests (Vitest)
	cd $(WEB_DIR) && npm test

.PHONY: web-license
web-license: ## Fail on any dependency licence outside the ADR-027 allowlist
	cd $(WEB_DIR) && npm run license-check

.PHONY: web-check
web-check: ## typecheck + lint + tests + licence audit for the JavaScript workspace (what the CI `web` job runs)
	cd $(WEB_DIR) && npm run check

# ── quality ──────────────────────────────────────────────────────────────────
.PHONY: test
test: ## Run unit tests (no stack required)
	$(UV) pytest -q -m "not integration"

.PHONY: test-all
test-all: $(DBT) ## Run every test, including integration, against the TEST databases (needs `make up`)
	$(TEST_ENV) $(UV) pytest -q

.PHONY: lint
lint: ## Lint and format-check
	$(UV) ruff check .
	$(UV) ruff format --check .

.PHONY: fmt
fmt: ## Auto-format
	$(UV) ruff format .
	$(UV) ruff check --fix .

.PHONY: typecheck
typecheck: ## Static type check
	$(UV) mypy core parser ingestion stats analysis api

.PHONY: lint-arch
lint-arch: ## Enforce the module-boundary contracts in .importlinter (ADR-023)
	$(UV) lint-imports

.PHONY: gen
gen: ## Regenerate files derived from core/schema (staging models), the stat registry (rollup, seed, law test, MV) and the dbt models (the worker's hot path)
	$(UV) python -m scripts.gen_schema
	$(UV) python -m scripts.gen_stats
	$(UV) python -m scripts.gen_hot_path

.PHONY: gen-check
gen-check: ## Fail if a generated file is stale (run `make gen`)
	$(UV) python -m scripts.gen_schema --check
	$(UV) python -m scripts.gen_stats --check
	$(UV) python -m scripts.gen_hot_path --check

.PHONY: size-check
size-check: ## Functions <= 40 lines, files <= 300 (baseline in scripts/size_baseline.txt)
	$(UV) python -m scripts.check_sizes

.PHONY: size-baseline
size-baseline: ## Rewrite the size baseline after fixing or deliberately baselining violations
	$(UV) python -m scripts.check_sizes --update-baseline

.PHONY: check
check: lint typecheck lint-arch gen-check size-check test ## What the CI `quality` job runs

# ── e2e (plan D.9b, ADR-055) ─────────────────────────────────────────────────
# One browser flow on the TEST environment: sign in, name a seat, upload a seed-corpus file
# through /upload, and My game counts its hands. Playwright starts the API (:8055), a worker and
# the app (:3055) itself and stops all three however the run ends (web/e2e/playwright.config.ts).
# Needs `make up && make seed` first; never beside `make test-all`, whose session drops the test
# databases and whose drain shares the worker's consumer group.
.PHONY: e2e-install
e2e-install: ## Install the browser the E2E drives (Chromium, plus its system libraries on Linux)
	cd $(WEB_DIR) && npm run e2e:install

# The one collision the test cannot detect for itself: another worker already consuming the test
# topics (a `make test-all` in flight, or an orphan from a killed run) would take the upload this
# test is waiting for, and the test would blame a missing worker. Kafka gives each partition to one
# member, so an active member of the group is a refusal, not a warning. If Kafka is not up, this says
# nothing and the API's own startup fails instead.
.PHONY: e2e
e2e: ## Browser test on the TEST env: sign in, add a screen name, upload a seed file, My game counts it (needs `make seed`)
	@group=$$(printf '%s\n' $(TEST_ENV) | sed -n 's/^KAFKA_CONSUMER_GROUP=//p'); \
	  members=$$($(COMPOSE) exec -T kafka kafka-consumer-groups.sh --bootstrap-server localhost:9092 \
	    --describe --group "$$group" --members 2>/dev/null | grep -c "^$$group" || true); \
	  if [ "$$members" != "0" ]; then \
	    echo "refusing: a worker is already consuming $$group — is 'make test-all' running, or a worker left over from a killed run?"; \
	    exit 1; \
	  fi
	cd $(WEB_DIR) && $(TEST_ENV) npm run e2e

# ── privacy guard (ADR-058) ──────────────────────────────────────────────────
# No real player's screen name in anything committed or pushed. Reads every real opponent's key
# from the REAL ClickHouse, read-only, so it needs `make up` and cannot run in CI, which has no
# real data by design. The step before every push; `make install-hooks` makes git run it.
.PHONY: privacy-check
privacy-check: ## Fail on a real player's screen name in a tracked or staged file (real ClickHouse, read-only; local only)
	$(UV) python -m scripts.privacy_check $(PRIVACY_ARGS)

.PHONY: install-hooks
install-hooks: ## Install the local pre-push hook: the privacy check over what a push would send
	$(UV) python -m scripts.privacy_check --install-hook
