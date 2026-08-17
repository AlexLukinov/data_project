# 03 — Orchestration (Airflow)

Idempotency & backfills · operators/TaskFlow/XComs · branching & sensors · dynamic task mapping ·
datasets · retries/SLAs/pools · executors. Helpers (`AF`, `CH`) are in [README.md](README.md). The
DAG under test is [dags/shop_batch_pipeline.py](../../dags/shop_batch_pipeline.py) (`make core && make sync-dags`).

---

## Core concepts

### [B] Q: DAG, task, operator, task instance, run — define them on the lab DAG.
**Talking points:** the **DAG** `shop_batch_pipeline` is the graph; each node is a **task**
(`extract_to_minio`, `load_raw_to_clickhouse`, `dbt_build`) built from an **operator**
(PythonOperator/BashOperator); a **DAG run** is one execution for a logical date; a **task instance**
is one task in one run (with its own state/retries/logs).
**Show it in the lab:**
```bash
AF dags list
AF tasks list shop_batch_pipeline
AF dags state shop_batch_pipeline 2026-06-11
```
**Follow-up:** "operator vs task?" → operator is the *class/template*; task is its *instantiation*
in a DAG; task instance is that task *for a specific run*.

### [I] Q: `schedule`, `start_date`, `catchup`, and what `ds` means.
**Talking points:** the DAG is `schedule="@daily"`, `catchup=False`, `start_date=2026-01-01`.
`catchup=False` means no backfill of all missed intervals on unpause. `ds` is the logical date the
run represents — used to template the partition path. Each scheduled run covers a data interval; the
loader keys MinIO/ClickHouse on `{{ ds }}`.
**Show it in the lab:** `extract_to_minio(ds: str, ...)` and `dt={ds}` in [dags/shop_batch_pipeline.py](../../dags/shop_batch_pipeline.py).
**Follow-up:** "`catchup=True` from Jan 1?" → it would try to run every day since the start_date —
careful with that on first unpause.

---

## Idempotency & backfills

### [I] Q: Why is this DAG safe to re-run, and how do you backfill a date range?
**Talking points:** idempotency = same inputs → same end state, no duplicates. The loader does
`ALTER TABLE raw.t DROP PARTITION '<ds>'` then re-inserts that day from `s3()` → re-running a date is
a clean replace. Backfill = run a contiguous range; because each day is partition-scoped, backfills
don't double-count.
**Show it in the lab:**
```bash
AF dags test shop_batch_pipeline 2026-06-11   # run twice
CH "SELECT count() FROM raw.orders"           # 10000 both times
# range backfill:
AF dags backfill -s 2026-06-10 -e 2026-06-11 shop_batch_pipeline
```
**Follow-up:** "append instead of partition-replace and re-run?" → duplicates; you'd need a
ReplacingMergeTree/dedupe or a delete-by-key step. Partitioning makes replace trivial.

### [A] Q: `dags test` vs `dags trigger`/`backfill` — why does the smoke use `test`?
**Talking points:** `dags test` runs the DAG **synchronously in-process**, no scheduler/executor, no
DB run record needed — perfect for a deterministic smoke with a clear exit code. `trigger` creates a
real run the scheduler executes via the executor (LocalExecutor here); `backfill` runs a range.
**Show it in the lab:** [scripts/smoke/phase4_airflow.sh](../../scripts/smoke/phase4_airflow.sh) uses `airflow dags test …`.
**Follow-up:** "gotcha with `dags test`?" → it bypasses some scheduler behaviors (pools, some
inter-run deps), so it validates task logic, not scheduling.

---

## Operators, TaskFlow, XComs

### [I] Q: PythonOperator vs TaskFlow — and how do tasks pass data?
**Talking points:** classic operators (this DAG) wire dependencies with `>>` and pass small values
via **XCom** (pushed return values / `ti.xcom_push`). TaskFlow (`@task`) makes Python functions into
tasks with implicit XCom passing and cleaner deps. XCom is for *small* metadata (ids, counts, paths)
— **not** data; big data goes to MinIO/CH and you pass the path.
**Show it in the lab:** the DAG passes nothing via XCom — it coordinates through *table/object state*
(extract writes Parquet, load reads it). That's the scalable pattern.
**Follow-up:** "why not XCom the dataframe?" → XCom is backed by the metadata DB; large payloads bloat
it. Pass a pointer (s3 path), store the bytes in object storage.

### [I] Q: Where do task connections/credentials come from here?
**Talking points:** injected as env on the scheduler: `AIRFLOW_CONN_SHOP_PG` becomes conn id
`shop_pg` (PostgresHook), plus `MINIO_*` / `CLICKHOUSE_*` plain env the tasks read. Connections via
`AIRFLOW_CONN_*` env are 12-factor-friendly and keep secrets out of code.
**Show it in the lab:** [infra/airflow/values.yaml](../../infra/airflow/values.yaml) `extraEnv`.
```bash
AF connections get shop_pg
```
**Follow-up:** "rotate a DB password?" → update the secret/env and restart; with a real secrets
backend (Vault/K8s secrets via the secrets backend) no restart.

---

## Branching, sensors, dynamic mapping

### [I] Q: Add a sensor that waits for the day's Parquet before loading.
**Talking points:** sensors poll for a condition (`poke`/`reschedule` mode — use `reschedule` to free
the worker slot between pokes). An `S3KeySensor`/custom sensor gates `load_raw_to_clickhouse` on the
object existing, decoupling extract from load.
**Show it in the lab (build-it snippet):**
```python
from airflow.providers.amazon.aws.sensors.s3 import S3KeySensor
wait = S3KeySensor(task_id="wait_orders", bucket_name="raw",
                   bucket_key="shop/orders/dt={{ ds }}/data.parquet",
                   aws_conn_id="minio", mode="reschedule", poke_interval=15, timeout=600)
extract >> wait >> load >> dbt_build
```
**Follow-up:** "`poke` vs `reschedule`?" → poke holds a worker slot the whole time (cheap, short
waits); reschedule releases it between checks (long waits, avoids starving the pool).

