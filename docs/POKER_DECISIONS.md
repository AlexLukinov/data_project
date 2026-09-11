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
| [027](#adr-027--range-lab-is-a-typescript-workspace-of-framework-free-packages-behind-one-nuxt-app-with-a-licence-allowlist-in-ci) | Range Lab: framework-free TS packages behind one Nuxt app; licence allowlist in CI | 🔒 |
| [028](#adr-028--a-node-is-a-predicate-over-decisions-nodekey-is-defined-once-and-buckets-live-in-the-registry) | A node is a predicate over `decisions`; `NodeKey` defined once; buckets live in the registry | ✅ |
| [029](#adr-029--hand-histories-are-parsed-server-side-only) | Hand histories are parsed server-side only | 🔒 |
| [030](#adr-030--charts-in-poker-ui-are-hand-drawn-svg-not-a-chart-library) | Charts in `poker-ui` are hand-drawn SVG, not a chart library | ✅ |
| [031](#adr-031--the-range-library-the-server-is-the-record-versions-are-append-only-nodekey-lands-with-it-importers-are-pure-functions) | The range library: server is the record, versions append-only, `NodeKey` lands with it, importers are pure functions | ✅ |
| [032](#adr-032--the-replayer-one-hand-shape-from-three-sources-states-are-derived-the-node-is-the-decision-just-made) | The replayer: one hand shape from three sources, states are derived, the node is the decision just made | ✅ |
| [033](#adr-033--what-the-pool-may-say-a-node-is-only-as-good-as-its-columns-and-a-range-is-only-the-hands-that-were-shown) | What the pool may say: a node is only as good as its columns, and a range is only the hands that were shown | ✅ |
| [034](#adr-034--the-analyzer-the-answer-is-fetched-after-the-commit-a-save-is-a-merge-and-a-reveal-names-its-own-authority) | The analyzer: the answer is fetched after the commit, a save is a merge, and a reveal names its own authority | ✅ |
| [035](#adr-035--tier-3-estimates-a-likelihood-ratio-not-a-frequency-and-reports-its-own-error-eqr-is-split-between-the-pool-and-the-engine) | Tier 3 estimates a likelihood ratio, not a frequency, and reports its own error; EQR is split between the pool and the engine | ✅ |
| [036](#adr-036--shard-by-cityhash64user_id-with-a-reserved-tenant-for-the-pool-buy-threads-before-shards) | Shard by `cityHash64(user_id)` with a reserved tenant for the pool; buy threads before shards | ✅ planned (E) |
| [039](#adr-039--all-in-ev-redistributes-the-pot-that-was-actually-awarded-per-side-pot-and-only-where-the-runout-happened) | All-in EV redistributes the pot that was actually awarded, per side pot, and only where the runout happened | ✅ |

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
3. **One anchor for every model, and it is the LAST model.** The built side of the comparison
   is always `marts.stats_daily`, never `{{ this }}`. With per-model state, a failed pass let
   upstream models advance while downstream ones did not, so the next pass built day X in
   `int_hand_player_flags` before `int_postflop_context` had it — every c-bet counter for that day
   came out zero with no error (pool c-bets 1,824,127 → 626,804). Flop-only models also never
   "contain" a flopless day and would stay dirty forever. Anchoring gives every pass one identical
   partition set built in dependency order; a failure anywhere leaves the set dirty and the next
   pass redoes it. The anchor was first set to `player_hand_flags`; `stats_daily`, which builds
   after it, then saw nothing dirty and stayed empty — the rollup route answered "0 hands" with no
   error. Hence *last* model, and if one is ever added downstream, the anchor moves to it.
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
- **Changing any column type or adding a column is a chain recreation, not a run.**
  `insert_overwrite` swaps partitions between the temp table and the target, so their DDL must
  match. Procedure: `dbt run --full-refresh --vars 'empty_chain: true'` (the macro returns an
  always-false gate, so every table is recreated from its own SELECT with no rows) and then
  `scripts/backfill.py`. dbt's `--empty` flag cannot be used: it appends its own alias to every
  limited ref and collides with the models' `{{ ref() }} as p` aliases.
- Column types: the 15 bucket columns are `LowCardinality(String)` and `players_to_*` `UInt8`
  since 2026-09-09 — the right types for GROUP BY and filters. **Measured honestly, they did not
  shrink the table:** 63.7 bytes/row after versus 64.3 before, because LZ4 already compressed
  the repetitive `String` buckets to ~0.4 bytes/row and `LowCardinality` lands at the same figure.
  The table's size is `hand_uid`: 32-char hex, 52% of every byte, incompressible. That is
  POKER_PLAN step B.5b (`FixedString(16)`), and it sits in every sort key, so it is a rebuild.

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

---

## ADR-027 — Range Lab is a TypeScript workspace of framework-free packages behind one Nuxt app, with a licence allowlist in CI
**Status:** 🔒 Locked by the founder, 2026-09-10. Phase F.

**Context.** The founder's Range Lab spec ([POKER_RANGE_LAB_SPEC.md](POKER_RANGE_LAB_SPEC.md))
asks for a range-thinking learning tool: a weighted equity engine, blocker and distribution
analysis, a range library, a replayer and a 9-step analyzer, with the engine and the components
reusable from other tools. Its §3 names Vite + Vue Router; ADR-016/024 already lock Nuxt 4 in
SPA mode for `platform/web/`. Its §3.1 forbids every copyleft licence, AGPL included, because the
product is commercial and closed-source.

**Decision.** One npm workspace at `platform/web/`: `packages/poker-core` (pure TypeScript —
cards, ranges, formats, evaluator, equity, blockers, distribution, metrics, classifier; no Vue, no
DOM), `packages/poker-workers` (Comlink wrappers, WASM loading), `packages/poker-importers`
(range-file importers), `packages/poker-ui` (Vue 3 SFCs that depend on `poker-core` only; props
in, events out, no store or API access), and **one app**, `apps/web`: Nuxt 4 with `ssr: false`,
hosting both the phase-D dashboard (My game, Pool, Hands, Upload) and the Range Lab routes.
The spec's `RangeMatrix` and plan D.3's `HandMatrix` are the same component. ESLint forbids
`poker-ui → apps`. The evaluator is PokerHandEvaluator (Apache-2.0) through
`poker-hand-evaluator-wasm`, with a pure-TS fallback for tests; nothing is taken from
wasm-postflop (AGPL). A licence audit (`license-checker-rseidelsohn`, allowlist MIT / Apache-2.0
/ BSD-2/3 / ISC / Unlicense / CC0 / Zlib / 0BSD; MPL-2.0 only unmodified and flagged) runs in
`make web-check` and CI from the first commit; `platform/web/LICENSES.md` lists every direct
dependency, its licence and why it is acceptable. npm workspaces, not pnpm: npm 11 is present,
corepack's cache is broken on the founder's machine, and a second package manager buys nothing
at this size.

**Alternatives.** *A separate Vite SPA per the spec's §3.2* — two auth clients, two API clients,
two builds, for routes that share every component; rejected by the founder. *Port the engine to
Python and compute equities server-side* — the calculators must work offline (spec §17) and
must respond while the user drags a range; a Worker on the client is the only place that
works.

**Consequences.** A JS toolchain in CI alongside Python (already accepted in ADR-016). Poker
mathematics lives in TypeScript on the client; poker *statistics* stay in ClickHouse behind the
API — the client never re-derives a pool number. `LICENSES.md` sits at the JS root rather than
the repository root because the repository root is shared with the minikube lab.

---

## ADR-028 — A node is a predicate over `decisions`; `NodeKey` is defined once; buckets live in the registry
**Status:** ✅ Recommended. Phase F.8.

**Context.** The spec's §10.1 wants a canonical `NodeKey` (stake, table size, effective stack,
positions, action sequence, street, texture) shared by ClickHouse queries and the frontend,
with bet sizes bucketed "in one place". The platform already answers "what happens at a node"
as a filter over `marts.decisions` (ADR-020): position, opener and last-raiser positions, raise
count, `facing`, own action lines, effective stack, texture columns, and size-as-fraction-of-pot
with presentation buckets in `stats/registry/dimensions.yaml`. The founder's spot census
(`scripts/spot_nodes.py`) derived a node grammar from `core.actions` independently.

**Decision.** A node **is** a filter AST (ADR-022). `NodeKey` is a Pydantic model in
`analysis/pool/nodes.py` with one compiler `node_filter(key) -> Node`; the TypeScript twin in
`packages/poker-core/src/node.ts` has the same shape, and one JSON fixture of nodes is parsed by
both test suites so they cannot drift. Every bucket boundary (`facing_size_pct`, `size_pct`,
`eff_stack_bb`, `spr`, and a new `raise_to_bb` set for preflop sizes) lives in
`dimensions.yaml` and reaches the client through `/v1/definitions`; no boundary is written in
TypeScript. Node endpoints are `POST /v1/pool/node/{frequencies,showdown-range,estimated-range,
eqr}` with the `NodeKey` as a typed body, implemented as `run_report()` calls (`group_by:
[action, size_pct]`; `group_by: [hand_class]` with `hole_cards != ''`), so cohorts, dates and
`min_n` gating come for free. The spot census grammar is reconciled with the `decisions`
columns, not kept as a second vocabulary.

**Alternatives.** *Store a node string per decision row* — simple to group by, but every
change of grammar is a 73M-row rebuild and it cannot compose with other filters. *Compute node
statistics in a separate service* — duplicates the tenancy, caching and gating the engine
already has.

**Consequences.** Tier 1 and tier 2 need no new SQL. Empirical EQR (spec §10.4) needs one new
column, `invested_bb` (the seat's chips in before the decision), because `net_won_bb` is the
whole-hand result; that is F.10's rebuild.

---

## ADR-029 — Hand histories are parsed server-side only
**Status:** 🔒 Locked by the founder, 2026-09-10. Phase F.7.

**Context.** The spec's §9.4 asks for a GGPoker hand-history parser in TypeScript so a pasted
hand can be replayed. The platform has a Python GG parser (`parser/sites/ggpoker.py`) validated
by pot-math reconciliation on 9.1M real hands, and `GET /v1/hands/{uid}` already returns the
replayer payload (`HandDetail`).

**Decision.** One parser. `POST /v1/hands/parse` takes raw text and returns `HandDetail`
without storing anything (no upload row, no ClickHouse write; the tenant's registered screen
names resolve hero as for uploads). The replayer consumes `HandDetail` from three sources — hero
database, pool database, pasted text — through the same shape.

**Alternatives.** *A TypeScript port* — fully offline paste-to-replay, at the cost of two
parsers that must agree on every format quirk GG ships; rejected by the founder.

**Consequences.** Pasting a hand needs the API; every offline feature (equity, ranges,
blockers, distribution, trainers) does not. A parse failure returns the parser's error text
with the offending line, as the spec's §13 requires.

---

## ADR-030 — Charts in `poker-ui` are hand-drawn SVG, not a chart library
**Status:** ✅ Recommended. Phase F.5, 2026-09-10.

**Context.** Plan F.5 named Chart.js (MIT) for the equity distribution graph and the equity
buckets. Building them showed what a canvas library costs here: it paints its own colours, so
dark mode means resolving the theme tokens at mount and redrawing on every theme change; its
output is a bitmap, so a component test under happy-dom can only assert that a constructor was
called; and it is one more runtime dependency to audit and keep on the allowlist (ADR-027).

**Decision.** `EquityDistributionChart` and `EquityBucketBars` are plain SVG and CSS inside the
component, about a hundred lines each: a `viewBox` that scales with its container, strokes and
fills from the `--pk-*` tokens, the pointer readout handled by the component. The numbers they
draw come from `poker-core` (`equityCurve`, `equityBuckets`), so the tests assert that the path
has one step per combo and that the bars have the right widths. No chart dependency was added
and `LICENSES.md` is unchanged. The same rule holds for phase D's `WinningsChart` (plan D.4)
unless it needs something SVG makes genuinely hard — zoom, brushing, tens of thousands of
points — in which case a library is chosen then, from the allowlist, and this ADR is amended.

**Alternatives.** *Chart.js* — axes and tooltips for free, but the theme and testing costs
above; rejected for two small charts. *A Vue wrapper (vue-chartjs, ECharts)* — the same costs
plus a second dependency.

**Consequences.** Charts follow the theme automatically and are tested like any other
component. A chart with real interaction needs (the replayer's timeline, a winnings graph with
brushing) is a new decision, not an exception taken quietly.

---

## ADR-031 — The range library: the server is the record, versions are append-only, `NodeKey` lands with it, importers are pure functions
**Status:** ✅ Recommended. Phase F.6, 2026-09-10.

**Context.** Spec §11 wants stored ranges keyed by situation, versioned with revert, cached for
offline use, imported in bulk from a folder with a review step, and compared three ways (my
chart | solver | pool). ADR-028 defines `NodeKey` once, in `analysis/pool/nodes.py`, and had
scheduled it for F.8; the library cannot store a situation without it.

**Decision.**
- **`NodeKey` is delivered in F.6**, exactly as ADR-028 describes it: the Pydantic model in
  `analysis/pool/nodes.py` is the definition, `packages/poker-core/src/node.ts` its twin with the
  same wire names, and `tests/fixtures/nodes.json` is parsed by both suites. `node_filter()`
  (key → filter AST) stays F.8's. **The action sequence ends with hero's own action:** a range
  stored at a key is "the combos that take the last step" (`UTG RFI` = `[UTG raise]`, `BB defend
  vs CO 2.5x` = `[CO raise 2.5, BB call]`); the pool reads the same key with the last step
  removed and the last step as the action it reports. Lookup compares the canonical JSON
  (every field present, defaults filled), so two spellings of one situation match.
- **Postgres is the system of record**; `ranges` carries what is browsed (name, key, source,
  tool, tags) and the number of the current version; `range_versions` is append-only — an edit
  of the body inserts, a revert inserts an old body as a new version, nothing is ever updated,
  so the history is complete by construction. Metadata edits do not make versions.
- **The body travels as `poker-core`'s canonical combo text** (`AsKh: 1,…`), never as parsed
  weights: the maths stays in TypeScript, and the server refuses anything else with the entry
  number so a broken client cannot store what every later page fails to parse.
- **The Dexie copy is a cache, not a store:** it keeps the last list and the bodies of the
  ranges that were opened, drops a body when its version no longer matches, and answers only
  when the API does not. It receives the server's plain objects — a Vue reactive proxy cannot
  be structured-cloned into IndexedDB, which the browser check found the hard way.
- **Importers are pure functions in `packages/poker-importers`**, `(text, name) → { ranges,
  warnings }` or an `ImportError` that says what to do instead, depending on `poker-core` only.
  Filename inference returns a key *and* a confidence with notes; the review table shows every
  row before anything is saved (spec §11.2's "never import silently"). `.bin` is refused with a
  pointer to SPH's text export; nothing of Appendix A is decoded and no fixture is committed.
- **Node endpoints take the typed `NodeKey` as a POST body** (`POST /v1/ranges/lookup`), the
  convention ADR-028 sets for the pool endpoints, rather than a key serialized into a query string.

**Alternatives.** *Store versions in place with an audit log* — simpler rows, but revert
becomes a copy that can drift from the log. *Parse ranges server-side and store 1326 floats* —
duplicates `poker-core` in Python for no reader. *Make the cache the primary store and sync* —
the founder works from more than one machine; the server must win.

**Consequences.** F.7 and F.9 can offer "the stored range at this node" with one lookup as
soon as they know the key. F.8's pool column drops into the comparison page where the stub sits.
A range's history grows one row per save; a purge policy is a later decision if it ever matters.

---

## ADR-032 — The replayer: one hand shape from three sources, states are derived, the node is the decision just made
**Status:** ✅ Recommended. Phase F.7, 2026-09-10.

**Context.** Spec §9 wants a hand replayed on a visual table with *every analysis panel rebound
to the current node* as you step. Three sources must feed it — the hero database, the pool
database, pasted text (ADR-029) — and the panels it feeds are the ones F.2–F.6 already built,
which take ranges, a board, a pot and a bet.

**Decision.**

- **One shape.** `GET /v1/hands/{uid}` and `POST /v1/hands/parse` both answer `HandDetail`, and
  the app converts it once (`app/hands/replay.ts`) into `poker-core`'s `ReplayHand`. Nothing
  below that conversion can tell where a hand came from. An action type the model does not know
  throws by name rather than being skipped: a parser change must be visible, not silent.
- **State is derived, never stored.** `replayStates(hand)` returns one state per step — the deal
  plus one per action. Chips live in two places, *committed in front of a seat* and the *settled
  pot*, because pot odds are quoted against what is actually in the middle; the street's bets are
  collected exactly when the next card is dealt, which is what a table does. The engine's pot and
  amount-to-call are checked against the parser's own `pot_before` and `to_call` for every action
  of a real hand: two independent computations of the same money.
- **Awards are not actions.** No parser emits a `win` action — who won which pot is its own table
  (`core.pot_winners`) — so the replayer leaves the pot in the middle until the hand ends and
  names the winner from `ReplaySeat.wonHand`. The alternative, inventing an award action during
  conversion, would put a number in the replayer that no parser produced.
- **The node is the decision that has just been made.** `nodeKeyAt(hand, step)` builds the
  `NodeKey` whose sequence *ends with* the seat that just acted — the same convention the range
  library stores under (ADR-031), so stepping forward walks the node tree and each step is one
  lookup. A hand whose seats have no derived position yields `null` rather than a key with an
  invented seat, which would quietly match the wrong stored range. `board_texture` is left empty:
  the tags are the server's (`int_board_texture`), and a guess here would not match the pool's
  own bucketing in F.8.
- **A filter is a document, so it is posted.** The plan said "`filter` on `/v1/hands`";
  it is `POST /v1/hands/search`, taking `stats.request.HandSearch` — the same filter tree the
  report engine takes (ADR-022), so a situation built in the Reports workbench opens as a list of
  hands with no second filter language. The answer is the matching **decisions**, not just the
  hands: a pool hand has no hero seat, so without the seat the caller would not know whose
  decision to watch. `HandSummary` gains `seat` for exactly that, and `GET /v1/pool/hands` uses
  it too — a pool hand opens on a seat that showed cards, else the biggest winner.

**Alternatives.** *A TypeScript hand parser* — rejected in ADR-029 and not reopened. *Storing
the per-step state server-side* — nothing needs it, and it would make the replayer need the API
for something the browser already has. *A `filter` query parameter* — a JSON tree in a URL, with
its own escaping and length limit, for no gain.

**Consequences.** F.8's pool frequencies attach to `nodeKeyAt`'s key with no further plumbing,
and F.9's analyzer opens from the replayer's current state. A hand from any table can be
replayed by pasting it, at the cost of needing the API for that one feature. The pot shown at
the end of a hand is the pot before rake and the award, which is what the summary line says.

---

## ADR-033 — What the pool may say: a node is only as good as its columns, and a range is only the hands that were shown
**Status:** ✅ Recommended. Phase F.8, 2026-09-10.

**Context.** ADR-028 settled that a node *is* a filter over `marts.decisions`. Building
`node_filter()` and the two tiered answers turned up three things that decision did not
settle: what to do when a `NodeKey` names something the decision fact has no column for, what a
"pool range" actually is when it is built from showdowns, and when the product is allowed to
show a number at all.

**Decision.**

- **Only ever filter on what a column means.** The seat hero is facing becomes
  `last_raiser_position` when it is the seat that bet or raised, and preflop `opener_position`
  when it opened. Anywhere else — a caller on the turn — the position is **not** named, because
  neither column means "the seat that called", and naming it returns nothing. What is kept
  instead is `is_ip`, which is a column and is the part of "who am I against" that changes the
  decision. A `NodeKey` is a description; the filter says only the part of it the fact can
  answer, and says it exactly.
- **The sequence is one street's.** A `NodeKey` has a single `street` and a flat sequence, so
  `nodeKeyAt` (the replayer) emits only the decisions on the node's own street; the opponent is
  still taken from the whole hand. Carrying every street's actions in the sequence made the
  filter ask for a line no seat ever took, and every postflop node in the replayer came back
  "never seen" — found in the browser, fixed with tests on both sides.
- **`eff_stack_bb` matches a registry bucket, never a float.** The column is a `Float32`; an
  equality on 100 would match almost nothing. `node_filter` looks the value up in
  `dimensions.yaml`'s own buckets and emits a `between`, so the boundary is written once.
- **A showdown range is the hands that were shown, and says so.** Tier 2 answers with `covers`
  — the share of the node's decisions whose cards were ever revealed — because a range built
  from showdowns is biased towards hands that get to showdown, and the reader must be able to
  see how bad the bias is. On the current corpus that figure is around half a percent, which is
  itself the argument for the re-parse in `POKER_PLAN.md` §5b.
- **Counts become a range per combo, not per class.** A class with twelve combos is shown twice
  as often as one with six at equal per-combo likelihood, so the weight of a class is its count
  *divided by its combos*, scaled so the most frequent class is 1. Built by rendering class
  notation and parsing it, so the one tested path into a `WeightedRange` stays the only one.
- **`MIN_N = 100`, and under it there are no numbers at all** — not greyed-out ones. The answer
  carries the count and `enough: false`; `PoolDataBadge` prints "insufficient data — 57 of the
  100 needed". Every number the pool shows arrives with its tier and its sample size beside it.

**Alternatives.** *Name the villain's position on every node* — silently empty answers, which is
worse than a wider node. *Show a percentage with a warning under `min_n`* — the number gets
quoted and the warning does not travel with it. *Weight classes by raw count* — over-weights
offsuit hands by a factor of two, which is a wrong range, not a rough one.

**Consequences.** Tier 3 (F.10) inherits the gate, the badge and the per-combo construction. A
node that mentions a caller is deliberately wider than the words suggest; if that ever matters,
the answer is a column on `decisions` (a `caller_position`), not a looser filter.

---

## ADR-034 — The analyzer: the answer is fetched after the commit, a save is a merge, and a reveal names its own authority
**Status:** ✅ Recommended. Phase F.9, 2026-09-10.

**Context.** Spec §15 makes the nine steps the spine of the product: *context → do the work →
commit a prediction → reveal → write a takeaway*. Everything the platform already has (the
replayer, the range library, the equity engine, the pool's tiered answers) is an input to it.
Building it settled four questions the spec left open: where the truth may live before it is
revealed, what a save is allowed to overwrite, whose frequency a step is actually asking about,
and how much authority a reveal is allowed to claim.

**Decision.**

- **The truth is fetched after the commit, not merely hidden.** `PredictionGate` takes `actual`
  as a prop and the step supplies it as `null` until a prediction exists; the page's pool query
  fires on the first committed prediction. A user who opens the devtools before answering finds
  nothing to find, because nothing has been asked for yet. `unavailable` is a separate prop, so
  "the pool has played this 87 times, too few" reads differently from "still working it out" —
  the gate never waits for ever on an answer that is not coming.
- **A save is a merge by step number.** `PUT /v1/analyses/{id}` replaces the step numbers in the
  body and leaves the rest alone; the client autosaves the step being worked on, over and over.
  A partial save can therefore never wipe the steps before it, and a retry after a dropped
  connection is harmless. The nine steps are one JSONB document because they are always read and
  written together and never queried across.
- **Dexie holds the newer copy while the server is away.** Every change is written to the
  browser immediately and marked `unsaved`; the server save is debounced. A refused save keeps
  the work queued, says `offline` on screen, and retries on the next change. Reopening prefers
  an `unsaved` local copy over the server's older one.
- **A step asks the node whose seat can answer it.** Step 9 wants "how often does my pool fold
  to this bet" — a question about the seat *facing* the bet, not the seat making it. A `NodeKey`
  always ends with hero's own action, so hero's own node answers "folds 0%". `facingNode()`
  swaps the two seats and appends villain's answer as the last step. Verified on a real NL10
  turn: hero's node says the field bets 30%, the facing node says it folds 43.2% (n = 3,988).
- **A reveal says where it comes from.** The pool's numbers carry `PoolDataBadge`. The ones
  computed here from `poker-core` are computed here, and where a rule of thumb is involved the
  screen prints the rule and the words "no solver was asked" — step 7 places a hand by
  **made-hand class order** within its own range, not by equity, because it is instant, it is how
  a player reads a board, and it does not pretend to be a solve.
- **The heuristic is a column, not the ninth takeaway.** It outlives the analysis: F.11's
  heuristic log with its 14-day review prompt is a query over `analyses.heuristic`.

**Alternatives.** *Fetch the pool answer when the page opens* — simpler, and the answer sits in
the browser before the question is asked; the gate would be a curtain, not a gate. *Send the
whole analysis on every save* — one dropped step patch would silently roll back everything after
it. *Nine typed step payloads* — nine models, nine migrations and nine branches at every read,
for a shape that is a flat union of eleven optional fields.

**Consequences.** F.11's training modes reuse `PredictionGate`, `scorePrediction` and the step
definitions in `analyze/steps.ts` (the questions, tolerances and units are data, in one list).
Two things the browser found are now invariants: `classifyCombos` throws on a board that is not
three to five cards, so every board-reading reveal checks `isDealt` first — a board is dealt one
card at a time and the partial states are real; and the process-wide ClickHouse client now runs
with `autogenerate_session_id` off, because ClickHouse refuses a second query inside a session
while the first runs, which made two concurrent reads (a hand and the pool's frequencies) fail
outright. Nothing in the platform uses session state.

---

## ADR-035 — Tier 3 estimates a likelihood ratio, not a frequency, and reports its own error; EQR is split between the pool and the engine

**Status:** ✅ Recommended by me · **Date:** 2026-09-11 · **Plan step:** F.10

**Context.** Spec §10.3 asks for a Bayesian reconstruction of villain's range at a node:
`P(combo | action) ∝ P(action | combo) × P(combo)`, with `P(action | combo)` estimated per
169-combo class from showdown data and applied to every combo in the class. Spec §10.4 asks for
empirical EQR beside it: `EQR = (EV / pot) / equity`, where the EV comes from the pool.

Implementing §10.3 literally — a class's revealed hands, and the share of them that took the
action — produces numbers that are not merely biased but inverted in meaning. Hole cards are
seen **only at showdown**, and a seat that folds is almost never shown, so among the revealed
hands nearly everything continued. Measured on the real corpus at the UTG open node (5.3M
decisions, 27,867 of them revealed), the direct estimate reads *"the field opens 97% of AQs, 85%
of KTo, 80% of QTo"* at a node where tier 1 — which is unbiased, because every decision records
its action — says the field opens **18.35%** of the time at all. Every class saturates near 1,
the differences between them are noise, and a range reweighted by them would be confidently
wrong in a product whose entire premise is never showing a number it cannot stand behind
(ADR-033).

**Decision.**

- **The likelihood is a ratio, not a rate.** `L(class)` is the class's share of the hands that
  took the action, divided by its share of all hands revealed at the node. Both halves count
  only revealed hands, so the chance of being shown at all divides out where it saturates. `L`
  is 1 for a class that takes the action as often as the node's average, above 1 for one that
  takes it more, and it has no ceiling to be pinned against. The reported per-class rate is
  `P(action) × L`, capped at 1 because it is a probability. **The posterior is unchanged by this
  choice** — the two estimators differ by a constant that renormalization removes — so this is
  about what the screen may claim, not about where the range lands.
- **A reconstruction must report its own error.** `implied_frequency` (the prior-weighted mean
  of the per-class rates) is shown against `observed_frequency` (tier 1). The ratio makes the
  two **equal exactly when the prior matches the class mix the field shows at that node**, so
  the gap is a reading on the prior, not an artefact of the estimator: positive means the prior
  is heavy on hands that take the action, negative that it is heavy on hands that do not. A
  test pins the equality; the panel prints the direction in words.
- **A bucket under `MIN_BUCKET_N` (200 revealed) is not reweighted at all** — `L` is 1, the
  prior's weight does not move, and `fallback` says so, so the UI greys it rather than drawing a
  number nobody measured. When every bucket falls back, implied and observed agree by
  construction, which is the honest answer for a node the showdown data says nothing about.
- **EQR is split at the language boundary.** The pool owns `EV / pot` — `net_won_bb +
  invested_bb` over `pot_before_bb`, straight out of the decision fact. Equity needs a range, a
  board and an evaluator, all of which live in `packages/poker-core`, so the server returns
  `realized` and the client divides by the equity it computed. A row shows an EQR only where an
  equity was supplied; a realized share on its own is never presented as one.
- **`invested_bb` is a new column on `marts.decisions`,** the seat's own chips already in the
  pot. It is what turns the hand-level `net_won_bb` into "chips won *from this point*": the
  chips already in the middle belong to the pot, not to the seat. A mart gains a column only
  when the chain is rebuilt, so the service **checks once** whether the column is there and
  answers `needs_rebuild` rather than letting UNKNOWN_IDENTIFIER out as a 500.
- **The per-class EQR sample is stated for what it is.** `overall` counts every decision that
  took the action, revealed or not — nothing selects it. `by_hand_class` can only count hands
  that were turned over, so `covers` is printed beside it and the panel says the rows favour
  hands that saw a showdown.

**Alternatives.** *Estimate `P(action | class)` directly, as the spec's wording reads* — the
saturation above; rejected on the measurement, not on theory. *Correct for the reveal rate per
action* — needs `P(shown | action)`, which is exactly what is unobservable for folds. *Compute
equity server-side* — a second evaluator in Python, to be kept in step with the TypeScript one
that the rest of the product already trusts (ADR-027). *Return the posterior per combo* — 1,326
numbers to say what 169 multipliers say, and it would discard the shape inside a class, which is
the part a chart author actually drew.

**Consequences.** The reconstruction is *under*-informative where the data is thin rather than
misleading — at a preflop open node it barely moves the prior, which is correct, because the
showdown sample there carries almost no information about who folded. It bites where both
branches reach showdown: verified in Chrome on the real pool at the BB's flop lead (1.35M
decisions, 1.8% revealed, 35 of 51 prior classes measured), where KK/AA/AKo move to 1.6× and
small pairs to 0.33×, cutting 22 from 100% of the prior to 20% of the reconstruction — a
polarised leading range, which is what the field actually has. It also makes the value of
plan §5b's re-parse measurable rather than assumed: more revealed seats is directly more classes
over `MIN_BUCKET_N`.

**The bucket is the 169 preflop classes, and that is a ceiling, not a preference.** Postflop what
moves a decision is whether the hand is a pair, a draw or air, not whether it is 98s — but
`decisions` carries `hand_class` and `hand_shape`, and `made_hand` is still the column reserved
for the evaluator (F-902). The 169-class bucket works here only because the node already fixes
the board *texture*, and it is the finest grain the fact table can answer. When F-902 fills
`made_hand`, tier 3 should bucket on it postflop: same likelihood ratio, same thresholds, same
validation view, one dimension swapped. The client cannot do this itself — the pool's counts
come from many boards that share only their texture tags, so classifying them against the one
board on screen would be wrong.

---

## ADR-036 — Shard by `cityHash64(user_id)` with a reserved tenant for the pool; buy threads before shards
**Status:** ✅ Recommended by me. Phase E.4, 2026-09-11. Design only — nothing is built.

**Context.** [ADR-025](#adr-025--freshness-and-scale-materialized-views-generated-from-the-registry-then-shard-by-tenant)
settled the scale plan in one sentence: shard `marts.*` by `cityHash64(user_id)`, keep the
population dataset on its own shard, `Distributed` tables on top, dbt per shard. Plan step **E.4**
asks for that as a design document with a shard key, a migration path and a per-node cost table.
Writing it against the code turned up two things the sentence could not have known, and the full
working is [POKER_SCALE.md](POKER_SCALE.md).

First, **the population dataset is not a user.** A `--dataset population` import stamps the
*importing account's* `tenant_id` on every row (`scripts/import_archive.py`;
`core/schema/hands.py` maps `user_id ← tenant_id`), and hero and pool are separated by the
`dataset` **column** alone. So `cityHash64(user_id)` co-locates the founder's 19,802 hero hands
with 9,073,994 pool hands: the two halves of ADR-025's sentence contradict each other as the code
stands.

Second, **sharding does not fix the query that motivated it.** The phase-C exit measured an
arbitrary uncached pool situation at **1.6 s over 73.5M decisions at `max_threads 2`**, against a
stated goal of under a second. The pool is one tenant and one dataset, so no hash of `user_id`
can divide it — however many nodes exist, that query runs on one of them.

**Decision.**

- **The shard key is `cityHash64(user_id)`, and nothing else.** It is already paid for: `user_id`
  leads the `ORDER BY` of every tenant-scoped table, so sharding needs no re-sort — the opposite
  of the rewrite [ADR-009](#adr-009--multi-tenancy-by-tenant-key-not-by-database) warns about — and
  `stats/query.py` binds `s.user_id = {tenant_id:UInt32}` as the first predicate of every query, so
  with `optimize_skip_unused_shards` a report prunes to one shard and the per-shard query is
  byte-identical to today's.
- **The pool corpus gets a reserved tenant id**, which is what makes "population on its own shard"
  true rather than aspirational. The `dataset` column stays exactly as it is — it is the read-side
  correctness boundary — but the rows move to an id of their own. This is a replay from object
  storage, not an `ALTER`, because `user_id` leads the sort key.
- **The shard key must stay a pure function of `user_id`.** `hand_uid` is deterministic, every core
  table is `ReplacingMergeTree(parsed_at)` keyed `(user_id, hand_uid, …)`, and `played_at_utc` is a
  property of the hand — so a re-parse lands on the same shard, partition and sorted range, and
  dedup still collapses it. Any key that is not purely of `user_id` silently turns
  exactly-once-effect into duplicate-on-retry. `FINAL` over a `Distributed` table deduplicates
  *within* each shard only, so this is also what keeps every `FINAL` read in the platform correct.
- **Writes go to the local table, reads go through `Distributed`.** A distributed insert would
  multiply parts by the shard count for the same 5,000-row batch (against the "one INSERT = one
  part" rule) and would break the worker's commit-after-insert contract, since async forwarding
  makes "returned" mean "queued". The shard is chosen in `insert_hands`, where `tenant_id` is
  already an argument and a batch never straddles tenants. The read swap is the `PHYSICAL` dict in
  `stats/query.py`.
- **dbt runs per shard, on local tables — mandatory, not preferred.** `insert_overwrite` is
  `ALTER TABLE … REPLACE PARTITION`, which exists only on a local MergeTree. The row budget
  (`DEFAULT_ROW_BUDGET = 2_000_000`, calibrated against one 4 GB node) and the dirty-partition gate
  are per-node physics, so each shard gets its own loop, budget and anchor watermark.
- **For the pool, buy threads before shards.** Measured: a `SELECT` over 6.48M `decisions` rows
  went **0.53 s → 0.16 s from 2 threads to 8**, for 0.98 GiB more memory. Eight threads on one
  larger node buys roughly what three shards would, with no fan-out, no initiator merge, and no
  `GLOBAL IN` needed on the cohort subquery. So the population shard is **one node with more
  vCPU**, not N nodes; a street-first projection on `decisions` is the next lever after that. Hero
  shards stay 4 GB / 2 vCPU.
- **Replicas are not designed here.** [ADR-013](#adr-013--rent-anything-with-a-replication-protocol)
  already says rent anything with a replication protocol. Shards are ours; replicas are the managed
  service's. One question is flagged unanswered rather than guessed: how `REPLACE PARTITION`
  behaves under replication, on which the entire incremental chain rests.

**Alternatives.** *A composite shard expression* — `if(dataset = 'population', 0,
cityHash64(user_id) % (N-1) + 1)` is two lines at `insert_hands` because `dataset` is in scope
there, but it makes the shard expression and the read predicate disagree about what identifies a
row, and every future reader of the query builder would have to know it. *Shard the pool by
`hand_uid` or by date* — divides the corpus, and breaks `FINAL` and `ReplacingMergeTree` dedup
platform-wide the moment one hand's rows can live on two shards. *Leave the pool on the hash and
add nodes* — buys nothing: it is one tenant. *Duplicate the pool per tenant* — 9M hands per
customer.

**Consequences.** The scale story becomes two node classes rather than one, which is why the cost
table has two rows: hero shards are bounded by disk and by the ~150k-hands/day partition rule, the
pool node by scan latency. The doc's shard-count model — ≈46M decisions ≈ 5.7M hands per shard for
a sub-second arbitrary situation — is **one measurement extended by a straight line**, and it says
so; measuring the same query at 20M, 40M and 73M decisions is what would replace it. Skew stays a
known defect of this key rather than a solved problem ([POKER_ARCHITECTURE.md](POKER_ARCHITECTURE.md)
named it first), with a trigger written down instead: pin a tenant to its own shard when its
`decisions` rows pass the same cap. Everything stays portable — a `<remote_servers>` definition and
`Distributed` tables are ClickHouse-native, and `Distributed` over one shard is a no-op, so
`docker-compose` still brings the whole product up on one machine.

**My reservation.** ADR-025 bundles the materialized views and sharding into one decision. They are
independent, and the MV half is the one with a real deadline (stats fresh after an upload); the
sharding half has no trigger until a second tenant exists whose data does not fit. Nothing here
should be built before E.1, E.2 and E.3.

---

## ADR-037 — One filter object, flat and registry-driven, carried in the URL as text

**Status:** ✅ Recommended by me · **Date:** 2026-09-11 · **Plan step:** D.3

**Context.** Plan §2.5 gives the engine a fully recursive filter grammar (`Leaf | all | any | not`)
and the registry (ADR-021) gives it 80 dimensions, each with its own type, vocabulary, allowed
ops and presentation buckets. D.3 has to turn that into something a poker player can hold: one
filter, shared by every screen, that survives being pasted into a chat window.

The screens that existed before this step did not share anything. `apps/web/app/hands/search.ts`
declared four `as const` tuples — `STREETS`, `FACING`, `ACTIONS`, `POSITIONS` — described in its
own docstring as "the registry's own", and one of them had already drifted: the registry's
`position` enum carries `UNKNOWN` and the copy did not, so an anonymised seat was unfilterable.
`op` was hard-wired to `eq`. Four of eighty dimensions were reachable, with one comparison each.

**Decision.**

- **The client holds no vocabulary of its own.** Everything — which dimensions exist, their
  values, their ops, their buckets, which tables hold them — comes from `GET /v1/definitions` and
  is held once per session (`stores/definitions.ts`). The four hard-coded tuples are deleted with
  the module that owned them. `Dimension.allowed_ops` is a server-computed field precisely so the
  op picker needs no copy of `OPS_BY_TYPE`, and it is what the picker is driven by.
- **The builder emits a conjunction, not the full grammar.** The shared filter is a flat list of
  clauses, ANDed: `{all: [...]}`. The engine's `any` and `not` remain available to saved filters
  and custom stats, but a *situation builder* that offered arbitrary nesting would be a visual
  query language, and the questions players actually ask ("turn, facing a bet over 75% pot, I
  called the flop c-bet in position") are conjunctions. Disjunction within one dimension is
  already `in`. The cost of this choice is legible and reversible: a clause is one row.
- **A clause holds its values as text, always in a list.** Text is what a URL carries and what an
  `<input>` holds, so the round trip is exact by construction, and the registry — not the UI —
  decides how a value is read. One function coerces, from the dimension's own type, at the single
  point where a clause becomes AST. Bools go out as `0`/`1`, never `true`/`false`.
- **A bucket is a UI op that compiles to a half-open pair, never to `between`.** The registry's
  buckets are `[low, high)`; the compiler renders `between` as SQL `BETWEEN low AND high`, which
  includes the top. A 40bb stack must land in `40-75` and not also in `0-40`, so `bucket` emits
  `gte low` AND `lt high`. This is the one place the UI knowingly does not use the op whose name
  matches.
- **The URL is readable text, not an opaque blob.**
  `?ds=population&f=street:eq:flop;position:in:BTN,CO;eff_stack_bb:bucket:75-125` — clauses on
  `;`, parts on `:`, lists on `,`, every *value* percent-encoded so a value containing a
  separator (`line_so_far` is `r/x-c/`) survives without the reader knowing which characters are
  special. Base64 would have been shorter and unreadable; a bare JSON blob would have been
  readable and fragile. Decoding is lenient and registry-free: it runs before `/v1/definitions`
  has answered, and a hand-edited link drops the segment it cannot read rather than throwing.
- **The URL wins when it says something; otherwise the filter does.** A pasted link replaces the
  filter; a screen opened with no filter parameters adopts the filter already in the store and
  stamps it into the address bar. That is what makes it *one* filter rather than one per page.
  Writes use `replace`, not `push`, so refining a filter does not fill the Back button.
- **An unfinished clause is held back, not sent.** `in` with nothing chosen and `between` with one
  bound are 422s from the Leaf validator; the bar says what is missing in its own words and the
  AST simply omits that clause.
- **The builder says which tables can answer the situation.** Table routing (`stats/router.py`)
  raises *before* leaf validation, so a decision-grain column beside a hand-grain stat fails with
  `dimension 'street' is not available for hand-grain stat 'hands'`. The filter exposes the
  surviving tables, the bar says so in words, and the stat picker offers only stats that fit.
  This was not theoretical: the first browser run produced exactly that 400, from the harness's
  own default stat.
- **Grouping the 80 dimensions is a presentation choice and lives in the client.** The registry is
  a flat list in table order, which is right for a compiler and wrong for a player. `families.ts`
  holds twelve groups in the order a hand is thought about. A test reads
  `stats/registry/dimensions.yaml` itself — the same trick `poker-core/test/node.test.ts` uses for
  the shared `nodes.json` fixture (ADR-028) — and fails when a dimension is unclassified. It
  earned its keep within the hour: it caught `made_hand` being added by a parallel session.
  Anything still unclassified at runtime appears under "Other", so a new column is reachable on
  the day it ships even if nobody has grouped it.

**Alternatives.** *A visual tree editor for the full grammar* — the general case nobody asked for,
at the cost of the common one. *Typed values in the clause* — then the URL codec needs the
registry, and decoding has to wait for a network round trip before it can show anything. *A
`family:` field in `dimensions.yaml`* — it is the column contract three non-UI consumers are built
to (dbt, the compiler, the API); a display grouping does not belong in it, and the coverage test
gives the same safety from the client side. *Keeping `situationFilter` and widening it* — it
overloads `''` as "not chosen", and `''` is a real value on ten dimensions.

**Consequences.** Four dimensions with one op became eighty with every op the registry allows,
and the hand list gained all of it by deleting code rather than adding it. Two primitives came out
of the work into `packages/poker-ui` — `PositionPicker` (a seat vocabulary as a ring; five
registry dimensions are seat enums and three files had inlined the same `<select>`) and
`ActionLine` (the `f·x·l·c·b·r` encoding spelled out; four dimensions are lines and nobody can
read one as letters). `SizeBadge` and `StackBadge`, which D.3 also named, were not built: one
`clauseLabel()` words every clause uniformly, and two bespoke badges would be a second copy of
that wording for two of nine bucketed dimensions.

**What is still owed.** `facing_size_pct` and `size_pct` are labelled "(% of pot)" and stored as
fractions, so the builder shows `0.75` under a label that says percent. The value is not silently
scaled, because the number typed and the number sent must agree — but the pair reads badly and
belongs on F.12's §13 checklist beside the comma-decimal note. Group-by and stat selection are
deliberately *not* in the shared filter: two screens sharing a situation should not be forced to
share the columns they measure it with. The reports workbench (D.5) owns those.

---

## ADR-038 — The scoring store is browser-owned; a spot is a seed; and the drawing mode is scored on the metric the spec names, not on the gate's

**Status:** ✅ Recommended by me · **Date:** 2026-09-11 · **Plan step:** F.11

**Context.** Spec §16 asks for six training modes over one scoring store, a `/progress` route, spaced
repetition, and a heuristic log with a "still true?" prompt after fourteen days. Spec §17 adds the
constraint that decides most of the design: the trainers must work **with no backend at all**.
Building them settled four questions the spec left open — where practice data lives, what a spot
*is*, which number a mode is actually graded on, and where a scheduler belongs in a codebase whose
core package is declared to be poker mathematics.

**Decision.**

- **The scoring store is owned by the browser, and it is the only thing here that is.** Every other
  Dexie database in this app (`poker-ranges`, `poker-analyses`) is a cache of something the server
  is the record for. `poker-training` is not: scores are per-device practice, the trainers must run
  with the API stopped, no other part of the platform reads them, and a stat that says "you were
  73% on two-tone flops last Tuesday" is worth nothing to a server that cannot see the spots. So
  `/train` and `/progress` are `public: true`, take no token, and are correct offline. **The
  heuristic log is the opposite case and is therefore split out** into `poker-heuristics` with
  `/v1/heuristics` behind it: a lesson is worth having on every device and it points back at an
  analysis the server already holds. Each row says on screen whether it has reached the server.
- **A spot is a seed, not a record.** `generateSpot(mode, seed)` is deterministic, so re-serving a
  missed spot regenerates it rather than storing it, and the review row is eight fields instead of
  a frozen copy of a range, a board and a question. Two consequences worth stating: every spot
  carries its seed into the equity run, because a preflop or hand-vs-range spot is Monte Carlo and
  without the seed "the correct answer" would drift by a tenth of a point between two showings of
  what is meant to be the same spot; and the spot's `hash` is **content-derived, not seed-derived**,
  so two seeds that happen to build the same question are one thing to relearn and a change to how
  seeds are drawn does not orphan a month of history.
- **The range-drawing mode is scored on total absolute weight error, which is not what its gate
  compares.** `PredictionGate` compares a committed number with a true one; the number a drawing can
  commit is how *wide* it is. But a range of exactly the right width made of entirely the wrong
  hands is not a range you know, and spec §16 names the right metric outright. So the mode's verdict
  — the one the review schedule believes and the one the score row records — is
  `diff(drawn, reference).totalAbsolute`, while the gate still does its job of taking the commitment
  before the reveal. **Both numbers are on screen, labelled**, because hiding either would make the
  other look like the whole truth.
- **The scheduler lives in `@poker/core`, in a `training/` module of its own.** This stretches that
  package's stated charter — "pure TypeScript poker mathematics" — and the alternative was worse:
  intervals inside a component cannot be tested without either mounting it or waiting a month. Every
  function takes `now` as an argument and returns ISO strings, so the whole of a spaced-repetition
  month is a unit test. The scheme is Leitner over `[0, 1, 3, 7, 16, 35]` days; a miss returns a
  spot to box 0, due at once, which is what "re-serve missed spots at increasing intervals" means in
  practice.
- **The fourteen-day rule has one definition per side of the wire and a test pinning each.**
  `HEURISTIC_REVIEW_DAYS` in TypeScript and `REVIEW_DAYS` in `api/schemas_heuristics.py`. The client
  computes whether a heuristic is due rather than reading the server's `is_due`, so an offline log
  answers the question exactly as an online one does. Answering the prompt — *any* answer, including
  retiring the lesson — is what resets the clock, because re-examining a heuristic is the act being
  scheduled, and correcting its wording is not.
- **The reference charts are labelled as what they are.** The offline modes need ranges to drill
  against and cannot wait on the range library or the pool, so `app/train/charts.ts` ships eight
  ordinary 6-max 100bb charts. Every screen that uses one prints the same sentence: a rule-of-thumb
  baseline, **no solver was asked**, and your own imported chart for the situation is the better
  reference. The blocker mode makes its continuing-range assumption visible for the same reason.

**Alternatives.** *Sync the scores to the server* — a fifth table, a merge policy and an offline
queue, for data the server cannot use and the user cannot lose anything by keeping locally. *Store
each spot as a row* — simpler to reason about for a day, until a generator improves and every stored
spot is a fossil that no longer matches the mode it belongs to. *Score the drawing on width alone* —
one number, one verdict, and the mode stops teaching the thing it exists to teach. *Put the
scheduler in the app* — untestable without a clock, and the first place a second consumer would have
to copy it from.

**Consequences.** F.12's §13 pass should look at `/train` with a month of history in it, which this
session could not: a trend chart is honest with one day in it but it is not yet informative.
`/v1/heuristics` ships with an integration test that has **not been run** — it needs the stack,
which a parallel session owned while this one ran — so F.11 stays unticked until it is. The
`candidates` endpoint is the bridge ADR-034 promised when it kept `analyses.heuristic` as a column
of its own: the log offers a step-9 takeaway for adoption instead of making the founder retype it.
One defect found in the browser and fixed with two regression tests: the guard against
`PredictionGate` re-emitting `reveal` was keyed on the spot and never cleared between servings, so a
spot answered again after coming back for review was scored once and never again — eight answers,
four rows on `/progress`.

---

## ADR-039 — All-in EV redistributes the pot that was actually awarded, per side pot, and only where the runout happened

**Status:** ✅ Recommended by me · **Date:** 2026-09-11 · **Plan step:** E.5

**Context.** [ADR-018](#adr-018--all-in-equity-uses-a-vetted-evaluator-computed-at-parse-time) decided
in principle that all-in equity comes from a vetted evaluator at parse time, and left three things
open that only real data could settle: which evaluator, how to price a preflop all-in without
enumerating 1.7M runouts per hand, and what to do about multiway pots, where it warned that
"equity against the whole field is not what determines your share of each pot" and offered the
escape hatch of restricting the adjustment to two players and saying so in the UI. Meanwhile
`marts.decisions.made_hand` had been reserved since ADR-020 and was still empty, which is what
ADR-035 needs before tier 3 can bucket postflop by anything better than the 169 preflop classes.

**Decision.** Four parts.

*The evaluator is `phevaluator` (Apache-2.0), and it was already a dependency.* It is the Python
binding of `HenryRLee/PokerHandEvaluator` — the same upstream the Range Lab already runs through
WebAssembly under ADR-027, so the founder has approved this code base twice. It was declared in
`pyproject.toml` from the first platform commit and never imported. The licence gate of spec §3.1
therefore passes on an existing, already-reviewed dependency, and no evaluator had to be written.
The *classifier* is a genuine port — `classify.ts` → `core/classify.py` — because the class
vocabulary is ours, not the library's; the two are pinned to `tests/fixtures/made_hands.json`,
1,024 cases covering all seventeen classes, generated from the TypeScript reference and asserted
by both suites. That is the ADR-028/ADR-031 pattern, for the same reason: otherwise a hand sits in
one class in the mart and another on screen and no test notices.

*Equity is exact, never sampled, and the preflop case is affordable because suits are
interchangeable.* A heads-up preflop all-in enumerates 1,712,304 runouts in 1.25 s. The corpus
holds 60,709 of them, which is 21 hours naively — but `core.equity.canonical_key` relabels suits
and player order to a fixed form, and those 60,709 collapse to **6,131** distinct matchups. Solved
once each across a process pool, that is thirteen minutes. An EV number that changes when you
recompute it is not one a player can act on, so sampling was not a trade worth making.

*EV redistributes the pot that was actually awarded, layer by layer.* Rather than restricting the
adjustment to heads-up, each side-pot layer is awarded separately to the best hand among the
players eligible for *that* layer — which is what ADR-018 asked for and thought might be too much
for a first version. It is not: the enumeration already ranks every contender on every runout, so
layering costs a few lines. The awarded total is then shared out by expected share, which gives
the invariant the whole design rests on — **`sum(ev_won) == sum(net_won)` for every hand, exactly**
— so rake, jackpot drops and cash drops need no special handling, and an EV win rate stays
comparable with the real one. `assert_ev_won_bb_redistributes_the_pot` checks it on the real data.

*There is no adjustment where nobody gambled.* GGPoker settles an all-in on request without
dealing the rest of the board, and such a hand stops with exactly the cards betting stopped on: 0
after preflop, 3 after the flop, 4 after the turn. **27,088 hands — 20% of the pool's all-ins and
18 of hero's — are like this.** De-lucking them would invent a swing that never existed, so the
actual result stands. Likewise, every seat that reached showdown must have shown: two known hands
out of three would hand the third player's money to the two that were seen.

**Alternatives.** *Monte Carlo for the preflop case* — 100k samples is ±0.15 pp, which is ±0.3 bb
on a 100 bb stack and visible in a hero sample of 654 all-ins; rejected once the canonical-form
memo made exact affordable. *A shipped 47,008-entry preflop equity table*, which is what ADR-018
literally suggested — six hours to build, a committed artifact to maintain, and unnecessary once
only the ~6k matchups a corpus actually contains are solved lazily. *Restricting EV to heads-up
all-ins*, ADR-018's escape hatch — rejected because the per-pot model is barely more code and
5% of the corpus's all-ins are multiway. *Computing `made_hand` in dbt* — SQL cannot rank a poker
hand; it is three `LowCardinality` columns on `core.hand_players`, one per street, because the
class a decision is taken with is the one for the street it is taken on.

**Consequences.** `core/` gains four pure modules (`cards`, `classify`, `equity`, `allin`) that
depend on nothing above them, and `ingestion.pipeline` calls `enrich()` after validation, so the
worker and the bulk importer are enriched identically by construction. The existing corpus is
filled by `scripts/backfill_equity.py`, which recomputes from stored columns rather than
re-reading 9M hands from object storage — the board is five columns on `core.hands` and the money
is on `core.hand_players`, so a re-parse would spend forty-five minutes to change nothing else,
and keeping the parser out of it is what lets the hero fingerprint be checked *against* this
change rather than through it. That backfill writes whole rows by comparison, not by intent, so it
is idempotent and can *clear* a value that should no longer be there — which is how the 18 hero
cash-out hands written by an earlier revision of the runout rule were removed. Because it touches
`core.hand_players` and not `core.hands`, it dirties no partition, and the mart rebuild after it
needs `--rebuild-from`, exactly as `macros/incremental.sql` says for a bare `ALTER ADD COLUMN`.
`ev_won_bb` stays NULL wherever the adjustment does not apply, and `hand_arrays.sql`'s existing
`coalesce(ev_won_bb, net_won_bb)` means those hands read as the actual result, unchanged.
ADR-035's postflop bucketing can now move from `hand_class` to `made_hand`.

---

## ADR-040 — Wilson for proportions, the standard error of the mean for bb/100, and no interval at all for a ratio

**Status:** ✅ Recommended by me · **Date:** 2026-09-11 · **Plan step:** E.2

**Context.** Every pool and hero number in this product is a sample, and the founder makes real
money decisions from them (spec §17). A bb/100 of −1.37 over 19,802 hands and the same figure over
200 hands are not the same claim, and until now the UI presented them identically. Plan goal 4 of
[POKER_PLAN.md](POKER_PLAN.md) §1 already asks for "every number with its sample size" and
[F-312](POKER_FEATURES.md) calls confidence bands a genuine differentiator, because most trackers
show point estimates with false precision. `Cell` has carried `n` since phase C; E.2 is what turns
that `n` into a statement about how much the number is worth.

**Decision.** Four parts, three of them forced by what the registry actually contains.

*The estimator is chosen by the stat's `format`, and the mapping lives in one function*
(`stats/interval.py:for_cell`). A `percent` stat is a Bernoulli proportion and gets a **Wilson
score interval**; a `per100` stat is the mean of a per-hand amount and gets the **standard error
of the mean**, `100 · z · sd / sqrt(n)`; `ratio` and `count` get nothing. Nothing else in the
engine needs to know which is which.

*Wilson, not Wald.* The Wald interval `p ± z·sqrt(p(1−p)/n)` collapses to zero width at p = 0 and
p = 1, so "folded to a 4-bet 0% of the time, ±0.00, n = 3" is exactly the output it produces in
exactly the case the founder needs warning about. Wilson never degenerates, never leaves [0, 1],
and leans away from the ends — which is why `MetricValue` prints the bounds rather than a single
`±` whenever the two halves differ at the precision on screen. The repo already contained a Wald
half-width, in `poker-core/src/equity/montecarlo.ts`, where it is correct: Monte-Carlo equity
never sits at p = 0 or p = 1 with a handful of samples.

*The plan step is amended: "ratio stats Wilson interval" means the `percent` format.* E.2 was
written before the registry was read closely. In this registry `ratio` is one thing — the
aggression factor, `(bets + raises) / calls` — and it is **not a proportion**: the numerator and
denominator count *disjoint* row sets, the value is unbounded above and undefined at zero calls.
Wilson is not defined for it. All four `af_*` stats therefore get no interval, and all 56 `percent`
stats do, including the four `afq_*` that are built from `numerator`/`denominator` rather than
`situation`/`action` but whose row sets still nest. A correct AF interval exists — Wilson on
`aggressive / (aggressive + calls)` mapped back by `af = p/(1−p)` — but that transform is not in
the codebase and inventing it here would be a second, unrequested feature.

*Asking for a per-100 interval costs the rollup, and that is why intervals are opt-in.*
`marts.stats_daily` stores a daily sum and a daily count per stat and **no sum of squares**, so
the per-hand spread a mean's standard error needs cannot be recovered from it at any price. The
request therefore carries `confidence: 90 | 95 | 99 | null`, defaulting to `null`; when it is set,
`stats.router.plan` refuses the rollup for any stat with a `dispersion` column and
`stats.query.stat_columns` emits `stddevSamp(x) AS <code>__sd` beside the value and the `n`.
Proportions are unaffected — Wilson needs only the value and `n`, both of which the rollup already
sums exactly — so a KPI row of VPIP, PFR and 3-bet keeps the fast path and only the winrate tile
pays. A 40-column grid being scrolled asks for no interval and is unchanged, byte for byte.

**Consequences.**

- `api/` did not change at all. `POST /v1/reports/run` declares `ReportRequest` in and
  `ReportResult` out, so a field on each model is the whole wire change — ADR-023's layering
  earning its keep. The v1 adapters, `analysis/hero` and `analysis/pool` are untouched.
- Adding a field to `ReportRequest` changes `canonical()` and therefore every report cache key.
  The cache is Redis and self-healing; saved reports store the document, and a stored document
  without the key still validates because the field is defaulted.
- **The interval is a floor on the uncertainty, not a ceiling, and the module docstring says so.**
  Both estimators assume independent draws. Several decisions come from one hand, many hands from
  one session, one session against a correlated pool — so the true interval is *wider* than the
  one printed, by an amount the aggregates cannot reveal. This is still a large improvement on a
  bare point estimate; it is not a licence to read the last decimal.
- `z` is tabulated for three levels rather than computed. The inverse normal CDF needs a numerical
  routine, the app venv has no scipy or numpy on purpose, and three levels is the whole product
  need. The tabulated values are asserted against `math.erf` in the unit tests, so a typo fails.
- **A per-100 stat under 30 hands gets no interval at all**, and this was a defect found by
  checking the implementation against Student's *t* rather than by reasoning about it. `z` is the
  normal quantile; at 95% the correct quantile at n = 2 is *t* = 12.706 against z = 1.960, so the
  band the first implementation printed was **6.5× too narrow** (1.15× at n = 10, 1.04× at n = 30).
  An interval six times too confident is not a conservative estimate — it is a wrong number
  wearing the uniform of a careful one, which is precisely what E.2 exists to stop. `MIN_N_MEAN`
  is therefore 30, where the normal approximation is worth having, and below it the engine does
  what it does everywhere else: says nothing rather than something fabricated (spec §17). Student's
  *t* itself was still not adopted — its quantile needs the same numerical routine the *z* table
  avoids, and a bb/100 over fewer than 30 hands is not a number anyone should act on regardless.
  A proportion has no equivalent floor: Wilson's good small-sample coverage is exactly its virtue,
  and `0% of 3 opportunities → 0–56%` is the most valuable thing this feature prints.
- `ROUNDING` moved from `stats/query.py` to `stats/definitions.py`: a bound must be rounded
  exactly as the value it brackets, and both modules now read one table.
- The interval carries its own `n`, duplicating the cell's. Deliberate: a client holding only the
  interval still knows what it rests on, which is the §17 promise in one object.
- The **baseline** cell has no interval of its own. `ReportRequest.baseline()` drops `confidence`,
  because only the baseline's `value` and `n` are attached to a cell and carrying the level would
  drag a whole-pool per-100 query off the rollup to compute bounds nobody reads. A screen that
  wants the pool's interval asks for the pool's own report.

---

## ADR-041 — A leak drills through by its own registry situation; hand notes wait for their table

**Status:** ✅ Recommended by me · **Date:** 2026-09-11 · **Plan step:** D.7 (and D.7b)

**Context.** D.7's Done means is one sentence — "clicking a leak opens the matching hands" — and
when the step was reached nothing in it could be performed. There was no leaks surface in the app
at all: `pages/index.vue` was still D.1's health page and no code called `/v1/hero/leaks`. Worse,
a `Leak` (`analysis/hero/leaks.py`) is deliberately thin — a stat code, the hero's value, the
baseline's, a delta and `|delta| * sqrt(n)` as a score. It carries **no situation**, so there is
nothing on the row to hand to a hand list.

The obvious move was to write the mapping by hand: `fold_to_cbet_flop` means street = flop, facing
a bet, the bet was a c-bet. That is precisely the drift ADR-037 had just finished deleting, where
`hands/search.ts` kept four copies of registry enums and one had already gone stale. Thirty-nine
stats' worth of hand-written situations would have been the same mistake at ten times the size,
and wrong the first time a definition was tuned in `stats/registry/stats/*.yaml`.

**Decision.**

- **A leak's situation is the registry's, read at runtime.** Every built-in stat already carries
  its own filter tree — `situation` + `action`, the `countIf(situation AND action) / countIf(situation)`
  pair of `stats/definitions.py` — and `GET /v1/definitions` serializes the whole `Stat` model, so
  the trees are already on the wire and were being thrown away by the client. The drill-through is
  therefore composition of things that exist: `stat.situation` → `nodeToClauses` (D.5's inverse of
  D.3's compiler) → `encodeClauses` → `/hands?ds=hero&f=…`, read back by the `useFilterUrl()` the
  list already calls. **No second URL grammar, no new endpoint, no vocabulary in the client.** When
  a definition changes, the link changes with it, because both sides are the same YAML.
- **A leak offers two links, because a leak is two questions.** The row's own link is the
  situation **and** the action — the hands where you did the leaky thing, which is what you want to
  watch — and a second, quieter link is the situation alone, the whole spot, whose size the row can
  state exactly because `Leak.n` *is* that denominator. Neither count is derived: the numerator is
  never computed as `n × value` and printed, it is whatever the list comes back with.
- **A leak that cannot be searched says so, and is recognised structurally.** `hand_search_sql`
  compiles every filter against `marts.decisions` alone, and 13 of the 80 dimensions are not on
  that table, so four of the thirty-nine ranked stats cannot become a hand search: `vpip` and `pfr`
  (`situation: {all: []}` with an action on `did_vpip`/`did_pfr`) and `wwsf`/`wtsd` (`saw_flop`) are
  all `player_hands`-only. They are detected by asking D.3's own `tablesFor()` whether `decisions`
  survives the clause list — **never by a hard-coded list of four codes**, which would rot the day a
  dimension is added to a second table. The row then explains itself instead of earning a 400, and
  an empty clause list is refused for the same reason: a link with no `f` would silently inherit
  whatever situation the store already held, which is a wrong answer shown confidently.
- **The leaks list lands in D.7, not D.4.** D.7 is the step judged on clicking a leak, so it owns
  the thing being clicked; D.4 keeps My game's KPI tiles, `WinningsChart` and sessions and composes
  `LeakTable.vue` into `pages/index.vue`.
- **Hand notes and tags wait for their table (D.7b).** They exist nowhere in the stack, and the
  repo's own dividing line puts them in Postgres in as many words — "*if a human edits it, it lives
  here … A note someone typed is Postgres*" (`api/models_pg.py`) — with the tables already specified
  in `POKER_DATA_MODEL.md` (`hand_notes`, `hand_tags`, `player_notes`). That is an Alembic
  migration, and the session that reached D.7 was web-only by instruction while a parallel session
  owned the database. So the clause is split into its own step with its schema written down, rather
  than shipped as half a feature.

**Alternatives.** *Store hand notes as step-less rows in `analyses`* — no migration at all, since
that table already carries `hand_uid`, a `tags` JSONB list and free text, with CRUD at
`/v1/analyses`. Rejected: notes would appear in `/analyze`'s list beside real nine-step analyses,
`current_step`, `steps` and `node_key` would be dead columns on every note row, and the schema
would stop saying what a row is. *A browser-owned Dexie note store*, following ADR-038's precedent
for the training scoring store — rejected because that precedent rests on spec §17 requiring the
trainers to work with no backend, which notes do not, and because ADR-038's store holds *derived*
practice history while a note is the only thing on the screen a person typed and cannot recover.
*Hand-written situations per leak* — the ADR-037 drift, above. *Teaching `/v1/hero/leaks` to take a
filter* so a leak could be scoped before it is clicked — a backend change outside the lane, and not
needed: the leak is scoped by dates and cohort, and the situation is the stat's own.

**Consequences.** The leak→hands path has no logic of its own to keep in step with the backend:
add a stat to the leak preset and it becomes clickable with no client change, and add a dimension
to `decisions` and one of the four dead leaks comes alive by itself. `app/hero/leaks.ts` depends on
`app/filter/node.ts` and `app/filter/clause.ts` — a lane boundary D.7 consumed and did not edit,
which is also the first real caller `nodeToClauses` has. Two silent-wrong-answer defects the same
audit turned up are fixed with it, both inside D.7's own wording: the hand list dropped the date
bounds whenever no clause was set (the two date boxes FilterBar renders did nothing), and
`HandState.actor` — documented as "the seat about to act" — named the next action's seat whatever
it was, so the acting ring sat on a player during `post_sb`, `uncalled_return`, `muck` and `show`;
it is now gated on the `DECISIONS` set that already sat beside it in `poker-core/src/hand/types.ts`.
The cost of the split is that D.7 ships a hands area with no annotation of any kind, and the
founder cannot mark a hand for review until D.7b runs.

---

## ADR-042 — Every cell carries its own `n`; a thin one is dimmed and left uncompared; the threshold travels in the link

**Status:** accepted · 2026-09-11 · plan step D.5

**Context.** Spec §17 says *never fabricate a pool number*: below the sample threshold, show
"insufficient data". Phase F obeys that one figure at a time — `analysis/pool/node_query.py`
refuses to print a frequency under `MIN_N = 100`, and `PoolDataBadge` says *"insufficient data —
41 of the 100 needed"*. A stat grid is the case that rule was written for and the hardest place to
apply it, because every cell is the same eight pixels wide: `0.0%` over three observations sits in
the same column as `41.0%` over eleven thousand and looks exactly as confident.

The engine makes this worse rather than better, and the numbers are measured, not imagined. On the
founder's own hands, grouping by position and pot type, VPIP in 5-bet pots from the big blind is
`6.67%` against the field's `35.18%` — a **−28.5 point leak drawn from fifteen hands**. Grouping
flop c-bet decisions by the flop's high card gives `raise_cbet_flop = 0.0%` on **n = 3**. And
`compare_to` compares anything it is given: hero's 3,245 hands against the pool's 9,036,302 comes
back as a delta of **−9,033,057**, which is arithmetic rather than information. `ReportRequest` has
no `min_n` field and `stats/` suppresses nothing — a `Cell` with `n: 2` is returned with its value —
so the judgement is the client's to make, and it is the client's to make *once*.

**Decision.**

1. **Every cell shows its own `n`**, in the cell and never only in a tooltip. The row's hand count
   is not a substitute: a row of 2,219 flops carries cells of n = 3, because each stat counts only
   the decisions where its own situation arose.
2. **Under the threshold, the value is still shown but marked, and its delta is withheld.** Hiding
   the value would move the guessing elsewhere; drawing the delta would dress noise as a finding.
3. **No observations, no number** — `value: null` reads as a dash even where the pool has a
   baseline for that row, which it usually does.
4. **A `count` is never compared**, whatever its sample.
5. **The threshold is part of the link** (`min=` in the URL, default 100 — the floor
   `node_query.py` and `analysis/hero/presets.yaml` already use). It decides which cells are
   greyed, so it is part of what the link *says*; a link that greys a cell for the sender and not
   for the receiver defeats the point of greying it. `0` is offered and means "show me everything,
   I know why".
6. **Direction is coloured only where the registry commits.** Most stats leave `higher_is_better`
   null — is a 42% fold-to-c-bet good? it depends on the board and on whom — and colouring those
   would invent a judgement the platform has not made.

All six live in `app/reports/cell.ts`, which is the only place that decides whether a number is
worth reading, and is tested against rows taken from the founder's real database. A per-cell
`PoolDataBadge` was considered and rejected: it is the right control for one headline figure, and
13 rows by 8 columns of badges would be a hundred paragraphs where the report wants a hundred
numbers.

**Consequences.** D.4 and D.6 inherit the rule by using `StatGrid`, rather than each re-deciding
what "enough" means. A screen that wants a different floor passes a different `minN`, and the link
it produces carries it. E.2's confidence intervals are complementary and deliberately not requested
here — its own docstring says a 40-column grid being scrolled does not want them — but a saved
report created by a KPI screen with `confidence` set will lose that field if it is re-saved from
the workbench, because D.5 carries `player_key`, `custom` and `limit` through untouched but knows
nothing of `confidence`; adding it to `Carried` is E.2's to do when it lands.

**Also decided here, smaller but load-bearing.**

- **The tree must come back into clauses** (`app/filter/node.ts`). D.3 compiled clauses into a
  filter tree; a preset and a saved report arrive as a tree, so opening one without the inverse
  would show a preset's numbers above a filter bar describing something else. Nested `all` nodes
  are flattened — AND is associative, and D.3's own compiler emits one for every two-bound bucket,
  so refusing nesting would have made every saved report with a stack or sizing bucket uneditable.
  An `any` or a `not` cannot be a clause list: the tree is then kept **verbatim**, sent unchanged,
  and the screen says the builder is not what is being asked.
- **The group-by is the other half of D.3's grain trap.** `stats/router.py` checks the group-by
  exactly as it checks the filter, so `group_by: ['facing']` with `stats: ['hands']` is the same
  400. The picker narrows on the situation *and* the grouping, and names the stats it dropped.
- **`compare_to` and `cohort` go inert rather than being cleared** when the dataset moves under
  them, so switching to the pool and back does not silently forget a setting the founder chose.
- **One composable owns the whole report URL.** Two composables each writing with `router.replace`
  in the same tick compute their next query from a `route.query` the other has not landed in yet,
  and the second drops the first's keys.
