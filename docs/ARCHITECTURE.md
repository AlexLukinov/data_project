# Architecture

minikube profile `dataplatform`, namespace `data-platform`. Service-to-service traffic uses
cluster DNS only; humans reach UIs through `scripts/port-forwards.sh`.

```
                        minikube (profile: dataplatform, ns: data-platform)
 ┌─────────────────────────────────────────────────────────────────────────┐
 │  BATCH PATH                                                              │
 │  ┌──────────┐   Airflow DAG    ┌─────────┐   s3() ingest   ┌─────────┐   │
 │  │ Postgres │ ───extract────►  │  MinIO  │ ──────────────► │ Click-  │   │
 │  │  (shop)  │   to Parquet     │  (S3)   │                 │ House   │   │
 │  │  CNPG    │                  └─────────┘                 │ raw     │   │
 │  └──────────┘                                              │ staging │   │
 │                                                            │ marts ◄─┼─── dbt
 │  STREAMING PATH                                            │         │   │  (via Airflow)
 │  ┌──────────┐    ┌────────┐   Kafka engine + MV            │         │   │
 │  │ event    │ ─► │ Kafka  │ ─────────────────────────────► │ raw.    │   │
 │  │ generator│    │ Strimzi│                                │ events  │   │
 │  └──────────┘    │ KRaft  │                                └────┬────┘   │
 │                  └────────┘                  ┌────────┐         │        │
 │  ┌─────────────────────────────┐             │ Trino  │ ◄───────┘        │
 │  │ Airflow: scheduler + web     │            │(option)│  jdbc:8123       │
 │  │ LocalExecutor, own meta-PG   │            └────────┘                  │
 │  │ image bakes dbt-clickhouse   │   ┌──────────────────┐                 │
 │  └─────────────────────────────┘   │ Spark Operator   │ (on-demand)     │
 │                                    │ + demo s3a job   │                  │
 │                                    └──────────────────┘                  │
 └─────────────────────────────────────────────────────────────────────────┘
```

## Integration points

| Edge | How | Endpoint |
|---|---|---|
| Airflow → Postgres | `clickhouse-connect`/psycopg, conn `AIRFLOW_CONN_SHOP_PG` | `shop-db-rw.data-platform.svc:5432` |
| Airflow → MinIO | `minio` SDK, write Parquet | `minio.data-platform.svc:9000` (path-style) |
| ClickHouse → MinIO | `s3()` table function, path-style http | `http://minio.data-platform.svc.cluster.local:9000/<bucket>/<key>` |
| Airflow → ClickHouse | `clickhouse-connect` HTTP, user admin | `clickhouse-platform.data-platform.svc:8123` |
| dbt → ClickHouse | dbt-clickhouse adapter (in `/opt/dbt-venv`) | host `clickhouse-platform`, 8123 |
| ClickHouse → Kafka | Kafka engine table + materialized view | `platform-kafka-bootstrap.data-platform.svc:9092` |
| generator → Kafka | confluent-kafka producer | `platform-kafka-bootstrap…:9092`, topic `clickstream` |
| Trino → ClickHouse | clickhouse connector, JDBC | `jdbc:clickhouse://clickhouse-platform:8123/` |
| Spark → MinIO | s3a (hadoop-aws), path-style, no TLS | `http://minio…:9000`, buckets `raw`/`spark` |

## Data model

- **Source (Postgres `shop`)**: `customers` (1k), `orders` (10k, 90-day window, status),
  `order_items` (~30k). Generated with `generate_series` — no external files.
- **ClickHouse `raw`**: MergeTree mirrors of source tables + `events` (streaming) fed by a
  Kafka engine table through `mv_events`.
- **ClickHouse `staging`** (dbt views): `stg_customers`, `stg_orders`, `stg_order_items`.
- **ClickHouse `marts`** (dbt tables): `fct_orders`, `daily_revenue` (MergeTree, ORDER BY date).

## Why these choices (see docs/versions.md for the full delta list)

CloudNativePG (Bitnami images went paid), Strimzi KRaft (no Zookeeper), Airflow LocalExecutor
(no Celery/Redis), single-replica ClickHouse (no Keeper), kafbat/kafka-ui (Provectus archived).
Everything is `helm upgrade --install` / `kubectl apply` — idempotent and re-runnable.
