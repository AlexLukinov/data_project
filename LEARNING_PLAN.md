# LEARNING_PLAN — Data Engineering (RU market stack), 6 months

> Source of truth for progress, read by Claude Code (see `CLAUDE.md` in the repo root).
> Update the marker below and check off `- [x]` items as you go — together with Claude Code, once a result is confirmed working.

**Current sprint: 2**

Check items off as you go (`- [x]`). Each sprint = 1 week, ~15-20h.

## How spaced repetition is built in (Ebbinghaus curve)

Two layers:

- **Anki (daily, 10-15 min)** — at the end of each sprint, make 8-12 cards covering the week (syntax, commands, "why X breaks"), then let the algorithm handle re-scheduling along the forgetting curve. Every sprint below has an `Anki cards` item.
- **Recap/Review (built into the checklist)** — recap of the previous sprint (~7 days) at the start of every week; cumulative review of past months (~30 days) at the start of sprints 5, 9, 13, 17, 21; a big Tier 1 review (~90 days) in sprint 13; a final cross-stack review starting from the oldest material — in sprints 21-24.

---

## MONTH 1 — ClickHouse fundamentals + OLAP SQL

### Sprint 1 (Week 1) — table engines
**Practice**
- [x] Confirm access to ClickHouse in the lab
- [x] Create tables with MergeTree, ReplacingMergeTree, AggregatingMergeTree engines
- [x] Load test data from the event generator
- [x] Write a short note on the practical difference between the engines

**Reading**
- [x] ClickHouse docs: Table Engines (MergeTree family)
- [x] Kleppmann, *Designing Data-Intensive Applications* (DDIA), ch. 1

**Repetition**
- [x] Anki cards for the week (8-12)

### Sprint 2 (Week 2) — partitioning, EXPLAIN
**Recap:** 10 min — explain the engine differences from Sprint 1 from memory, then check your notes

- [x] Set up date-based partitioning on a test table
- [x] Compare query performance with different ORDER BY keys
- [x] Read through EXPLAIN / EXPLAIN PIPELINE output in ClickHouse
- [x] Compare the plan for the same query in ClickHouse vs Postgres (shop-db)

**Reading**
- [ ] ClickHouse docs: Primary keys and indexes, EXPLAIN
- [ ] DDIA, ch. 3

**Repetition**
- [ ] Daily Anki review
- [x] Anki cards for the week

### Sprint 3 (Week 3) — materialized views
**Recap:** 10 min — write an EXPLAIN query from memory and explain the plan, no docs

- [ ] Create a materialized view with an aggregation
- [ ] Use -State/-Merge combinators (e.g. uniqState/uniqMerge)
- [ ] Build an incremental-aggregation example on an event stream

**Reading**
- [ ] ClickHouse docs: Materialized Views, AggregatingMergeTree
- [ ] DDIA, ch. 5

**Repetition**
- [ ] Daily Anki review
- [ ] Anki cards for the week

### Sprint 4 (Week 4) — Month 1 checkpoint
**Recap:** 10 min — sketch the structure of a materialized view from memory

- [ ] Manually (no Airflow yet) move data shop-db → ClickHouse with a single Python script
- [ ] Solve 10-15 interview-style SQL problems on window functions/CTEs in ClickHouse dialect
- [ ] Short README: takeaways from month 1

**Reading**
- [ ] DDIA, ch. 6

**Repetition**
- [ ] Daily Anki review
- [ ] Anki cards for the week (put them in a separate "ClickHouse" deck for easy future review)

---

## MONTH 2 — Airflow + Python ETL

### Sprint 5 (Week 5) — Airflow architecture
**Month 1 review (~30 days in, forgetting risk kicks in):**
- [ ] No docs: write a CREATE TABLE with ReplacingMergeTree + a sensible ORDER BY
- [ ] Explain MergeTree vs AggregatingMergeTree in your own words
- [ ] Run through the entire "ClickHouse" Anki deck

