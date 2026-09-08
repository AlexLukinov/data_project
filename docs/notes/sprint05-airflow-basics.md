# Sprint 5 — Airflow from zero (architecture, first DAG, idempotency)

Consolidation of Sprint 5. Review sheet: be able to reproduce the **bold** rules from memory.

Grounded in this lab: Airflow 2.11.1, LocalExecutor, metadata DB = CNPG `airflow-meta`,
DAGs on a PVC synced by `make sync-dags`. First hand-written DAG: [[../../dags/sprint05_hello.py]].

---

## 1. What Airflow is for

You already had `etl/pg_to_clickhouse.py` (Sprint 4) and ran it by hand. Airflow answers the
questions a bare script can't: who runs it at 03:00, who retries it when it fails, who enforces
that it runs *after* something else, where are the logs, and how do you re-run **only** last
Tuesday. `cron` answers the first one only.

**Airflow does not process data.** Your Python does. Airflow decides when it runs, in what order,
retries it, and records what happened.

## 2. Vocabulary — description vs real event

The distinction that unblocks everything else:

| Word | Analogy | Description or event? |
|---|---|---|
| **DAG** | the recipe on paper | description |
| **Task** | step 3, "bake 20 min" | description |
| **Operator** | the *kind* of step (`PythonOperator`, `BashOperator`) — a template | description |
| **DAG Run** | Tuesday, when you actually cooked | **event** |
| **Task Instance** | the baking you actually did on Tuesday | **event** |

> **A recipe cannot fail.** States (`success`/`failed`/`queued`) never belong to a DAG or a Task —
> only to a **DAG Run** or a **Task Instance**. "Clearing a task" means discarding one Task
> Instance's result so it re-executes; the DAG file is untouched.

DAG = **D**irected **A**cyclic **G**raph: boxes + one-way arrows, no loops (a loop would mean two
tasks waiting on each other forever). `a >> b` draws the arrow.

## 3. The four programs

**The metadata DB is the system** (`airflow-meta`, deliberately separate from the business
`shop-db`). Every DAG run, task instance, state, and connection is a row there. The other three
programs **never talk to each other** — they only read and write this DB. Most "why is it stuck"
questions reduce to: who was supposed to write the next row, and why didn't they?

| Program | Job | Reads your `.py`? |
|---|---|---|
| **Scheduler** (`airflow-scheduler-0`) | (a) parse files → write structure to DB; (b) every 5s, create due DAG Runs and queue ready tasks | ✅ every ~30s |
| **Executor** (LocalExecutor, *inside* the scheduler) | actually runs the task | ✅ once per task attempt |
| **Webserver** | draws the UI; buttons just write rows | ❌ **not even mounted** |

**LocalExecutor runs tasks as child processes inside the scheduler pod** — no worker pods exist.
So task memory comes out of the scheduler's limit, and a fat task OOM-kills the whole orchestrator,
not just itself. That is the tradeoff vs Celery/Kubernetes executors, which isolate tasks in
separate processes/pods.

## 4. Why the DAG file is parsed twice (and repeatedly)

A DAG file holds two kinds of information, and **only one of them fits in a database**:

- **structure** ("2 tasks, `hello` before `report_run_context`, daily") → JSON, stored in the
  `serialized_dag` table;
- **code** (the actual Python function object) → cannot be serialized.

Proof, from `serialized_dag` for `sprint05_hello`: the `BashOperator` keeps its `bash_command`
(a string), while the `PythonOperator` carries **no reference to the callable at all**.

> **The scheduler parses to learn what to schedule; the task subprocess imports to get the code to
> run.** The scheduler never executes your function, so it never needs it.

Re-parsing every `min_file_process_interval` (30s here) exists because **Airflow has no reload
button and no file-watcher** — polling is the only way it learns you edited a file. Verified: after
`make sync-dags`, a new task appeared in the DB with no restart and no `reserialize`.
`min_file_process_interval` is a *floor per file*, not a fixed delay: 3 tiny files updated in
seconds; 500 files would take much longer (the real reason edits "take forever to appear").

`dag_dir_list_interval` (300s) is the different one: how often the folder is rescanned for
**new/removed files**. A brand-new DAG can therefore lag by minutes; `airflow dags reserialize`
forces it.

> **Module-level code runs at parse time AND once more per task attempt** (the task subprocess
> re-imports the module to reach the function). So a `pd.read_sql()` at the top of a DAG file runs
> every 30s per file forever, even while paused. **The top level of a DAG file may only define
> things** — imports, constants, functions, the DAG structure. Every action lives inside a callable.

