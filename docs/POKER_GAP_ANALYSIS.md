# Gap analysis — lab today vs. the poker platform

> Companion docs: [POKER_ARCHITECTURE.md](POKER_ARCHITECTURE.md) · [POKER_DATA_MODEL.md](POKER_DATA_MODEL.md) · [POKER_DECISIONS.md](POKER_DECISIONS.md) · [POKER_ROADMAP.md](POKER_ROADMAP.md) · [POKER_OBSERVABILITY.md](POKER_OBSERVABILITY.md)
>
> Everything in this document was read from the repo and the live `dataplatform` cluster
> on 2026-09-06, not assumed. Where I could not determine something, it is listed under
> **Assumptions** at the bottom rather than guessed silently.

---

## The one-paragraph summary

You have built, and understood, roughly **70% of the infrastructure** the poker platform
needs — and **0% of the product**. The lab's ClickHouse, Kafka, MinIO, Airflow and dbt are
not toys; they are the same components the platform runs, wired the same way, with pinned
versions and smoke tests. What's missing is everything above the storage layer: there is no
API, no authentication, no upload path, no parser, no canonical model, no Redis, and — the
single most consequential gap — **no multi-tenancy anywhere**. Every table in the lab is
single-tenant by construction. That is not a small refactor; it is a schema-design decision
that has to be made once, correctly, at the start.

---

## Per-tool assessment

Legend for the verdict column: **Reuse** = keep as-is · **Repurpose** = same component,
new schema/config · **Build** = doesn't exist yet · **Cut** = not on the product's path.

### ClickHouse — the analytics store

| | |
|---|---|
| **Status** | ✅ Running. Altinity operator 0.27.1, server `25.8.16.10002.altinitystable`, 1 shard × 1 replica, **no Keeper**. Databases `raw` / `staging` / `marts` (+ `sandbox`, `shop_raw` from sprint exercises). 1Gi request / 2Gi limit, 10Gi PVC. |
| **Target role** | Primary analytics store for hands and precomputed stat rollups. **On the critical path.** Every dashboard query terminates here (or in Redis in front of it). |
| **Verdict** | **Repurpose** |
| **Gap** | Four things. **(1) Multi-tenancy.** Nothing in the lab has a `user_id`; the product needs `user_id` leading every `ORDER BY` key and CH quotas/settings profiles per tenant. **(2) Scale.** A single 10Gi PVC on a laptop vs. heavy users at 5–10M hands each. **(3) No Keeper, no replication.** Fine for the lab, unacceptable for a store that holds paying users' data — production needs at least 2 replicas + Keeper, or managed ClickHouse. **(4) No storage tiering.** Hot/cold via an S3-backed volume + TTL-to-volume is unbuilt. |
| **What transfers** | Everything you learned in Month 1 transfers directly and is *exactly* the right knowledge: `AggregatingMergeTree` + `-State`/`-Merge` is how the stat rollups work; `ReplacingMergeTree` is how re-parsed hands supersede old ones; the partition-pruning and `ORDER BY`-prefix rules from [notes/month-01-takeaways.md](notes/month-01-takeaways.md) are the reason `user_id` goes first in the key. |

### PostgreSQL — the system of record

