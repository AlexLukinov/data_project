# Usage — launch, UIs, and how to see what happened

A practical, copy-pasteable guide. All commands run from the repo root. Cluster facts:
minikube profile `dataplatform`, namespace `data-platform`.

---

## 0. Prerequisites

- **Docker Desktop running**, with **≥ 16 GB** memory (Settings → Resources → Memory).
- `minikube`, `kubectl`, `helm` on PATH — `brew install minikube helm kubernetes-cli`.
- Apple Silicon is fine. Everything is arm64 **except Greengage** (amd64, runs emulated).

---

## 1. Launch

### Cold start (empty machine → batch pipeline)

```bash
make cluster        # start minikube (4 CPU / 12Gi / 40g) + metrics-server + namespace + secrets
make core           # phases 1–5: MinIO, Postgres(CNPG), ClickHouse, Airflow, dbt wiring
make sync-dags      # copy dags/ and dbt/ into the Airflow PVC
```

Then run the batch pipeline once (Postgres → MinIO Parquet → ClickHouse raw → dbt marts):

```bash
kubectl -n data-platform exec deploy/airflow-scheduler -c scheduler -- \
  airflow dags trigger shop_batch_pipeline
# or click ▶ on shop_batch_pipeline in the Airflow UI (see §2)
```

### Streaming path (phase 6)

```bash
make streaming      # Strimzi + Kafka (KRaft) + kafka-ui + ClickHouse Kafka engine tables
make stream-on      # start the event generator  (make stream-off to stop it)
```

### Query engine — Trino (phase 7a)

```bash
make query          # Trino coordinator-only: catalogs clickhouse + iceberg + iceberg_history + tpch
```

### Lakehouse — Iceberg on Nessie (phase 8) + Spark (phase 7b)

```bash
make lakehouse      # Nessie (Iceberg REST catalog) over the MinIO 'lakehouse' bucket
make spark-demo     # PySpark job: reads raw/ parquet, writes a month-partitioned Iceberg table
```

### CDC — Debezium (phase 9)

```bash
make cdc                 # Postgres logical-replication setup + Strimzi KafkaConnect + Debezium connector
make airflow && make sync-dags   # rebuild the Airflow image (adds confluent-kafka) + resync DAGs
kubectl -n data-platform exec deploy/airflow-scheduler -c scheduler -- \
  airflow dags trigger shop_cdc_consumer      # land CDC into ClickHouse staging.cdc_events
```

### MPP — Greengage (phase 10)

```bash
make mpp            # single-host Greengage (Greenplum fork, amd64 emulated) + shop dataset
```
> ⏳ Greengage is **emulated** — first boot (cluster init) takes ~1–2 min and it is CPU-hungry.
> Scale it down when idle: `kubectl -n data-platform scale statefulset/greengage --replicas=0`.

### Data quality (phase 11)

```bash
make dq             # dbt tests: not_null / unique / relationships / accepted_values
```

### Verify the whole thing

```bash
make smoke          # runs scripts/smoke/phase0..11 — every installed component
```

---

## 2. Where to see the UIs

Open all consoles with one command (safe to re-run):

```bash
bash scripts/port-forwards.sh
# stop them later:  pkill -f 'kubectl.*port-forward'
```

| Service | URL | Credentials | What you see |
|---|---|---|---|
| **Airflow** | http://localhost:8080 | admin / admin | DAGs `shop_batch_pipeline`, `shop_cdc_consumer`; runs, logs, graph |
| **MinIO console** | http://localhost:9001 | minioadmin / minioadmin | buckets `raw`, `lakehouse`, `spark`, `staging`, `dwh` |
| **ClickHouse HTTP** | http://localhost:8123/play | admin / admin | query `raw` / `staging` / `marts` |
| **Kafka UI** | http://localhost:8081 | — | topics `clickstream`, `shop.public.*`, `connect-*` |
| **Trino** | http://localhost:8082 | any username | query UI (or use the CLI, see §3) |
| **Nessie** | http://localhost:19120 | — | Iceberg catalog UI: commits, branches, tags (`history_demo`) |
| **Kafka Connect API** | http://localhost:8083/connectors | — | Debezium connector status (JSON) |
| **Postgres shop** | localhost:5433 | shop / shop | source OLTP DB (psql/DBeaver) |
| **Greengage** | localhost:7000 | gpadmin (trust) | MPP coordinator — `psql -h localhost -p 7000 -U gpadmin -d postgres` |

