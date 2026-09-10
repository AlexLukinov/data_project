# Poker platform — local development contract. Every target is idempotent.
#
# This is the PRODUCT. The minikube data-engineering lab lives one directory up and has its
# own Makefile; the two are deliberately separate (docs/POKER_DECISIONS.md ADR-015).
.DEFAULT_GOAL := help

COMPOSE := docker compose
UV      := uv run
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
TEST_ENV := CLICKHOUSE_DB_PREFIX=test_ POSTGRES_DB=poker_test S3_RAW_BUCKET=poker-raw-test \
  KAFKA_UPLOADS_TOPIC=test.hands.uploads.v1 KAFKA_BULK_TOPIC=test.hands.bulkimport.v1 \
  KAFKA_CONSUMER_GROUP=test-parser-workers REDIS_URL=redis://localhost:6380/1

.PHONY: help
help: ## Show this help
	@grep -hE '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) | sort | \
	  awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

# ── stack ────────────────────────────────────────────────────────────────────
.PHONY: up
up: ## Start ClickHouse + Postgres + Kafka + Redis + MinIO and wait for health
	$(COMPOSE) up -d --wait
	@echo ">> stack healthy. Next: make seed"

.PHONY: down
down: ## Stop the stack (volumes preserved)
	$(COMPOSE) down

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
install: ## Install Python deps (app + dev)
	uv sync --group dev

.PHONY: dbt-install
dbt-install: ## Install dbt into its OWN venv (its pins clash with the app's — same lesson as the lab)
	uv venv .venv-dbt --python 3.12
	VIRTUAL_ENV=.venv-dbt uv pip install "dbt-core~=1.9" "dbt-clickhouse~=1.8"

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
seed: ## Provision the TEST databases, load the sample corpus into them, build dbt there
	$(TEST_ENV) $(UV) python -m api.provision
	$(TEST_ENV) $(UV) python -m scripts.seed
	$(TEST_ENV) $(DBT) build --project-dir $(DBT_DIR) --profiles-dir $(DBT_DIR)
	@echo ">> seeded the test databases (test_core, test_marts, poker_test)."
	@echo ">> To serve them: $(TEST_ENV) make api"

.PHONY: dbt-build
dbt-build: ## Run dbt (models + tests)
	$(DBT) build --project-dir $(DBT_DIR) --profiles-dir $(DBT_DIR)

.PHONY: dbt-test
dbt-test: ## Run dbt tests only
	$(DBT) test --project-dir $(DBT_DIR) --profiles-dir $(DBT_DIR)

.PHONY: dbt-docs
dbt-docs: ## Generate and serve dbt lineage docs
	$(DBT) docs generate --project-dir $(DBT_DIR) --profiles-dir $(DBT_DIR)
	$(DBT) docs serve --project-dir $(DBT_DIR) --profiles-dir $(DBT_DIR)

# ── run ──────────────────────────────────────────────────────────────────────
.PHONY: api
api: ## Run the API (http://localhost:8000 — dashboard at /, docs at /docs)
	$(UV) uvicorn api.main:app --reload --port 8000

.PHONY: worker
worker: ## Run a parser worker (consumes Kafka, writes ClickHouse)
	$(UV) python -m ingestion.worker

# ── quality ──────────────────────────────────────────────────────────────────
.PHONY: test
test: ## Run unit tests (no stack required)
	$(UV) pytest -q -m "not integration"

.PHONY: test-all
test-all: ## Run every test, including integration, against the TEST databases (needs `make up`)
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
gen: ## Regenerate files derived from core/schema (staging models) and the stat registry (rollup, seed, law test)
	$(UV) python -m scripts.gen_schema
	$(UV) python -m scripts.gen_stats

.PHONY: gen-check
gen-check: ## Fail if a generated file is stale (run `make gen`)
	$(UV) python -m scripts.gen_schema --check
	$(UV) python -m scripts.gen_stats --check

.PHONY: size-check
size-check: ## Functions <= 40 lines, files <= 300 (baseline in scripts/size_baseline.txt)
	$(UV) python -m scripts.check_sizes

.PHONY: size-baseline
size-baseline: ## Rewrite the size baseline after fixing or deliberately baselining violations
	$(UV) python -m scripts.check_sizes --update-baseline

.PHONY: check
check: lint typecheck lint-arch gen-check size-check test ## Everything CI runs