**Practice**
- [ ] Study the scheduler / executor (LocalExecutor) / webserver architecture
- [ ] Write your first DAG (hello world + one Python task)
- [ ] Put DAG idempotency into your own words

**Reading**
- [ ] Airflow docs: Concepts (DAGs, Tasks, Operators)
- [ ] *Fundamentals of Data Engineering* — start the orchestration chapter

**Repetition**
- [ ] Daily Anki review
- [ ] Anki cards for the week

### Sprint 6 (Week 6) — sensors, hooks, XCom
**Recap:** 10 min — write the structure of a one-task DAG from memory

- [ ] Add a sensor (waiting on a file/data)
- [ ] Connect to Postgres/ClickHouse via hooks
- [ ] Configure retries and pass data through XCom
- [ ] Backfill a test DAG

**Reading**
- [ ] *Data Pipelines with Apache Airflow*, ch. 1-3

**Repetition**
- [ ] Daily Anki review
- [ ] Anki cards for the week

### Sprint 7 (Week 7) — production DAG
**Recap:** 10 min — explain the difference between hook / sensor / XCom without looking anything up

- [ ] DAG: shop-db → ClickHouse on a schedule
- [ ] Error handling + basic alerting
- [ ] Verify a re-run doesn't duplicate data

**Reading**
- [ ] *Data Pipelines with Apache Airflow* — idempotency patterns

**Repetition**
- [ ] Daily Anki review
- [ ] Anki cards for the week

### Sprint 8 (Week 8) — monitoring, wrap-up
**Recap:** 10 min — recall what most often broke your DAG last week

- [ ] Basic DAG monitoring (UI + logs)
- [ ] Refactor the DAG using patterns from the book
- [ ] Update the lab README: Airflow section

**Reading**
- [ ] Finish the key chapters of *Data Pipelines with Apache Airflow*
- [ ] *Fundamentals of Data Engineering* — transformation chapters

**Repetition**
- [ ] Daily Anki review
- [ ] Anki cards for the week ("Airflow" deck)

---

## MONTH 3 — dbt + Kafka start + portfolio project #1

### Sprint 9 (Week 9) — dbt staging
**Months 1-2 review (~30 days since the last review):**
- [ ] No hints: sketch a DAG with an idempotent task writing to ClickHouse
- [ ] Quickly redo one materialized-view example from memory
- [ ] Run through the "ClickHouse" + "Airflow" Anki decks

**Practice**
- [ ] Set up dbt-core + dbt-clickhouse
- [ ] Staging layer on top of raw ClickHouse tables
- [ ] Configure sources.yml

**Reading**
- [ ] dbt docs: Best practices, Project structure
- [ ] Kimball & Ross, *The Data Warehouse Toolkit* — ch. 1-2

**Repetition**
- [ ] Daily Anki review
- [ ] Anki cards for the week

### Sprint 10 (Week 10) — intermediate → marts
**Recap:** 10 min — explain in your own words why you need a staging layer before marts

- [ ] Intermediate model layer
- [ ] Marts
- [ ] dbt tests: not_null, unique, relationships
- [ ] Generate dbt docs

**Reading**
- [ ] Kimball — star schema chapters

**Repetition**
- [ ] Daily Anki review
- [ ] Anki cards for the week

### Sprint 11 (Week 11) — incremental, SCD2
**Recap:** 10 min — describe staging/intermediate/marts from memory

- [ ] Incremental materialization for a fact table
- [ ] Snapshot (SCD2) for one dimension

**Reading**
- [ ] Kimball — Slowly Changing Dimensions chapter

**Repetition**
- [ ] Daily Anki review
- [ ] Anki cards for the week ("dbt" deck)

### Sprint 12 (Week 12) — Kafka basics + portfolio project #1
**Recap:** 10 min — explain incremental models and why SCD2 matters, in your own words

