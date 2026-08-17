# 01 — Batch & Modeling

SQL/ClickHouse optimization · engine selection · dimensional modeling & SCD · incremental vs full
load · file formats · data quality. Helpers (`CH`, `PG`, `DBT`, `CHSH`) are defined in
[README.md](README.md).

---

## SQL & ClickHouse optimization

### [B] Q: Why ClickHouse for a DWH instead of Postgres?
**Talking points:**
- Column-oriented + vectorized execution: reads only the columns a query touches, compresses each
  column hard (similar values adjacent). OLAP scans/aggregations over billions of rows in ms.
- MergeTree stores data sorted by `ORDER BY` with a *sparse* primary index (one mark per ~8192-row
  granule) → tiny index, range scans skip granules.
- Trade-off: no real UPDATE/DELETE semantics, eventual merges, weak point-lookup story — it's an
  analytics store, not OLTP. Postgres (`shop-db`) stays the source of truth.
**Show it in the lab:**
```bash
CH "SELECT name, total_rows, formatReadableSize(total_bytes) FROM system.tables WHERE database IN ('raw','marts') AND total_rows>0 ORDER BY total_bytes DESC"
```
**Follow-up:** "When NOT ClickHouse?" → high-frequency single-row updates, transactional integrity,
many-table normalized OLTP, strong uniqueness constraints.

### [I] Q: What does `ORDER BY` do in a MergeTree, and how do you choose it?
**Talking points:**
- It's the physical sort order **and** the sparse primary index. Filters on a left prefix of the
  ORDER BY prune granules (and partitions prune first). It is *not* a uniqueness key — duplicates
  are allowed.
- Put the columns you filter/group by most, lowest cardinality first, then increasing cardinality.
**Show it in the lab:** `raw.events` is `ORDER BY (ts, user_id)` (see [infra/clickhouse/kafka-tables.sh](../../infra/clickhouse/kafka-tables.sh)); `marts.fct_orders` is `ORDER BY order_id`.
```bash
CH "EXPLAIN indexes=1 SELECT count() FROM raw.events WHERE ts > now() - INTERVAL 1 HOUR"
```
Look for the primary-key condition and granules selected vs total.
**Follow-up:** "Filter only by `user_id`?" → `ts` prefix unused, no pruning → fix with a projection
or skip index (below).

### [I] Q: PARTITION BY vs ORDER BY — what's the difference?
**Talking points:**
- Partitioning splits data into independent parts on disk (`PARTITION BY _dt` in the `raw.*` batch
  tables). It enables *partition pruning* and cheap whole-partition operations (`DROP PARTITION`,
  `TTL`, `ATTACH`/`DETACH`). Keep partition count modest (date is typical; don't partition by a
  high-cardinality key).
- ORDER BY sorts *within* a partition and builds the index. Different jobs.
**Show it in the lab:** the batch loader replaces a day idempotently by dropping its partition:
```bash
CH "SELECT partition, rows FROM system.parts WHERE database='raw' AND table='orders' AND active"
```
That `_dt` partition is exactly what [dags/shop_batch_pipeline.py](../../dags/shop_batch_pipeline.py) `ALTER TABLE raw.orders DROP PARTITION '<ds>'`-es before each load.
**Follow-up:** "Why not `PARTITION BY user_id`?" → thousands of tiny parts, merge pressure, slow
inserts. Partition coarse, order fine.

### [A] Q: A query filters on a non-ORDER-BY column and scans everything. Options?
**Talking points:**
- **Skip index** (data-skipping): `minmax`, `set`, `bloom_filter`, `ngrambf` — store per-granule
  metadata so granules that can't match are skipped.
- **Projection**: a second physical ordering/aggregation of the same table, chosen automatically.
- Or reshape the primary `ORDER BY`/add the column to it.
**Show it in the lab (build-it snippet):** add a bloom filter on `page`, then prove it's used.
```sql
-- in CHSH
ALTER TABLE raw.events ADD INDEX IF NOT EXISTS idx_page page TYPE bloom_filter GRANULARITY 4;
ALTER TABLE raw.events MATERIALIZE INDEX idx_page;
EXPLAIN indexes=1 SELECT count() FROM raw.events WHERE page='/checkout';
```
**Follow-up:** "bloom_filter vs minmax?" → minmax is great for sorted/correlated columns (ranges);
bloom_filter for high-cardinality equality (`=`, `IN`).

