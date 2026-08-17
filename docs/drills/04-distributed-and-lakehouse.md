# 04 — Distributed & Lakehouse

Spark tuning · Trino federation · table formats (Iceberg/Delta). Helpers (`TRINO`, `CH`) are in
[README.md](README.md). Lakehouse: `make lakehouse`; Spark: `make spark-demo`; Trino: `make query`.

---

## Spark

### [B] Q: What does the lab's Spark job do, and what's the s3a stack?
**Talking points:** [infra/spark/job.py](../../infra/spark/job.py) reads `s3a://raw/shop/orders/`
(the same Parquet the batch DAG wrote), aggregates revenue per day, and writes a **month-partitioned
Iceberg table** `lake.shop.daily_revenue` via the Nessie REST catalog (see Lakehouse below). s3a =
the `hadoop-aws` connector talking S3 to MinIO (used for the *read*); the image
([infra/spark/Dockerfile](../../infra/spark/Dockerfile)) bakes `hadoop-aws:3.3.4` +
`aws-java-sdk-bundle:1.12.262` (must match Spark 3.5.3's Hadoop 3.3.4) **plus** the Iceberg runtime +
`iceberg-aws-bundle` (S3FileIO for the *write*), on a **JDK-17** base (Iceberg 1.11 needs Java 17).
Path-style + no-TLS config in [infra/spark/sparkapplication.yaml](../../infra/spark/sparkapplication.yaml).
**Show it in the lab:**
```bash
make spark-demo
kubectl -n data-platform get sparkapplication shop-daily-revenue -o jsonpath='{.status.applicationState.state}{"\n"}'
```
**Follow-up:** "why pin those exact jar versions?" → `hadoop-aws` must match the Hadoop version Spark
ships, and the aws-sdk-bundle must match `hadoop-aws`; mismatches = `NoSuchMethodError`/`ClassNotFound`.

### [I] Q: Narrow vs wide transformations, and what is a shuffle?
**Talking points:** narrow (map/filter/withColumn) — each output partition depends on one input
partition, no data movement. Wide (groupBy/join/distinct/repartition) — output partitions pull from
many inputs → a **shuffle**: data is written, network-exchanged, re-read. Shuffles are the dominant
cost; minimize and right-size them.
**Show it in the lab:** the job's `groupBy("order_date").agg(...)` is a shuffle; `withColumn(... to_date ...)`
is narrow. Read the physical plan:
```python
daily.explain()   # add to job.py — shows Exchange (shuffle) before HashAggregate
```
**Follow-up:** "control shuffle partition count?" → `spark.sql.shuffle.partitions` (default 200 — way
too many for this tiny job; AQE coalesces them).

### [I] Q: Broadcast join vs sort-merge join — when and how?
**Talking points:** if one side is small, **broadcast** it to every executor → the big side stays put,
**no shuffle** of the big table. Spark auto-broadcasts under `spark.sql.autoBroadcastJoinThreshold`
(~10 MB) or you hint `broadcast(df_small)`. Otherwise it's a **sort-merge join** (both sides shuffled
+ sorted on the key).
**Show it in the lab (build-it snippet):** in `job.py`, join orders to a small dim:
```python
from pyspark.sql.functions import broadcast
joined = orders.join(broadcast(dims), "customer_id")
joined.explain()   # look for BroadcastHashJoin, not SortMergeJoin
```
**Follow-up:** "broadcast a 5 GB table?" → OOMs executors; that's what the threshold prevents — use
sort-merge or bucketing.

### [A] Q: Two big tables joined repeatedly on the same key — kill the shuffle.
**Talking points:** **bucketing** — pre-partition + sort both tables into N buckets on the join key
when writing; subsequent joins are shuffle-free sort-merge. Trades one-time write cost for repeated
join savings. (Also: salting for skewed keys, AQE skew-join handling.)
**Show it in the lab (build-it snippet):**
```python
orders.repartition(50,"customer_id").write.bucketBy(50,"customer_id").format("parquet").mode("overwrite").save("s3a://spark/orders_bucketed/")
```
**Follow-up:** "AQE?" → Adaptive Query Execution (`spark.sql.adaptive.enabled`, on by default in 3.5)
coalesces shuffle partitions, switches to broadcast at runtime, and splits skewed partitions using
real stats.