- [ ] Cover topics/partitions/consumer groups using the event generator
- [ ] Build the pipeline: Postgres → Kafka → ClickHouse (staging) → dbt (marts) → Airflow
- [ ] Publish on GitHub: README + architecture diagram (mermaid is fine)
- [ ] Draft your resume with this project

**Reading**
- [ ] Start *Kafka: The Definitive Guide*

**Repetition**
- [ ] Daily Anki review
- [ ] Anki cards for the week

**✅ Checkpoint: start applying to jobs.**

---

## MONTH 4 — Kafka deep-dive + CDC + MPP theory

### Sprint 13 (Week 13) — Kafka Connect + Debezium
**Big Tier 1 review (~90 days since month 1 — peak forgetting risk):**
- [ ] Full cycle from memory, no docs (only peek if truly stuck): recreate 2-3 ClickHouse tables with different engines, write a simple idempotent DAG in Airflow, build a staging→marts model in dbt
- [ ] Run through the entire "ClickHouse", "Airflow", "dbt" Anki decks
- [ ] Note whatever you forgot the most — that's your signal for where to add focus in the remaining sprints

**Practice**
- [ ] Debezium connector for Postgres (shop-db) in Strimzi Kafka Connect
- [ ] Logical replication (pgoutput) on the CloudNativePG cluster
- [ ] Verify shop-db changes reach the Kafka topics

**Reading**
- [ ] *Kafka: The Definitive Guide* — Kafka Connect chapters

**Repetition**
- [ ] Daily Anki review
- [ ] Anki cards for the week

### Sprint 14 (Week 14) — Python consumer/producer
**Recap:** 10 min — explain how Postgres → Debezium → Kafka logical replication works, in your own words

- [ ] Consumer in confluent-kafka/aiokafka for CDC events
- [ ] Idempotent processing (at-least-once + deduplication)
- [ ] Write processed events into ClickHouse staging

**Reading**
- [ ] *Kafka: The Definitive Guide* — delivery semantics

**Repetition**
- [ ] Daily Anki review
- [ ] Anki cards for the week

### Sprint 15 (Week 15) — MPP theory
**Recap:** 10 min — describe at-least-once / at-most-once / exactly-once from memory

- [ ] Cover distribution keys, data motion (broadcast/redistribute)
- [ ] Run examples on Postgres, compare join plans

**Reading**
- [ ] DDIA — distributed-data chapters (revisit/go deeper)
- [ ] Greengage/Greenplum docs: Query Optimization, Distribution

**Repetition**
- [ ] Daily Anki review
- [ ] Anki cards for the week

### Sprint 16 (Week 16) — Greengage
**Recap:** 10 min — explain why a broadcast join can hurt in an MPP system

- [ ] Deploy Greengage locally (Arenadata Docker images)
- [ ] Load a test dataset, configure distribution keys
- [ ] Compare a query plan in ClickHouse vs Greengage

**Reading**
- [ ] Greengage docs: Getting Started

**Repetition**
- [ ] Daily Anki review
- [ ] Anki cards for the week ("Kafka + MPP" deck)

---

## MONTH 5 — PySpark + Trino + Iceberg

### Sprint 17 (Week 17) — PySpark basics
**Months 1-4 review (~30 days since the last review, now folding in Kafka):**
- [ ] Anki: run through every deck so far (ClickHouse, Airflow, dbt, Kafka + MPP)
- [ ] Solve 5 SQL problems in ClickHouse dialect without hints
- [ ] Describe the Debezium connector config in your own words (no copy-paste)

**Practice**
- [ ] `pip install pyspark`, local SparkSession
- [ ] DataFrame API: transformations vs actions
- [ ] Work through a lazy-evaluation example

**Reading**
- [ ] *Learning Spark* 2nd ed / *Spark: The Definitive Guide* — opening chapters

**Repetition**
- [ ] Daily Anki review
- [ ] Anki cards for the week

### Sprint 18 (Week 18) — MinIO + parquet
**Recap:** 10 min — explain the difference between a transformation and an action in Spark