### [A] Q: What's a projection and when beats a materialized view?
**Talking points:**
- A projection lives *inside* the table and is maintained transactionally with inserts; the
  optimizer picks it. Great for "same data, different sort/aggregation" (e.g. order-by-user).
- A materialized view is a separate table populated by an INSERT trigger (what feeds `raw.events`).
  Use MV for transforming/routing into a different table/engine; projection for query acceleration
  of the same table.
**Show it in the lab (build-it snippet):**
```sql
-- in CHSH
ALTER TABLE marts.fct_orders ADD PROJECTION p_city (SELECT city, sum(amount) GROUP BY city);
ALTER TABLE marts.fct_orders MATERIALIZE PROJECTION p_city;
EXPLAIN indexes=1 SELECT city, sum(amount) FROM marts.fct_orders GROUP BY city;
```
**Follow-up:** cost? extra storage + write amplification per insert. Don't over-project.

### [I] Q: What is `LowCardinality` and why is `event_type` declared that way?
**Talking points:**
- Dictionary-encodes a column (stores ints + a dictionary). Big win for low-distinct-count strings
  (status, event_type, country): smaller, faster GROUP BY/filter.
- Hurts for high-cardinality columns (the dict grows) — don't wrap `event_id`/UUIDs.
**Show it in the lab:** `raw.events.event_type` is `LowCardinality(String)`.
```bash
CH "SELECT event_type, count() FROM raw.events GROUP BY event_type ORDER BY 2 DESC"
```
**Follow-up:** "compression on event_id?" → it's a random UUID String → poor compression; that's why
`raw.events` is ~44 B/row. Store as `UUID` type to halve it.

### [I] Q: Window functions in ClickHouse — show a running total.
**Talking points:** `OVER (PARTITION BY … ORDER BY … ROWS/RANGE …)`; also CH-native `runningAccumulate`,
`neighbor`, `lagInFrame`/`leadInFrame`.
**Show it in the lab:**
```bash
CH "SELECT order_date, revenue, sum(revenue) OVER (ORDER BY order_date) AS cum_revenue FROM marts.daily_revenue ORDER BY order_date LIMIT 10"
```
**Follow-up:** "7-day moving average?" → `avg(revenue) OVER (ORDER BY order_date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)`.

---

## Engine selection (the MergeTree family)