### [I] Q: Predicate/column pushdown and partition pruning with Parquet.
**Talking points:** Spark pushes filters and column projection into the Parquet reader — only needed
row-groups (via min/max stats) and columns are read. With Hive-partitioned paths (`dt=…`), partition
**pruning** skips whole directories. Select columns and filter early.
**Show it in the lab:** the orders Parquet is `dt=<ds>/`; reading `s3a://raw/shop/orders/` exposes
`dt` as a partition column Spark can prune on.
```python
spark.read.parquet("s3a://raw/shop/orders/").select("order_ts","amount").where("dt='2026-06-11'").explain()
```
**Follow-up:** "`select('*')` then filter in Python?" → reads all columns/rows; pushdown lost. Push
filters into the read.

---

## Trino

### [B] Q: What is Trino doing here that ClickHouse/Spark don't?
**Talking points:** Trino is a **federated, interactive** MPP SQL engine — it queries data *where it
lives* (no ingestion) across catalogs. The lab runs it **coordinator-only** (`workers=0`,
`node-scheduler.include-coordinator=true`) with a `clickhouse` JDBC catalog + the built-in `tpch`.
Great for ad-hoc cross-source SQL and sub-minute analytics.
**Show it in the lab:** [infra/trino/values.yaml](../../infra/trino/values.yaml).
```bash
TRINO "SELECT order_date, orders, revenue FROM clickhouse.marts.daily_revenue ORDER BY order_date LIMIT 5"
TRINO "SHOW CATALOGS"
```
**Follow-up:** "coordinator-only limitation?" → no horizontal scale; one node plans *and* executes.
Fine for a lab; add workers (StatefulSet) for real volume.

### [I] Q: Federation — join across two systems in one query.
**Talking points:** Trino can join a ClickHouse table to a Postgres/tpch table in a single SQL,
pushing each source's filters down and doing the join in Trino. Powerful for "enrich warehouse facts
with reference data that lives elsewhere."
**Show it in the lab:** join the CH marts to `tpch` (always present):
```bash
TRINO "SELECT r.order_date, r.revenue, n.name FROM clickhouse.marts.daily_revenue r CROSS JOIN tpch.tiny.nation n WHERE n.nationkey=0 ORDER BY r.order_date LIMIT 3"
```
*(Add a `postgresql` catalog to federate the live `shop-db` — a natural next drill.)*
**Follow-up:** "where does the join run?" → in Trino; each connector pushes down what it can
(filters/aggregations), the rest executes in the engine. Verify with `EXPLAIN`.

### [I] Q: How do you see what got pushed down vs executed in Trino?
**Talking points:** `EXPLAIN` shows the distributed plan and which predicates/aggregations the
connector handled (`TableScan` with a pushed filter) vs what Trino does locally. Maximizing pushdown
minimizes data pulled over JDBC.
**Show it in the lab:**
```bash
TRINO "EXPLAIN SELECT count(*) FROM clickhouse.raw.events WHERE event_type='purchase'"
```
**Follow-up:** "filter not pushed down?" → Trino pulls rows then filters locally (slow); connector
capability + types determine pushdown.

