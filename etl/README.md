# etl — manual shop-db → ClickHouse loader

The pre-Airflow version of the pipeline (Sprint 4). A single Python script that extracts every
row from `shop-db` (Postgres), maps Postgres types to ClickHouse types, and batch-loads into
`shop_raw.*` in ClickHouse. Built to feel every moving part before a framework hides them.

## Design in one breath

- **Extract:** server-side cursor + `fetchmany` (never `fetchall` a fact table).
- **Transform:** explicit Postgres→ClickHouse type map (`numeric→Decimal`, `timestamptz→DateTime64`,
  low-distinct `text→LowCardinality(String)`).
- **Load:** batched `INSERT` into `ReplacingMergeTree(_loaded_at)` keyed `ORDER BY id`, so re-running
  is idempotent — duplicates collapse on the next merge; read the deduplicated truth with `FINAL`.
- **Verify:** compares `source count(*)` vs `target count() FINAL` and exits non-zero on a mismatch.

## Run

```bash
# 1. port-forward Postgres (:5433) and ClickHouse HTTP (:8123)
kubectl -n data-platform port-forward svc/shop-db-rw 5433:5432 &
kubectl -n data-platform port-forward svc/clickhouse-platform 8123:8123 &

# 2. venv + pinned deps
cd etl && python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt

# 3. load (idempotent — safe to re-run)
./.venv/bin/python pg_to_clickhouse.py
```

Connection params come from env vars (`PG_HOST/PORT/DB/USER/PASSWORD`, `CH_HOST/PORT/USER/PASSWORD`);
defaults are the intentionally-committed lab creds over the port-forwards.
