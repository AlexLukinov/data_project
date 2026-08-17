# Interview drills

Q&A drill sheet for Data Engineer interviews, grounded in **this** lab. Every answer is backed by
a command or query you can actually run here and point to — so you rehearse on real components, not
slides.

## Tracks

| File | Covers |
|---|---|
| [01-batch-and-modeling.md](01-batch-and-modeling.md) | SQL & ClickHouse optimization, dimensional modeling, SCD, incremental vs full load, file formats, dbt tests |
| [02-streaming.md](02-streaming.md) | Kafka internals, delivery semantics, windowing & late data, schema registry, the CH Kafka-engine path |
| [03-orchestration.md](03-orchestration.md) | Airflow: idempotency, backfills, sensors, branching, dynamic mapping, datasets, executors |
| [04-distributed-and-lakehouse.md](04-distributed-and-lakehouse.md) | Spark tuning, Trino federation, Iceberg/Delta (ACID, time travel, schema evolution) |

Each entry is tagged `[B]` beginner · `[I]` intermediate · `[A]` advanced.

## How to use this

1. Cover the answer, read the **Q**, say your answer out loud, then check the talking points.
2. Run the **Show it in the lab** command so the concept is muscle memory and you can describe a
   *real* thing you built in interviews ("in my lab the orders fact is a MergeTree ordered by…").
3. The **Follow-up** is the curveball an interviewer adds once you answer — have it ready.

Demos are one of two kinds:
- **Runs as-is** — uses something already deployed (the batch path, `raw.events`, the marts…).
- **Build-it snippet** — a few lines you paste to *create and prove* a feature the base lab doesn't
  ship (ReplacingMergeTree, SCD2 snapshot, Iceberg…). These are the highest-value reps.

## Lab warm-up (do this once per session)

```bash
minikube start -p dataplatform
make core          # batch path: minio, postgres, clickhouse, airflow, dbt
make sync-dags     # push dags/ + dbt/ into the Airflow PVC
make streaming     # optional: Kafka + generator + CH Kafka tables
make query         # optional: Trino
make spark-demo    # optional: Spark operator + demo job
bash scripts/port-forwards.sh   # MinIO 9001 · Airflow 8080 · CH 8123 · Kafka-UI 8081 · Trino 8082 · PG 5433
```

### Copy-paste helpers (referenced by every demo)

```bash
# ClickHouse (admin/admin) — single query
CH() { local p; p=$(kubectl -n data-platform get pod -l clickhouse.altinity.com/chi=platform -o jsonpath='{.items[0].metadata.name}'); \
       kubectl -n data-platform exec "$p" -c clickhouse -- clickhouse-client --user admin --password admin --query "$1"; }
# ...or an interactive CH shell for multi-statement snippets:
CHSH() { local p; p=$(kubectl -n data-platform get pod -l clickhouse.altinity.com/chi=platform -o jsonpath='{.items[0].metadata.name}'); \
         kubectl -n data-platform exec -it "$p" -c clickhouse -- clickhouse-client --user admin --password admin; }

# Postgres source (peer-auth as postgres superuser; reads the shop db)
PG() { kubectl -n data-platform exec shop-db-1 -c postgres -- psql -U postgres -d shop -tAc "$1"; }

# Trino (clickhouse + tpch catalogs)
TRINO() { kubectl -n data-platform exec deploy/trino-coordinator -- trino --execute "$1"; }

# dbt (isolated venv inside the Airflow image)
DBT() { kubectl -n data-platform exec airflow-scheduler-0 -c scheduler -- \
        /opt/dbt-venv/bin/dbt "$@" --project-dir /opt/airflow/dags/dbt/shop_dwh --profiles-dir /opt/airflow/dags/dbt/shop_dwh; }

# Airflow CLI
AF() { kubectl -n data-platform exec airflow-scheduler-0 -c scheduler -- airflow "$@"; }

# Kafka broker CLI (Strimzi pod; CLIs live under /opt/kafka/bin)
KAF() { kubectl -n data-platform exec platform-dual-0 -- "$@"; }   # e.g. KAF /opt/kafka/bin/kafka-topics.sh ...
```

> Pod names: ClickHouse and Trino are resolved by label/deploy in the helpers. `shop-db-1`,
> `airflow-scheduler-0`, and `platform-dual-0` are StatefulSet pods (stable names). If a name ever
> differs, `kubectl -n data-platform get pods` shows the current set.

## The lab in one breath (your 30-second "tell me about a project" answer)

> A laptop-scale DWH on minikube: an Airflow DAG snapshots a Postgres shop DB to Parquet in MinIO,
> ClickHouse ingests it via the `s3()` function into a `raw` layer, and dbt builds `staging` views
> and `marts` tables (a `fct_orders` star and a `daily_revenue` rollup) with schema tests. A second
> path streams synthetic clickstream through Kafka (Strimzi, KRaft) into ClickHouse via a Kafka-engine
> table + materialized view. Trino federates queries over ClickHouse, and a Spark job reads the same
> Parquet over s3a. Everything is Helm/operators, pinned, idempotent, smoke-tested.