### [I] Q: Walk through MergeTree vs Replacing/Aggregating/Summing.
**Talking points:**
- **MergeTree** — base; append-only, keeps everything (the lab's `raw.*`, `marts.*`).
- **ReplacingMergeTree(ver)** — collapses rows with the same sort key on merge, keeping max `ver`.
  Dedup / latest-state. Merges are async → use `FINAL` or aggregate to read deduped.
- **AggregatingMergeTree** — stores aggregate *states* (`...State()`), merged on compaction; read
  with `...Merge()`. Pre-aggregation at scale.
- **SummingMergeTree** — sums numeric columns by sort key on merge. Simple additive rollups.
**Show it in the lab (build-it snippet):** prove ReplacingMergeTree dedup.
```sql
-- in CHSH
CREATE TABLE raw.cust_latest (id Int64, city String, ver UInt64) ENGINE=ReplacingMergeTree(ver) ORDER BY id;
INSERT INTO raw.cust_latest VALUES (1,'Moscow',1),(1,'Kazan',2);
SELECT * FROM raw.cust_latest FINAL;          -- one row: Kazan (max ver)
```
**Follow-up:** "Why did I see two rows before FINAL?" → merges are background/async; `FINAL` (or
`argMax(city, ver)`) forces the collapse at query time.

### [A] Q: AggregatingMergeTree with a materialized view — sketch it.
**Talking points:** MV writes `...State()` aggregates into an AggregatingMergeTree; queries call
`...Merge()`. The view stays tiny and reads are O(groups), not O(rows).
**Show it in the lab (build-it snippet):**
```sql
-- in CHSH
CREATE TABLE marts.events_by_type (event_type LowCardinality(String), c AggregateFunction(count))
  ENGINE=AggregatingMergeTree ORDER BY event_type;
CREATE MATERIALIZED VIEW marts.mv_events_by_type TO marts.events_by_type AS
  SELECT event_type, countState() AS c FROM raw.events GROUP BY event_type;
-- backfill existing rows once, then it stays live:
INSERT INTO marts.events_by_type SELECT event_type, countState() FROM raw.events GROUP BY event_type;
SELECT event_type, countMerge(c) FROM marts.events_by_type GROUP BY event_type;
```
**Follow-up:** contrast with `marts.daily_revenue`, which is a plain dbt-built MergeTree recomputed
each run — fine for small data, but the MV approach updates incrementally on insert.

---

## Dimensional modeling & SCD

### [B] Q: Star schema — what is `fct_orders` and what are its dimensions?
**Talking points:** a fact table at order grain (one row per order) with measures (`amount`,
`item_count`, `items_total`) and foreign keys to dimensions (customer, date, status). Dimensions are
descriptive (`city`, calendar attributes). Star = denormalized for fast joins/aggregations.
**Show it in the lab:** [dbt/shop_dwh/models/marts/fct_orders.sql](../../dbt/shop_dwh/models/marts/fct_orders.sql).
```bash
CH "DESCRIBE marts.fct_orders"
CH "SELECT city, count() orders, round(sum(amount)) rev FROM marts.fct_orders GROUP BY city ORDER BY rev DESC"
```
**Follow-up:** "grain of `daily_revenue`?" → one row per `order_date` (a daily aggregate / periodic
snapshot), coarser than `fct_orders`.

### [I] Q: SCD Type 1 vs Type 2 — and which does the lab use?
**Talking points:**
- **Type 1**: overwrite — no history (current `stg_customers` just reflects latest `raw.customers`).
- **Type 2**: new row per change with `valid_from`/`valid_to`/`is_current` — preserves history; the
  fact joins on the version valid at order time.
- Also T3 (previous-value column), T4/T6 (history tables/hybrids).
**Show it in the lab (build-it snippet):** dbt snapshot turns `customers` into SCD2.
```sql
-- snapshots/snap_customers.sql in the dbt project
{% snapshot snap_customers %}
{{ config(target_schema='marts', unique_key='id', strategy='check', check_cols=['city']) }}
select id, name, city from {{ source('raw','customers') }}
{% endsnapshot %}
```
```bash
DBT snapshot                       # builds marts.snap_customers with dbt_valid_from/to
CH "SELECT id, city, dbt_valid_from, dbt_valid_to FROM marts.snap_customers ORDER BY id LIMIT 5"
```
**Follow-up:** "How does the fact pick the right version?" → join on key AND
`order_ts BETWEEN dbt_valid_from AND coalesce(dbt_valid_to,'2999-01-01')`.

### [I] Q: Surrogate keys vs natural keys?
**Talking points:** natural keys come from the source (`customers.id`); surrogate keys are
warehouse-generated (hash/sequence), stable across source changes and required for SCD2 (the same
natural key has many versions, each needing a unique row id). `dbt_utils.generate_surrogate_key`.
**Show it in the lab (build-it snippet):**
```sql
-- in a dbt model
select cityHash64(toString(id), toString(dbt_valid_from)) as customer_sk, * from {{ ref('snap_customers') }}
```
**Follow-up:** "why not autoincrement?" → not deterministic/parallel-safe across distributed loads;
hashes are.

---

## Incremental vs full load

### [I] Q: The batch DAG reloads everything daily. How is that idempotent, and when would you go incremental?
**Talking points:**
- Idempotency here = **partition replace**: each run writes Parquet to `dt=<ds>` and the loader does
  `ALTER TABLE raw.t DROP PARTITION '<ds>'` then re-inserts — re-running a day yields the same rows,
  never duplicates.
- Full snapshot is fine at lab scale; at real scale you load only new/changed rows (incremental) by
  a watermark (`max(updated_at)`) or CDC, to bound cost.
**Show it in the lab:** [dags/shop_batch_pipeline.py](../../dags/shop_batch_pipeline.py) `load_raw_to_clickhouse`. Prove idempotency:
```bash
AF dags test shop_batch_pipeline 2026-06-11   # run twice
CH "SELECT count() FROM raw.orders"           # stays 10000, not 20000
```
**Follow-up:** "the `use_hive_partitioning=0` setting?" → the `dt=<ds>` path looks like a Hive
partition column to `s3()`; disabling it stops CH inventing a `dt` column so `SELECT *` matches the
table schema.

### [I] Q: Make a dbt model incremental.
**Talking points:** `materialized='incremental'` + `unique_key`; on incremental runs dbt only
processes new rows guarded by `{% if is_incremental() %} where ts > (select max(ts) from {{ this }}) {% endif %}`;
`--full-refresh` rebuilds. In dbt-clickhouse the default incremental strategy uses a temp table +
insert (or `delete+insert`/`append`).
**Show it in the lab (build-it snippet):** new model `models/marts/events_daily.sql`:
```sql
{{ config(materialized='incremental', engine='MergeTree()', order_by='d', unique_key='d') }}
select toDate(ts) as d, count() as events from {{ source('raw','events') }}
{% if is_incremental() %} where toDate(ts) >= (select max(d) from {{ this }}) {% endif %}
group by d
```
```bash
DBT run --select events_daily          # first build
DBT run --select events_daily          # incremental — only recent day(s)
```
**Follow-up:** "late-arriving data past the watermark?" → lookback window (`max(d) - 3`) or periodic
`--full-refresh`.

---

## File formats

### [B] Q: Why Parquet for the MinIO landing zone?
**Talking points:** columnar (column pruning + per-column compression + encodings), self-describing
schema, predicate/stat pushdown via row-group min/max, splittable. Beats CSV/JSON for analytics
scans. ORC is similar (Hive world); Avro is row-oriented — better for streaming/record-by-record
and schema evolution.
**Show it in the lab:** the extract writes `raw/shop/<table>/dt=<ds>/data.parquet`.
```bash
CH "SELECT count() FROM s3('http://minio.data-platform.svc:9000/raw/shop/orders/dt=2026-06-11/data.parquet','minioadmin','minioadmin','Parquet')"
```
**Follow-up:** "Parquet vs ORC vs Avro one-liner?" → Parquet/ORC columnar for OLAP scans; Avro row
for write-heavy streaming + strong schema evolution.

### [I] Q: Why did the extract force microsecond timestamps?
**Talking points:** pandas writes nanosecond Parquet timestamps by default; **Spark 3.5 can't read
`INT64 TIMESTAMP(NANOS)`** (and some engines choke). Coercing to micros makes the file portable
across ClickHouse, Spark, and Trino. A classic "interoperability" war story.
**Show it in the lab:** `df.to_parquet(buf, coerce_timestamps="us", allow_truncated_timestamps=True)`
in [dags/shop_batch_pipeline.py](../../dags/shop_batch_pipeline.py); the Spark job
([04](04-distributed-and-lakehouse.md)) reads the same files cleanly because of it.
**Follow-up:** "how would you catch this earlier?" → a schema/contract check on the landing files, or
reading them back with each downstream engine in CI.

### [I] Q: Partition layout on object storage — why `dt=<value>/`?
**Talking points:** Hive-style `key=value/` directories let engines prune by partition without
reading files, and make idempotent overwrite trivial (replace one prefix). Watch for *small files*
(too many tiny Parquet files kill scan performance — compact them).
**Show it in the lab:**
```bash
# via the mc helper / console: raw/shop/orders/dt=2026-06-11/data.parquet
```
**Follow-up:** "small-file problem fix?" → compaction jobs, bigger batch windows, or a table format
(Iceberg) that manages file sizes/manifests.

---

## Data quality

### [B] Q: How do you test data in this pipeline?
**Talking points:** dbt generic tests declared in `schema.yml` run as SQL that must return 0 rows:
`not_null` + `unique` on keys, `accepted_values` on `status`. `dbt build` runs models **and** tests;
a failing test fails the run.
**Show it in the lab:** [dbt/shop_dwh/models/staging/schema.yml](../../dbt/shop_dwh/models/staging/schema.yml).
```bash
DBT test                 # all generic tests
DBT test --select stg_orders
```
**Follow-up:** "test only sees built models?" → yes; that's why `dbt build` interleaves model+test,
so a bad model can't silently feed downstream.

### [I] Q: Sources, freshness, and custom tests?
**Talking points:** `sources.yml` declares upstream tables (`raw.*`) so models `ref`/`source` them
and you get lineage; `freshness:` (loaded_at_field + warn/error after) catches stale upstreams;
custom generic tests are macros in `tests/generic/` returning offending rows.
**Show it in the lab (build-it snippet):** a no-negative-amounts test.
```sql
-- tests/generic/test_non_negative.sql
{% test non_negative(model, column_name) %}
select * from {{ model }} where {{ column_name }} < 0
{% endtest %}
```
then attach `tests: [non_negative]` to `fct_orders.amount` in `schema.yml` and `DBT test`.
**Follow-up:** "dbt tests vs Great Expectations?" → dbt tests are SQL-native, in-pipeline, versioned
with models; GE is a richer standalone framework (profiling, expectation suites, data docs) you'd
wire as an Airflow task before/after load. `dbt-expectations` ports many GE checks into dbt.