### [B] Q: Spark vs Trino vs ClickHouse — which when?
**Talking points:**
- **ClickHouse** — store + serve fast aggregations on data you've modeled into it (the marts).
- **Trino** — interactive, federated SQL across sources without moving data; BI/ad-hoc.
- **Spark** — heavy batch ETL/ML, big shuffles/joins, complex transforms, scheduled.
The lab shows all three reading the *same* order data three ways.
**Show it in the lab:** the same daily revenue, two engines side by side (Spark recomputes it in `job.py`):
```bash
CH    "SELECT order_date, revenue FROM marts.daily_revenue ORDER BY order_date LIMIT 3"
TRINO "SELECT order_date, revenue FROM clickhouse.marts.daily_revenue ORDER BY order_date LIMIT 3"
```
**Follow-up:** "1 B-row nightly join + write?" → Spark. "Ad-hoc join CH facts to Postgres dims?" →
Trino. "Dashboard p99 < 200 ms on a modeled table?" → ClickHouse.

---

## Lakehouse & table formats

### [I] Q: The `raw/` zone is immutable Parquet. What do Iceberg/Delta add?
**Talking points:** plain Parquet on object storage has no **ACID** (partial writes visible), no
row-level update/delete (rewrite whole partitions), no schema-evolution safety, no time travel, and
suffers small-file/listing pain. **Iceberg/Delta** add a metadata/transaction layer over Parquet:
atomic commits, snapshots (time travel + rollback), hidden partitioning, safe schema evolution, and
efficient upserts/deletes (merge-on-read / copy-on-write).
**Show it in the lab:** the `raw` zone loader does *partition replace* (`DROP PARTITION`) for
idempotency — a manual stand-in; the lab *also* runs a real Iceberg lakehouse (Spark writes
`lake.shop.daily_revenue`, Trino reads it via the Nessie catalog) — see the ACID/time-travel drill below.
**Follow-up:** "Iceberg vs Delta?" → Iceberg: engine-neutral, strong hidden partitioning + manifest
metadata (Netflix lineage); Delta: Spark-native, simple transaction log, unifies batch+streaming
(Databricks). Both ACID; choice often follows your engine ecosystem.

### [A] Q: Demonstrate ACID + time travel on the lab's Iceberg lakehouse.
**Talking points:** the lab runs a real **Nessie** Iceberg REST catalog over MinIO — Spark writes
`lake.shop.daily_revenue`, Trino reads it via catalog `iceberg`. Schema evolution + time travel work
through Trino. The **Nessie twist**: history is git-style **commits/branches/tags**, not retained
Iceberg snapshots — so `FOR VERSION AS OF <snapshot>` does *not* apply. You time-travel by pinning a
Nessie **tag** and reading it through a second catalog (`iceberg_history`): tag = old state, `main` = new.
**Show it in the lab:** `make lakehouse && make spark-demo`, then:
```bash
TRINO "ALTER TABLE iceberg.shop.daily_revenue ADD COLUMN note varchar"   # schema evolution
bash scripts/smoke/phase8_lakehouse.sh   # tags state, writes on main, reads old(tag) vs new(main)
```
**Follow-up:** "ACID on S3 specifically?" → S3 lacks atomic rename; Iceberg commits by swapping a
metadata pointer (here via the Nessie catalog), Delta historically needed a lock (e.g. DynamoDB) for
multi-writer safety. "Why not standard snapshot time travel?" → Nessie keeps history as commits, not
Iceberg snapshots, so you pin a ref/tag instead.

### [I] Q: When is a lakehouse table format *overkill*?
**Talking points:** append-only, immutable, partition-replace workloads (exactly the lab's `raw/`
batch zone) don't need updates/deletes or time travel — the metadata overhead and write cost buy
little. Reach for Iceberg/Delta when you need upserts/deletes, concurrent writers, schema evolution,
audit/rollback, or to tame small files at scale.
**Show it in the lab:** the `raw/` zone is exactly this append/replace case — the loader just swaps a day's partition, no row-level mutation needed:
```bash
CH "SELECT partition, rows FROM system.parts WHERE database='raw' AND table='orders' AND active"
```
**Follow-up:** "cheapest reliability win on plain Parquet?" → write-to-temp + atomic swap of a
manifest/prefix, plus a compaction job — i.e. reinventing a slice of what Iceberg already does.