### [I] Q: Branching and `trigger_rule` — run dbt only if load changed something.
**Talking points:** `BranchPythonOperator`/`@task.branch` returns the task id(s) to follow;
downstream `trigger_rule` (`all_success` default, `none_failed_min_one_success`, `all_done`)
controls join behavior so skipped branches don't wrongly skip the merge.
**Show it in the lab (build-it snippet):**
```python
@task.branch
def gate(ds=None):
    return "dbt_build" if rows_loaded(ds) > 0 else "skip"
```
**Follow-up:** "downstream after a skipped branch is itself skipped — fix?" → set its
`trigger_rule="none_failed_min_one_success"`.

### [A] Q: The DAG hardcodes 3 tables. Make it scale with dynamic task mapping.
**Talking points:** `.expand()` (dynamic task mapping) generates one task instance per item at
runtime — one extract+load per table — giving per-table parallelism, retries, and logs instead of a
loop inside one task.
**Show it in the lab (build-it snippet):**
```python
@task
def extract_one(table: str, ds=None): ...   # the per-table body of extract_to_minio
extract_one.expand(table=["customers", "orders", "order_items"])
```
**Follow-up:** "loop-in-one-task vs expand?" → the loop is one TI (all-or-nothing, one log); expand
isolates failures/retries per table and parallelizes.

---

## Datasets, retries, SLAs, pools

### [I] Q: Data-aware scheduling (Datasets) — what problem does it solve here?
**Talking points:** instead of time-cron coupling, a producer DAG declares it *updates* a Dataset and
a consumer DAG is scheduled *on* that Dataset — so "rebuild marts when raw is refreshed" triggers on
data availability, not a guessed time. Decouples pipelines and removes brittle cross-DAG sensors.
**Show it in the lab (build-it snippet):**
```python
raw_orders = Dataset("clickhouse://raw/orders")
# producer task: outlets=[raw_orders]; consumer DAG: schedule=[raw_orders]
```
**Follow-up:** "vs an ExternalTaskSensor?" → datasets are push/event-driven and declarative; sensors
poll and couple DAGs by name+timing.

### [I] Q: Retries, SLAs, and failure alerts — what would you set on these tasks?
**Talking points:** `retries`, `retry_delay`, `retry_exponential_backoff` per task/`default_args`;
`execution_timeout` to kill hangs; `sla` + `sla_miss_callback` for lateness; `on_failure_callback`
for alerting (Slack/email). Make retries safe = require idempotency (which this DAG has).
**Show it in the lab (build-it snippet):**
```python
default_args = {"retries": 2, "retry_delay": timedelta(minutes=1),
                "execution_timeout": timedelta(minutes=15)}
```
**Follow-up:** "retry a non-idempotent task?" → duplicates/corruption; fix idempotency *before*
enabling retries.

### [A] Q: How do you stop one heavy DAG from starving the cluster?
**Talking points:** **pools** cap concurrent slots for a set of tasks; `max_active_runs` (per DAG),
`max_active_tasks`/`concurrency`, and `priority_weight` shape scheduling. On LocalExecutor everything
shares the scheduler box, so pools matter even more.
**Show it in the lab:**
```bash
AF pools list
```
**Follow-up:** "LocalExecutor parallelism cap?" → the `parallelism`/`max_active_tasks_per_dag` config
+ the single node's CPU; that's the motivation for KubernetesExecutor (next).

---

## Executors

### [A] Q: LocalExecutor vs KubernetesExecutor — what changes and why switch?
**Talking points:**
- **LocalExecutor** (the lab): scheduler runs tasks as subprocesses on one node — simple, no Celery/
  Redis, but bounded by that node and no per-task isolation.
- **KubernetesExecutor**: each task runs in its own pod — per-task resources/images, horizontal
  scale, isolation, clean failure boundaries; cost is pod-startup latency and k8s plumbing
  (pod templates, service account, DAG distribution to pods).
- What changes concretely: chart `executor: KubernetesExecutor`, a pod template / `executor_config`
  per task for resources, DAG delivery (gitSync or baked image) since there are no long-lived workers.
**Show it in the lab:** today [infra/airflow/values.yaml](../../infra/airflow/values.yaml) sets `executor: LocalExecutor` and DAGs ride a PVC via `make sync-dags`. The migration is the documented advanced exercise in [README.md](../../README.md).
**Follow-up:** "CeleryExecutor vs Kubernetes?" → Celery = warm worker pool (low latency, fixed
capacity, needs a broker like Redis); Kubernetes = pod-per-task (elastic, isolated, cold-start).
The lab deliberately avoids Celery/Redis for footprint.

### [I] Q: Where does Airflow keep its own state, and why a separate Postgres?
**Talking points:** the metadata DB stores DAG/run/task state, XComs, connections, etc. The lab runs
a dedicated CloudNativePG `airflow-meta` cluster (the chart's bundled Bitnami Postgres is disabled,
since Bitnami's free images were deprecated) — a real-world "operator-managed metadata DB" decision.
**Show it in the lab:** [infra/airflow/airflow-meta.yaml](../../infra/airflow/airflow-meta.yaml) + `postgresql.enabled: false` in values.
**Follow-up:** "why not SQLite?" → SQLite only supports SequentialExecutor (one task at a time) — fine
for `dags test`, useless for parallel scheduling.