> ⚠️ Do **not** port-forward ClickHouse native 9000 — it collides with MinIO API 9000 on the host.
> All lab credentials live in `infra/secrets.yaml`.

---

## 3. What happened in the cluster — how to observe each layer

### Everything at a glance

```bash
kubectl -n data-platform get pods                    # all components
helm -n data-platform ls                             # installed charts
make smoke                                           # green = each layer works end-to-end
```

### Batch (Postgres → MinIO → ClickHouse → dbt)

```bash
# marts built by dbt (via the batch DAG)
kubectl -n data-platform exec chi-platform-platform-0-0-0 -c clickhouse -- \
  clickhouse-client -u admin --password admin -q \
  "SELECT order_date, orders, revenue FROM marts.daily_revenue ORDER BY order_date LIMIT 5"
```
UI: **Airflow** → `shop_batch_pipeline` graph (extract → load → dbt_build); **MinIO** → `raw/shop/…parquet`.

### Streaming (event-gen → Kafka → ClickHouse)

```bash
# rows keep growing while stream is on
kubectl -n data-platform exec chi-platform-platform-0-0-0 -c clickhouse -- \
  clickhouse-client -u admin --password admin -q "SELECT count() FROM raw.events"
```
UI: **Kafka UI** → topic `clickstream` (messages flowing).

### Lakehouse (Spark → Iceberg / Nessie, queried by Trino)

```bash
TRINO="kubectl -n data-platform exec deploy/trino-coordinator -- trino --execute"
$TRINO "SELECT count(*) FROM iceberg.shop.daily_revenue"                    # Spark-written table
$TRINO "SELECT * FROM iceberg.shop.\"daily_revenue\$partitions\""           # month partitions
# time travel (Nessie tag): old vs new — phase-8 smoke proves it
bash scripts/smoke/phase8_lakehouse.sh
```
UI: **Nessie** → commits/branches, the `history_demo` tag; **MinIO** → `lakehouse/warehouse/…`.

### CDC (Debezium → Kafka → Airflow → ClickHouse)

```bash
# connector state
kubectl -n data-platform get kafkaconnector shop-postgres \
  -o jsonpath='{.status.connectorStatus.connector.state}{"\n"}'
# deduplicated CDC landing (matches the Postgres source counts)
kubectl -n data-platform exec chi-platform-platform-0-0-0 -c clickhouse -- \
  clickhouse-client -u admin --password admin -q \
  "SELECT source_table, count() FROM staging.cdc_events FINAL WHERE _deleted=0 GROUP BY 1 ORDER BY 1"
```
UI: **Kafka UI** → topics `shop.public.customers|orders|order_items`; **Kafka Connect API** → connector JSON.
Try it live: `INSERT` a row into Postgres (`localhost:5433`) → watch it appear in the topic, then
re-run `shop_cdc_consumer` and see it in `staging.cdc_events`.

### MPP (Greengage — distribution keys + data motion)

```bash
GP="kubectl -n data-platform exec greengage-0 -- runuser -u gpadmin -- psql -d postgres -c"
$GP "SELECT gp_segment_id, count(*) FROM orders GROUP BY 1 ORDER BY 1"          # data spread over segments
$GP "EXPLAIN SELECT c.city, count(*) FROM orders o JOIN customers c ON o.customer_id=c.id GROUP BY 1"
#   ^ look for 'Redistribute Motion' / 'Gather Motion' in the plan = data motion
```

### Data quality (dbt tests)

```bash
make dq             # 20 tests: not_null / unique / relationships / accepted_values — all PASS
```

---

## 4. Stop & teardown

```bash
make down           # scale all workloads to zero, KEEP PVCs (data preserved). 'make core' etc. bring back.
kubectl -n data-platform scale statefulset/greengage --replicas=0   # stop the emulated MPP specifically
make nuke           # DESTRUCTIVE: delete the whole minikube cluster (typed confirmation required)
```
