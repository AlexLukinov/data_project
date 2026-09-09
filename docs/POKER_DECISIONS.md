# Decision log (ADRs) — poker platform

> Companion docs: [POKER_GAP_ANALYSIS.md](POKER_GAP_ANALYSIS.md) · [POKER_ARCHITECTURE.md](POKER_ARCHITECTURE.md) · [POKER_DATA_MODEL.md](POKER_DATA_MODEL.md) · [POKER_ROADMAP.md](POKER_ROADMAP.md) · [POKER_OBSERVABILITY.md](POKER_OBSERVABILITY.md)

Lightweight ADRs. Each has **Context → Decision → Alternatives → Consequences**, and where I
disagree with a locked decision I say so under **My reservation** — as a recommendation to weigh,
not a change I've made.

**Status legend:** 🔒 Locked by you · ✅ Recommended by me · ⚠️ Locked, with a reservation

| # | Decision | Status |
|---|---|---|
| [001](#adr-001--python-primary-with-a-hard-parser-boundary) | Python primary, with a hard parser boundary | 🔒 |
| [002](#adr-002--clickhouse-as-the-analytics-store) | ClickHouse as the analytics store | 🔒 |
| [003](#adr-003--dbt-owns-the-stat-definitions-clickhouse-mvs-own-the-hot-path) | dbt owns definitions; ClickHouse MVs own the hot path | ⚠️ |
| [004](#adr-004--kafka-in-phase-2-not-phase-1) | Kafka in phase 2, not phase 1 | ⚠️ |
| [005](#adr-005--airflow-deferred-to-phase-4) | Airflow deferred to phase 4 | 🔒 |
| [006](#adr-006--spark-is-for-bulk-re-parse-not-for-ml-features) | Spark is for bulk re-parse, not ML features | ⚠️ |
| [007](#adr-007--iceberg-over-delta-lake) | Iceberg over Delta Lake | ✅ |
| [008](#adr-008--greengage-is-a-sandbox-not-a-product-component) | Greengage is a sandbox, not a product component | 🔒 |
| [009](#adr-009--multi-tenancy-by-tenant-key-not-by-database) | Multi-tenancy by tenant key, not by database | ✅ |
| [010](#adr-010--raw-hand-text-is-the-source-of-truth-clickhouse-is-derived) | Raw text is the source of truth; ClickHouse is derived | ✅ |
| [011](#adr-011--the-solver-is-a-baseline-producer-behind-a-spot_key-seam) | The solver is a baseline producer behind a `spot_key` seam | ✅ |
| [012](#adr-012--the-ai-layer-is-aggregate-first-and-batch-only) | The AI layer is aggregate-first and batch-only | 🔒 |
| [013](#adr-013--rent-anything-with-a-replication-protocol) | Rent anything with a replication protocol | ✅ |
| [014](#adr-014--the-ingestion-contract-is-versioned-and-frozen-early) | The ingestion contract is versioned and frozen early | ✅ |
| [015](#adr-015--docker-compose-for-the-product-minikube-stays-the-learning-lab) | docker-compose for the product; minikube stays the learning lab | 🔒 |
| [016](#adr-016--nuxt-4--vue-3-for-the-dashboard) | Nuxt 4 / Vue 3 for the dashboard | ✅ |
| [017](#adr-017--clickhouse-migrations-are-versioned-sql-not-a-framework) | ClickHouse migrations are versioned SQL, not a framework | ✅ |
| [018](#adr-018--all-in-equity-uses-a-vetted-evaluator-computed-at-parse-time) | All-in equity uses a vetted evaluator, computed at parse time | ✅ |
| [019](#adr-019--the-stat-chain-is-incremental-by-daily-partition-anchored-and-backfilled-in-batches) | The stat chain is incremental by daily partition, anchored, and backfilled in batches | ✅ implemented |
| [020](#adr-020--a-decision-level-fact-table-is-the-source-of-truth-for-situations) | A decision-level fact table is the source of truth for situations | ✅ planned (POKER_PLAN C) |
| [021](#adr-021--the-stat-registry-is-data-and-every-consumer-is-generated-from-it) | The stat registry is data, and every consumer is generated from it | ✅ planned (C) |
| [022](#adr-022--filters-and-custom-stats-are-a-typed-json-ast-not-a-text-dsl) | Filters and custom stats are a typed JSON AST, not a text DSL | ✅ planned (C) |
| [023](#adr-023--strict-module-layering-enforced-in-ci-with-storage-behind-protocols) | Strict module layering enforced in CI, with storage behind Protocols | ✅ planned (B) |
| [024](#adr-024--nuxt-4-app-in-spa-mode-with-one-shared-filter-model-and-two-entry-points) | Nuxt 4 app in SPA mode, one shared filter model, two entry points | ✅ planned (D) |
| [025](#adr-025--freshness-and-scale-materialized-views-generated-from-the-registry-then-shard-by-tenant) | Freshness and scale: MVs generated from the registry, then shard by tenant | ✅ planned (E) |
| [026](#adr-026--hero-analysis-and-pool-analysis-are-separate-modules-as-in-hand2note) | Hero analysis and pool analysis are separate modules, as in Hand2Note | 🔒 |

---

## ADR-001 — Python primary, with a hard parser boundary
**Status:** 🔒 Locked

**Context.** Parsers for a dozen text formats plus a FastAPI service. Python is the language of
your data stack and your learning goals; it is also, by reputation, slow at text processing.

**Decision.** Python everywhere. The parser is isolated behind
`parse(raw_text, site) -> CanonicalHand` so a single hot format can later be replaced with Rust
(PyO3/maturin) or Cython without touching anything else. Polars handles bulk columnar
normalization after parsing.

**Alternatives.** Rust or Go for the parser from day one (faster, but a second language, a second
build toolchain, and a second place for the domain logic to live — and the domain logic here is
subtle and changes often). A JVM stack (throws away the entire lab and your learning plan).

**Consequences.** One language, one test suite, one deployment story. The parser is where all
domain complexity concentrates, so keeping it in the language you iterate fastest in is worth
more than raw throughput. Per the arithmetic in
[POKER_DATA_MODEL.md §10](POKER_DATA_MODEL.md#10--parser-throughput--the-honest-numbers),
steady-state parsing at 100k users is roughly **one core** — Python is not the bottleneck, and
the real risks are per-hand Pydantic validation and per-hand DB round-trips, both of which are
implementation discipline rather than language limits.

**I agree with this one**, and I'd add: the boundary is worth maintaining even if you never use
it for Rust, because it's also what lets the Spark re-parse job and the API share one parser
implementation instead of drifting into two.

---

## ADR-002 — ClickHouse as the analytics store
**Status:** 🔒 Locked

**Context.** The interactive workload is "scan a lot of rows for one tenant, filter by date and
dimensions, aggregate" — repeated for every dashboard load.

**Decision.** ClickHouse is the primary analytics store for hands and stat rollups, on the
critical path, multi-tenant via `user_id` leading the `ORDER BY` key plus per-tenant quotas.

**Alternatives.** PostgreSQL + TimescaleDB (fine to ~100M rows, then painful — and heavy users
alone blow past that). DuckDB (excellent embedded, wrong for a multi-tenant server). Snowflake/
BigQuery (great, but per-query pricing against an interactive dashboard is a business-model
mismatch, and neither is realistic for the RU market). Greengage — see ADR-008.

**Consequences.** Sub-second aggregation over hundreds of millions of rows on modest hardware.
In exchange: no real `UPDATE`/`DELETE`, eventual dedup via merges (read with `FINAL`), one
physical sort order per table, and joins that are weaker than a classic MPP's. Every one of
those constraints is already shaped into the model in
[POKER_DATA_MODEL.md](POKER_DATA_MODEL.md) — the flag table exists precisely so the hot path
never needs a large join.

---

## ADR-003 — dbt owns the stat definitions; ClickHouse MVs own the hot path
**Status:** ⚠️ Locked (dbt), with a reservation about dbt *alone*

**Context.** The locked decision is "dbt is the stat-transformation layer; this is where stat
logic lives." I agree with that entirely. The reservation is about *timing*, not ownership: dbt
runs in batch, and a user who uploads a session expects their stats to move within seconds.

**Decision.** Two tiers, one source of truth:

- **ClickHouse materialized views** do incremental aggregation automatically on insert. They are
  the reason stats are fresh seconds after an upload, with no orchestrator involved.
- **dbt** owns the *definitions* — the intermediate flag logic, the mart models, the tests, the
  lineage, the documentation — and runs full rebuilds and backfills on a schedule.

The MV's `SELECT` and the dbt model's `SELECT` must express the **same** logic. Generate the MV
DDL from the dbt model (a macro, or dbt's `materialized='materialized_view'`) rather than
maintaining two hand-written copies, and add a reconciliation test asserting the MV output
matches a full dbt rebuild for a sample window.

**Alternatives.** *dbt only* — simplest, but stat freshness becomes "next scheduled run," which
is a visibly worse product. *MVs only* — fastest, but you lose tests, lineage, docs, and the
ability to reason about the stat layer, which is unacceptable for logic this subtle. *Compute
stats in the API* — scatters the definitions across application code; this is exactly what the
locked decision correctly rules out.

**Consequences.** You maintain a generation step and a reconciliation test. In return you get
seconds-fresh stats *and* a tested, documented, single-source stat layer. The main risk is drift
between the two tiers, which is why the reconciliation test is not optional.

**My reservation, stated plainly:** dbt on ClickHouse is meaningfully weaker than dbt on
Snowflake or BigQuery — incremental strategies are more limited, and the adapter's feature set
lags. Budget for hitting rough edges, and don't assume a pattern from dbt tutorials will work
here unchanged.

---

## ADR-004 — Kafka in phase 2, not phase 1
**Status:** ⚠️ Locked (Kafka), with a reservation about phase-1 timing

**Context.** Kafka is a locked decision as the ingestion bus and the future backbone for the
desktop HUD agent's real-time stream. You've since confirmed the HUD will stream, which
strengthens the case considerably.

**Decision.** Kafka is in the architecture and in the contract from day one. It is **introduced
in phase 2**, not phase 1. Phase 1 ships upload → object storage → a Redis-backed job queue
(`arq` or RQ) → parser workers, behind an interface shaped exactly like a topic consumer. Phase
2 swaps the transport with no change to the parser worker's logic or the API's contract.

**Alternatives.** *Kafka from day one* — the operational burden lands before there's a single
user to justify it, and for a solo maintainer Strimzi is a genuine part-time job. *Never Kafka*
— defensible for batch uploads alone, but wrong once the HUD streams: at that point you need
per-user ordering, replay, multi-consumer fan-out, and durable buffering under load, which is
precisely Kafka's job description. *Redis Streams permanently* — no real replay, weaker
durability guarantees, and it becomes the thing you regret at exactly the moment you can least
afford a migration.

**Consequences.** Phase 1 has one fewer distributed system to operate while you're still
discovering what the parser needs. The cost is a transport swap in phase 2, which is small if
the worker interface is right, and a real risk of the swap being deferred forever if phase 1
"works fine" — so put it in the roadmap's exit criteria, not in a backlog.

**My reservation:** the strongest argument for Kafka here is the live HUD, and that's phases
away. Between now and then, Kafka mostly buys you a learning objective (sprint 12–14) and an
architecture you won't have to redo. Both are real. Just don't let phase 1 stall on broker
operations.

**In production: run it managed.** Redpanda Cloud, Confluent, MSK, or Yandex Managed Kafka.
Self-hosted Strimzi belongs in the lab, where its purpose is teaching you what the managed
service is doing. Redpanda deserves a specific mention as the "boring technology" option — a
Kafka-API-compatible single binary with no ZooKeeper and no JVM tuning.

---

## ADR-005 — Airflow deferred to phase 4
**Status:** 🔒 Locked

**Context.** Airflow is warranted once there are more than ~2–3 scheduled jobs; before that
it's a large dependency serving one cron entry.

**Decision.** Plan for Airflow, don't front-load it. It arrives in phase 4 when there are
genuinely several interdependent scheduled jobs: dbt builds, bulk re-parse, baseline refresh,
coaching-report generation, retention/tiering. Until then, a scheduled container running
`dbt build` is enough.

**Alternatives.** Airflow from day one (complexity with no payoff). Dagster or Prefect (better
developer experience, arguably a better fit for asset-oriented data work — but Airflow is the RU
market standard and it's what your learning plan and your existing lab are built around; that
tips it decisively). Cron forever (breaks down the moment jobs have dependencies and need
retries and backfills).

**Consequences.** Phase 1–3 stay light. When Airflow arrives you already have the lab experience
([notes/sprint05-airflow-basics.md](notes/sprint05-airflow-basics.md) is genuinely good
groundwork) and real jobs to orchestrate rather than a toy DAG.

**One hard constraint worth repeating:** Airflow must never sit in the upload→stats path. It's a
batch orchestrator, and putting a user's wait behind a scheduler's granularity is a product bug.

---

## ADR-006 — Spark is for bulk re-parse, not for ML features
**Status:** ⚠️ Locked (Spark reserved for the batch layer), with a reservation on scope

**Context.** Spark is reserved for heavy reprocessing over the lake and ML feature engineering
for leak models, deferred until real volume or an ML need.

**Decision.** Spark's load-bearing job is **bulk re-parse**: parser v7 ships, and you need to
re-derive canonical rows for tens or hundreds of millions of hands from raw text in the lake.
That is genuinely a distributed batch job and Spark is genuinely the right tool.

**Alternatives for re-parse.** A pool of Python workers reading from Iceberg (works, and is what
you'd reach for at 10M hands; gets awkward at 1B). ClickHouse itself (can't run your Python
parser). So: Spark, correctly.

**My reservation — the ML feature-engineering justification is probably wrong.** "Feature
engineering for leak models" here means computing aggregate stat vectors per player per spot
bucket. That is a `GROUP BY` over data that already lives in ClickHouse, and ClickHouse will do
it faster than Spark for any volume you'll realistically have, with Polars covering whatever
post-processing the model needs. I'd expect Spark to never be needed for the ML path. Keep it
for re-parse, and treat "Spark for ML features" as unproven until a specific job actually
doesn't fit ClickHouse.

**Consequences.** Spark stays a scale-to-zero, on-demand component with exactly one job. That's
a small operational surface. The learning-plan sprints (17–20) still deliver full value because
re-parse is a real, product-justified Spark workload — you won't be inventing an exercise.

---

## ADR-007 — Iceberg over Delta Lake
**Status:** ✅ My recommendation

**Context.** The lake needs a table format so batch tools can read and reprocess raw and
canonical hands, with schema evolution as a first-class requirement.

**Decision.** **Apache Iceberg**, catalogued by Nessie (already running) or by an
Iceberg-REST-compatible service in production.

**Alternatives.**

| | Iceberg | Delta Lake |
|---|---|---|
| Engine support | Spark, Trino, ClickHouse, DuckDB, Flink — genuinely vendor-neutral | Best-in-class on Spark/Databricks; adequate elsewhere |
| Schema evolution | Add/drop/rename/reorder by **column id**, no data rewrite | Supported, historically more constrained |
| Partition evolution | **Yes** — change the partition spec without rewriting history | No |
| Hidden partitioning | Yes — queries don't need to know the partition scheme | No |
| Already in your lab | **Yes** — Nessie + Spark + Trino all wired and smoke-tested | No |
| In your learning plan | **Yes** — sprint 19 | No |

**Consequences.** Iceberg wins on four independent axes here and loses on none that matter to
you. **Partition evolution** is the one people underrate: if you partition
`hands_history` by month and later discover you need `(month, site)`, Iceberg changes the spec
going forward and keeps reading old data. Delta would mean a rewrite. Given that the canonical
model *will* change — bounties, straddles, run-it-twice — this is a real property, not a
brochure feature.

Delta would only win if you were committed to Databricks. You aren't.

---

## ADR-008 — Greengage is a sandbox, not a product component
**Status:** 🔒 Locked — and I agree completely

**Context.** Greengage (a Greenplum fork) is deployed in the lab and is a valuable interview
topic for the RU market.

**Decision.** Greengage is a **learning sandbox**. It never touches the product's critical path.
Later, load the same poker dataset into it and compare MPP query behaviour against ClickHouse.

**Why it's redundant — the teaching version.** Greengage and ClickHouse are both analytical
warehouses solving the same problem: scan a lot of rows fast. They differ in *how*.

- **Greengage is MPP shared-nothing over Postgres.** A coordinator plans; each segment executes
  on its own slice; when a join needs rows living on the wrong segment, the plan inserts a
  **Motion** node to physically move data across the network. Strengths: full ANSI SQL, real
  transactions, genuinely good at complex many-table joins.
- **ClickHouse is a columnar engine optimized for wide single-table scans.** Strengths: it is
  dramatically faster at "filter and aggregate one huge table," which is *exactly* the shape of
  every poker stat (`sum(vpip_action)/sum(vpip_opp)` over a flag table). Weaknesses: large
  distributed joins, and no meaningful transactional updates.

Running both would mean two copies of every hand, two schemas to keep in sync, two dialects of
stat logic, and two systems to operate — to serve a workload that only ever asks the question
ClickHouse is best at. **That's the redundancy.** The flag-table design in
[POKER_DATA_MODEL.md §4.3](POKER_DATA_MODEL.md#43-the-flag-table--the-heart-of-the-stat-layer)
exists specifically so the hot path is a single-table scan — which removes the one workload
where Greengage would have had an edge.

**Consequences.** You keep a genuinely valuable interview topic (distribution keys, data motion,
broadcast vs. redistribute — the material in sprints 15–16) and you keep it out of production.
Operationally: it runs amd64-emulated on your arm64 Mac and is CPU-hungry, so scale it to zero
when idle — `kubectl -n data-platform scale statefulset/greengage --replicas=0`.

---

## ADR-009 — Multi-tenancy by tenant key, not by database
**Status:** ✅ My recommendation (nothing in the lab has this yet)

**Context.** 100,000 users eventually, heavily skewed: most under 500k hands, heavy users at
5–10M+.

**Decision.** One cluster, one schema, `user_id` as the leading column of every ClickHouse
`ORDER BY`; per-tenant CH quotas and settings profiles; tenant injected server-side from the JWT
on every query; `user_id=` prefixes in object storage; `key = user_id` in Kafka.

**Alternatives.** *Database per tenant* — 100,000 databases is not a thing you can operate, and
ClickHouse would drown in metadata. *Schema per tenant* — same problem, smaller. *Separate
cluster for heavy users* — a real option **later**, for a handful of extreme accounts; premature
now.

**Consequences.** Simple operations, one migration path, one backup. The two risks are (1) a
tenancy bug leaking data across users — mitigated by making `user_id` a non-optional constructor
argument on every query builder so it *cannot* be forgotten, and never accepting it from a
client; and (2) noisy neighbours — mitigated by CH quotas and by isolating bulk imports on their
own Kafka topic.

**Get this right in the first schema.** The ClickHouse sort key *is* the physical layout;
retrofitting `user_id` into the front of it later means rewriting every table.

---

## ADR-010 — Raw hand text is the source of truth; ClickHouse is derived
**Status:** ✅ My recommendation, aligned with your stated requirement

**Context.** You want raw text kept forever so hands can be re-parsed after parser fixes.

**Decision.** Raw text in object storage is **the** source of truth, immutable, compressed with
zstd, never modified. Everything in ClickHouse is a derived cache that could be rebuilt from it.
Every canonical row carries `parser_version` and a pointer (`raw_object_key`, `raw_byte_offset`)
back to the bytes it came from.

**Alternatives.** Keep only parsed data (smaller and cheaper — and a parser bug becomes
permanent data loss, which for an analytics product is fatal). Keep raw text in ClickHouse
(it's not a blob store; you'd be paying analytics-store prices for archival bytes).

**Consequences.** A parser bug is a re-parse, not a catastrophe. Storage cost is modest — hand
histories compress ~8–12× and the parsed columnar form is smaller again. Backup priorities
become clear and asymmetric: **losing ClickHouse costs you time; losing object storage costs you
the product.** Note the compliance corollary — "forever" includes other players' screen names,
so retention and deletion need a documented position (see
[POKER_GAP_ANALYSIS.md](POKER_GAP_ANALYSIS.md#cross-cutting-gaps)).

---

## ADR-011 — The solver is a baseline producer behind a `spot_key` seam
**Status:** ✅ My recommendation for the seam design

**Context.** A future CFR solver (TexasSolver as a compute service, or purchased outputs) should
produce baseline ranges the stats and AI layers read. You are not building the solver.

**Decision.** The seam is a **`spot_key`** — a deterministic hash of
`(game_type, stakes_bucket, positions, stack_depth_bb, preflop_action_sequence, street,
board_texture_bucket)`. Baseline set *metadata* lives in Postgres (`baseline_sets`); the
strategy payload lives in ClickHouse or the lake as `(baseline_set_id, spot_key, action,
frequency, ev, sample_size)`. The deviation scorer joins the user's aggregated frequencies to
baseline frequencies on `spot_key`. Any producer — solver, purchase, or your own population
data — writes the same shape.

**Alternatives.** Call a solver at query time (far too slow, and wasteful — the same spots recur
constantly). Store full solver trees (enormous, and you only need frequencies at the decision
nodes). No abstraction, integrate a specific solver directly (locks you to one vendor's output
format forever).

**Consequences.** The solver becomes swappable and optional. Critically, **population baselines
come free**: once you have hands from many users, "what does the pool do here" is a `GROUP BY
spot_key` over your own data — a real product feature requiring no solver at all, and the way
you should validate the seam before any solver exists.

**Emit `spot_key` from phase 1**, even with nothing to join against. An unjoined column costs
nothing; retrofitting one costs a full reprocess of everything.

---

## ADR-012 — The AI layer is aggregate-first and batch-only
**Status:** 🔒 Locked — and correct

**Context.** Leak detection compares a player's stats to population and GTO baselines; an LLM
turns the findings into advice. Users have millions of hands.

**Decision.** Compute deviations with SQL over aggregates. Rank them by magnitude × frequency ×
estimated EV loss. Feed the LLM the top 3–5 findings plus 3–5 hand-picked example hands each —
a few kilobytes total. Never raw hands in bulk. Generate asynchronously, cache the result in
Postgres, serve the cache.

**Alternatives.** RAG over raw hands (expensive, slow, and worse — an LLM reading 500 hand
texts is a bad statistician; a `GROUP BY` is a perfect one). Fine-tuning on hand histories
(costly, hard to evaluate, and it still wouldn't compute frequencies reliably). Real-time LLM
analysis per hand (no budget for it in a 300 ms path, and no user need).

**Consequences.** Costs stay bounded and roughly constant per report regardless of database
size. The quality ceiling is set by the **deviation scorer**, not the LLM — which is the right
place for it, because ranking leaks is arithmetic and explaining them is language. Build and
validate the scorer first; the LLM is the last and easiest step.

---

## ADR-013 — Rent anything with a replication protocol
**Status:** ✅ My recommendation

**Context.** Solo maintainer. Every self-hosted stateful system is an on-call rotation of one.

**Decision.** Self-host your own code (FastAPI, parser workers, dbt, Spark jobs). Use managed
services for **PostgreSQL, ClickHouse, Redis, object storage, and Kafka**. Keep the full
self-hosted stack in the minikube lab, where its purpose is understanding what the managed
services do.

**Alternatives.** Self-host everything (cheapest in cash, most expensive in the only resource
you can't buy more of; and the failure modes — a botched ClickHouse Keeper upgrade, a Kafka
partition reassignment gone wrong — arrive at the worst possible time). Serverless everything
(no realistic ClickHouse-equivalent, and per-query pricing fights an interactive dashboard).

**Consequences.** Higher monthly cost, dramatically lower operational risk, and your time goes
to the parser and the product — which is where all the differentiation is. **ClickHouse is the
component where managed buys the most**: replication, Keeper, merges, backups and upgrades are
each a way to lose a weekend.

Provider choice is deliberately out of scope here; the principle is provider-agnostic. The lab
stays as-is regardless — it's the teaching artifact, not the production plan.

---

## ADR-014 — The ingestion contract is versioned and frozen early
**Status:** ✅ My recommendation

**Context.** Browser uploads today; a desktop HUD agent streaming hands later; a bulk importer;
a re-parse pipeline. All produce hands. The agent will ship on users' machines and cannot be
force-upgraded.

**Decision.** One versioned HTTP contract (`/v1/uploads`, `/v1/hands:batch`, and later
`/v1/stream`), with three invariants:

1. **Content-addressed idempotency** — every hand carries a stable `external_id`; re-sending is
   a no-op. An agent that crashes and re-scans a folder must be harmless.
2. **Tenancy from the token, never from the payload.** No endpoint accepts a client-supplied
   `user_id`.
3. **Clients send raw text, never parsed structures.** The server parses. This is what makes
   "fix the parser, re-parse everything" possible and keeps the agent thin enough to be
   maintainable.

**Alternatives.** Let the agent parse locally and upload canonical hands (halves server CPU —
and permanently splits the parser into two implementations on two release cycles, with the
client one un-upgradable. This is the trap). An unversioned contract (guarantees a breaking
change reaches deployed agents). Direct-to-object-storage uploads with presigned URLs (a fine
*optimization* for very large files, but it bypasses the validation and quota checks the API
should own — add it later as an alternate path, not as the contract).

**Consequences.** The agent, the browser, and the bulk importer are the same client from the
server's perspective. The cost is that the server does all the parsing work — which
[POKER_DATA_MODEL.md §10](POKER_DATA_MODEL.md#10--parser-throughput--the-honest-numbers) shows
is roughly one core at 100k users, so it is not a real cost.

**Design this in phase 1, when there is one client and changing it is free.** By the time the
agent ships, the contract is load-bearing on machines you don't control.

---

## ADR-015 — docker-compose for the product; minikube stays the learning lab
**Status:** 🔒 Locked

**Context.** The repo already contains a full minikube stack (ClickHouse, Postgres, Kafka, MinIO,
Airflow, Spark, Trino, Nessie, Debezium, Greengage) that took eleven phases to build and works.
The product needs a local dev environment. The obvious question is whether to reuse the lab.

**Decision.** **Two separate environments, deliberately.** The product gets a `docker-compose.yml`
with ClickHouse + Postgres + Kafka + Redis + MinIO, healthchecks, and a `make up` / `make seed` /
`make test` workflow. The minikube lab stays exactly as it is: the interview-prep and
learning artifact.

**Alternatives.** *Build the product on minikube* — the lab is tuned for teaching (LocalExecutor,
single replicas, `kubectl cp` DAG sync, an emulated amd64 Greengage) and carries components the
product doesn't want. It also couples "I broke the lab while studying" to "I can't work on the
product." *One environment with profiles* — sounds tidy, produces a config nobody can reason about.

**Consequences.** Two things to maintain, which is the honest cost. In exchange: the product's
local stack starts in seconds instead of minutes, has five services instead of seventeen, needs no
Kubernetes knowledge to debug, and can be thrown away and recreated freely. The lab keeps its own
purpose and its own golden rules.

**Practical note.** Don't run both at once on a 20Gi machine unless you've checked the headroom —
`make down` in the lab scales it to zero while keeping PVCs.

---

## ADR-016 — Nuxt 4 / Vue 3 for the dashboard
**Status:** ✅ My recommendation

**Context.** The MVP needs a web dashboard: winnings and EV graphs, a stats table driven by the
filter engine, and a hand-replayer stub. The brief asked for "the lightest option that fits a
Python-centric team."

**Decision.** **Nuxt 4 / Vue 3** with `<script setup lang="ts">`, Pinia setup stores, and
`useFetch`/`useAsyncData`. The single strongest reason: **your global conventions already specify
Nuxt 4 / Vue 3 in detail** — props/emits/`defineModel` patterns, Pinia store style, scoped styles,
`nuxt typecheck` before finishing. That's not a preference, it's an existing standard you already
work to, and adopting anything else means writing conventions from scratch.

**Alternatives.** *React SPA* — larger ecosystem, more charting options, and no reason to prefer it
when your standards are Vue. *Server-rendered Python (HTMX + Jinja, or Streamlit)* — genuinely
lighter and tempting for a Python-centric team, and the right answer if the dashboard stayed
static. It isn't: the filter engine, the interactive graphs and especially the hand replayer are
real client-side state, and that's where server-rendered approaches start fighting you.
*Metabase/Superset on ClickHouse* — excellent for *your* internal analysis, and worth doing for
that, but it can't be the product UI.

**Consequences.** A JavaScript toolchain to maintain alongside Python — real, and unavoidable for
an interactive analytics product. Mitigated by keeping the frontend thin: it renders what the API
returns and holds no stat logic. The API stays the contract, which also means the frontend can be
replaced without touching the platform.

**Note.** Consider Metabase against ClickHouse anyway in Phase 1 as an *internal* tool. It costs an
afternoon and lets you inspect stats while the dashboard is still being built.

---

## ADR-017 — ClickHouse migrations are versioned SQL, not a framework
**Status:** ✅ My recommendation

**Context.** Postgres gets Alembic. ClickHouse has no equivalent with comparable maturity, and the
schema will change repeatedly as the canonical model grows.

**Decision.** Numbered, append-only `.sql` files (`ch/migrations/0001_core_tables.sql`, …) applied
in order by a small idempotent Python runner that records applied versions in a
`_schema_migrations` table. Every statement written to be re-runnable: `CREATE TABLE IF NOT
EXISTS`, `ALTER TABLE … ADD COLUMN IF NOT EXISTS`. **dbt owns `staging`/`marts`; migrations own
`core` and the rollup target tables.**

**Alternatives.** *`golang-migrate` / `dbmate`* — both support ClickHouse and are perfectly
reasonable; they add a non-Python tool to the stack for something a 60-line runner does. *dbt for
everything* — dbt doesn't manage the landing tables the parser writes into, and shouldn't. *No
migrations, just apply DDL by hand* — works right up until an environment drifts and you can't
tell which.

**Consequences.** No down-migrations, which is the right tradeoff: ClickHouse DDL rollbacks are
mostly fictional anyway, and forward-only with `IF NOT EXISTS` is honest about that. The one real
discipline this demands: **changing a sort key is not a migration, it's a table rebuild** — which
is exactly why `user_id` has to lead the `ORDER BY` from migration 0001
([ADR-009](#adr-009--multi-tenancy-by-tenant-key-not-by-database)).

---

## ADR-018 — All-in equity uses a vetted evaluator, computed at parse time
**Status:** ✅ My recommendation

**Context.** The EV-adjusted winnings line (F-502) is the most-looked-at chart in any poker
tracker — it's how a player separates running bad from playing bad. It needs each all-in's equity
at the moment the money went in.

**Decision.** Use a **vetted, fast hand evaluator library** (`phevaluator`, `eval7`, or
equivalent) rather than writing one. Compute equity **at parse time**, store `equity` and
`ev_won` on `hand_player`, and never recompute at query time.

**Alternatives.** *Write our own evaluator* — a solved problem with subtle correctness traps and
no upside. *Compute at query time* — a 7-card Monte-Carlo per all-in per query, in a 300 ms
budget, for a user with 10M hands. No. *Skip EV adjustment in MVP* — defensible on effort grounds,
but this is the chart users check first; shipping without it reads as incomplete.

**Consequences.** Parse-time cost rises for the small fraction of hands containing an all-in
(exhaustive enumeration for a river all-in is trivial; a preflop all-in with two players is ~1.7M
board runouts, so use a precomputed preflop equity table for the common two-player case and
enumerate the rest). Storage cost is two columns. Query cost is zero.

**Correctness note worth flagging:** multiway all-ins with side pots make "equity" ambiguous —
equity against the whole field is not what determines your share of each pot. Model it per-pot,
and if that's too much for MVP, restrict EV adjustment to two-player all-ins and **say so in the
UI**. Silently computing a wrong number for multiway spots is worse than not computing one.

---



## ADR-019 — The stat chain is incremental by daily partition, anchored, and backfilled in batches
**Status:** ✅ Implemented 2026-09-09 *(rewritten the same day — the first version recorded monthly
partitions and per-model watermarks, both of which were replaced within hours; see
[POKER_AUDIT.md](POKER_AUDIT.md) §6)*

**Context.** `int_hand_player_flags` was a full-refresh CTAS joining eight relations at 54.5M-row
grain, and `marts.player_hand_flags` rebuilt on top of it. That single pattern was the only
reason ClickHouse was configured for 15 GB — serving a stat query over the same table uses
13–29 MiB. Production is a cluster of **small (~4 GB) nodes**, not one large server, so peak
memory per dbt run is the constraint that decides the design.

**Decision.** Four parts, all in `dbt/poker_dwh/macros/incremental.sql` and `scripts/backfill.py`:

1. **Partition-grain `insert_overwrite`**, partitioned by **`toYYYYMMDD(played_at_utc)`** (daily).
   Every model in the chain is `materialized='incremental'`; the gate `dirty_partitions()` is
   repeated on **every** relation of every join, because ClickHouse builds the right-hand side in
   memory and does not push the predicate through a `LEFT JOIN`.
2. **Per-partition watermark.** A partition is dirty when `max(core.hands.parsed_at)` for that day
   exceeds `max(src_parsed_at)` already built for that day. A single global watermark was tried
   first and silently skipped partitions: ingest order and partition order are unrelated, so one
   late-ingested 2023 hand pushed the watermark past 972,943 December-2024 hands. The per-partition
   comparison is answered from part metadata in ~20 ms.
3. **One anchor for every model.** The built side of the comparison is always
   `marts.player_hand_flags` (the last model), never `{{ this }}`. With per-model state, a failed
   pass let upstream models advance while downstream ones did not, so the next pass built day X in
   `int_hand_player_flags` before `int_postflop_context` had it — every c-bet counter for that day
   came out zero with no error (pool c-bets 1,824,127 → 626,804). Flop-only models also never
   "contain" a flopless day and would stay dirty forever. Anchoring gives every pass one identical
   partition set built in dependency order; a failure anywhere leaves the set dirty and the next
   pass redoes it.
4. **Bootstrap in batches, never in one shot.** `scripts/backfill.py` loops dbt over the oldest N
   dirty partitions (`--vars batch_partitions`), halving N on a memory failure and doubling after
   three clean passes. `max_partitions_per_insert_block` stays at its default of 100 on purpose:
   an unbatched full refresh fails fast with a clear error instead of exhausting memory.

**Measured.** Monthly grain, one-shot full refresh: 781 s at 7.30 GiB, fingerprint reproduced
exactly (54,563,210 rows / 12,453,044 vpip / 29,080,102 rfi_opp / 1,824,127 cbet_flop). Hero
increment: **781 s → 4 s, peak 591 MiB** (700 MiB at `CLICKHOUSE_MEM=4G`). Rebuilding one
partition of `int_hand_player_flags`: monthly 2024-12 (5.9M rows) 2.27 GiB fits; monthly 2025-01
(20.5M rows) 3.06 GiB **fails on 4 GB** and gets *worse* with fewer threads (the cost is the
20.5M × 155-column output, not parallelism); daily (≤ 898k rows) is comfortable. **Daily bootstrap
of the full 9.09M-hand corpus on a 4 GB node: 19 passes, 581 s, peak 2.00 GiB.** ClickHouse
baseline RSS 3.60 → 1.12 GiB after sizing the caches (`infra/clickhouse/small-node.xml`:
mark cache 512 MiB, uncompressed cache off); per-query ceiling 2.5 GB, `max_threads 2`
(`limits.xml`).

**Why daily works now when it failed before.** Daily was first rejected because a one-shot full
refresh opens every partition at once and ClickHouse holds a write buffer per column per open part:
155 columns × 164 parts demanded > 11 GiB in `int_postflop_context`. That failure belongs to the
one-shot path. With the batch loop writing a few partitions per pass the buffers never multiply, and
the one-shot path is no longer used to bootstrap.

**Why partition grain is not a detail.** `insert_overwrite` works by `ALTER TABLE … REPLACE
PARTITION`, which swaps the **whole** partition. Filtering at row grain —
`parsed_at > watermark`, the instinctive choice — would emit only the newly-parsed hands of a
month and then replace that month with just them, silently deleting every hand already there.
The filter must select *all* hands in any partition that received new data.

**Two data traps met on the way, recorded because both were silent.** (a) `core.*` is
`ReplacingMergeTree` partitioned by `played_at_utc`, and ReplacingMergeTree only deduplicates
*within* a partition: the timezone fix moved boundary hands into the next day and orphaned 41,677
pre-fix copies that no merge or `FINAL` would ever collapse; they had to be deleted by `parsed_at`
cutoff. Any re-parse that changes `played_at_utc` will do the same. (b) clickhouse-connect treats a
*naive* datetime as local time and converts it to UTC, so stripping `tzinfo` shifted every hand by
the host's UTC offset; the loader now passes aware datetimes and a regression test guards it.

**Alternatives.** *`append` + ReplacingMergeTree* — collapses rows only when they share a sort
key, and a re-parse can change one: parser bug #4 corrected `player_key` for 6.2% of GGPoker
seats, which moves the row. `append` would leave two rows per seat that never merge.
*`delete+insert`* — lightweight deletes are asynchronous mutations; at this row count that is a
worse failure mode than a partition swap. *dbt `microbatch` on `played_at_utc`* — keys on event
time, so a backfill of older dates is never picked up.

**Consequences.**
- The gate must be repeated on **every** relation in a join, not just the driving table:
  ClickHouse does not push the predicate through a `LEFT JOIN`, and the unfiltered right-hand
  side is exactly what has to be built in memory.
- Five intermediates gained `played_at_utc` and `src_parsed_at` so they can be partitioned and
  watermarked.
- The loader now stamps `parsed_at` explicitly once per batch instead of letting the column
  default fire per-INSERT, which had been giving one hand four timestamps milliseconds apart
  across the four core tables.
- ClickHouse's default drops from 15 GB to **4 GB** (`CLICKHOUSE_MEM`), per-query ceiling
  2.5 GB. Keep `infra/clickhouse/limits.xml`, `small-node.xml` and the compose limit in step: a
  ceiling above the container cap means Docker OOM-kills the server instead of ClickHouse
  rejecting one query, which is exactly what happened when 12 GB was tried inside 15 GB.
- Changing partition granularity means changing it in three places: the model configs, the macro,
  and `PARTITION_EXPR` in `scripts/backfill.py` (they drifted once).

**Known edge, accepted:** if a re-parse removed *every* hand from a day, the temp table would
produce no partition for it and the stale partition would survive. Hands are never deleted, so
this is theoretical; a full refresh is the remedy.

**Not addressed here:** F-202 materialized views and sharding by `user_id` (ADR-025). The
incremental scan still reads every row of each source before filtering (`read_rows` 54.7M to write
20k) because `IN (subquery)` does not prune partitions at scan time; resolving the dirty days to
literals at compile time would fix that — a read cost, not a memory cost, deliberately deferred.

---

## ADR-020 — A decision-level fact table is the source of truth for situations
**Status:** ✅ Recommended, accepted by the founder 2026-09-09 ("as fast as Hand2Note or faster,
and the most powerful"). Built in [POKER_PLAN.md](POKER_PLAN.md) phase C.

**Context.** The v1 stat layer is one wide row per (hand, player) with a fixed opportunity/action
counter pair per stat — 156 columns. It answers any of its 86 counters sliced by any of 28
pre-bucketed dimensions, and nothing else: no numeric thresholds (`spr`, `stack_at_flop_bb`,
`bet_size_pct` are computed and discarded), no "when I was the aggressor", no action-line filter,
no `a/(a+b+c)` arithmetic. A new situation is a dbt edit on a 54M-row table plus a rebuild
([POKER_AUDIT.md](POKER_AUDIT.md) §3.1).

**Decision.** `marts.decisions`: **one row per decision point** (a seat that must act), carrying
the full state *before* the decision — street, what is being faced and its size, raises so far,
callers, aggressor flags, position and IP/OOP, effective stack and SPR as raw numbers, the action
line so far as compact strings, board texture at that street, holding — plus the action taken and
the hand's outcome. Any situation is a predicate over that row; any situation stat is
`countIf(situation AND action) / countIf(situation)`. A slim `marts.player_hands` (one row per
hand and player, ~25 columns) serves hand-grain stats (VPIP, PFR, WTSD, bb/100). Both use the
ADR-019 incremental gate; `player_hands` becomes the anchor. All "before this decision" facts are
computed from per-hand arrays so joins stay at hand grain. Column list in POKER_PLAN §2.3.

**Alternatives.** *Keep the wide row and add action-line strings + an expression DSL* — cheaper
now, but every new counter still widens the table and needs a rebuild, and numeric situations stay
impossible without new columns. *Compute situations at query time from `core.actions`* — correct
and infinitely flexible, but every question is a window-function pass over 100M actions; the
decision table is exactly that pass, done once at write time.

**Consequences.** ~65M rows for the current corpus (100M actions minus posts/wins/shows), narrow
LowCardinality columns; a pool question is a filtered aggregate over a sorted MergeTree — the
ClickHouse-ideal shape. The v1 chain is deleted only after a parity gate on every built-in stat
(POKER_PLAN §3). `made_hand` is reserved for the evaluator (F-902).

---

## ADR-021 — The stat registry is data, and every consumer is generated from it
**Status:** ✅ Recommended. Built in phase C.

**Context.** Stat definitions exist in three hand-written copies (`int_hand_player_flags.sql`,
`api/queries.py`, `dim_stat_definitions.sql`) and have already diverged; 29 stats exist in the
mart but not in the API; the dbt law test covers 14 of 46 pairs (AUDIT B3, B6).

**Decision.** `platform/stats/registry/*.yaml` is the single source: each stat has a code, label,
category, grain (`hand` | `decision`), a situation predicate and an action predicate (or explicit
numerator/denominator expressions), `higher_is_better`, a typical range, a description and a
`cached` flag. Dimensions are declared the same way (type, allowed ops, enum values, which tables
hold them). `scripts/gen_stats.py` (`make gen`) renders the rollup model, the definitions seed and
the law tests for **every** stat; CI fails if regeneration produces a diff. The API loads the same
YAML at startup; the UI reads `/v1/definitions`. Adding a built-in stat is one YAML entry; a user
stat is a Postgres row; neither touches SQL by hand.

**Alternatives.** *Keep Python as the source and generate SQL from it* — works, but couples the
definitions to the API process and makes dbt depend on the app package. *dbt-only definitions*
(the v1 intent) — dbt cannot serve labels, typical ranges or filter metadata to the UI, which is
how the three copies appeared.

**Consequences.** Generated SQL files carry a header and are never edited; a registry entry is
validated at load (dimension exists, op allowed, value in enum). The registry is the contract
between dbt, the API and the UI.

---

## ADR-022 — Filters and custom stats are a typed JSON AST, not a text DSL
**Status:** ✅ Recommended. Built in phase C.

**Context.** Filters today are `column IN (list)` over an allowlist; PT4's custom stats are SQL,
which is a remote-code-execution surface in a multi-tenant cloud product. F-313 asked for an
"expression DSL".

**Decision.** Filters are a JSON tree (`all` / `any` / `not` / leaf `{dim, op, value}`) with ops
`in, not_in, eq, ne, lt, lte, gt, gte, between, prefix, like`, validated by Pydantic against the
dimension registry before anything reaches the compiler. Custom stats are `{numerator, denominator}`
expressions over `count`, `sum(dim)`, `countIf(node)` and `+ − × ÷`. The compiler emits only bound
parameters and registry-qualified identifiers; `tenant_id` and `dataset` are constructor arguments.
The table router picks the cheapest of rollup → `player_hands` → `decisions` by *both* the stats
and the dimensions requested (fixes AUDIT B4).

**Alternatives.** *A text expression language* — needs a parser, an error model and escaping
rules, and is harder for a UI to build; the JSON tree is what a form produces anyway.
*Free-form SQL with a sandbox* — no.

**Consequences.** A situation builder in the UI maps 1:1 to the AST; saved filters, reports and
stats are JSON rows; the existing 25 injection tests carry over and gain AST cases.

---

## ADR-023 — Strict module layering enforced in CI, with storage behind Protocols
**Status:** ✅ Recommended. Built in phase B.

**Context.** `ingestion/*` and `ch/migrate.py` import from `api/`; `api/db.py` builds a database
engine at import time; storage clients are `lru_cache` singletons with no interface; the Kafka
worker and the bulk importer run two diverged copies of the ingest loop; the core schema is spelled
out in seven places; table names are hardcoded so tests write into the analysis database
(AUDIT B2, B10, B11, B12).

**Decision.** Layers `core ← parser ← ingestion ← stats ← analysis ← api`, with `scripts/` and
`web/` as leaves, enforced by `import-linter` in `make check`. Settings live in `core/settings.py`;
the ClickHouse client factory in `ingestion/`. `HandSink`, `RawStore`, `EventBus` are Protocols
with real and fake implementations; `pipeline.ingest_text()` is the only ingest loop and takes
sinks by constructor. `core/schema.py` declares every core table once; row builders and staging
SELECTs derive from it and an integration test compares it to `system.columns`. Database names
carry a settings-driven prefix so the integration suite uses `test_core`/`test_marts` and the
founder's analysis tables are never written by a test. Function and file size limits
(40 / 300) are checked mechanically.

**Alternatives.** *Separate Python packages per layer in a uv workspace* — stronger isolation,
more ceremony; revisit when a second deployable (the worker image) actually ships separately.
*Trust code review* — that is how the backwards imports got in.

**Consequences.** A backwards import fails CI; a sink can be swapped by config; unit tests cover
the ingest loop without a stack; the analysis databases are protected by construction, not by a
cleanup fixture.

---

## ADR-024 — Nuxt 4 app in SPA mode, one shared filter model, two entry points
**Status:** ✅ Recommended (extends ADR-016). Built in phase D.

**Context.** The shipped UI is one static page with three controls (AUDIT §3.4). The founder wants
both a guided dashboard for end users and an advanced workbench, from the start, English only.

**Decision.** `platform/web/`: Nuxt 4 / Vue 3, `ssr: false` (everything is behind auth and FastAPI
is the only server), Pinia setup stores, TypeScript strict. Two areas — **My game** and **Pool** —
plus Hands and Upload. One filter object shared by every page and encoded in the URL; a dataset
toggle (My hands / Pool / Compare) on every analytical page; a `SituationBuilder` that emits the
ADR-022 AST; one `StatGrid` component reused by both areas; every number shown with its sample size
and greyed under the registry's `min_n`; labels and definitions come from `/v1/definitions`; presets
are the landing state of every page. Auth: access token in memory with silent refresh via the
HttpOnly cookie; CORS with an explicit origin; per-IP limits on auth routes.

**Components are modular by rule (founder, 2026-09-09):** each poker concept — the 13×13 hand
matrix, a card, a board, a position picker, an action line, a stat cell — is exactly one typed
component in `web/components/poker/`, with no store or API knowledge, reviewed on a fixture page.
Pages and feature components compose these primitives and never re-implement them; the hand
matrix, for example, serves the pool ranges view, the holding filter and hand-class results from
one file. New report types register a panel component instead of adding a page.

**Alternatives.** *Server-rendered pages* — rejected in ADR-016 for the same reasons that still
hold. *Grow the static page* — its own header says "Replace it, don't grow it."

**Consequences.** A JS toolchain in CI (`nuxt typecheck`, ESLint, Playwright); the client holds no
stat logic, so the API remains the product contract.

---

## ADR-025 — Freshness and scale: materialized views generated from the registry, then shard by tenant
**Status:** ✅ Recommended. Phase E.

**Context.** ADR-003 requires dbt and the ClickHouse MV to express the same logic and flagged
drift as the main risk. Production is a cluster of small nodes.

**Decision.** The rollup SQL is generated from the registry (ADR-021) once, and the same template
emits the `MATERIALIZED VIEW … TO marts.stats_daily` DDL, with the boundary-marker backfill and a
reconciliation test on a window. The rollup engine is `SummingMergeTree` with every group key in
the sort key. Scale: shard `marts.*` by `cityHash64(user_id)`, keep the population dataset on its
own shard, `Distributed` tables on top, dbt per shard; per-tenant settings profiles and quotas.
Written as a design document first; built when a second node exists.

**Consequences.** Stats are fresh seconds after an upload without a dbt run; the MV cannot drift
from the model because neither is written by hand.

---

## ADR-026 — Hero analysis and pool analysis are separate modules, as in Hand2Note
**Status:** 🔒 Locked by the founder, 2026-09-09.

**Context.** Hand2Note keeps *player reports* (hero or any opponent, filtered by situation) apart
from *population analysis* (a cohort of many players; ranges and frequencies by spot). The founder
wants the same separation so the two evolve independently.

**Decision.** Two packages under `platform/analysis/`, each with its own service, API router,
report presets and UI area: **`hero`** (My game: overview, sessions, saved reports, leaks vs a
baseline, hand context) and **`pool`** (Pool: population stats by situation, cohorts by stat
criteria, per-opponent reports on real screen names, ranges from showdowns, and the
`BaselineProvider`). Both call the shared `stats` engine and contain no stat SQL. `hero` may import
only `pool.baselines` (a Protocol), `pool` never imports `hero`; import-linter enforces it. A new
analysis module is one package plus one `include_router`.

**Alternatives.** *One analysis module with a dataset switch* — simpler, but every hero feature
would read pool tables directly and the two could never be deployed, cached or scaled apart.

**Consequences.** Population baselines reach the hero module only through the seam that a solver
implementation will later use (ADR-011). The UI mirrors the split, which is also how players
think about the two questions.
