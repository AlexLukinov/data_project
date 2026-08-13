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
| Spark → MinIO (source) | s3a (hadoop-aws), path-style, no TLS | `http://minio…:9000`, bucket `raw` |
| Spark → Iceberg | Iceberg REST + S3FileIO, catalog `lake` | Nessie `…:19120/iceberg`, warehouse `s3://lakehouse/` |
| Trino → Nessie | iceberg connector, `type=rest` (`iceberg`) + native `nessie` (`iceberg_history`) | `nessie.data-platform.svc:19120` |
| Nessie → MinIO | writes table metadata server-side (STATIC S3 creds) | `minio…:9000`, bucket `lakehouse` |
| Debezium → Postgres | Strimzi Connect, pgoutput logical replication | `shop-db-rw…:5432`, publication `dbz_publication` |
| Debezium → Kafka | per-table topics `shop.public.<table>` | `platform-kafka-bootstrap…:9092` |
| Airflow (CDC) → ClickHouse | confluent-kafka consumer → `staging.cdc_events` | topics `shop.public.*` → CH 8123 |
| Greengage | single-host demo (coordinator + 2 primary segments), `kubectl exec` psql | `greengage-0`, coordinator port 7000 |

## Data model

- **Source (Postgres `shop`)**: `customers` (1k), `orders` (10k, 90-day window, status),
  `order_items` (~30k). Generated with `generate_series` — no external files.
- **ClickHouse `raw`**: MergeTree mirrors of source tables + `events` (streaming) fed by a
  Kafka engine table through `mv_events`.
- **ClickHouse `staging`** (dbt views): `stg_customers`, `stg_orders`, `stg_order_items`.
- **ClickHouse `marts`** (dbt tables): `fct_orders`, `daily_revenue` (MergeTree, ORDER BY date).
- **ClickHouse `staging.cdc_events`** (CDC landing): `ReplacingMergeTree(_version)` keyed by
  `(source_table, id)` — deduplicated CDC state from Debezium.
- **Iceberg `lake.shop.daily_revenue`** (Spark): month-partitioned, in MinIO `lakehouse/`, tracked by Nessie.
- **Greengage** (standalone MPP): `customers` / `orders` distributed by different keys to force data motion.

## Extended layers (phases 8–11)

```
 LAKEHOUSE   MinIO raw/ ─Spark→ Iceberg(lakehouse/) ◄─catalog─ Nessie(REST) ◄── Trino
                                                                   ▲ time travel via Nessie tag
 CDC         Postgres ─Debezium(pgoutput)→ Kafka shop.public.* ─Airflow→ ClickHouse staging.cdc_events
 MPP         Greengage (coordinator + 2 segments, amd64 emulated) — distribution keys + data motion
 DQ          dbt tests (not_null / unique / relationships / accepted_values) on staging + marts
```

- **Lakehouse (phase 8).** Nessie is the **Iceberg REST catalog**; both Spark (writes) and Trino
  (reads) speak the standard Iceberg REST API to it, and Nessie writes table metadata to MinIO
  itself. Time travel is **Nessie-native** (commits/branches/tags), not per-snapshot — a Nessie
  tag pins a point-in-time state and the `iceberg_history` Trino catalog reads it.
- **CDC (phase 9).** Debezium runs on a Strimzi `KafkaConnect` (custom image with the connector
  plugin). CNPG already runs `wal_level=logical`; only a REPLICATION grant + publication are added.
  The Airflow consumer lands changes idempotently via `ReplacingMergeTree`.
- **MPP (phase 10).** Greengage is amd64-only, so it runs **emulated** (documented exception to the
  arm64 rule). A single-host `gpdemo` cluster in one pod; gpstart needs passwordless self-ssh
  (container starts as root for sshd, runs the DB as gpadmin).
- **DQ (phase 11).** dbt schema tests; Great Expectations was evaluated and **not** adopted — see
  `docs/data-quality.md`.

## Why these choices (see docs/versions.md for the full delta list)

CloudNativePG (Bitnami images went paid), Strimzi KRaft (no Zookeeper), Airflow LocalExecutor
(no Celery/Redis), single-replica ClickHouse (no Keeper), kafbat/kafka-ui (Provectus archived),
Nessie for the Iceberg REST catalog + git-style time travel, Debezium on Strimzi Connect for CDC,
Greengage (Apache-2.0 Greenplum fork) for the MPP demo. Everything is `helm upgrade --install` /
`kubectl apply` — idempotent and re-runnable.
