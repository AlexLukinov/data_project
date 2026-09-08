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
seed: migrate ## Migrate, load the sample hand corpus, and build the dbt models
	$(UV) python -m scripts.seed
	$(MAKE) dbt-build
	@echo ">> seeded. Start the API with: make api"

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
test-all: ## Run every test, including integration (needs `make up && make seed`)
	$(UV) pytest -q

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
	$(UV) mypy core parser ingestion api

.PHONY: check
check: lint typecheck test ## Everything CI runs