- [ ] PySpark job writes to MinIO (S3A)
- [ ] Partitioned layout

**Reading**
- [ ] Spark book — I/O chapters

**Repetition**
- [ ] Daily Anki review
- [ ] Anki cards for the week

### Sprint 19 (Week 19) — Iceberg catalog
**Recap:** 10 min — explain from memory why you'd partition a dataset in S3

- [ ] Stand up an Iceberg REST catalog (Nessie / iceberg-rest-fixture)
- [ ] Configure the Iceberg catalog in Trino
- [ ] Rewrite the Spark job to write Iceberg tables
- [ ] Verify schema evolution and time travel through Trino

**Reading**
- [ ] Apache Iceberg docs: Getting started

**Repetition**
- [ ] Daily Anki review
- [ ] Anki cards for the week

### Sprint 20 (Week 20) — Trino federated queries + portfolio project #2
**Recap:** 10 min — explain the difference between schema evolution and time travel in Iceberg

- [ ] Federated query: JOIN Postgres + ClickHouse + Iceberg through Trino
- [ ] Build a batch lakehouse: Spark → Iceberg on MinIO → Trino, orchestrated by Airflow + Spark Operator
- [ ] Publish on GitHub

**Repetition**
- [ ] Daily Anki review
- [ ] Anki cards for the week ("Spark + Iceberg + Trino" deck)

---

## MONTH 6 — Kubernetes consolidation + interviews

### Sprint 21 (Week 21) — platform consolidation
**Final review, part 1 — start with the oldest material (highest forgetting risk):**
- [ ] Rubber duck: explain ClickHouse engines out loud, as if to an interviewer, and when to use each
- [ ] Rubber duck: explain Airflow idempotency using your own DAG as the example
- [ ] Anki: run through the entire "ClickHouse" and "Airflow" decks

**Practice**
- [ ] Deploy the whole platform through a single helm/kubectl flow
- [ ] Full README with an architecture diagram (mermaid)

**Repetition**
- [ ] Daily Anki review

### Sprint 22 (Week 22) — resume and profiles
**Final review, part 2:**
- [ ] Rubber duck: explain staging→intermediate→marts in dbt and why SCD2 matters
- [ ] Rubber duck: explain at-least-once/exactly-once in Kafka using your CDC pipeline
- [ ] Anki: run through the "dbt" and "Kafka + MPP" decks

**Practice**
- [ ] Resume tailored to the RU DE market (reframe the PHP/GCP experience)
- [ ] Update hh.ru, Habr Career, LinkedIn
- [ ] Add both portfolio projects to your resume with GitHub links

**Repetition**
- [ ] Daily Anki review

### Sprint 23 (Week 23) — mock interviews
**Final review, part 3:**
- [ ] Rubber duck: explain distribution keys / data motion in MPP and schema evolution / time travel in Iceberg
- [ ] Anki: run through the "Spark + Iceberg + Trino" deck

**Practice**
- [ ] 20-30 SQL optimization/window-function problems
- [ ] 1-2 mock interviews on system design (DWH modeling, ClickHouse)
- [ ] Refresh Kimball/DAMA terminology for governance questions

**Repetition**
- [ ] Daily Anki review

### Sprint 24 (Week 24) — active job search
- [ ] Actively apply to roles
- [ ] Attend a meetup (Data Fest, Highload++) or a relevant Telegram channel
- [ ] Review 6 months of progress, adjust the plan if needed

**Repetition**
- [ ] From here on, keep Anki in "maintenance mode" (5-10 min/day) — don't drop the decks even during active interviewing

---

**Contingency (laid off earlier than planned):** bump the pace to 30+ h/week, which compresses the plan to ~4 months; cut sprints 17-20 first (PySpark/Trino/Iceberg depth), don't cut Tier 1-2 (sprints 1-16) or the repetition layer — forgotten Tier 1 skills cost more in an interview than a missed Iceberg chapter.