## 5. Airflow's model of time

Airflow is built for batch: not "do a thing now" but **"process yesterday's data."** It thinks in
**periods**, not moments. `@daily` chops the calendar into intervals; one DAG Run owns one interval.

> **The run for a period starts at the END of that period.** The run responsible for Aug 26 starts
> just after midnight on Aug 27 — you can't process a day until the day is over.

| Name | For the Aug-26 run | Meaning |
|---|---|---|
| `data_interval_start` | `2026-08-26 00:00` | start of the owned period |
| `data_interval_end` | `2026-08-27 00:00` | end of it |
| `logical_date` | `2026-08-26 00:00` | the run's identity (old name: `execution_date` — **not** the execution time) |
| `ds` | `"2026-08-26"` | `logical_date` as `YYYY-MM-DD` |

For **scheduled** runs `logical_date == data_interval_start`, which is why the difference stays
invisible. **On a manual trigger, `logical_date` becomes "now"** and `ds` drifts off the interval.
Observed in this lab: triggering at 05:26 on Aug 27 gave `ds = 2026-08-27` while
`data_interval = [2026-08-26, 2026-08-27)`.

> **Window queries on `data_interval_start`/`data_interval_end`, never on `ds`.** They agree on a
> schedule and disagree on a manual run — i.e. exactly when someone is re-running a failed day and
> can least afford a silent one-day shift. `WHERE order_date = '{{ ds }}'` fails this way silently.

`catchup=False` matters for the same reason: with `start_date` a month back, `catchup=True` would
launch every missed interval at once the moment you unpause.

## 6. Idempotency

**Running it twice leaves the world as it was after running it once.** `x = 5` is idempotent;
`x = x + 1` is not.

**Airflow will run your task more than once — this is certain, not possible.** Three normal
features guarantee it: **retries** (transient failure), **clear** (you re-run it from the UI), and
**backfill** (re-run 90 days after a schema change). All three re-execute code that already
partly ran.

A plain `INSERT` is never idempotent: succeed → 1 row; crash-and-retry → 2 rows; clear-and-re-run
→ 3 rows. Nothing errors, no alert fires, the dashboard is just wrong.

Three fixes:

1. **Delete the window, then write it** — `ALTER TABLE … DROP PARTITION '<interval>'` before the
   insert, so a re-run replaces its own output. See [[../../dags/shop_batch_pipeline.py]].
2. **Let the engine dedupe** — `ReplacingMergeTree(version) ORDER BY id`, the Sprint 4 loader. A
   re-run inserts newer-versioned copies and the newest wins. Note this only dedupes **within a
   partition** — see the partition-key trap in [[month-01-takeaways]].
3. **Never read the clock inside a task** — `today()` makes a December re-run of August write
   December's data into August's row. Derive the window from `data_interval_start`/`end`, which are
   fixed forever for a given run.

> **One rule:** a DAG is idempotent when re-running any run for any interval produces exactly the
> result that interval should have, regardless of what ran before. §5 and §6 are the same lesson:
> **a run must be a pure function of its data interval.**

## 7. Lab incident (worth remembering)

The webserver had been OOMKilled **92 times**. Cause: `webserver workers = 4` gunicorn workers,
each holding a full Airflow app (~500Mi), against a 1Gi limit. Fixed in
[[../../infra/airflow/values.yaml]]: workers → 2, webserver limit → 1536Mi, scheduler limit → 2Gi
(LocalExecutor runs tasks in there). Result: 1 restart in 8 days, down from 92.

Also: the scheduler had crept from ~620Mi to 931Mi over 14 days of uptime. **A long-running Airflow
scheduler is not the process you deployed** — judge headroom on a freshly restarted one.

Node has **20Gi**, not the 12288Mi recorded in `CLAUDE.md` — drift worth correcting.

## What I can now do

Explain what each Airflow process does and where a task physically runs; write a multi-task DAG with
dependencies and get it green; explain why a DAG file is parsed repeatedly and what must never live
at module level; read `logical_date` vs `data_interval` correctly and say why `ds` is unsafe for
windowing; and state what makes a DAG idempotent plus three concrete patterns for getting there.

## Related
- Sprint 4's manual EL script is the thing Month 2 turns into a scheduled DAG — [[month-01-takeaways]] §4.
- Sprint 6 adds sensors, hooks and XCom; Sprint 7 rebuilds shop-db → ClickHouse as a production DAG.