| | |
|---|---|
| **Status** | ✅ Running, two CNPG clusters. `shop-db` (PG 16.8, toy e-commerce: 1k customers / 10k orders / 30k order_items, seeded from a ConfigMap) and `airflow-meta` (Airflow's metadata DB). `wal_level=logical` already enabled. |
| **Target role** | System of record: accounts, auth, billing/subscriptions, poker-account→screen-name mapping, upload & parse job metadata, hand notes/tags, HUD layouts, solver/baseline set metadata. **On the critical path** for writes, off it for analytics. |
| **Verdict** | **Repurpose** (the CNPG operator and the deployment pattern) + **Build** (the entire schema) |
| **Gap** | The `shop` schema is a teaching dataset with zero overlap with the product. There is no accounts table, no auth, no billing, no migrations tooling (**no Alembic anywhere in the repo**), and no `pyproject.toml`/`uv` — the only Python dependency file is [etl/requirements.txt](../etl/requirements.txt). Per your global conventions the product schema needs `MetaData(naming_convention=...)` and Alembic from day one. |
| **Keep `shop-db`?** | Yes, but only as a *learning* fixture during the transition, and delete it once sprint 13's CDC exercise is retargeted at the real product Postgres. Two Postgres clusters on a 20Gi node is affordable. |

### Kafka — the ingestion bus

| | |
|---|---|
| **Status** | ✅ Running. Strimzi 1.0.0, Kafka 4.2.0 in KRaft mode, single node pool `dual` (controller+broker combined), RF=1, 5Gi. Topic `clickstream` (3 partitions, 7-day retention) plus Debezium's `shop.public.*`. kafbat kafka-ui at :8081. |
| **Target role** | Decouple upload acceptance from parsing; later, the backbone for the desktop HUD agent's stream. |
| **Verdict** | **Repurpose** |
| **Gap** | Topic design is the work, not the cluster. The product needs `hands.uploads.v1` (small pointer messages, keyed by `user_id`), a **separate** `hands.bulkimport.v1` so one user's 10M-hand backfill can't starve everyone else's live uploads, and `hands.deadletter.v1`. Also missing: any schema contract (JSON Schema at MVP, Avro + registry later), and consumer-lag monitoring. |
| **Honest note** | See [POKER_DECISIONS.md ADR-004](POKER_DECISIONS.md#adr-004--kafka-in-phase-2-not-phase-1). Kafka is a locked decision and I'm honoring it. For a solo maintainer it is the single heaviest operational component in the stack, and at MVP volumes a Redis Stream or a Postgres outbox would do the same job — so my recommendation is that it enters at **phase 2**, not phase 1. But your confirmation that **the live HUD will stream** is the decisive argument in its favour: a streaming agent needs per-user ordering, replay, durable buffering under load, and multi-consumer fan-out, which is Kafka's exact job description. It's designed into the contract from day one for that reason (see [the live HUD path](POKER_ARCHITECTURE.md#the-live-hud-path-future--phase-7)). In production, run it **managed** (Redpanda Cloud, Confluent, MSK, or Yandex Managed Kafka), never self-hosted Strimzi. |

### MinIO / object storage — the data lake

| | |
|---|---|
| **Status** | ✅ Running. Chart 5.4.0, standalone, single replica, 10Gi PVC. Buckets `raw` `staging` `dwh` `spark` `lakehouse`, created idempotently by [infra/minio/bucket-init-job.yaml](../infra/minio/bucket-init-job.yaml). |
| **Target role** | Immutable forever-storage of raw hand-history text (so hands can be re-parsed after parser fixes), plus the Parquet/Iceberg lake for batch reprocessing. |
| **Verdict** | **Reuse** locally, **swap for S3-compatible cloud storage** in production |
| **Gap** | No compression policy (raw text must be zstd — hand histories compress ~8–12×), no per-user prefix layout, no lifecycle/tiering rules, no retention or deletion story (relevant: hand histories contain *other* players' screen names — see the compliance note below). |

### Airflow — orchestration

| | |
|---|---|
| **Status** | ✅ Running. Chart 1.16.0, custom image `airflow-lab:dev` (Airflow 2.11.1 / py3.12), **LocalExecutor**, external CNPG metadata DB, DAGs on an RWO PVC synced by `kubectl cp` (`make sync-dags`). No triggerer, no statsd. Three DAGs: `shop_batch_pipeline`, `shop_cdc_consumer`, `sprint05_hello`. |
| **Target role** | Batch orchestration only: scheduled dbt runs, bulk re-parse jobs, baseline/report refresh, ML feature builds. **Explicitly off the interactive path.** |
| **Verdict** | **Reuse** (as an orchestrator) / **Cut** (from the ingestion path) |
| **Gap** | The current DAG-sync mechanism (`kubectl cp` into a PVC) is a lab affordance and does not survive contact with production — it needs git-sync or a baked image. LocalExecutor means task memory comes out of the scheduler's limit, which you already learned the hard way ([notes/sprint05-airflow-basics.md](notes/sprint05-airflow-basics.md) §7); a production deployment wants KubernetesExecutor or a managed Airflow. Also: **Airflow must not be in the upload→stats path.** A user who uploads a session expects stats in seconds, and Airflow's minimum granularity and scheduling model are wrong for that. Real-time incremental aggregation belongs to ClickHouse materialized views. |

### dbt — the stat-transformation layer

| | |
|---|---|
| **Status** | ✅ Wired. dbt-core ~1.10 + dbt-clickhouse 1.10.0 in an isolated `/opt/dbt-venv`. Project [dbt/shop_dwh](../dbt/shop_dwh/): 3 staging views, 2 marts tables, 20 schema tests, a `generate_schema_name` macro that maps custom schemas straight onto CH databases. |
| **Target role** | Where **all stat logic lives**: staging hands → intermediate flags → stat marts, with tests and lineage. |
| **Verdict** | **Reuse** the project skeleton, macro, and test conventions; **build** every model |
| **Gap** | No intermediate layer exists (the lab goes staging→marts directly), no incremental materializations, no snapshots, no `dbt docs`, no packages (`dbt_utils`), no `sources.yml` freshness checks. |
| **Design flag** | dbt alone cannot serve the hot path — see [ADR-003](POKER_DECISIONS.md#adr-003--dbt-owns-the-stat-definitions-clickhouse-mvs-own-the-hot-path). The pattern that works is **two-tier**: ClickHouse materialized views do incremental aggregation automatically on insert (seconds); dbt owns the *definitions*, the tests, the lineage, and the full rebuilds/backfills (minutes-hours). Your Sprint 3 MV work is the foundation of the first tier. |

### Spark — the batch layer

| | |
|---|---|
| **Status** | ⚙️ On-demand. kubeflow spark-operator 2.5.0; custom image `spark-s3a:dev` = Spark 3.5.3 + JDK 17 + hadoop-aws 3.3.4 + iceberg-spark-runtime 1.11.0. One demo job ([infra/spark/job.py](../infra/spark/job.py)) that reads Parquet over s3a and writes a month-partitioned Iceberg table. Last ran 24 days ago. |
| **Target role** | Bulk re-parse of raw hand text after a parser fix, over the lake. Possibly ML feature engineering later. **Batch layer only, never the interactive path.** |
| **Verdict** | **Repurpose** — but later than the learning plan implies |
| **Gap** | The reprocessing job doesn't exist. More importantly: I am not convinced Spark is ever needed for ML feature engineering here (ClickHouse + Polars covers a very large range), so its only *load-bearing* justification is bulk re-parse. See [ADR-006](POKER_DECISIONS.md#adr-006--spark-is-for-bulk-re-parse-not-for-ml-features). |

### Iceberg + Nessie — the table format

| | |
|---|---|
| **Status** | ✅ Running. Nessie 0.108.4 as the Iceberg REST catalog (RocksDB version store on a PVC), metadata + data in the MinIO `lakehouse` bucket. Spark writes, Trino reads. Time travel is Nessie-native (commits/branches/**tags**), not per-snapshot — the `iceberg_history` Trino catalog reads a pinned tag. |
| **Target role** | Table format over the raw-hand and canonical-hand lake, so batch tools can read and reprocess it, and so the canonical schema can evolve without rewriting history. |
| **Verdict** | **Reuse** — and Iceberg (not Delta) is the recommendation. See [ADR-007](POKER_DECISIONS.md#adr-007--iceberg-over-delta-lake). |
| **Gap** | Nothing structural. The lake layout for hands doesn't exist yet. One genuine product need that maps beautifully onto sprint 19: **schema evolution is not academic here** — when the canonical hand model gains a field (say, straddle support), Iceberg lets you add it without rewriting 50 billion rows. |

### Trino — federated query

| | |
|---|---|
| **Status** | ✅ Running. Chart 1.42.2, Trino 480, coordinator-only. Catalogs `clickhouse` / `iceberg` / `iceberg_history` / `tpch`. |
| **Target role** | None on the product's critical path. Useful for ad-hoc exploration across the lake + ClickHouse, and for the analyst-style queries you'd otherwise write twice. |
| **Verdict** | **Cut from the critical path**, keep as a lab/exploration tool |
| **Gap** | n/a — it works, it's just not part of the product. ClickHouse serves the interactive path; Spark serves the batch path; Trino sits between them with no unique job. |

### Debezium / CDC

| | |
|---|---|
| **Status** | ✅ Running. Debezium PG connector 3.1.1 on a custom Strimzi Kafka Connect image; publication `dbz_publication` on `shop-db`; topics `shop.public.*`; an Airflow consumer lands them idempotently into `staging.cdc_events` (`ReplacingMergeTree(_version)`). |
| **Target role** | Genuinely useful, but **not for hands** — hands arrive as immutable files, not row mutations. The real use is syncing *dimensions* from the product Postgres into ClickHouse: `poker_accounts` (which screen name is "hero"), subscription tier (for quota enforcement in queries), stake groupings. Those change in Postgres and need to be joinable in ClickHouse. |
| **Verdict** | **Repurpose** — retarget from `shop-db` to the product Postgres |
| **Gap** | It points at the wrong database. Also: at MVP a nightly full-refresh of three small dimension tables is simpler than CDC and gives the same result. CDC earns its place when dimension changes must be reflected in seconds (e.g. a user adds a poker account mid-session). |

### Greengage — the MPP sandbox

| | |
|---|---|
| **Status** | ⚠️ Running but **amd64-only under Docker Desktop emulation** (documented exception to the arm64 rule). Single-host `gpdemo`: 1 coordinator + 2 primary segments, no mirrors, in one pod. Seeded with a copy of the shop dataset distributed by different keys to force a Motion node. **Wired into nothing.** |
| **Target role** | **Learning sandbox only. Not part of the product.** |
| **Verdict** | **Cut from the product; keep as a sandbox** |
| **The redundancy, explained plainly** | Greengage (a Greenplum fork) and ClickHouse are **both analytical warehouses solving the same problem** — scan a lot of rows fast by spreading them across machines and using columnar storage. They differ in *how*, not in *what*. Greengage is **MPP-shared-nothing over Postgres**: a coordinator plans a query, each segment executes it on its own slice, and when a join needs rows that live on the wrong segment, the plan inserts a **Motion** node to physically move data across the network. That makes it excellent at complex multi-table joins with full ANSI SQL and real transactions. ClickHouse is a **columnar single-table-optimized engine**: it is dramatically faster at "scan one huge table, filter, aggregate" — which is *exactly* what poker stats are (`sum(vpip_action) / sum(vpip_opportunity)` over a hand-flags table) — and comparatively weak at large distributed joins. Running both in production would mean **two copies of the same hands, two schemas to keep in sync, two sets of query logic, and two things to operate** — for a workload that only ever asks the one question ClickHouse is best at. That is the redundancy. Keep Greengage to load the same poker dataset later and compare plans; it is genuinely valuable *interview* material (distribution keys, data motion, broadcast vs. redistribute) and genuinely worthless product infrastructure. |
| **Operational note** | It runs emulated and is CPU-hungry. Scale it to zero when not actively used: `kubectl -n data-platform scale statefulset/greengage --replicas=0`. |

### Redis — absent

| | |
|---|---|
| **Status** | ❌ **Not present anywhere in the repo or cluster.** |
| **Target role** | Cache of hot precomputed stat blocks for fast dashboard/API responses. |
| **Verdict** | **Build** |
| **Gap** | Everything. Also worth knowing: Redis is the natural home for the MVP **job queue** as well as the cache — which is the pragmatic alternative to Kafka in phase 1 (see [ADR-004](POKER_DECISIONS.md#adr-004--kafka-in-phase-2-not-phase-1)). |

### The application layer — absent

| | |
|---|---|
| **Status** | ❌ **Nothing exists.** No FastAPI service, no API contract, no authentication, no upload endpoint, no frontend, no `pyproject.toml`, no `uv.lock`, no tests directory, no CI. |
| **Target role** | The product. The ingestion API contract in particular is the piece that must be designed *first* and kept stable, because the future desktop HUD agent attaches to it as "just another client." |
| **Verdict** | **Build** |
| **Gap** | This is the largest single gap and — importantly — **it is not covered anywhere in your learning plan.** [LEARNING_PLAN.md](../LEARNING_PLAN.md) is 24 sprints of data-engineering skills. FastAPI, auth, Redis, API contract design, and the frontend are simply absent from it. See the reconciliation in [POKER_ROADMAP.md](POKER_ROADMAP.md#the-honest-gap-in-the-learning-plan). |

### The parser — absent

| | |
|---|---|
| **Status** | ❌ Does not exist. No poker code of any kind in the repo. |
| **Target role** | `parse(raw_text, site) -> CanonicalHand`. The single most product-specific piece of code in the system, and the one with the most edge cases. |
| **Verdict** | **Build** |
| **Gap** | Everything, including the sample data to build against — I could not find any hand-history files in the repo, so I'm assuming you'll supply your own exports. |

---

## Cross-cutting gaps

**Multi-tenancy — the big one.** Not a single table in the lab has a tenant key. Retrofitting
`user_id` into a ClickHouse `ORDER BY` key later means rewriting every table, because the sort
key *is* the physical layout. This has to be right in the first schema you write. Same for
object-storage prefixes, Kafka message keys, and every dbt model.

**Observability.** The cluster runs `metrics-server` and nothing else. No Prometheus, no
Grafana, no structured logging, no alerting. `make smoke` is an excellent *deployment* check
and a poor *runtime* monitor — it tells you a component is up, not that ingest lag is climbing.
See [POKER_OBSERVABILITY.md](POKER_OBSERVABILITY.md).

**Nothing is HA.** Single ClickHouse replica with no Keeper, single Kafka broker with RF=1,
single Postgres instance per cluster, standalone MinIO. Every one of those is the correct
choice for a 20Gi laptop and the wrong choice for paying customers. The upgrade path is known
for each; the point is that "it works in the lab" and "it's safe to charge money for" are
separated by a real amount of work.

**No CI, no tests, no packaging.** For a parser that will be corrected repeatedly against
real-world edge cases, a regression test suite over a corpus of known-tricky hands is not
optional — it is the only thing that makes "re-parse everything after a fix" a safe operation
rather than a terrifying one.

**Compliance, briefly.** Hand histories contain other players' screen names and betting
behaviour. If you serve users in Russia (152-ФЗ) or the EU (GDPR), that is third-party personal
data you are storing indefinitely. It's manageable — it's a documented lawful basis, a retention
policy, and a deletion path — but it should be a conscious decision, not a discovery. Related:
phase 1 is post-session analysis of the user's own hands, which essentially every site permits.
Real-time assistance and on-table HUDs are what site ToS restrict, and they vary per network —
which is why the HUD agent is a later, per-network-gated concern.

---

## Lab health — things to fix before building on it

Found while inventorying the live cluster:

1. **Memory drift in the docs.** [CLAUDE.md](../CLAUDE.md) records `4 CPU / 12288Mi`, and
   [cluster/up.sh](../cluster/up.sh) defaults to `MEMORY=12288`. The running node actually has
   **20Gi** (currently 10.1Gi used). You already caught this in
   [notes/sprint05-airflow-basics.md](notes/sprint05-airflow-basics.md) §7 — it should be
   corrected in `CLAUDE.md` and `cluster/up.sh` so the next cold start reproduces what you have.
2. **`strimzi-cluster-operator` has 635 restarts.** It is `Running` now, but that is a
   crashloop history nobody has diagnosed. Worth ten minutes with `kubectl logs --previous`
   before you make Kafka load-bearing.
3. **Two uncommitted improvements.** The Airflow memory fixes in
   [infra/airflow/values.yaml](../infra/airflow/values.yaml) (webserver workers 4→2, limits
   raised) and the sprint-4 checkmarks in `LEARNING_PLAN.md` are working-tree only. Per golden
   rule 5 they belong in a commit.
4. **Untracked sprint-5 work.** `dags/sprint05_hello.py`, `anki/sprint-05.tsv`,
   `docs/notes/sprint05-airflow-basics.md`, `docs/notes/month-01-takeaways.md`.
5. **`make sync-dags` won't scale.** `kubectl cp` into an RWO PVC is fine for one machine and
   a dead end for anything else. Not urgent; note it.

---

## Assumptions I had to make

These are the things I could not determine from the repo. If any is wrong, the docs that
depend on it need revision — I've noted which.

1. **No poker sample data exists yet.** I found no hand-history files anywhere in the repo, so
   I've assumed you'll supply your own exports (from your own play) as the phase-0 corpus.
   *Affects: the whole roadmap's phase 0 and 1.*
2. **PokerStars text is the first format.** I've assumed the standard PokerStars-style text
   format is parser #1, because it is the de-facto reference format that several other networks
   (WPN/ACR, and GGPoker's PokerCraft text export) approximate. *Affects: DATA_MODEL's parser
   section and the roadmap's phase 1.*
3. **Cash games first, tournaments second.** The phase-1 stat list assumes 6-max/9-max No-Limit
   Hold'em cash games. Tournaments add ICM, bounties, changing blind levels, and chip-vs-money
   distinctions that materially complicate the model. *Affects: DATA_MODEL's schema and stat
   definitions.*
4. **Deployment target is unknown.** The lab is minikube; I have no information about where
   production will run (VPS, Yandex Cloud, Hetzner, AWS…). I've written the architecture to be
   provider-agnostic and flagged managed-vs-self-hosted per component without pricing.
5. **You are the only engineer.** Everything is sized and sequenced for one person, which is
   why the recommendations lean hard toward "fewer moving parts" and "managed where it matters."
6. **No existing users or revenue.** Phase ordering assumes you can afford a working-but-ugly
   phase 1 (correct stats, minimal UI) before polish.
7. **The 20Gi node is the real ceiling** for local development. A full 5–10M-hand heavy-user
   dataset will not fit comfortably alongside the whole stack; local testing will use a sampled
   corpus.
8. **`shop-db` can eventually be retired.** I've assumed nothing outside the learning plan
   depends on the toy e-commerce dataset.

---

## Open questions for you, before the implementation run

1. **Which sites do you actually play, and can you export real hand histories from them today?**
   This decides parser order, and real files beat synthetic ones by a wide margin for a parser.
2. **Cash, tournaments, or both — and is Hold'em enough for phase 1?** Adding Omaha is cheap in
   the model and expensive in the stat definitions; adding tournaments is expensive in both.
3. **Do you want opponent stats at all in phase 1, or only hero stats?** Hero-only is
   dramatically simpler (no player-identity resolution, no anonymization problem) and is a
   legitimate product on its own. Opponent tracking is what makes it a PokerTracker competitor.
4. **Where will production run?** Managed ClickHouse (ClickHouse Cloud, Yandex Managed
   ClickHouse, Altinity.Cloud) vs. self-hosted on your own k8s changes the operational plan
   substantially, and it is the component where "managed" buys the most.
5. **How much of your ~15–20 h/week goes to the product vs. to interview prep?**
   [LEARNING_PLAN.md](../LEARNING_PLAN.md) ends in a job search; the product ends in a business.
   These are compatible for about 20 sprints and then they aren't. The roadmap assumes they stay
   merged; tell me if that's wrong.
6. **Is the frontend in scope for you, or do you want the API to be the deliverable?** The
   phase-1 "usable increment" looks very different depending on the answer.
7. **How soon do you expect to want the live streaming HUD?** You've confirmed it will stream,
   which is designed into the ingestion contract from day one. But if it's a year out, Kafka
   still enters at phase 2 and the `hands.live.v1` / `hands.parsed.v1` topics stay unproduced
   until phase 7. If it's much sooner, it reorders things substantially — the read-side Redis
   pre-warm and the per-network policy question both move forward.

---

## Recommended next step

**Build the parser and the canonical model first, against real hand-history files, with a
regression corpus — and land the results in a multi-tenant ClickHouse schema.** Concretely, the
second run should create a `poker/` Python package with `uv`/`pyproject.toml`, define the
`CanonicalHand` model as typed dataclasses or Pydantic models, implement `parse(raw_text, site)
-> CanonicalHand` for PokerStars text behind that interface, add a `tests/corpus/` directory
with a dozen real hands covering the nasty cases (all-in side pots, uncalled bet returned, split
pots, straddles, a disconnected player, a hand with no showdown), and write the ClickHouse DDL
for `core.hands` / `core.hand_players` / `core.actions` with `user_id` leading every `ORDER BY`.
Nothing else — no Kafka, no API, no dashboard. The reason to start here is that the parser is
the only component whose design you cannot borrow from the lab, it's where all the domain
complexity lives, and every downstream decision (stat definitions, storage layout, reprocessing
strategy) is constrained by the shape of what it emits. Everything else in this stack you have
already built once.
