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
