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
| [024](#adr-024--nuxt-4-app-in-spa-mode-one-shared-filter-model-two-entry-points) | Nuxt 4 app in SPA mode, one shared filter model, two entry points | ✅ planned (D) |
| [025](#adr-025--freshness-and-scale-materialized-views-generated-from-the-registry-then-shard-by-tenant) | Freshness and scale: MVs generated from the registry, then shard by tenant | ✅ planned (E) |
| [026](#adr-026--hero-analysis-and-pool-analysis-are-separate-modules-as-in-hand2note) | Hero analysis and pool analysis are separate modules, as in Hand2Note | 🔒 |
| [027](#adr-027--range-lab-is-a-typescript-workspace-of-framework-free-packages-behind-one-nuxt-app-with-a-licence-allowlist-in-ci) | Range Lab: framework-free TS packages behind one Nuxt app; licence allowlist in CI | 🔒 |
| [028](#adr-028--a-node-is-a-predicate-over-decisions-nodekey-is-defined-once-buckets-live-in-the-registry) | A node is a predicate over `decisions`; `NodeKey` defined once; buckets live in the registry | ✅ |
| [029](#adr-029--hand-histories-are-parsed-server-side-only) | Hand histories are parsed server-side only | 🔒 |
| [030](#adr-030--charts-in-poker-ui-are-hand-drawn-svg-not-a-chart-library) | Charts in `poker-ui` are hand-drawn SVG, not a chart library | ✅ |
| [031](#adr-031--the-range-library-the-server-is-the-record-versions-are-append-only-nodekey-lands-with-it-importers-are-pure-functions) | The range library: server is the record, versions append-only, `NodeKey` lands with it, importers are pure functions | ✅ |
| [032](#adr-032--the-replayer-one-hand-shape-from-three-sources-states-are-derived-the-node-is-the-decision-just-made) | The replayer: one hand shape from three sources, states are derived, the node is the decision just made | ✅ |
| [033](#adr-033--what-the-pool-may-say-a-node-is-only-as-good-as-its-columns-and-a-range-is-only-the-hands-that-were-shown) | What the pool may say: a node is only as good as its columns, and a range is only the hands that were shown | ✅ |
| [034](#adr-034--the-analyzer-the-answer-is-fetched-after-the-commit-a-save-is-a-merge-and-a-reveal-names-its-own-authority) | The analyzer: the answer is fetched after the commit, a save is a merge, and a reveal names its own authority | ✅ |
| [035](#adr-035--tier-3-estimates-a-likelihood-ratio-not-a-frequency-and-reports-its-own-error-eqr-is-split-between-the-pool-and-the-engine) | Tier 3 estimates a likelihood ratio, not a frequency, and reports its own error; EQR is split between the pool and the engine | ✅ |
| [036](#adr-036--shard-by-cityhash64user_id-with-a-reserved-tenant-for-the-pool-buy-threads-before-shards) | Shard by `cityHash64(user_id)` with a reserved tenant for the pool; buy threads before shards | ✅ planned (E) |
| [039](#adr-039--all-in-ev-redistributes-the-pot-that-was-actually-awarded-per-side-pot-and-only-where-the-runout-happened) | All-in EV redistributes the pot that was actually awarded, per side pot, and only where the runout happened | ✅ |
| [037](#adr-037--one-filter-object-flat-and-registry-driven-carried-in-the-url-as-text) | One filter object, flat and registry-driven, carried in the URL as text | ✅ |
| [038](#adr-038--the-scoring-store-is-browser-owned-a-spot-is-a-seed-and-the-drawing-mode-is-scored-on-the-metric-the-spec-names-not-on-the-gates) | The scoring store is browser-owned; a spot is a seed; and the drawing mode is scored on the metric the spec names, not on the gate's | ✅ |
| [040](#adr-040--wilson-for-proportions-the-standard-error-of-the-mean-for-bb100-and-no-interval-at-all-for-a-ratio) | Wilson for proportions, the standard error of the mean for bb/100, and no interval at all for a ratio | ✅ |
| [041](#adr-041--a-leak-drills-through-by-its-own-registry-situation-hand-notes-wait-for-their-table) | A leak drills through by its own registry situation; hand notes wait for their table | ✅ |
| [042](#adr-042--every-cell-carries-its-own-n-a-thin-one-is-dimmed-and-left-uncompared-the-threshold-travels-in-the-link) | Every cell carries its own `n`; a thin one is dimmed and left uncompared; the threshold travels in the link | ✅ |
| [043](#adr-043--the-query-budget-is-a-clickhouse-user-per-tenant-not-an-if-in-the-api-requests-are-budgeted-separately-in-redis) | The query budget is a ClickHouse user per tenant, not an `if` in the API; requests are budgeted separately, in Redis | ✅ |
| [044](#adr-044--the-rollups-materialized-view-is-generated-from-the-registry-and-writes-to-its-own-table-never-to-the-dbt-anchor) | The rollup's materialized view is generated from the registry and writes to its own table, never to the dbt anchor | ✅ |
| [045](#adr-045--my-game-is-composed-from-four-calls-and-the-winnings-curve-is-borrowed-from-a-route-d9-deletes) | My game is composed from four calls, and the winnings curve is borrowed from a route D.9 deletes | ✅ |
| [046](#adr-046--the-pool-page-composes-d5s-parts-behind-a-locked-filteraccess-regs-vs-fish-is-two-runs-a-player-is-found-by-substring-not-prefix) | The pool page composes D.5's parts behind a locked `FilterAccess`; "regs vs fish" is two runs; a player is found by substring, not prefix | ✅ |
| [047](#adr-047--the-hot-path-renders-the-dbt-models-own-sql-for-one-batch-provenance-not-a-lock-guards-dbts-swap-the-fresh-rollup-serves-only-what-dbt-has-not-built) | The hot path renders the dbt models' own SQL for one batch; provenance, not a lock, guards dbt's swap; the fresh rollup serves only what dbt has not built | ✅ |
| [048](#adr-048--a-tag-filter-is-an-id-list-not-a-registry-dimension-a-note-lives-in-postgres-on-a-hand-that-lives-in-clickhouse-and-ownership-is-decided-at-the-edge) | A tag filter is an id list, not a registry dimension; a note lives in Postgres on a hand that lives in ClickHouse, and ownership is decided at the edge | ✅ |
| [049](#adr-049--the-cohort-form-is-a-small-vocabulary-of-its-own-offers-what-the-registry-marks-cached-and-shows-a-refusal-in-the-servers-words) | The cohort form is a small vocabulary of its own, offers what the registry marks cached, and shows a refusal in the server's words | ✅ |
| [050](#adr-050--an-example-is-a-spot-in-the-bundle-opened-in-the-analyzers-own-steps-with-no-account-no-upload-and-no-pool) | An example is a spot in the bundle, opened in the analyzer's own steps with no account, no upload and no pool | ✅ |
| [051](#adr-051--an-upload-is-followed-by-its-own-row-to-the-end-a-failure-is-retried-by-dropping-the-file-again-a-file-that-stored-nothing-is-a-failure-and-the-uploader-reads-sentences-never-exceptions) | An upload is followed by its own row to the end: a failure is retried by dropping the file again, a file that stored nothing is a failure, and the uploader reads sentences, never exceptions | ✅ |
| [052](#adr-052--the-winnings-curve-is-a-hero-route-over-the-timeline-query-not-a-day-dimension-the-v1-api-is-deleted-and-every-probe-of-it-re-pointed) | The winnings curve is a hero route over the timeline query, not a day dimension; the v1 API is deleted and every probe of it re-pointed | ✅ |
| [053](#adr-053--a-number-is-typed-as-text-and-read-with-either-separator-a-fraction-is-labelled-a-fraction-a-situation-travels-in-a-link-as-its-canonical-key) | A number is typed as text and read with either separator; a fraction is labelled a fraction; a situation travels in a link as its canonical key | ✅ |
| [054](#adr-054--ci-lives-at-the-repository-root-calls-the-make-targets-instead-of-restating-them-and-runs-on-every-push) | CI lives at the repository root, calls the make targets instead of restating them, and runs on every push | ✅ |
| [055](#adr-055--the-browser-test-owns-the-three-processes-it-needs-refuses-to-run-outside-the-test-environment-and-reaches-ci-as-a-job-of-its-own) | The browser test owns the three processes it needs, refuses to run outside the test environment, and reaches CI as a job of its own | ✅ |
| [056](#adr-056--a-word-that-says-how-a-number-was-obtained-is-a-glossary-entry-a-word-that-names-a-set-is-a-row-in-a-typed-table-both-are-explained-by-the-same-affordance) | The two vocabularies: a word that says how a number was obtained is a glossary entry, a word that names a set is a row in a typed table, and both reach the screen through one affordance | ✅ |
| [057](#adr-057--registry-words-reach-the-screen-through-one-app-side-component-from-the-registrys-own-descriptions-at-runtime-a-blank-area-says-what-it-is-for-and-offers-one-way-in-a-failure-is-a-sentence-that-cannot-be-mistaken-for-no-data) | Registry words reach the screen through one app-side component; a blank area teaches; a failure is a sentence that cannot be mistaken for "no data" | ✅ |
| [058](#adr-058--the-privacy-guard-matches-a-name-where-its-context-proves-it-is-one-and-runs-before-every-push-never-in-ci) | The privacy guard matches a name where its context proves it is one, and runs before every push, never in CI | ✅ |
| [059](#adr-059--one-sentence-one-home-the-tool-catalogue-the-page-explainer-and-control-help) | One sentence, one home: the tool catalogue, the page explainer and control help | ✅ |
| [060](#adr-060--a-number-on-a-hero-screen-says-what-it-means-not-what-it-is) | A hero number says what it means, not what it is | ✅ |
| [061](#adr-061--a-gate-handed-a-reason-prints-it-an-example-therefore-opens-all-nine-steps-and-step-4-stops-printing-the-answer-it-is-about-to-ask-for) | A gate handed a reason prints it; an example opens all nine steps | ✅ |
| [062](#adr-062--a-player-is-found-by-the-name-a-person-types-not-by-the-key-the-pipeline-stores-and-the-registry-says-what-it-means-to-a-reader-with-the-porting-record-kept-out-of-their-way) | A player is found by the name a person types; the registry says what it means | ✅ |
| [063](#adr-063--the-reading-threshold-is-the-one-control-on-a-report-screen-that-folds) | The reading threshold is the one control on a report screen that folds | ✅ |

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

### Correction, found at the round-5 merge (2026-09-15)

`apply_update` stamped `confirmed_at` with `datetime.now(UTC)` in the API process, while `created_at` is the
database's `now()`, and `review_due_at` compares the two. So answering "still true?" could move the next
review **earlier** than the one just answered, by however far the clocks disagreed: the integration test
saw 0.22 s while Docker Desktop's VM ran ahead of the host, and two production machines can disagree by
seconds. `confirmed_at` is now `func.now()`, which the router's refresh reads back — one clock for both
ends of the rule (`c36faa4`). The store's database-free unit test asserts the clock; the round trip
stays in `tests/integration/test_heuristics.py`.

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

---

## ADR-043 — The query budget is a ClickHouse user per tenant, not an `if` in the API; requests are budgeted separately, in Redis

**Status:** accepted · **Date:** 2026-09-11 · **Plan step:** E.3 · **Features:** F-208, F-706
**Supersedes nothing.** Extends [ADR-023](#adr-023) (layering) and the sizing recorded in
[ADR-019](#adr-019) and [ADR-036](#adr-036) / [POKER_SCALE.md](POKER_SCALE.md) §1.

### The decision

A tenant's **query cost** is bounded by ClickHouse itself: each tenant gets a ClickHouse **user**,
assigned a per-tier **settings profile** whose ceilings are `CONST`, and its own hourly **quota**.
A tenant's **request count** is bounded in the API, by Redis, per address on the unauthenticated
auth routes and per tenant on the analytics routes. Two mechanisms, because they are two different
promises.

### Why the budget cannot live in the API

The plan's "Done means" for E.3 says the over-budget query must be *"rejected by ClickHouse, not
by the API"*, and that phrasing is the whole decision. An `if` in `api/` is a limit for callers
that arrive through `api/`. Everything else holding the database credential — the parser worker, a
`dbt` run, `scripts/backfill.py`, a psql-equivalent at a prompt, the next service, a bug — reaches
the same tables by another road and never passes the check. A budget with a bypass is not a budget;
it is a convention. So it is declared to the server, which has no other road.

`CONST` on every ceiling is the second half of that: the connection cannot raise its own limit
(the attempt is `SETTING_CONSTRAINT_VIOLATION`), so even a compromised API process cannot buy
itself more of the node. `readonly = 2` beside it means the report connection cannot write at all,
which is defence in depth next to `GRANT SELECT` on `marts` alone.

### Why a user per tenant, rather than one user and a keyed quota

ClickHouse can key one quota by `client_key` and account per key with a single user, which is
cheaper and needs no DDL at runtime. It was rejected for one reason: **the limits would then be
identical for everyone**. F-208 is written *per tier*, F-704 (billing) is what will choose a
tier, and a tier is only meaningful if it can be assigned to one tenant and not another. A user
per tenant also makes the budget testable at all — the integration test puts one tenant on a
narrow budget and shows the other answering the same query at the same moment, which a shared
quota object cannot express.

The cost is real and accepted: about six idempotent DDL statements per tenant per process, run
lazily on that tenant's first query and cached, plus one connection per active tenant (bounded,
oldest closed first).

### The three things that were got wrong first, and what they taught

- **The fallback was too wide.** Provisioning failure falls back to the shared admin connection
  on purpose — a budget is a fairness mechanism, not the isolation boundary (isolation is the
  `user_id` filter in `stats/query.py`, untouched by any of this), and refusing every report
  because the access DDL was rejected trades a small problem for an outage. But the first version
  caught the *connection* too, so a tenant whose quota was spent would fail to authenticate,
  fall back to the admin connection, and get an unbudgeted one: reconnect and the hour starts
  again. Only the DDL falls back now. A refusal at authentication propagates, because that
  refusal **is** the budget working.
- **The seam already existed.** `run_report(request, tenant_id, *, run=...)` has taken an
  injectable runner since phase C, and every analysis module threads it. So the whole change to
  the read path is `run or tenancy.runner_for(tenant_id)` in four places; no router signature
  moved, and `api/` gained no query-layer knowledge. ADR-023's layering earning its keep for the
  second time (E.2 was the first).
- **The driver refuses a `CONST` setting before the wire.** clickhouse-connect reads
  `system.settings` at connection and raises `ProgrammingError("Setting … is readonly")` client
  side rather than letting the server answer 452. That is fine, but it means a test asserting
  "the ceiling cannot be raised" would otherwise be asserting something about the *driver*. The
  server-side proof is the rejection of the over-budget query itself, corroborated by the
  `readonly` column of `system.settings` as the tenant sees it.

### What the numbers are, and where they came from

`stats/budget.py` holds them, derived from figures already measured in this repo rather than
chosen: 1.5 GB per query (above the 0.98 GiB heaviest measured pool scan, below the 2.5 GB
server-wide ceiling), 60 s (the measured pool-wide arbitrary situation is 1.6 s), 400M rows read
(about 5× today's 73.7M-row `decisions`, so an honest full scan passes and a runaway join does
not), 1M result rows (the engine caps a report at 10,000), 4 concurrent queries (the server allows
16), and hourly 3,600 queries / 10G rows / 1,800 s. They are a first cut whose job is to be a
lever, not a prediction. **`infra/clickhouse/limits.xml` is now one of four files that must stay
in step** — the container cap, the caches, the server-wide ceiling, and these — and its stale
"~69% of the 8G container" comment, recorded as doc drift by E.4, is corrected in this step.

### Why the request budget is separate, and stays in Redis

Counting requests is not bounding work, and the two have different failure modes. The Redis
limiter **fails open** and its counters live in a cache running `allkeys-lru`, so they can be
evicted: acceptable for fairness, and not acceptable for accounting — which is exactly why the
accounting half is the ClickHouse quota and not a second Redis counter. Within the limiter,
buckets are split per route family: `/v1/auth/refresh` was unlimited before this step and could
not simply be given sign-in's bucket, because a browser that refreshes all day would then spend
the budget whose purpose is to stop credential stuffing, and lock its own user out.

`TENANT_REQUESTS_PER_MINUTE` is a module constant rather than a setting because `core/settings.py`
was owned by a parallel session in this round; it is read in one place and should be promoted to
`Settings` when `core/` is next open. Per-tenant *ingest* limits, the other half of F-706's
sentence, are deferred: uploads have a 200 MB per-file cap and no volume accounting, and a real
ingest quota wants the storage accounting that F-704 will need anyway.

### Two corrections, found when the integration tests were first run (2026-09-12)

**Connecting to a tenant must not re-tier it.** The first implementation called
`ensure(tenant_id)` on every connection-cache miss, and `ensure` ends in
`ALTER USER … SETTINGS PROFILE poker_budget_standard`. So a tenant put on any other tier went back
to the standard one the moment it next connected, and the tier — the thing `Budget.name` exists
for — survived only until the next reconnect. All four of `test_quotas.py`'s assertions failed on
it. The statements that *bind* a tenant to a tier (`ALTER USER … SETTINGS PROFILE`,
`ALTER QUOTA … MAX`) are now separated from the ones that merely keep it able to connect, and a
cache miss sends only the latter; a tenant that does not exist yet has no tier to preserve and
still gets the full list. The invariant is asserted directly in a unit test, because it is not
visible from reading either function alone.

**A quota does not count a query that reads no table.** ClickHouse charges the `queries` counter
for a query that goes through a storage; `SELECT 1` is folded to a constant and is free. Measured
on 25.8: twenty-five `SELECT 1`s left the counter at 1 — the one the driver's own handshake spends
on `system.settings` — while a single read of a mart moved it. This is useful (a health check
costs nothing) and it is a trap for anyone writing a test or a monitor that expects to exhaust a
quota by looping on a trivial query.

---

## ADR-044 — The rollup's materialized view is generated from the registry and writes to its own table, never to the dbt anchor

**Status:** accepted · **Date:** 2026-09-12 · **Plan step:** E.1 · **Features:** F-202
**Discharges the reservation in [ADR-003](#adr-003).** Implements the first half of
[ADR-025](#adr-025). Constrained throughout by [ADR-019](#adr-019) (the incremental gate).

### The decision

`marts.stats_daily` gets a second producer — a pair of ClickHouse materialized views — under
three conditions, each of which turned out to be forced rather than chosen:

1. **One renderer emits both.** `scripts/rollup_sql.py: select_body()` writes the SELECT list;
   the dbt model wraps it in `ref()` + the dirty-partition gate, the view wraps it in
   `CREATE MATERIALIZED VIEW ... TO`, and `scripts/mv_sync.py` uses it a third time for the
   backfill. Drift is not guarded against, it is unwritable.
2. **The views write to `marts.stats_daily_mv`, not to `marts.stats_daily`.**
3. **The views are fenced by a boundary row** and everything below it is backfilled.

### Why the view may not write into `marts.stats_daily`, which is the load-bearing finding

`marts.stats_daily` is the incremental chain's anchor. `dirty_partitions()` marks a day dirty
when `max(core.hands.parsed_at)` for it exceeds the `max(src_parsed_at)` already built for it —
a **strict** `>`. And `parsed_at` is stamped **once per ingest batch** (`ingestion/loader.py`)
precisely so the four core tables agree to the millisecond, then flows unchanged into
`src_parsed_at`. So a view writing its own rows into the anchor makes the two sides of the
comparison equal at the instant a batch lands:

    src_max = T  ·  built_max = T  ·  T > T is false  →  the day is CLEAN, for ever

This is structural, not a race. The consequence is that `marts.decisions` and
`marts.player_hands` are **never built for those hands**, while the rollup shows them — and
`stats/router.py` sends a report to the rollup or to the fact tables depending on the stats it
asks for, so the same question answered two ways would return two different numbers, silently
and permanently. It is a worse version of the `player_hand_flags` anchor bug ADR-019 records.

Two further mechanics make a shared table untenable even if the watermark were solved.
`SummingMergeTree` **does not sum `DateTime64`** — verified live: two rows for one key summed
their counter 5+7=12 while `src_parsed_at` kept the *first-inserted* value, so a collapsed
watermark is insertion-order dependent and therefore non-deterministic. And `REPLACE PARTITION`
**deletes** whatever the view had written into a partition it rebuilds, which rules out storing
the boundary as a row inside the rollup: it would be destroyed by the very mechanism it exists
to coordinate with. Hence `_meta.mv_boundaries`.

A separate target has a second virtue that decided the shape of the test: the two producers'
rows sit side by side and can be compared directly, which is exactly what ADR-003 asks for.

### Why the views are not created by the numbered migration

Two reasons, and they point the same way. `api/provision.py` runs the migrations **before**
`build_empty_marts()`, so `marts.decisions` does not exist when migrations run and a migration
naming it fails on every fresh environment. And the migration runner is append-only: it skips a
version it has already applied, so a **regenerated** file would never reach the database and the
view would keep the previous registry's logic while the dbt model moved on — the exact drift this
step exists to prevent. So the split is by what the file *holds*: the two tables hold data and
live in `ch/migrations/0011_mv_stats_daily.sql`; the views are pure derived DDL and live in
`ch/views/stats_daily_mv.sql`, re-applied unconditionally by `scripts/mv_sync.py --refresh`.
Dropping a view never touches a row of its target, so re-applying is free.

### The boundary-marker backfill

A materialized view is forward-only and `POPULATE` drops whatever lands while it runs, so:
write the boundary `T = now + margin` **into the future**, create the view fenced by
`src_parsed_at >= T`, wait for `T` to pass, then backfill `< T` with an ordinary
`INSERT ... SELECT`, one day-partition at a time (ADR-019's memory budget applies unchanged).
No interleaving leaves a gap or an overlap. `marts.stats_daily_mv` is therefore a **complete**
rollup — backfill below the boundary, view above it — not an increment, which is what lets the
reconciliation assert equality with a full dbt rebuild rather than something weaker about a delta.

### What this does NOT deliver, stated plainly

E.1's "Done means" is *"an upload is visible in stats without a dbt run"*, and **it is not met.**
An MV fires only on a plain `INSERT` into its source table. dbt writes the marts with
`ALTER TABLE ... REPLACE PARTITION`, a part-level swap that triggers no view — verified live on
this build: the source went 2 → 5 rows and the view never saw the 3 — and the adapter confirms it
(`get_create_table_as_sql` into `__dbt_new_data_*`, then `replace partition`). Nothing outside dbt
inserts into `marts.*`; the ingest path stops at `core.*`. So the views are correct and **inert**
until something plain-inserts decisions, which is why they are created in the test environment and
deliberately **not** on the real database.

Attaching them to `core.*` instead was considered and rejected: those tables are
`ReplacingMergeTree`, so a re-parse — which this repo does, 9.07M hands of it in September — would
double every counter; the rollup's keys (`site`, `stake_level`, `game_type`, `table_format`) live
on `core.hands` rather than `core.hand_players`; and 47 of the 57 cached stats are decision-grain
and need per-hand action context an insert block cannot see.

The remaining work is the hot path — a generated `INSERT INTO marts.decisions` for
just-ingested hands — filed as **E.1b**. It carries a lost-update race of its own: a hand
inserted between dbt's temp-table build (t0) and its partition swap (t1) lands in the partition
about to be dropped, and the watermark then says the day is fresh. That needs a guard, and it is
why the hot path is a step rather than a footnote here.

### Consequences

`make gen` writes two more files; `make gen-check` fails if either drifts.
`tests/test_rollup_sql.py` asserts the view and the model select the same columns without a
database, and `tests/integration/test_mv_reconciliation.py` compares the two tables over 113
counters and 11 group keys in both directions, with traffic driven through the view in 12
separate insert blocks so partial aggregation is exercised. Reads are unchanged: nothing unions
`stats_daily_mv` yet, which is E.1b's to decide.

---

## ADR-045 — My game is composed from four calls, and the winnings curve is borrowed from a route D.9 deletes

**Date:** 2026-09-12 · **Status:** accepted · **Plan step:** D.4 · **Supersedes:** nothing

### Context

Plan §2.7 lists `GET /v1/hero/overview` returning "KPIs (with CI), timeline series (actual / EV /
showdown / non-showdown / moving average), sessions". `api/routers/hero.py` has never had it: the
hero router is `leaks`, `sessions` and `presets`, and nothing else. D.4 is the step that needs all
three of those things, so the gap had to be closed one way or another.

Three facts decided how:

1. **The KPI numbers are a report.** `POST /v1/reports/run` with `group_by: []`,
   `compare_to: 'population'` and E.2's `confidence: 95` answers all eight tiles in one call, with
   the field's value and a Wilson or normal band in every cell that can carry one. An overview
   endpoint would have been a second way to ask the same question, which is the duplication
   ADR-022 exists to prevent.
2. **The winnings curve is not a report and cannot become one.** The registry has **no day
   dimension** among its eighty — dates are WHERE-clause scope in `stats/query.py`, never a
   group-by — so `/v1/reports/run` cannot produce a time series at any price. The only one in the
   API is `GET /v1/stats/timeline`, a v1 adapter whose own module docstring says *"Deleted in plan
   D.9"*. It already returns exactly the four cumulative series this step needs.
3. **Sessions and leaks already have their routes**, and they take dates and a cohort only.

### Decision

**My game composes four calls rather than waiting for an overview endpoint**, and the page loads
them independently so each panel owns its own failure — a slow pool baseline cannot keep the
sessions off the screen.

**The winnings curve is built on the condemned adapter, behind a boundary.** `heroApi.winnings()`
calls `/v1/stats/timeline` and maps it into this module's own `WinningsPoint` (`net`, `ev`,
`showdown`, `nonShowdown`). No consumer above it — not the chart, not its geometry module, not its
tests — knows a v1 field name. **D.9 therefore changes one function body**, and the obligation is
written into D.9's step rather than left for whoever finds the 404.

The alternative was to add `GET /v1/hero/winnings` in this step. It was rejected on scope, not on
merit: D.4 ran as one of four parallel sessions in the web workspace, a backend route is another
lane's ground, and a route added here would have had to be added *again* properly when the day
dimension question is settled. Registering a `day` dimension is the better long-term answer and is
a registry decision, not a UI one.

**There is no filter bar on My game, only dates.** Of the four panels, two accept dates and a
cohort and one accepts dates and four coarse dimensions. A situation filter whose clauses three of
the four silently ignored is what `pages/leaks.vue` already calls *"a worse lie than no filter
bar"*. The dates come from D.3's shared store, so a leak and the hands its drill-through opens
always answer over the same months.

**`/` is no longer public.** D.1 left it a `/health` page and it was the one route the global auth
middleware did not guard; a page that reads the founder's own hands cannot be that route. The
health check survives as a strip at the foot of the dashboard, which is where "is the database
answering?" belongs on a page made of numbers.

### Consequences

- D.9 cannot simply delete the `/v1/stats*` adapters — it must move the timeline first. That is now
  written into the step.
- A KPI request with `confidence` costs the daily rollup on the two per-100 stats, because
  `stats_daily` stores no sum of squares (`stats/router.py`). Eight tiles is the case E.2's own
  docstring says is worth it; a forty-column grid is not, and the workbench does not ask.
- The four-call layout means four cache keys rather than one, so a date change re-runs four
  queries. Measured on the founder's 19,802 hands against the 54.4M-row pool, a cold load is one
  call per panel and the page is complete in a second.
- `Cell.interval` and `ReportRequest.confidence` now exist on the TypeScript side, which E.2
  deliberately left for its first consumer to add.

## ADR-046 — The pool page composes D.5's parts behind a locked `FilterAccess`; "regs vs fish" is two runs; a player is found by substring, not prefix

**Status:** accepted · 2026-09-12 · plan D.6 (amended before it was built)

**Context.** D.6 was written on 2026-09-09, before the Range Lab spec, before phase F was
interleaved into phase D, and before D.5 built the workbench D.6 is supposed to consume. Audited
against the code first, as D.3 and D.7 were: three of its four clauses were missing **in the web
lane only** — every backend they need already shipped in phase C — and the fourth was already done.

**Decisions.**

1. **The ranges clause is struck, because phase F closed it.** `HandMatrix` does not exist; the
   grid is `RangeMatrix`, whose docstring says so, and `/ranges/compare` already draws the pool
   column through it. D.6's own acceptance — "the ranges page adds no new grid code" — was true
   before this step started. Building a pool-ranges page would have produced the second grid the
   clause exists to prevent. The pool workbench links to `/ranges/compare` instead.

2. **The page composes D.5's parts; it does not mount `ReportWorkbench` and does not fork
   `StatGrid`.** D.5 called that component "the shell D.4 and D.6 may ignore" and it is hero-shaped
   three ways: one prop (`savedId`), an `openFirstPreset()` that lands on a *hero* preset, and a
   bare `<FilterBar />` carrying the dataset toggle this page must not offer. So `pages/pool/`
   mounts `StatGrid`, `StatPicker`, `GroupByPicker` and `DefinitionPanel` directly. ADR-042 already
   made the no-fork rule a decision of record; this is the first step to inherit it.

3. **The dataset lock is structural, not a setting.** Rather than writing `population` into the
   shared Pinia filter on mount — which would leave the hand list showing pool hands afterwards,
   and which the URL would silently undo, since `filter/url.ts` reads any missing or unknown `ds`
   as `hero` — the page wraps the store in a `FilterAccess` whose `dataset` **is** `population` and
   whose every emitted request says so. The shared store is never written to. This matters because
   `analysis/pool/service.py` refuses a body that is not `population` and `stats/request.py`
   refuses `population` beside `hero_only`: a page that let the URL win would 400 on an ordinary
   link. `FilterBar`'s existing `datasets?: boolean` seam hides the toggle; no D.5 file changed.

   **The first version of this was wrong, and the way it was wrong is the point.** "Wrap the store"
   was written as *the shared store is never written to*, and it was not: `applyRequest` does
   `filter.load({ dataset: request.dataset ?? 'hero', … })`, so opening a pool preset stamped
   `population` onto the store `/hands` and `/reports` share — visiting the pool quietly changed
   what the hand list answered, in a lane that had congratulated itself on isolation. The lock is
   therefore **bidirectional**: `load` keeps the dataset the store already had, and
   `reportRequest` forces `population` on the way out. The clauses and the dates still pass through
   untouched, because those *should* follow a person between pages; the dataset should not, because
   on this page it was never a choice. A unit test would not have caught it — the seam looked right
   in isolation — so it is pinned by both a test on `load` and a browser check that walks
   `/hands` → `/pool` → `/hands`.

4. **"Regs vs fish" is two runs, joined on the row key, with no difference drawn.** `ReportRequest`
   carries one `cohort` and `compare_to` is refused for any dataset but hero, so there is no
   pool-vs-pool baseline to ask for. `pool/compare.ts#align` puts both answers over the same rows —
   a bucket one cohort never reached becomes an **empty** row, which `cell.ts` already reads as "no
   observations, no number" — and stops there. Subtracting the two would have been one line and
   would have been a *second* comparison with its own second answer to what "enough" means, in a
   file the grid does not consult. The two samples are shown; the reader does the subtraction.
   The cohorts themselves are the server's: `GET /v1/pool/presets` has been returning `regs` and
   `fish` on every page load, and `reports/library.ts` was dropping them on the floor.

5. **A player is found by substring, and that is a defect worked around, not a preference.**
   `GET /v1/pool/players` compiles to `startsWith(player_key, …)`, but **every** key in the corpus
   is namespaced `ggpoker:<name>` — so the purpose-built route answers "no such player" to every
   real opponent typed by name, which is an assertion of absence that is false. Measured against
   the live API: `prefix=A`, `V`, `Vill`, `P`, `1` each returned 0 rows, while
   `player_key LIKE '%mango%'` returned five real names. The search therefore goes through the
   ordinary report path as a `like`, which keeps the site namespace out of the client entirely.
   **The lower-casing is a measured fact, not a guess:** of all 94,276 distinct keys, none contains
   an upper-case character, so lowering the typed text makes the search case-insensitive in effect
   and would stop matching — rather than match wrongly — if that ever changed. `GET /v1/pool/players`
   should gain an `ilike`/substring mode or drop its namespace; recorded as a backend follow-up.

6. **Spec §17 is met per surface, and the third of its three words is bounded by the running
   system.** Sample size is on **every** cell, always, through `cell.ts` unchanged; tier is
   `PoolDataBadge`'s, where a figure comes from the node tiers; confidence is `MetricValue` on
   headline figures. The grid deliberately does **not** ask for `confidence`: ADR-042 decided that,
   `stats/request.py` warns a per-100 interval leaves the daily rollup, and on a 54M-hand
   population that is a different order of query. Worth recording because it was nearly missed —
   the API process on :8000 **predates E.2** (its own `openapi.json` has no `confidence`, no
   `Interval`), and `ReportRequest` is `extra='forbid'`, so a grid that asked for intervals would
   have 422'd against the very server the founder is running.

7. **The page is `pages/pool/`, not `pages/pool.vue`.** Three routes under one area; in Nuxt a
   sibling `pool.vue` beside a `pool/` directory becomes a parent layout needing its own
   `<NuxtPage />`, which is not what the clause meant.

**Consequences.** Cohort **create/edit/delete** is split out as **D.6b**: the six routes and the
table exist, but they write rows to Postgres and this lane was read-only against the live API by
instruction — the same split, for the same reason, as D.7b. The cohorts page therefore lists and
applies cohorts and says plainly that a shipped cohort has no stored membership list, rather than
inventing one from a report the engine was never asked.

---

## ADR-047 — The hot path renders the dbt models' own SQL for one batch; provenance, not a lock, guards dbt's swap; the fresh rollup serves only what dbt has not built

**Status:** accepted · **Date:** 2026-09-14 · **Plan step:** E.1b · **Features:** F-202
Closes the sentence [ADR-044](#adr-044) left open ("an upload is visible in stats without a dbt
run"). Constrained by [ADR-019](#adr-019) (the incremental gate is the chain's spine) and
[ADR-003](#adr-003) (dbt owns the definitions). Composes with [ADR-036](#adr-036) (sharding).

### The decision

1. **The hot path is the dbt models, rendered a second time.** `scripts/hot_path_sql.py` renders
   `macros/hand_arrays.sql`, `macros/decision_state.sql`, `models/marts/player_hands.sql` and
   `models/intermediate/int_board_by_street.sql` with Jinja, exactly as dbt does, with two stubs:
   `dirty_partitions(column)` becomes *"this tenant, this batch stamp, these partitions"*, and
   `ref('int_board_by_street')` becomes that model inlined, because the just-ingested hands are not
   in the intermediate table yet. `make gen` writes the result to `ch/hot_path/{decisions,
   player_hands}.sql` and `make gen-check` fails if it drifts. The derivation is written once, in
   the dbt macros; nothing about a decision is expressed twice.
2. **A batch is identified by its stamp, not by its hand ids.** `parsed_at` is stamped once per
   ingest batch (ADR-044 relies on that already), flows into every staging view as
   `src_parsed_at`, and is the one column every call site of the gate has in the same form —
   `hand_uid` is the hex string in staging and `FixedString(16)` after `hand_arrays()`, so a
   predicate on it would have to change shape by call site. The batch's partitions are passed
   too, for the same pruning the gate gets: `staging.stg_hands FINAL` filtered by stamp alone is
   **1,116 ms** on the founder's 9M-hand tenant; with the partition, **3.8 ms**.
3. **Every fact row says who wrote it.** `marts.decisions` and `marts.player_hands` gain a last
   column `built_by` ∈ {`dbt`, `hot`} (`macros/provenance.sql`; `'hot'` in the hot-path render).
   That column is the race guard — see below — and it costs nothing at query time.
4. **The hot path is idempotent by an anti-join, and off for bulk paths.** The INSERT skips a
   hand already present in the target for the batch's partitions, so a Kafka redelivery inserts
   nothing and fires no view twice. `hand_sink(hot_path=False)` is what `scripts/import_archive.py`
   and `scripts/reparse.py` build: a 9M-hand import would otherwise run the derivation 1,800 times
   for hands that `scripts/backfill.py` is about to derive anyway, and neither path needs
   second-fresh stats.
5. **Reads take each (tenant, dataset, day) from exactly one rollup.** `stats/query.py` reads the
   rollup as a UNION ALL of `marts.stats_daily` for the slices dbt has built and
   `marts.stats_daily_mv` for the slices where the view holds a newer stamp than dbt's rollup —
   the read-side twin of the dbt gate, over the two rollups only. Nothing is ever counted from
   both. The router is unchanged.
6. **`marts.stats_daily_mv.src_parsed_at` becomes `SimpleAggregateFunction(max, DateTime64)`**
   (migration `0012`), so the stamp survives a `SummingMergeTree` merge as the maximum. ADR-044
   measured the plain column keeping the *first-inserted* value; verified again here (5+7 summed
   to 12 with the January stamp kept; with the aggregate type the March stamp is kept).
7. **Provisioning creates the views** (`api/provision.py` runs `scripts.mv_sync --create`, now
   idempotent), so a fresh environment is never read through a union with an empty half. The
   worker invalidates the tenant's report cache after a batch, without which "fresher" would be
   invisible for `stats_cache_ttl_seconds` (300 s).

### Question 1 — the lost-update race, stated precisely, and why the answer is a column

dbt's `insert_overwrite` builds a temp table at *t0* and swaps the partition at *t1*; the two fact
tables are siblings and are built one after the other, so there are two such windows. The hot path
inserts a batch *B* (stamp *tB*) into `decisions` at *tH* and into `player_hands* at *tH'*. The
gate then asks whether `max(core.hands.parsed_at)` for the day exceeds `max(src_parsed_at)` in
`stats_daily`, per partition.

The per-partition watermark already makes an *all-or-nothing* loss self-healing: if the swap wipes
*B* from both tables, the rollup's stamp for the day stays below *tB* and the next pass rebuilds it.
The silent case is a **half** loss, and there are three of them:

| | `decisions` | `player_hands` | rollup built at t2 sees | old gate |
|---|---|---|---|---|
| A: t1 < tH, tH' < t1' | keeps *B* | wiped | *B*'s decision half, stamp *tB* | **clean** — hand-grain half never built |
| B: tH < t1, t1' < tH' | wiped | keeps *B* | *B*'s hand half, stamp *tB* | **clean** — decision half never built |
| C: t1 < tH < t2 < tH' | keeps *B* | keeps *B* | *B*'s decision half only | **clean** — rollup permanently half |

In every row the rollup's per-day maximum carries *tB* because one branch contributed it, the
strict `>` reads *tB > tB* as false, and nothing is red. There is a fourth: the anti-join and the
insert are one statement but not atomic against a concurrent `REPLACE PARTITION`, so a swap that
lands between them leaves *B* **twice** in a fact table — dbt's rows and the hot rows — with the
gate clean.

Two guards were considered and rejected. *A lock* (dbt's `on-run-start` hook, honoured by the
worker) has a check-then-insert window of its own and turns a dbt crash into a stalled worker.
*Anchoring the gate on the fact tables too* — `anchors: [decisions, player_hands, stats_daily]`,
which `anchor_built()` already supports — catches A and B but **not C** (both facts carry *tB*),
and costs **320 ms + 258 ms** per gate evaluation on the real corpus (`max(src_parsed_at)` per
partition over 73.7M and 54.6M rows; the rollup's is 27 ms).

The guard is provenance. Hot-path rows are `built_by = 'hot'`; dbt-built rows are `'dbt'`; the
generated rollup model aggregates `built_by = 'dbt'` rows only; and the gate gains a second clause:
**a partition holding any `'hot'` row is dirty**. Re-running the table:

- A, B, C: a hot row survives somewhere, so the partition is dirty regardless of stamps, and the
  rollup's stamp comes from dbt-derived rows only, so it never reads *tB* until dbt has derived
  *B* itself. The next pass replaces all three partitions and the hot rows with them.
- The duplicate: the partition holds hot rows → dirty → the next `REPLACE PARTITION` removes them.
- All-wiped, and the ordinary case (hot rows, dbt idle): dirty by stamp, as before.
- A partition dbt has built from a snapshot that included *B*, after which the hot rows were
  swapped away: clean, correct, and the view target already holds *B* once.

So the invariant is *"a partition reads clean only when everything in it was derived by dbt from a
snapshot that included every hand in it"*, which is what ADR-019 always meant. The clause costs
one scan of a `LowCardinality` column per fact table (**69 ms** measured on 73.7M rows with a
stand-in column); the hot path never writes `stats_daily`, so it still cannot advance the anchor.
On the real tables the column is added with `DEFAULT 'dbt'`, which `REPLACE PARTITION` from a
temp table without the default accepts (verified live); the default is kept, because removing it
makes rows in old parts read `''`.

**Upgrading an environment whose marts predate this ADR** — the real database was upgraded this way
on 2026-09-15; a fresh one needs none of it, because dbt creates both columns. In this order, once,
with nothing ingesting:

```
cd platform && make ch-migrate                    # 0012: the view target, aggregate-max watermark
# then, in clickhouse-client -- metadata only, existing rows read 'dbt':
ALTER TABLE marts.decisions    ADD COLUMN IF NOT EXISTS built_by LowCardinality(String) DEFAULT 'dbt' AFTER src_parsed_at;
ALTER TABLE marts.player_hands ADD COLUMN IF NOT EXISTS built_by LowCardinality(String) DEFAULT 'dbt' AFTER src_parsed_at;
uv run python -m scripts.mv_sync --create         # boundary, views, backfill
uv run python -m scripts.mv_sync --verify         # must report 0 / 0
```

Nothing here needs a backup: 0012 drops only `marts.stats_daily_mv`, which is derived from the fact
tables and rebuilt by `--create`, and the two `ADD COLUMN`s change no stored row.

### Question 2 — where the union lives

The E.1b step asked whether reads union the view in the router or behind a `Distributed`/`merge()`
table. Neither. `merge()` and a `Merge` engine are plain unions and would count a hand twice
(ADR-044 made `stats_daily_mv` a *complete* rollup, so it overlaps `stats_daily` almost entirely).
A database-side `VIEW` holding the disjoint union cannot be tenant-scoped: the dirty set is a
subquery, predicates are not pushed into it, and a per-tenant user (ADR-043) is granted `marts.*`
only — which also rules out reading `core.hands` for the signal at all. A parameterized view would
work on 25.8 but needs the tenant as a literal, which `stats/query.py`'s second rule forbids.

So the union is built by the query builder, as the rollup's FROM expression, one level below the
router: the router still picks the logical table `stats_daily`; how that table is *read* is the
builder's. It composes with ADR-036 unchanged — a `Distributed` over each rollup is the `PHYSICAL`
swap it already names, and the dirty set is per shard because dbt and its anchor are per shard.

The dirty set is one scalar, computed once per query:

    WITH (SELECT groupArray((dataset, day)) FROM <view's max stamp per (dataset, day)>
          LEFT JOIN <rollup's max stamp per (dataset, day)> ... WHERE fresh_max > built_max) AS dirty
    SELECT ... FROM (
        SELECT * EXCEPT (src_parsed_at) FROM marts.stats_daily    AS r WHERE r.user_id = {tenant} AND NOT has(dirty, (r.dataset, r.day))
        UNION ALL
        SELECT * EXCEPT (src_parsed_at) FROM marts.stats_daily_mv AS f WHERE f.user_id = {tenant} AND     has(dirty, (f.dataset, f.day))
    ) AS s WHERE s.user_id = {tenant} AND s.dataset = {dataset} ...

`has()` rather than `IN`: ClickHouse evaluates an identical `IN (subquery)` twice in one query
(measured: 12M rows read for a 3M table) and refuses `NOT IN <scalar alias>`; the scalar is cached
and `has()` takes it as a constant. The outer date range is pushed into both branches, so partition
pruning is what it was (EXPLAIN: 10 of 180 parts and 6 of 91). Per (dataset, day) rather than per
day, so a hero upload never routes the same day's *population* slice through the view target,
whose population slice is only as fresh as its last backfill (bulk imports run without the hot
path). Cost on the pool tenant: the two per-day maxima are **38 ms** each; a hero tenant's are
milliseconds.

### What this does not deliver, stated plainly

- **A re-parse leaves the view target stale for the days it touches** — a materialized view is
  insert-only and never sees dbt's `REPLACE PARTITION`. Reads are bounded, not wrong: a stale
  (dataset, day) is served from the view only while it is dirty, and from dbt's rollup as soon as
  the pass lands. The repair is `scripts/mv_sync.py --recreate` after a re-parse or a bulk
  import, once `scripts/backfill.py` has caught up, and `--verify` says whether it is needed.
- **One residual double count.** A hot-path insert swapped away by dbt *and* then redelivered by
  Kafka inserts the batch again (the anti-join sees an empty target) and the view counts it a
  second time. Two independent rare events; bounded the same way, repaired the same way. A claim
  ledger keyed by `(user_id, hand_uid)` would close it and was left out as a table for a race that
  needs two failures at once.
- **A hand ingested while dbt is mid-pass is fresh only after the next pass** in the A/B/C
  interleavings: the view has it, but the day is dirty by provenance, and a dirty day is served
  from the view — so in fact it *is* visible; what waits for the next pass is the fact tables'
  completeness, which only uncached reports see.

### Alternatives

*Read `stats_daily_mv` alone* — simplest, but every re-parse would silently and permanently move
production numbers away from dbt's, and ADR-003 says dbt owns the definitions; the disjoint union
keeps dbt's rollup authoritative wherever it exists. *An increment table dropped on each dbt
build* — contradicts ADR-044's complete-rollup amendment and reintroduces the same race on the
drop. *`dbt compile` for the hot-path SQL* — needs the dbt venv and a live connection inside
`make gen`, which CI does not have. *A `hand_uid IN (...)` batch predicate* — changes type across
call sites (item 2). *`stats_daily_mv.src_parsed_at` in the ORDER BY* — exact too, but grows a row
per batch per group and breaks the "sort key = group keys" contract the tests pin.

### Two things implementation found

**Planning, not execution, is the hot path's cost.** The decisions derivation for a two-hand
batch took 3.2 s, of which `EXPLAIN` alone -- no rows read -- was 3,240 ms under ClickHouse
25.8's analyzer and 182 ms under the legacy one (`enable_analyzer = 0`); execution is ~170 ms
either way. The cost is planning `decision_state()`'s hundred-odd lambda expressions, which dbt
pays once per pass and never notices and which the worker would pay once per batch. So the
decisions statement runs with `enable_analyzer = 0` (`ingestion/hot_path.py: SETTINGS`), the
player_hands statement on the default: it plans in under 200 ms, and the legacy analyzer refuses
its `ARRAY JOIN ... AS seat` beside `seat AS seat`. A speed setting, not a semantic one -- the
integration test compares the rows with dbt's, which plans with the server default. Measured
after: 246 ms and 320 ms for the two statements on the test corpus.

**The stamp predicate is exact only for the batch the loader has just written -- which is the
only batch the hot path ever derives.** Re-deriving the founder's newest hero batch (647 hands,
5,198 decisions) from the real staging views matched dbt's rows on 60 of 78 columns and differed
on every seat attribute, because only 3,519 of that batch's 3,882 `core.hand_players` rows still
carry the batch stamp: the E.5 equity backfill of 2026-09-11 re-stamped the rest. So the hot
path is not a repair tool for old batches, and the loader's invariant that the four core tables
share one stamp (`tests/test_loader_rows.py`) is what it rests on. Bound the same way, a Kafka
redelivery re-stamps the core rows while the hot rows keep the stamp they were derived under;
the newer stamp is exactly what makes the partition dirty, and dbt's rebuild carries it.

**The `stats_daily_mv` created by 0011 is dropped by 0012**, views first. On the real database
it was empty and had no views; on any other, `api/provision.py` re-creates and re-backfills
through `--create`, which is now idempotent (present views are left alone) so provisioning can
call it every time.

### Consequences

Two new generated files, one new migration, one new dependency (`jinja2`, BSD-3), `make gen`
runs a third generator. `tests/test_hot_path_sql.py` pins the render without a database;
`tests/integration/test_hot_path.py` proves a hand ingested through the worker is in a report
with no dbt run, that the hot-path rows equal dbt's row for row (`EXCEPT` both ways on the same
hands), that a partition with a hot row is dirty when the stamps say clean, and that the report is
byte-identical after dbt. `tests/integration/test_mv_reconciliation.py` passes unchanged in its
assertions; its fixture now calls `recreate`, so the backfill path is still exercised with data.
On the real database: `0012` applied, `built_by` added to both fact tables, the views created and
the target backfilled over 160 partitions, and `--verify` reports zero disagreement both ways.

---

## ADR-048 — A tag filter is an id list, not a registry dimension; a note lives in Postgres on a hand that lives in ClickHouse, and ownership is decided at the edge

**Date:** 2026-09-14 · **Status:** accepted · **Plan step:** D.7b · **Supersedes:** nothing

### Context

D.7b is the third clause of D.7 — "tags/notes" — split out on 2026-09-11 (ADR-041) because it is the
one clause that existed nowhere in the stack and needs a migration. Audited before building, as the
last four D steps had to be: unlike D.3, D.6, D.7 and D.6b, **it really was unbuilt** — no table, no
route, no client, no panel; the only hits for "note" under `api/` were the range library's
per-version note and the analyzer's step takeaways, neither of which is a note *on a hand*. The plan
left two things to settle before building, and the first of them is the decision this ADR exists
for.

Two facts shape everything here. **A hand is a ClickHouse row and stays one** — `core.hands`, keyed
`(user_id, hand_uid)`, rebuilt from raw text whenever the parser improves. **A note is a Postgres
row**, by the dividing line `api/models_pg.py` states in as many words ("*a note someone typed is
Postgres*"): it is edited one row at a time, which is the question ClickHouse hates. So the two
halves of "a note on a hand" live in different databases, joined by nothing but the 32-character
hex `hand_uid` every URL already carries.

### Decisions

1. **The tag filter is an id-list intersection, carried as `?tag=`, and the stat registry does not
   learn the word "tag".** A registry dimension is a *column on a ClickHouse mart*: the compiler
   renders it into SQL, the rollup generator sums over it, `make gen` writes it into the dbt
   models, the builder offers it in every report and group-by. A tag is none of those things — it
   is a human-edited Postgres row that changes between two reports — so a `tag` dimension would
   either need the compiler to reach into Postgres mid-render (a cross-store join inside the one
   module that must stay pure), or need every tag edit copied into ClickHouse (single-row updates
   into a MergeTree, and a re-parse would drop them), and it would surface as a group-by that no
   mart can answer. Instead the hands router looks the tag up in Postgres and hands the matching
   `hand_uid`s to the ClickHouse query as a restriction: `hand_uid IN {only}` on `core.hands` for
   the two plain lists, and on the decision mart — whose key is the 16 raw bytes — a subquery,
   `s.hand_uid IN (SELECT toFixedString(unhex(x), 16) FROM (SELECT arrayJoin({only_hand_uids}) AS
   x))`. **That form was the browser's correction, not the first draft's:** the first version
   wrote `IN arrayMap(x -> unhex(x), {only_hand_uids})`, which the unit test accepted and the real
   server refused with `UNSUPPORTED_METHOD` — ClickHouse's `IN` takes a constant or a table
   expression, and a function over a bound array is neither — so `/hands?tag=bluff&f=street:eq:flop`
   answered 500 while the plain lists, whose `IN {only}` *is* a constant, worked. The scenario's own
   check had passed on the `OPTIONS` preflight; it now asserts the `POST`. **The search document is
   untouched:**
   `only_hand_uids` is a keyword on `hand_search_sql`, deliberately *not* a field of `HandSearch`,
   because that document is a situation and an id list is not one. A tag nobody has used answers
   `[]` without asking ClickHouse at all. The list is bounded by the user's own tagged hands and
   travels as a bound array parameter, never interpolated.

2. **Ownership is decided at the HTTP edge, against ClickHouse, with the same 404 as the hand
   itself.** There is no foreign key from `hand_notes` to the hand, because the hand is in another
   database. So every route under `/v1/hands/{uid}/` hangs off one dependency, `owned_hand`, which
   asks `core.hands` whether this tenant has this `hand_uid` (a point lookup on the sort key) and
   answers "Hand not found" otherwise — for another tenant's hand and for a hand that does not
   exist alike, because the response must not reveal that a hand exists at all, which is the rule
   `GET /v1/hands/{uid}` already keeps. Reads get the same check as writes; a special case for
   reads would have been one more rule to remember for the cost of one point query. The pool's
   hands carry the founder's tenant (ADR-036's finding), so they can be annotated too.

3. **A tag has one spelling, decided in one place.** `normalize_tag` — trimmed, lower-cased, inner
   whitespace collapsed, refused in words when nothing is left or more than forty characters is —
   is applied on every road a tag travels: the `POST` body, the `DELETE` path and the `?tag=`
   query. So `Bluff`, ` bluff ` and `BLUFF` are one row, `?tag=Bluff` finds the hands tagged
   `bluff`, and the chip on the hand reads as the server spells it. The client keeps only a mirror
   of the rule to grey the Add button for a tag already on the hand; the server stays the authority.

4. **The cap is on the vocabulary, not on the hand.** `MAX_DISTINCT_TAGS = 500` per user: the
   501st *distinct* tag is refused with a sentence, while a tag already in use goes on any number
   of hands. Five hundred is already past what a tag list can be browsed at; a per-hand cap would
   have been a second constant guarding a case the first one already bounds.

5. **A blank note removes the row.** A note that says nothing is not a note, and an empty row would
   list the hand as annotated. `PUT` with whitespace deletes and answers the same shape as a hand
   never written on (`body: ""`, `updated_at: null`), so the panel needs no separate delete.

6. **`HandSummary` carries `tags`, attached by the routers.** Every list row shows its tags, so the
   three list routes (`GET /v1/hands`, `POST /v1/hands/search`, `GET /v1/pool/hands`) decorate their
   rows in one Postgres query over the page's `hand_uid`s. The field defaults to an empty list, so
   a row read straight off ClickHouse (`summary_from_row`, unchanged) is still valid.

7. **`player_notes` and colour labels (F-508) wait.** They key on `player_key`, not `hand_uid`;
   their surface is the pool's players page, not the replayer; and nothing in this step consumes
   them. Bundling a third table into this migration to save a later one would have been a table
   with no reader — they get their own step and their own migration when the players page wants
   them.

8. **The panel takes its API as a prop and lives on the page, not in `HandStudy`.** A pasted hand
   has no `hand_uid` and nothing on the server to hang a note on (ADR-029), so `pages/hands/[id].vue`
   mounts `HandNotes` beside `HandStudy` and `pages/hands/paste.vue` does not. The API arrives as a
   prop, the way `poker-ui`'s components take their services (ADR-027), which is what lets the panel
   be the **first app component mounted under Vitest** — with an in-memory fake, no Nuxt — and that
   needed one line of shared configuration: the `~` alias in `web/vitest.config.ts`. The note
   autosaves 800 ms after typing stops and is flushed on blur and on leaving the page; **the last
   text typed is the text saved** — a save already in flight when more typing arrives is not
   reported as "saved", and another follows once it lands — and the box stays disabled until the
   server's note has loaded, so an autosave can never overwrite a note with the empty draft.

9. **The Postgres-only tests live in `tests/postgres/`, with ownership faked, and the reason is
   the other lane.** `tests/integration/`'s session fixture drops and re-provisions the ClickHouse
   `test_` databases and rebuilds the empty marts, because its tests ingest hands — and another
   lane owned that namespace throughout this session. A suite whose every query is Postgres can
   run beside it against any database ending in `_test`, so `tests/postgres/conftest.py` provisions
   Postgres alone, and its guard is *stricter* about ClickHouse than the integration one: the prefix
   must be **set** to anything but the empty string, so a route reached by mistake fails on an
   unknown database instead of reading the founder's real hands. `owned_hand` is overridden through
   `app.dependency_overrides` with a registry of who owns what; the unfaked path — a hand really
   ingested, another tenant really refused by `core.hands`, a tag filter really compiled against the
   decision mart — is `tests/integration/test_hand_notes.py`, which this lane could not run.

### What the tests found before a browser did

**The honest 500-request loop cannot pass, and that is E.3 working.** The first version of the
501st-tag test added five hundred tags through the API and was refused at request 300 — not by the
cap, by `TENANT_REQUESTS_PER_MINUTE` in `api/ratelimit.py`, with "Too many requests for this
account". The same loop would have failed under `make test-all` for a reason unrelated to the
feature, which is exactly the shape of test the last merge session warned about. Both tests now seed
the first 499 tags as rows through the store and send the 500th and the 501st over HTTP, so the cap
is still exercised at its literal boundary and the budget is left to its own tests.

### What the adversarial review found, and what was done with it

Six reviewers with distinct lenses read the slice; their verifiers all died on a session limit, so
the seventeen raw findings were triaged by hand rather than by vote. **Four were real and are
fixed, each with a test in `tests/postgres/`:** (1) a tag containing `/` — `3-bet/4-bet` is a
natural one — could be added but never removed, because the client sends it as `%2F`, the server
decodes the path before routing, and a plain `{tag}` segment then never matches; the route is
`{tag:path}` now, and `50%25%20pot` and `why%3F` are exercised beside it. (2) The note's first
save was read-then-insert, so two first saves of one hand at once (two tabs) would both insert and
the second would 500 on the unique constraint; `put_note` is an `ON CONFLICT DO UPDATE` upsert, and
`add_tag` an `ON CONFLICT DO NOTHING`, so the router's `IntegrityError` handling went away with it.
(3) A NUL byte in a note or a tag reached Postgres, which refuses it, as a 500; it is refused at
the pydantic layer in words. (4) The `extra="forbid"` test for the note body passed vacuously —
`{"Body": "x"}` fails on the *missing* `body` first — and now sends both spellings. **Four more were
worth doing:** the two client-side length limits are named constants mirrored from the server; the
note box and the tag input carry `aria-label`s and the save status is a polite live region; and the
Postgres-only conftest's Redis guard parses the URL's path, so a URL naming *no* database (which
Redis reads as 0) is refused too — the integration conftest has the same gap and was left alone as
another lane's file. **One is accepted rather than fixed:** the 500-distinct-tags cap is checked
read-then-write and concurrent adds of *different* new tags can overshoot it by their number; it
bounds a vocabulary, not an account, and an advisory lock per request is not worth that. **Two were
already fixed by the time the review returned** (the `arrayMap` form; the plan line still reading
"Not started").

### Consequences

- The registry's 80 dimensions are unchanged, the compiler knows nothing of tags, and `make gen`
  output is byte-identical (`gen-check` green).
- A tag filter costs one Postgres query plus an `IN` list the size of the user's tagged hands. At
  the corpus's scale (19,802 hero hands) that is trivially bounded; if a user ever tags most of a
  million hands the list becomes a temp-table question, which is a change inside `restrict_to` and
  the two `hand_query` functions and nowhere else.
- `HandSummary` gained a field, so every producer of a list row carries tags by construction; a
  future list route that forgets `attach_tags` shows empty chips rather than wrong ones.
- Re-parsing the corpus loses nothing written on it: `hand_uid` is derived from the hand's own
  identity, and the note never lived in the table that gets rebuilt.

---

## ADR-049 — The cohort form is a small vocabulary of its own, offers what the registry marks cached, and shows a refusal in the server's words

**Status:** accepted · 2026-09-14 · plan D.6b (amended before it was built)

**Context.** D.6b is D.6's write half, split out by ADR-046 because it writes rows to Postgres and
that lane was read-only. Its wording said `app/pool/stats.ts` "already types all six routes".
Audited against the code first, as D.3, D.6 and D.7 were: the server side was complete and needed
nothing — the six routes in `api/routers/pool.py`, the `cohorts` table with `uq_cohorts_user_name`
(migration `8b2f4c6d1e3a`, in the chain to head), the 409 sentence, the 400 at create for a rule on
an uncached stat (`stats/query.py#_cached_stat`), the 422 list for an eleventh rule
(`MAX_COHORT_RULES`) — each measured over HTTP before a line of the form was written. The client
typed the **shapes** (`PoolCohort`, `CohortSpec`) and bound only the three reads; no `POST`, `PUT`
or `DELETE` call existed. So the step became web-only — `app/pool/**`, `components/pool/**`,
`pages/pool/**` — one of three parallel lanes, with no migration and no Python.

**Decisions.**

1. **The rule builder is a vocabulary of its own, not `ClauseRow`.** `app/pool/rules.ts` holds
   it: four comparisons, a stat, a number, at most ten rules. A cohort rule is a smaller language
   than a filter clause and is refused by different code for different reasons (`stats/request.py`
   for the shape, `stats/query.py` for the stat); teaching the 80-dimension builder that dialect
   would have meant hiding most of what it knows. The logic is framework-free and unit-tested, the
   `.vue` only binds — the pattern every `app/<area>/` already follows.

2. **Which stats may define a cohort is the registry's to say, and the form shows both answers.**
   `Stat.cached` was already on the wire. The picker offers the cached stats (57 today) and lists
   the uncached ones (8: the aggression factors and frequencies) **greyed** under "Not cached —
   cannot define a cohort", rather than hiding them: a person then learns *why* aggression factor is
   not on offer instead of wondering whether it exists. No list of codes lives in the client; when
   the registry changes, the picker changes with it.

3. **A refused write is shown in the server's sentence; the client checks only the shape.**
   `describeCohortError` passes a 409 and a 400 detail through verbatim, and reads a 422's *list*
   item by item ("criteria.rules: List should have at most 10 items after validation, not 11") —
   the one shape `describeApiError` cannot read and would have reported as a bare status. The
   client refuses an empty name, a value that is not a number, and an eleventh rule ("Add a rule"
   is disabled at ten and says why) — but it does **not** judge whether a stat is cached. Two
   authorities for one rule would drift; the server's is the one that counts, and it was measured:
   a rule forced onto `af_flop` by un-greying the option earned exactly
   `cohort rule on 'af_flop': only cached stats can define a cohort`, and nothing was saved.

4. **The list is re-read after every write; the form's draft never becomes the page's truth.**
   `toSpec` builds a new document (the plan's "assign a new object, never push into `.rules`"),
   and after a `POST`, `PUT` or `DELETE` the page calls `load()` again, so what is shown is what is
   stored — `25` comes back as `25.0` and is described as the server has it.

5. **"Save as mine" is the answer to the shipped cohort's missing member list.** ADR-046 recorded
   that a shipped cohort has no membership list and said so on the page. The copy button opens the
   form pre-filled with the preset's label and rules and saves a cohort of the founder's own, which
   does list them (7,711 players for Regs at verification). The shipped rules are still never
   retyped in the client — they arrive from `GET /v1/pool/presets` and pass through.

6. **Delete asks first, in the browser's own dialog, and says what a stale link will do.**
   `window.confirm`, as `/ranges/[id]` already does. The sentence says a `/pool?cohort=<id>` link
   that named the cohort will measure the whole field instead — which is exactly what that page's
   `labelOf()` does with a key it cannot find. Verified both ways: declining sends nothing.

**Verification.** A headless Chrome of its own (the shared MCP profile was another lane's), the app
on `:3006`, a throwaway API on `:8806` over a scratch Postgres `poker_d6b_verify` migrated to head,
and the real ClickHouse read-only — the first account registered there is tenant 1 and so sees the
real 9M-hand pool while writing nothing to the real Postgres. 37/37 checks; another tenant's
`GET`/`PUT`/`DELETE` on the id answered 404 over HTTP with a second throwaway account. The database
was dropped afterwards.

**The review changed two of these before the tick, and the way they were wrong is worth keeping.**
An adversarial review ran before the step was ticked (five lenses; two of them and every refuter hit
the session limit, so the seven findings were judged by hand against the code). Two were real
defects in the page: editing a cohort whose "Who is in it" panel was open left the panel showing the
*pre-edit* size and members under the words "right now" — the list was re-read, the panel was not —
and the write and its read-back shared one `try`, so a `poolPresets()` failure *after* the server
had accepted the row would have shown as a refused save with the form still open, and the next
Save would have earned the real 409 for a cohort the person believed was never saved. Both were
invisible to the first browser run, which edited with the panel closed and never lost the list.
Now the panel is fetched again after an edit of its cohort (measured: 1,444 → 3,563 players as the
threshold moved) and a failed reload is its own sentence. Three tests were also tautological under
mutation — a `MAX_RULES` of 11 passed every test because the tests were built from the constant —
and now pin the literals the server holds.

**Consequences.** A saved cohort whose stat later stops being cached (a registry change) would open
in the form with its greyed option selected and be refused on save with the server's sentence —
correct, and unverified only because it cannot happen from the UI today; a stat the registry no
longer names at all is shown as such in the select rather than as its first option.
`GET /v1/pool/cohorts/{id}` is still fetched only when "Who is in it" opens. **Follow-up outside
this lane:** `validationMessages` in `pool/rules.ts` is the app's only reader of a FastAPI 422 list
and has nothing cohort-specific in it — it belongs beside `errorDetail` in `auth/api.ts`, with
`describeApiError` reading a list, after which `describeCohortError` is unnecessary; left where it
is because `auth/api.ts` was not this lane's file. The lane's gate, `make web-check`, was **green
over the combined tree** at the end of the session (846 tests / 79 files); its first run had been
red on one line outside the lane — `app/hands/notes.ts:92`, lane B's `createAutosave` at 47 lines
against the 40-line rule — which that lane fixed before the final run.

---

## ADR-050 — An example is a spot in the bundle, opened in the analyzer's own steps with no account, no upload and no pool

**Status:** accepted · 2026-09-16 · plan F.12d (round 6, lane E)

**Context.** Spec §13 asks for a "permanent *Examples* section with 3–5 pre-loaded analyses to explore"
and a "first-run guided tour — short, skippable, resumable from the help menu". The UX audit
([POKER_UX_AUDIT.md](POKER_UX_AUDIT.md) §2.10) found nothing tour-, help- or example-shaped in the app at
all, and §6 inventoried the materials without choosing between them. ADR-050 was reserved for this
choice. Four facts bound it:

1. **A first visit is anonymous.** `middleware/auth.global.ts` sends every non-public page to `/login`,
   and every API route needs a bearer token (ADR-024). An example that needs an account or a running API
   cannot be what a first visit is offered.
2. **Only real hands go into the real `core.*`/`marts.*`** (CLAUDE.md). An example hand cannot be a hand
   stored in the founder's tenant unless it is one of the founder's own.
3. **Four of the analyzer's nine steps are scored against the pool.** Steps 1, 2 and 6 read
   `ctx.pool`, step 9 `ctx.poolFacing`; with no pool, `poolGap(null)` returns `''`
   (`analyze/context.ts`) and `PredictionGate` shows "Working out what actually happens here…"
   **for ever** (`PredictionGate.vue`) — a frozen state the spec forbids outright.
4. **Only one pair of reference charts is honest for a flop.** `train/charts.ts` has eight charts;
   `btn_rfi` against `bb_call_vs_btn` is the only pair where the caller's chart *is* the range that
   reaches the flop. Every other pair would need a range nobody has written down (what the CO calls a
   3-bet with), and inventing one is exactly the "bare number of unclear provenance" §13 forbids.

**Decisions.**

1. **An example is data in the bundle, not a row anywhere.** `app/help/examples.ts` holds three
   `Example`s: a `NodeKey`, the two reference-chart ids for its seats, a flop, hero's two cards, hero's
   bet as a share of the pot, and the prose (title, what it teaches, the story, where it comes from).
   `exampleSteps()` turns that into the analyzer's own `AnalysisStep[]` — step 1's ranges, step 3's
   board, step 5's hand, step 6's size. Nothing is written to ClickHouse, Postgres, IndexedDB or
   `localStorage`, so the real-hands rule cannot be broken by an example and a reader's answers are
   gone on reload, which the page says.
   *Rejected:* a row in `/v1/analyses` (needs sign-in and the API; rows are per user, so a first visit
   could not open one, and a `pasted` analysis reopens with no hand anyway); a stored or pool hand
   (decision 2 above).
2. **It lives at `/examples` and `/examples/<id>`, both `public: true`**, with an *Examples* entry in
   the nav and in the help menu. Both pages render correctly with the API stopped, because neither
   fetches anything.
3. **It opens in the analyzer's own step components** (lane C's `components/analyze/Step{3,4,5,7,8}`)
   over a local `StepContext` (`help/exampleSession.ts`) — not a second analyzer written beside the
   first. The reader gets the real mechanic: commit an answer, then see what is true.
4. **An example never asks the pool, and offers only the five steps poker-core can answer** (3, 4, 5,
   7, 8). Steps 1, 2, 6 and 9 are not mounted; the rail is `STEP_LABELS` filtered to the five, and
   `StepperNav` ignores a step it was not given. The inputs those steps would have produced are set up
   instead — step 1's two ranges and step 6's size — and the page says so in one sentence, with the way
   to all nine: open one of your own hands and press *Analyze this node*. **No gate on an example can
   wait for an answer that is never coming.**
   *Rejected:* handing the steps a `NodeFrequencies` with `enough: false` — it prints "The pool has
   played this 0 times", which is false; and fetching the pool when signed in — it would make the page
   behave differently for two readers, and the seed spot's stake is not the founder's pool's.
5. **The three examples are the same two ranges on three flops** — the button opens, the big blind
   calls, on K♥9♦4♠ (the committed PokerStars seed hand #245678901235, whose node this reproduces
   byte-for-byte through `nodeKeyAt`), on J♥8♥5♣ and on A♦A♠3♥. One pair of charts is the honest one
   (fact 4), and three flops over the same ranges is the lesson: the range edge, the nut split, the
   blocker question and what one hand is *for* all move with the board. `examples.test.ts` pins each
   example's stated lesson to what the reveals actually compute, so a chart edit that makes a lesson
   lie fails there rather than in front of a reader.
6. **The first-visit offer is a strip under the header, not a modal**, listing the tour and all three
   examples. It is answered by taking the tour, opening an example, or *No thanks*; the answer lives in
   `localStorage['poker-help/v1']` (`{welcomed, tour, stop}`) — per browser, never per account, never
   sent anywhere. Storage that throws reads as a first visit and a refused write is dropped, so the
   worst case is being offered the tour twice.
7. **The tour is five stops on public pages, anchored on `data-testid`s the pages already carry**
   (`step-purpose`, `prediction-gate`, `stepper-7`, `mode-advantage`, `mode-equity`) — it adds no
   attribute to another lane's markup and renames nothing. Every word of every stop is a string the
   analyzer or the trainers already show (`STEPS`, `MODES`); the tour's own new words are the chrome
   ("Tour · 2 of 5 · Your call, before the answer", Back/Next/Finish, "End tour Esc").
   `tour.test.ts` enforces all three rules: the words exist verbatim, every route is a `public: true`
   page, and every anchor is a `data-testid` declared in the source.
8. **A stop whose anchor never appears says so on the card** after 5 s rather than waiting in
   silence, and a stop on another page offers "Take me there" instead of hijacking navigation.
9. **A tour found running by a new page load is stopped where it was** (`onArrival`), so a reload or a
   return visit never has the card reappear unasked; the help menu then reads "Resume the tour (stop 3
   of 5)".
10. **The `?` overlay is generated from one registry**, `app/help/shortcuts.ts`, which lists every
    shortcut that exists today: `?`/Esc, undo and redo, an explained word's Esc, the matrix, the range
    text box, the analyzer rail, the replayer, the prediction gate and the number boxes. Each group
    names the files that bind it, and `shortcuts.test.ts` scans `poker-ui/src` and `apps/web/app` for
    key handlers and **fails when a file that binds keys is not named in the registry** — so a shortcut
    added without a row here cannot land undiscoverable. Keys are tokens (`Mod`, `Shift`, `ArrowLeft`)
    rendered per platform: ⌘⇧Z on a Mac, Ctrl+Shift+Z elsewhere. The overlay is a native `<dialog>`
    (Esc and focus trapping from the platform, nothing inside it to lose), like `SaveReportDialog`
    before it. It stays **keys only**: a vocabulary reference belongs beside the words it explains, so
    lane C's `VocabularyTable` is not mounted here (follow-up 6).

    *The guard earned itself inside the round.* It went red twice on bindings this lane does not own —
    lane C's `useUndoShortcuts` (the undo keys moved to the window, and now cover `/ranges/[id]` and
    step 1 as well as the Lab and the drawing trainer, one brush stroke per undo step) and lane D's new
    `components/reports/RegistryTerm.vue` (Esc dismisses a term's explanation). Both are rows in the
    registry now, checked against those lanes' code rather than their description of it.

**Reviewed adversarially** (six lenses over the lane's files, each finding then given to a skeptic
told to refute it): 13 findings, 10 refuted, 3 fixed here — the tour card followed an anchor scrolled
out of the window instead of parking in the corner (`placement.ts`); it went on ringing an anchor the
page had destroyed, drawing an 8-pixel ring in the window's corner, until the reader changed stop
(`TourCard.vue` now re-finds the anchor when it is detached); and Esc ended the tour while the reader
was typing in a box, which the shortcut list itself says it does not do.

**Consequences.**

- A first visit, signed out, with the API stopped, can read a worked spot, commit five predictions and
  see five reveals — all computed in the browser (the equity Worker enumerates the flop exactly).
- The Examples section is not the whole analyzer: four steps of nine are missing from it by design.
  Whether that reads as "pre-loaded analyses" is the founder's call; the way to all nine is one click
  from the page, and follow-up 1 below closes the gap if he wants it closed.
- Lane C owns the step components an example mounts. A change to `StepContext` or to a step's props
  breaks `/examples/<id>` at `nuxt typecheck`, not silently — and `example.test.ts` mounts all five.
- Nothing about help reaches the server: no new endpoint, no migration, no new dependency.

**Follow-ups (not built here).**

1. **All nine steps in an example**, which needs four lines in lane C's files: add
   `readonly poolMissing?: string` to `StepContext` (`analyze/context.ts`); let
   `poolGap(pool, missing = '')` return `missing` when `pool` is null; pass `props.ctx.poolMissing` at
   the four call sites (`Step1Ranges.vue`, `Step2Subtract.vue`, `Step6Decision.vue`,
   `Step9Deviation.vue`). Then an example can mount all nine with an honest sentence where the pool
   would have been. Left undone because it edits four files lane C is changing this round.
2. **`Step4Nuts` renders `RangeComparisonPanel` before the prediction is committed**
   (`Step4Nuts.vue`), so step 4's answer — the nut split — can be read off the page before answering.
   Found on the example page; it is the analyzer's own behaviour everywhere, and it is lane C's file.
3. "Try an example" links in the empty states that the audit §2.4 lists (`/hands`, `/analyze`,
   `/ranges/compare`, the report workbench) — those pages belong to lanes C and D.
4. `apps/web/README.md`'s route table has no `/examples` row (the file belongs to no lane this round).
5. A fourth and fifth example need a reference chart the set does not have (decision, fact 4).
6. A vocabulary reference has no home: lane C's new `VocabularyTable` (`@poker/ui`) is a one-line mount
   if `/examples` or a `/help` page should carry one. Deliberately not in the `?` overlay.

---

## ADR-051 — An upload is followed by its own row to the end: a failure is retried by dropping the file again, a file that stored nothing is a failure, and the uploader reads sentences, never exceptions

**Date:** 2026-09-15 · **Status:** accepted · **Plan step:** D.8 (amended before it was built) · **Features:** F-110, F-703 · **Supersedes:** nothing
Constrained by [ADR-014](#adr-014--the-ingestion-contract-is-versioned-and-frozen-early) (content-addressed idempotency, tenancy from the token), [ADR-029](#adr-029--hand-histories-are-parsed-server-side-only) and [ADR-047](#adr-047--the-hot-path-renders-the-dbt-models-own-sql-for-one-batch-provenance-not-a-lock-guards-dbts-swap-the-fresh-rollup-serves-only-what-dbt-has-not-built) (the hot path that makes an upload visible without dbt).

### Context

D.8 said: "`DropZone` with progress via `/v1/uploads/{id}` polling, dataset choice, poker accounts · **Done means** a real file uploaded through the UI produces stats without manual steps". It was audited before anything was built (a read-only workflow of six auditors and a critic whose load-bearing claims were each re-read against the code). The ingestion contract existed — `POST /v1/uploads` with `site` and `dataset`, `GET /v1/uploads[/{id}]`, `GET /v1/sites`, `GET`/`POST /v1/auth/poker-accounts` — and **no line of the web app called any of it**. The hot path runs for both Kafka topics and both datasets, so upload size and dataset do not change freshness. But between the drop and the report, five things would each have made "without manual steps" false with nothing red:

1. **A failed upload could never be retried.** Dedupe on `(user_id, sha256)` answered `duplicate` whatever the row's status, and the worker commits the offset of a failed message. One transient error (object storage, ClickHouse, a worker that died) locked that file for that user for good.
2. **The worker's cache drop deleted nothing.** `ingestion/cache.py` scanned `stats:{tenant}:*`; every report is cached by `ReportRequest.cache_key` as `report:{tenant}:{digest}`. A report viewed before an upload stayed as it was for `stats_cache_ttl_seconds` (300 s) after the upload landed. E.1b wired the call in, with no test that it removed a key.
3. **A file that stored no hands ended `completed`** — a site declared wrongly splits into zero hands, a file of refused hands stores none, and both read as success.
4. **`error_text` was the exception**, `f"{type(exc).__name__}: {exc}"`, returned verbatim by `GET /v1/uploads`. A ClickHouse or S3 exception carries hosts, bucket names and SQL — the one internal error that reached a client, through a table instead of a response.
5. **A hero upload whose seat did not resolve is stored and invisible.** Every hero stat filters `is_hero = 1`; nothing counted such hands. A pool export dropped under "My hands" ends `completed, N parsed` and My game does not move.

Also found: `Producer.flush()`'s return (messages still undelivered) was ignored, so a broker outage answered 202 and left the row `queued` for ever; `decode_upload` tried UTF-16 second and blind, so an even-length cp1251 file decoded as garbage and was refused as an unknown format while the same file one byte longer was read; `dataset` was stored nowhere, so the list could not show it and the same bytes under the other dataset were silently "duplicate"; poker accounts had no delete, accepted any string as a site (stored, never matched) and did not trim a name; `/v1/sites` returned a bare dict against §2.7.

Two premises of the step were wrong. **"Progress" could only have been a spinner** — nothing wrote `processing`, and counts were written once, at the end. And **an account is not a precondition of a hero upload**: PokerStars falls back to the first `Dealt to X [cards]` line and GGPoker defaults `hero_names` to its `Hero` alias (`parser/sites/pokerstars/finalize.py:109-114`, `parser/sites/ggpoker.py:88`), so a self-export resolves its hero with no account at all.

### Decisions

1. **The upload row is the page's only view of the worker, and it is kept true to the end.** The API writes `queued`; the worker writes `processing` when it takes the file, the counts so far after every stored batch (`ingest_text(progress=…)`, every 5,000 hands), and `completed` or `failed` last (`ingestion/upload_status.py`). A poller needs no other signal: `queued` for long means no worker, `processing` means one is reading, and `updated_at` moves with every batch.

2. **A failure is retried by dropping the same file again** (`api/upload_store.py`). When the earlier upload of the same bytes is `failed` — or `processing` with no word from a worker for `STALE_PROCESSING` (15 minutes; the worker moves `updated_at` after every batch) — the route resets that row, puts the bytes back under its content-addressed key and publishes it again, answering `dedupe: "requeued"`. Idempotency is otherwise unchanged: `completed`, a live `processing` and `queued` answer `duplicate`. The stale-`processing` rule is what makes every status write safe to lose: a `record_outcome` or `record_failure` swallowed during a Postgres blip leaves the row `processing`, and the next drop finishes it. A stuck `queued` row is deliberately **not** requeued on a time-out: with the publish checked (decision 5) it means no worker is running, and republishing would only queue the same file twice behind it.

3. **A file that stored nothing is `failed`, in words.** `failure_sentence` gives three: no hands found ("Check that it is a *site* hand history"), one hand refused, *N* hands refused ("They are kept for the parser's backlog"). A file with at least one stored hand is `completed` with its refused count beside it.

4. **The uploader reads sentences, never exceptions.** The worker logs the exception in full (a test asserts the log carries it) and writes "Processing failed on our side. Upload the file again to retry." — which is also true, because of decision 2. Every refusal at the door is a sentence that says what to do: a zip is told to be unzipped (415, detected by its magic bytes), a file over the limit is told the limit (413), a declared site the text contradicts is refused (422 — the mislabelling that used to become an empty `completed` upload), a file no parser recognises asks for the site (422), an unknown site lists the supported ones (400), and object storage that does not answer is a 503 of its own ("Storage did not answer…") rather than a 500 — which Starlette serves outside the CORS middleware, so the browser would have read it as "the API did not answer". **A declared site is checked against every line, not the first:** detection reads the start of the file, so a file with a preamble is undetectable, and choosing its site has to work or the 422's own advice loops; the headers of the two sites never overlap, so the other site's hands are still refused. The upload page shows these exactly as sent.

5. **A publish the broker did not acknowledge fails the upload, and cannot come back to life later.** Success is **this pointer's own delivery report**, not `flush()`'s count, which covers every message in the process-wide producer. `message.timeout.ms` is 5,000, so librdkafka drops an unacknowledged pointer instead of retrying it for its default five minutes — measured against the real broker: an acknowledgement in 0.11 s; with no broker a `_MSG_TIMED_OUT` report at 5.02 s and an empty producer queue. The route then marks the row `failed` with "The upload queue did not answer. Upload the file again in a minute." (only if it is still `queued`) and answers 503, so the next drop requeues it. A pointer that timed out *in flight* may still have been stored by the broker, so **the worker skips a pointer whose upload is already `failed`** (`upload_status.claim`); a requeue sets `queued` before it publishes, so a real retry is never skipped.

6. **The cache drop scans every prefix a tenant's entries are written under** (`TENANT_PREFIXES = (stats, report)`), and it runs **before** the terminal status is written — a page re-reads its reports the moment it sees the upload end — and on a failure too, since earlier batches of the file may already be in stats. `tests/test_cache_invalidation.py` pins both writers to the scanned prefixes, so a third writer with a new prefix turns a test red instead of a screen stale.

7. **`uploads.dataset` and `uploads.hands_without_hero`, one migration (`a8b9c0d1e2f3`, from `f7a8b9c0d1e2`).** `dataset` is **nullable** on purpose: no row before this revision recorded one, and a `'hero'` default would state something false about every pool file already imported. The same bytes under the other dataset are refused in words (409, "This file is already uploaded as My hands. A file belongs to one dataset.") rather than answered "duplicate" — **and this is checked before a failed row is retried, which keeps its dataset**: a failed upload may already have hands in the marts from its earlier batches, and the hot path's anti-join skips a hand already there whatever its dataset, so a retry under the other dataset would leave those hands under the first one, silently, until dbt rebuilt their days. Only a row with no recorded dataset takes the retry's. The page labels a re-dropped row by the row's dataset, never the form's, and a row with none as "Dataset not recorded", with no link. `hands_without_hero` counts a `hero` file's stored hands with no seat resolved as the uploader's — the only trace that a pool export went in under the wrong dataset — and the page turns it into a warning. Both columns are metadata-only additions on Postgres 16. The bulk importer's ledger writes both too, and follows decision 3: a file it stored nothing from is `failed` in words, so neither a re-run nor the upload page skips it as an empty `completed`.

8. **Poker accounts: list, add, remove — and they are the fix, not the gate.** `DELETE /v1/auth/poker-accounts/{id}` scoped by `user_id` (another user's id is the same 404 as a missing one); a site must have a parser; a name is trimmed and compared without case, because the parser compares without case. The page says what the audit found: most exports need no name, and **a name applies to files uploaded after it is added**. Re-attributing a stored hand is not offered: its core rows would be re-parsed, but the hot path's anti-join skips a hand already in the marts, so the fix would not reach stats until dbt rebuilt its day — a manual step presented as a button.

9. **The page** (`pages/upload/index.vue`): the dataset (My hands / Pool hands, locked while a folder is read and while files are sending — a switch during the walk would have sent the whole folder under the other dataset), the site (detected unless chosen), a drop of files or a folder, a queue that sends one file at a time and follows them through `GET /v1/uploads/{id}` every 2 s, **at most five at once**, oldest first, the recent uploads, and the poker accounts. The clock that words "Is the parser worker running?" (after 20 s) and gives up (after 10 minutes) measures the time since **anything** in the queue last moved, so files waiting behind a busy single worker are not told it is down. **Leaving the page stops the queue**: nothing more is sent and nothing polled — without it, a sign-out followed by another sign-in on the same tab would have sent the rest of the first user's folder with the second user's token. A completed hero file links to My game, a pool file to the pool. One nav entry, appended; `/hands`' empty state and `/account` point at it. `account.vue` shows `describeApiError`'s sentence instead of the fetch library's message, and `describeApiError` now reads a 422's list detail (ADR-049's follow-up, in `auth/api.ts`; `pool/rules.ts`' private copy is left for its owner).

### Alternatives

*Requeue a stuck `queued` row after a time-out.* Rejected (decision 2): with the publish checked, a stuck `queued` row means no worker is running, and republishing adds a duplicate message and hides the real cause behind "trying again". A silent `processing` row is different — a worker took it and its last word was lost — and is requeued.
*Let a lost status write raise, so Kafka redelivers.* Rejected: `_handle` returning without a commit does not redeliver — the consumer's position is already past the message, and the next message on the partition commits past it — so the pointer would be lost, not retried.
*Retry a failed upload under the dataset the new drop chose.* Rejected (decision 7): it looks harmless when the failure stored nothing, and `hands_parsed = 0` is not proof of that — a failure inside the first batch's hot path leaves decisions written and the count at zero.
*Keep the worker's offset uncommitted after a failure, so Kafka retries.* Rejected: a deterministic failure (a raw object that is gone) becomes a poison message that blocks its partition for every tenant keyed to it. The uploader's own second drop is the retry, and it is idempotent.
*Refuse, or dead-letter, a hero hand with no hero seat.* Rejected: the shared ingest loop also serves the bulk importer, and the hand is a valid hand — the mistake is the dataset, and a count the page can word is the honest signal.
*A non-null `dataset` with `'hero'` as the server default.* Rejected (decision 7).
*Put E.3's per-tenant request budget on the upload routes.* Rejected: 300 requests a minute is spent by the page itself on a 40-file folder; the poll is bounded in the client (decision 9) instead, and a byte budget is F-706.
*Widen `FetchOptions.body` to carry a `FormData`.* The right type, and a one-line change in `app/auth/api.ts` — but it turns `nuxt typecheck` red in `app/ranges/api.test.ts`, which reads `.body.node_key` and belongs to no lane this round. The one multipart call site casts, with the reason beside it; **the widening and its two-line test narrowing are a merge follow-up.**
*Union the GG `Hero` alias with registered names* (`(hero_names or set()) | {"hero"}`). Deferred: today a registered GG name replaces the alias and resolution falls back to `Dealt to` with cards, which every GG self-export prints; changing the parser changes re-parse output and is not this step's.

### Verification

**In a browser, end to end, on the test environment** — the Done means. A headless Chrome of its own (CDP on :9268, its own profile; the shared MCP profile was held by another lane), the app on :3008, an API of its own on :8808, and `make worker`, **both under `TEST_ENV`**; the founder's :8000/:3000 and the real databases untouched. A script drove the real UI and ran the worker itself, so it could stop it. **29 of 29 checks**:
- an account registered through the UI; My game's report before any upload answered **0 hands** (and was cached — the entry the old invalidation would have left in place);
- **Upload** is the last nav entry; `/hands`' empty state and `/account` link to `/upload`; the page opens on My hands, offers *Detect* + `ggpoker` + `pokerstars`, and says the accounts and uploads are empty;
- `cash_6max_nl50.txt` handed to the file input → the line went `sending → processing → completed` in **2.8 s**, read "2 hands in", linked "See them in My game", and the recent uploads re-read to `Done 2 / 2 / 0`;
- following the link, My game's `POST /v1/reports/run` answered **hands 2, `cached: false`**, 12.3 s after the drop (the script's own page waits included) — with **`stats_daily` 0 rows and `stats_daily_mv` 12 rows for that tenant**: no dbt run produced it;
- the same file again → "Uploaded before"; `export.zip` → refused before sending, in words; the observed GG table under My hands → "1 hand in" with the warning that no seat is yours and that it cannot be moved to Pool; the same bytes under Pool → the 409 sentence; `Hero` added, `hero` refused with the 409 sentence, removed after the confirm; a row with its dataset nulled (a pre-D.8 row) re-dropped → "Dataset not recorded", no link;
- the worker stopped → a file waits "Waiting for the parser", and after 20 s asks whether the worker is running; its raw object deleted and the worker started → **"Processing failed on our side. Upload the file again to retry."** in 5.1 s; dropped again → "Failed before — trying again" → **4 hands in** in 8.3 s.
Failed requests: the bootstrap `POST /v1/auth/refresh` 401 (D.2's design) and the two deliberate 409s; no page exception. The first run, before the review, was 26/28 — both misses were the check script's own selectors.

**Tests.** `tests/integration/test_upload_to_report.py` (4): an upload over HTTP counted by a report **warmed first with the cache on** (`cached` false afterwards, `stats_daily` empty for the tenant); a pool export under My hands counted as `hands_without_hero` and absent from My game; a pool upload in the pool report; a file over the bulk threshold on the bulk topic and in stats. `tests/integration/test_upload_contract.py` (8): a real failure (the raw object deleted) worded, refused under the other dataset, retried, stored once; a file of unreadable hands `failed` in words and its counts reset on requeue; the other dataset's 409; another tenant's upload 404; poker accounts added, refused case-insensitively, listed and removed per user; **an unacknowledged publish → 503, the row `failed`, a late pointer delivered by hand skipped by the worker, then the retry `completed`**; storage down → 503 and no row; a `processing` row silent for an hour requeued while one touched a moment ago is a duplicate. Unit (no stack, 43 new): the intake's refusals and the preamble case, the worker's order (claim → progress → cache drop → outcome) and its log, the failure sentences, both cache writers pinned to the scanned prefixes, cp1251 at both parities, the delivery report and `message.timeout.ms`, the ledger's failed status, the pipeline's counters and progress hook, and the route refusals over ASGI. Web: 83 Vitest tests over `upload/`, `components/upload/` and `auth/`, failure paths first — among them an unmount while a POST is held open sends nothing more and polls nothing.
**Proved by mutation:** reverting `TENANT_PREFIXES` to `stats` alone turns the warm-report integration test and both cache unit tests red.

**Reviewed adversarially before ticking** — a workflow of six lenses (backend, security, web, contract, tests, rules), each finding given to a skeptic told to refute it: **30 findings, 8 refuted, 22 upheld (14 confirmed, 8 in part), 21 fixed** and the last answered by a data check (no `failed` row exists on the real Postgres). The fixes that changed a decision are in decisions 2, 4, 5, 7 and 9: the dataset checked before a retry, stale `processing`, the per-message delivery report and the late-pointer skip, the storage 503, the declared site read on every line, the poll cap and shared clock, the reading lock, the null-dataset label, and the queue stopping on unmount (which closed a cross-tenant send on sign-out). Two of the refuters' corrections were load-bearing: making `_handle` return without a commit on a lost status write would have *skipped* the message, and `message.timeout.ms` below the wait without a per-message report would have answered 202 for a pointer that expired.

**Found by the gate, fixed:** `make test-all` failed once on the worker's log assertion, which passed alone. `migrations/env.py` called `fileConfig()` with its default `disable_existing_loggers=True`, so every in-process migration — `api.provision` in the test session — silenced every logger already imported, the worker's among them, for the rest of the process. It now passes `disable_existing_loggers=False`; the failing order was reproduced, and reverting the line makes it fail again.

**Gates:** `make check` green (7 contracts, size check clean, gen-check unchanged) · `make web-check` green (1,013 tests / 99 files; 2 lint warnings, both in lane C's `analyze/index.test.ts`) · `make seed && make test-all` **1,783 passed, 6 skipped** (dbt 35/35 in the seed), with both new integration files confirmed by name with `--collect-only`.

### Consequences

- **The Phase-1 exit criterion is met**: a file dropped in the browser is in My game's numbers seconds later with no command typed, verified on the test environment (decision 9 and the verification above).
- **Operator step for the real stack:** `make pg-migrate` applies `a8b9c0d1e2f3` (two metadata-only `ADD COLUMN`s; the downgrade drops them — back up `uploads` first). The API on the real database needs it before `/v1/uploads` answers; the long-running `:8000` process predates D.7b and was not reloaded by this work. And "without manual steps" assumes a running worker: `make worker` is still a foreground process, not a compose service.
- **Not this step, recorded:** moving or deleting an upload — a pool export dropped under My hands is flagged, and the page says it cannot be moved, because the retry would need the affected days rebuilt or a dataset-aware anti-join in the hot path first; a `.zip` is refused in words (archive upload is F-116); no per-tenant upload budget (F-706); cohort membership still reads dbt's `stats_daily` only (`stats/query.py` `cohort_subquery`), so a just-uploaded pool hand moves pool reports but not who is in a cohort until dbt runs; `api/hand_query.py`'s hero hand list has no `dataset` predicate, so a GG self-export uploaded as Pool shows its Hero seat in My hands; the GG alias union (above); `pool/rules.ts#validationMessages` can now import `auth/api.ts`'s; `FetchOptions.body` (above).
- Rows written before this step keep their old `error_text`; the real Postgres holds **no** `failed` upload (2,539 `completed`, 17 `queued`, checked read-only 2026-09-15), so no exception text is there to scrub, and the migration rewrites nothing.
- The two catch-less deletes the UX audit's §2.13 lists are in `pages/analyze/index.vue` and `components/reports/ReportWorkbench.vue`, not `account.vue`; they are F.12a's.

---

## ADR-052 — The winnings curve is a hero route over the timeline query, not a day dimension; the v1 API is deleted and every probe of it re-pointed

**Date:** 2026-09-15 · **Status:** accepted · **Plan step:** D.9a (round 5, lane B) · **Settles:** the obligation ADR-045 left on D.9

### Context

D.9 had to delete the v1 adapters (`GET /v1/stats`, `POST /v1/stats/custom`, `GET /v1/stats/timeline`
in `api/routers/stats.py`) and the static dashboard at `/`. One of them could not simply go: the
timeline is the API's only time series, and My game's winnings curve is drawn from it through
`heroApi.winnings()` (ADR-045). The plan named two replacements and called the first the better
answer: **register a `day` dimension and move the curve onto `POST /v1/reports/run`**, or **add
`GET /v1/hero/winnings` over `stats.timeline.build_timeline`**. Either way `winnings()` keeps its
return type, so no consumer changes. Three tests also used `/v1/stats*` as probes, one of them the
tenant-isolation suite, which exists to break isolation on purpose.

### Decision

**`GET /v1/hero/winnings`.** The day dimension was checked against the code, not weighed in the
abstract. The cheapest version of it that works is smaller than the plan's wording suggested, and
it is still the wrong trade for this step:

1. **The cheapest working day dimension is a fact-table one.** A dimension is its column on
   every table it lists (`group_expr` emits `s.<code>`), and the calendar date is `day` on
   `stats_daily` but `played_date` on both fact tables (`stats/query.py`, `DATE_COLUMN`). A
   `played_date` dimension on `[player_hands, decisions]` needs no rename. Its cost is that every
   report grouped by it leaves the rollup for the fact tables. (An adversarial review corrected
   the first draft of this ADR, which said a rename and a marts rebuild were unavoidable.)
2. **Exact sums are possible, but not through a built-in stat.** A built-in stat's cell is a rate
   rounded to three decimals (`ROUNDING`, `value_expr`), so rebuilding a day's sum as
   `value × n / 100` drifts day over day. An inline `CustomStatSpec` with `format: count` and
   `numerator: {sum: net_won_bb}` is not rounded and is exact. `analysis/pool/realization.py`
   already builds one that way. So the curve could be four inline custom stats grouped by day,
   with no new rollup columns, migration or backfill. A rollup-served curve would still need four
   new cached stats.
3. **A report row cannot hold a date today.** `ReportRow.group` is
   `dict[str, str | int | float | None]` (`stats/request.py`), and clickhouse-connect returns a
   `Date` as `datetime.date`, which pydantic refuses (measured:
   `ReportRow(group={'day': date(2026, 8, 18)}, …)` raises `string_type`). The engine's result
   model would change before a single day could be grouped.
4. **The registry has no date type, and a group-by dimension is offered everywhere.**
   `DimType` is `enum | number | bool | line | string`. A day needs a type, date ops, binding in
   the compiler, a place in `/v1/definitions` and in the TypeScript filter model (ADR-037). The
   group-by picker offers every dimension on both the workbench and the pool page
   (`reports/columns.ts`), so `day × player_key` over the 9M-hand pool would be one click away.
   That is a product decision about time as a slice for every stat, not a detail of one graph.
5. **A report is `LIMIT`ed (default 500) and ordered by its group key, ascending.** A curve
   request that forgets to raise `limit` loses its most recent days first, and `ReportResult`
   carries no truncation flag, so nothing turns red.

So the report route could serve the curve, but only by adding a date type, a result-model change
and a UI-wide group-by in the same step as a deletion. That step was scoped and parallel. The
route gives identical numbers now, from code that already exists. The running totals stay on the
server either way, as the `WinningsPoint` contract written in D.4 (`web/apps/web/app/hero/api.ts`)
asks. A server-side wrapper over a report could meet that contract too, so it decides nothing
between the two.

**It is not the duplication ADR-022 forbids.** Today the report engine cannot ask this question,
and everything that can be shared is shared. `build_timeline` is unchanged, and it scopes through
`stats.query.scope` (tenant first, dataset, hero seat, dates) and reads the fresh rollup through
`source_of` (ADR-047), exactly as a report does.

**The shape of the route.**
- The work lives in `analysis/hero/winnings.py`: My game owns the graph (ADR-026). The router is
  thin, like `/v1/hero/sessions`.
- **Dates only.** My game has no filter bar (ADR-045). The v1 route's `dataset` and four coarse
  filters were not carried over, because no caller sent them and the hero area is hero-only by
  definition.
- **The names say what a number is.** `hands` is that day's hands; the four sums beside it are
  `cumulative_net_bb`, `cumulative_ev_bb`, `cumulative_showdown_bb` and
  `cumulative_nonshowdown_bb`. v1's `total_hands` is `hands`, matching `SessionsResult`. The
  running-total arithmetic is v1's, moved unchanged, so the numbers are identical by construction
  and were checked to be.
- **Cached under `stats:{tenant}:hero_winnings:…`** through `api.cache.stats_key`, whose prefix is
  the constant `invalidate_tenant` scans. It deliberately does not use `ReportRequest.cache_key`
  (`report:{tenant}:…`), which that invalidation misses. That was measured here in a scratch
  Redis: `invalidate_tenant(1)` removed both `stats:1:hero_winnings` keys and left `report:1:…`.
  Round 5's lane A found the same thing independently and fixes the report side (ADR-051). Because
  the key is built from the shared constant, it stays in the invalidated namespace whichever side
  that fix changes.

**Deleted:** `api/routers/stats.py`; the six v1 schemas in `api/schemas.py` (`StatValue`,
`CustomStatSpec`, `CustomStatsRequest`, `StatsResponse`, `TimelinePoint`, `TimelineResponse`);
`api/static/index.html`; and the `/` route and `/static` mount in `api/main.py`. The UI has been
the Nuxt app since D.1.

**Every probe was re-pointed, none deleted:**

| test | was | now | intent kept, and what changed |
|---|---|---|---|
| `integration/test_tenant_isolation.py` · unauthenticated | `GET /v1/stats`, `/v1/stats/timeline`, `/v1/hands`, `/v1/uploads` | `POST /v1/reports/run`, `GET /v1/hero/winnings`, the same two | 401 on every data route |
| · forged bearer | `GET /v1/stats` | `POST /v1/reports/run` and `GET /v1/hero/winnings` | 401; now on both successors |
| · tenant in the query string | `GET /v1/stats` clean vs forged | both successors, clean vs forged, **each computed from an empty cache** | Both routes cache under the token's tenant, so the second of two calls was answered from the first's entry and never reached ClickHouse — a forgery honoured in the query but not in the key would have passed. `_forget_cached_answers()` drops the report and curve keys (prefixes read from the code that writes them) before each call. A first draft instead pinned both answers to `0`; the review showed that goes red when the probing account is itself tenant 1 with hands, so it was withdrawn |
| · **new:** tenant in the body | — | `POST /v1/reports/run` with `tenant_id` / `user_id` | The report route reads a body, so the body is the other place to forge. Refused 422 `extra_forbidden`, not ignored |
| · a fresh tenant sees nothing | `/v1/stats` hands, `/v1/stats/timeline` total | report `hands == 0`, winnings `hands == 0` and `points == []` | unchanged |
| `integration/test_rate_limits.py` · tenant budget | `GET /v1/stats` ×3 | `POST /v1/reports/run` ×3, body `{}` | An empty body is a valid report, so every refusal is the budget. Also dropped the file's stale **NOT YET RUN**: it ran at the round-3 and round-4 merges |
| `test_api_v2.py` · scoping | `/v1/stats?site=` | `POST /v1/reports/run` with a `site in` filter | bound `IN`, tenant parameter, hero seat by default |
| · binding / enums | `/v1/stats?stake_level=<injection>` | the same payload as a report filter | bound, never in the SQL; a bad `site` is a 400 **and never reaches the runner** (new assertion) |
| · timeline shape | `/v1/stats/timeline` | `/v1/hero/winnings` | every field of both days; tenant, dataset and hero seat bound |
| · **new:** forged scope on the curve | — | `?tenant_id=1&dataset=population&hero_only=false&player_key=…` | parameters stay exactly `{tenant_id: 7, dataset: 'hero'}` |
| · **new:** the retired surface | — | 5 paths | 404, not hidden behind a 401 |

Dropped with the adapter, and only because they tested the adapter's own response shape:
`test_v1_stats_adapter_keeps_the_dashboard_shape`'s `groups` / `StatValue` assertions, and
`test_v1_custom_counters_are_gone`. The latter's route no longer exists, and the 404 test covers
it.

### Alternatives

- **The day dimension**, deferred rather than refuted (above). It is the right answer for a
  different question: a stat over time (VPIP by month, the pool's drift). When the first consumer
  needs that, it should be its own step: a `date` type with week and month buckets, a date-capable
  `ReportRow.group`, the rollup-or-facts decision, and a truncation signal on `LIMIT`. The curve
  can move then if it gains anything, and `winnings()` would again be the only function body that
  changes.
- **Keep `/v1/stats/timeline` and delete the rest.** That keeps a v1 path, a `dataset` switch
  nobody uses on a hero graph, and a `report:` cache key the worker cannot invalidate.

### Consequences

- `stats.timeline.build_timeline` keeps its filter support and its fact-table branch, although its
  only caller now passes dates and nothing else. It is the function's own contract and was not
  this step's to narrow. If no filtered consumer arrives by F.12, the branch should go.
- A pydantic range error reads as pydantic prints it (`1 validation error for ReportRequest …
  date_from is after date_to`), exactly as `/v1/hero/sessions` does. It is a 400 naming the
  caller's own input, not a stack trace.
- **Two lines in other lanes' files are now stale**, handed to the merge: `platform/Makefile:117`'s
  `api` help text ("dashboard at /", lane D's) and the comment in `pages/index.vue` saying the
  winnings series "accepts dates and four coarse dimensions" (lane C's). A third, the
  `cors_origins` docstring in `core/settings.py` ("the same-origin dashboard at `/` needs no
  entry"), was in no lane and was corrected here.
- **`test_tenant_isolation.py`'s query-string probe detects a forgery only when tenant 1 owns
  hands and the probing account is not tenant 1, and nothing in the file guarantees either.** In
  the full, alphabetical `make test-all` both hold: `test_analyses.py` registers the first account,
  and `test_mv_reconciliation.py` ingests the seed corpus as `TENANT = 1` before this file runs.
  **Run alone, it is vacuous:** the session starts from an empty Postgres, `iso-a` becomes tenant 1,
  and `tenant_id=1` forges its own id. So the merge should confirm it **by name inside the full
  `make test-all -v` output, not in a separate single-file run.** This predates D.9a (the
  `/v1/stats` version had it). The real fix is a victim tenant the file ingests itself, forged by
  id and checked to hold hands before the probe. That is left as a follow-up, because it is new
  ingestion code in a suite this lane cannot run.
- The re-pointed integration tests **have not run**: this lane may not run `make test-all`. D.9a
  stays `[ ]` until the merge runs them by name.

### Verification

The recipe D.4 used: an API of this lane's own on `:8859` over the **real** ClickHouse, read-only;
auth in a scratch Postgres `poker_d9a_verify`, whose first account is tenant 1 (dropped
afterwards); Redis db 9; Nuxt on `:3059`; a headless Chrome on its own profile and port `:9259`.
**Before any code changed**, the v1 timeline gave 18 days, 19,802 hands, ending at
**−272.0 actual, +55.64 EV, +1,819.2 showdown, −2,091.2 non-showdown**, bb/100 −1.37, EV +0.28,
and My game drew **−272 · 56 · 1,819 · −2,091** from `GET /v1/stats/timeline?dataset=hero`.
**After:** `GET /v1/hero/winnings` matched it field by field on all 18 days, and on a sub-range
(2026-08-25 → 09-01: 8 days, 7,895 hands, −287.2 / −304.68). The page drew the same four end
labels from one `GET /v1/hero/winnings`, made no `/v1/stats` call, and logged 0 console errors
and 0 failed requests. The KPI report was byte-identical apart from `cached`. `/v1/stats`,
`/v1/stats/timeline`, `/` and `/static/index.html` answered 404. A cached answer equalled a
computed one (6 ms against 306 ms cold), a backwards range answered 400, and no token answered
401.

---

## ADR-053 — A number is typed as text and read with either separator; a fraction is labelled a fraction; a situation travels in a link as its canonical key

**Status:** accepted · 2026-09-15 · plan F.12a (split out of F.12; round 5, lane C)

**Context.** F.12a is the mechanical half of the UX audit — [POKER_UX_AUDIT.md](POKER_UX_AUDIT.md) §7
item 1 and the three known issues of §4 — run beside D.8, D.9a and F.1. Most of it is fixes with known
files. Three items needed a choice, and one of them touches 28 controls in both packages, which is
exactly what drifts into three conventions unless it is written down. The browser pass then turned up
two things the audit could not see from the source; they are decisions 7 and 8.

**Decisions.**

1. **Every numeric input is `NumberInput`: a text box in `inputmode="decimal"` that reads `2.5` and
   `2,5` alike.** Measured in a headless Chrome launched `--lang=ru-RU` (the founder's `AppleLocale` is
   `ru_RU`): a native `<input type="number">` holding 2.5 **displays `2,5`** — screenshotted — while it
   *accepts* either separator when typed (`value` is `'2.5'` both ways). So the defect is the display,
   which disagrees with every figure the app prints beside it. The options:
   - *`lang="en"` on the document or the element* — already set; Chrome ignores it for number inputs.
   - *Keep `type="number"` and accept the display* — the one control on the page that writes `2,5`,
     and the display follows a browser setting the app cannot see.
   - *A directive over native inputs* — still a number input underneath; the display stays.

   So `poker-ui/src/components/NumberInput.vue` over `src/number.ts` (`parseDecimal`, `formatDecimal`,
   `cleanDecimal`, `sameDecimal`), exported from `@poker/ui`, used by all 28 — `grep 'type="number"'`
   finds nothing in either package:
   - A comma is **always** the decimal separator, never a thousands separator (`1,000` is one); `2..5`,
     `1e3`, `5%` and anything else that is not one plain number are refused. Nothing more is guessed.
   - Unreadable or out-of-range text is **not emitted**: the box is `aria-invalid`, red, with a `title`
     saying what it takes ("A number from 0 to 100 — 2.5 and 2,5 both work."), and the last good value
     stays in use. Leaving the box writes back that value, with a dot, so the screen never shows a number
     other than the one computed. Typed key by key, `2..5` passes through a readable `2`, which *is*
     applied; the box then ends on `2`, which is honest.
   - Emptying the box emits `clear`, not `null`: a value that can never be empty binds `v-model` alone,
     a nullable one also listens for `clear`. This is why the component declares props and emits instead
     of `defineModel` — the two directions have different types (vue-tsc types a `defineModel<number |
     null>` emit as nullable, which a pot's `Ref<number>` rejects).
   - Half-typed text is left alone when the value it already says comes back with float noise, so a
     percent-scaled consumer binds the **unrounded** scaled number (`0.285 × 100` shows `28.5`, not `29`).
   - `lazy` emits on change where the old input used `@change`; ArrowUp/ArrowDown step by `step` within
     `min`/`max`; a disabled box looks disabled.
   - Anything that stored the typed *text* now stores `formatDecimal(number)`: a prediction commits
     `45,5` as `45.5` (`scorePrediction` reads it with `Number()`), a filter clause and a cohort rule send
     `0.75`.
   - Two neighbours of the same problem, found by the review: a filter clause's **list** of numbers
     (`big_blind in …`) is separated by `;` or spaces, because `0,05, 0,1` split on commas was four wrong
     numbers sent silently; and `PotOddsPanel`'s *to call* shows the bet as a **placeholder** — as its
     value it was written back under the cursor of a reader who had just emptied the box.

2. **`facing_size_pct` and `size_pct` are relabelled "(fraction of pot)", not given a percent control.**
   The value is a fraction end to end (the mart, the buckets `[0, 0.37] … [1.10, ∞)`, the descriptions).
   A percent control needs a registry concept ("fraction shown as percent") carried through
   `/v1/definitions` into `ClauseValue` and `filter/label.ts` for two dimensions, and would make the
   number typed differ from the one in the URL, which STATUS recorded must not happen. Label only:
   `gen_stats.py` writes stat labels, not dimension labels, so `make gen` changed no file.

3. **A situation travels in a link as its canonical key, in one parameter: `?node=`.** `HandStudy`'s
   "Compare here" sent `?hero=…&street=…`, which `/ranges/compare` never read — and two fields cannot name
   a node (seats, street, the sized action sequence, stack, table, stake, texture). `app/ranges/situation.ts`
   writes `canonicalNodeKey(key)` and reads it back through `parseNodeKey`. A readable field-per-parameter
   form in the style of `filter/url.ts` was rejected: a second serialisation of a type that has a
   canonical one, for a link nobody types. Reading is strict where the filter's is lenient — a situation
   read halfway is a different situation — so an unreadable `?node=`, and a `?range=` id that cannot be
   opened (which the page used to swallow), say so in a sentence and open on the default.

4. **The pot-odds and MDF panels on the replayer and in the pot-odds trainer are bound, not made
   read-only.** Both mounted the panels without handlers, so their inputs took typing and changed
   nothing. The trainer's own comment said they were editable on purpose; on the replayer "what if the
   bet were bigger" is the study. `composables/useEditableOdds.ts` seeds pot, bet and rake from the step or
   the spot, re-seeds on every new one, and a line says when the numbers are no longer the hand's, with a
   button back. The call is seeded as `null` — it follows the bet — because a pinned call made a bigger
   bet ask for *less* equity.

5. **Step 4 grades by the nut definition on screen, and locks it once an answer is committed.**
   `RangeComparisonPanel` exposes its Advanced definition as an optional `v-model:nutOptions` (core's
   units; unbound it keeps a local copy) and `Step4Nuts` passes the same object to `nutAdvantage()`. The
   definition is **not persisted** — `StepWork` is the API's schema, not this lane's — so it is locked after
   commit (`nutLockedReason`, which says why and that reopening grades by the default): changing it
   afterwards re-graded an answer already given and autosaved the new grade.

6. **The header wraps.** Its links overflowed below ~1000 px; it is a wrapping flex row. A disclosure menu
   was rejected for a laptop-width problem that wrapping solves with no state.

7. **A page that loads its subject renders while it loads.** Every reworded "Loading…" was unreachable:
   the pages awaited `useAsyncData` in setup, and with the request held in the browser **nothing rendered —
   not even the layout's `<main>`** — until it answered. `/hands`, `/hands/[id]`, `/ranges/[id]` and the
   compare page's lookups are `lazy`; `/analyze/[id]` does not await `store.open()` but gates the page on
   its own `opened` flag, because the store still holds the analysis opened before this one and a lazy
   load would have shown — and autosaved into — the wrong one. `/hands` hides its count until the list
   has answered, instead of saying "0 hands" above "Finding the hands…".

8. **What a compare column shows is one tested function, in one order.** `app/ranges/compareColumn.ts`:
   still asking → the column says so, whatever the previous situation left behind; a failed call → an
   error, **never "insufficient data"**, which needs an answer that said so; an unasked pool says that.
   The diff heatmap and the disagreement table wait until both lookups have settled, and a tier-3
   reconstruction for a superseded situation is dropped rather than drawn on the new one.

Smaller, recorded here so no one re-derives them: step 1 names the chart it loaded ("started from your
chart …"), loads an **own** chart only (a solver range is not "your chart"), and tells an API that did not
answer from a library with nothing stored (`library.lookup` now marks the store ready on success); the
equity trainer prints the reference-chart provenance; `MDFPanel`'s "after rake" and `EquityCalculator`'s
exact / Monte Carlo go through `MetricLabel`, with counts written `1,176` on any locale; the replayer's
developer sentence about `invested_bb` is a sentence for the reader; the two deletes with no `catch`
say a refusal (and the saved-report library drops a deleted row before re-reading, so a failed re-read is
not reported as a failed delete); a combo weight keeps Float32's seven digits so `0.0004` can be zeroed.

**Verification.** A headless Chrome of its own (`--lang=ru-RU`, port 9253, its own profile) driven over
CDP with request interception, the app on `:3053`, an API on `:8853` over a scratch Postgres
`poker_f12a_verify` (tenant 1, **dropped afterwards**) and the real ClickHouse read-only. **113 of 113
checks**, typing `2,5` and `2.5` key by key into the Lab's panels, the rake and nut-cutoff Advanced folds,
the EQR box, the brush, a drilldown weight, the trainer's gate, the situation editor, step 6 (read back
from the server as 0.455), a filter clause on the relabelled dimension and the cohort form; the header and
pages at 1280 and 700 px, light and dark, with no horizontal overflow; loading, empty, failure and
link-problem states forced by holding or refusing the requests that answer them. Before any of it ran, an
adversarial review over the combined diff (four lenses, a skeptic per lens) returned 31 findings,
several the same defect seen from two lenses: 4 refuted (the iPad decimal pad, an intended `edited`
rule, the `defineModel` deviation, the Upload link — lane A's); every confirmed one fixed with a test,
except the error unwrap and one component test listed below. The 700 px pass also caught a pre-existing overflow
in `NodeKeyEditor`'s grid (a text box holds a 7rem column open), fixed with `min-width: 0`.
Gates: `make web-check` green (typecheck, ESLint, **1,015 tests / 99 files**, licences unchanged);
`make check` green (`make gen` changed nothing, 1,676 unit tests over the combined tree).

**Consequences and follow-ups.**
- **Persist the nut definition with step 4** — optional `nut_mode`/`nut_cutoff`/`nut_top_percent` on
  `StepWork` (JSONB, no migration) — then drop the lock's "reopening grades by the default" caveat. An API
  change, so not this lane's.
- **`describeApiError` should unwrap `useAsyncData`'s error** (`error.cause ?? error`): Nuxt wraps a
  failed `$fetch` in an H3Error with status 500, so `/hands`, `/hands/[id]` and `/analyze` print "The API
  answered with status 500." for an API that is not running. `compare.vue` unwraps locally; the fix
  belongs in `app/auth/api.ts` (lane A's).
- `ReportWorkbench`'s refused delete is verified in the browser only — mounting it needs three stores,
  the route and the columns model; `/analyze`'s has a component test.
- Not this step: `pages/account.vue`'s "Loading…" and raw `error.message` (lane A). Left for F.12: the
  replayer's first step prints core's "pot must be positive, got 0" on screen (§2.13's generic errors).

---

## ADR-054 — CI lives at the repository root, calls the make targets instead of restating them, and runs on every push

**Status:** accepted · 2026-09-15 · plan F.1 (its last clause, "green … in CI") · round 5, lane D

**Context.** CI has never run. Four findings, each confirmed against the tree before anything changed:

1. **Wrong place.** The workflow was committed at `platform/.github/workflows/ci.yml` (`bd097d8`,
   extended by F.1 in `021e9c7`). GitHub reads workflows only from `.github/workflows/` at the
   repository root, and the git root is `ru_de/`, one level up. As far as GitHub was concerned,
   the repository had no workflow.
2. **Wrong trigger.** `on: push: branches: [main]` plus `pull_request`. The work lives on
   `feat/range-lab`, nothing is pushed and no pull request is open, so the file would not have
   fired even at the right path.
3. **Drift.** Its steps restated the Makefile's commands, and the copy had already fallen behind.
   E.1b added `scripts.gen_hot_path --check` to `make gen-check` (ADR-047), the workflow never got
   it, and `make check` still called itself "Everything CI runs". The integration job restated
   `TEST_ENV`, `dbt-install`, the provisioning, the seed and the dbt build, and ran
   `pytest -m integration` where `make test-all` runs every test.
4. **Toolchains that disagreed.** The workflow ran `uv sync --group dev` against the rule
   "`uv sync --frozen` in CI"; Node 24 in CI against Homebrew's `node` 23.11.0 locally; no Python
   pin (uv takes whatever satisfies `>=3.12`: a managed 3.12.14 here, the runner's system Python
   there); `ubuntu-latest`; and v4 actions on the retired node20 runtime.

**Decisions.**

1. **Moved, not copied.** `git mv platform/.github/workflows/ci.yml .github/workflows/ci.yml`, so
   history follows the file. `defaults.run.working-directory: platform` keeps every step in the product.
2. **Jobs call targets, and restate none of them.** `quality` runs `make install` + `make check`;
   `web` runs `make web-install` + `make web-check`; `integration` runs `make install` + `make up` +
   `make seed` + `make test-all`. The only raw command is the failure-only `docker compose logs`,
   which is a diagnostic, not a gate: `make logs` follows with `-f` and would never return. **The
   rule for every later edit:** if a target cannot run in CI as written, change the target, never
   a copy of it in the workflow. It has applied once already. A fresh clone's `make seed` and
   `make test-all` failed on a missing `.venv-dbt` (`api/provision.py` runs dbt too), so the dbt
   binary became a file prerequisite of every target that runs dbt. Locally it is a no-op; on a
   fresh tree `make -n seed` prints `make dbt-install` first.
3. **`--frozen` in the Makefile, not only in CI.** `make install` is `uv sync --frozen` and
   `UV := uv run --frozen`, so a developer and CI run literally the same command. `--group dev` was
   redundant: `dev` is uv's default group, and the fresh sync below installed pytest, ruff, mypy and
   lint-imports without it. Freezing only the sync would not have been enough. The `uv run` calls
   inside `make check` would still re-lock a stale `uv.lock` on the runner, and CI would pass on a
   resolution nobody committed. **Consequence:** after a hand edit to `pyproject.toml`, run
   `uv lock` (`uv add` already does). **Not `--locked`:** the rule names `--frozen`. `--locked` would
   also fail a lock that has gone stale against `pyproject.toml`; that is a one-word change if the
   founder wants it.
4. **One source per tool version.**
   - Node: `platform/web/.nvmrc` = `24`, read by `actions/setup-node` (`node-version-file`) and by
     nvm/fnm locally. 24, not 23: 23 is an odd-numbered release, end of life since June 2025, and the
     dependency tree already refuses it. A fresh `npm ci` on 23.11.0 prints 38 `EBADENGINE` warnings,
     among them nuxt 4.5.2 (`^22.19.0 || ^24.11.0 || >=26.0.0`), vitest 4.1.11 and
     license-checker-rseidelsohn 5.0.1 (`node >=24`). The gate passes on 23 today, but outside the
     range each of those supports.
   - Python: `platform/.python-version` = `3.12`, the version mypy's `python_version` and ruff's
     `target-version` already name. The existing `.venv` (3.12.14) satisfies it, so no environment
     is rebuilt (`uv sync --frozen --dry-run`: "Would make no changes").
   - uv: `UV_VERSION` 0.12.5 in the workflow, the version that wrote `uv.lock`.
   - Runner: `ubuntu-24.04`, not `ubuntu-latest`. Actions: `checkout`, `setup-node` and `setup-uv`
     at `@v7`, all on the node24 runtime (read from each `action.yml`).
5. **Triggers: every push to every branch, pull requests into `main`, and by hand.**
   - `push: branches: ["**"]`: the founder works on long-lived branches without pull requests, so
     the check has to run where the work is. F.1's clause is reached by pushing `feat/range-lab`
     alone.
   - `pull_request: branches: [main]`: checks the merge result, which a branch push never builds.
   - `workflow_dispatch`: a re-run without an empty commit.
   - `concurrency: ci-${{ github.ref }}` with `cancel-in-progress`: a newer push supersedes the run
     on the older commit.
   - **No `paths` filter.** A docs-only commit costs one run. Any skip rule is one more way for "CI
     did not run" to happen quietly, which is the bug this ADR fixes. Revisit if Actions minutes
     become a constraint.
   - **Rejected:** `main` plus pull requests (the status quo, which checks nothing on a branch until
     a PR is opened) and a schedule (nothing changes without a push). **Expected cost:** a branch
     with an open PR runs twice per push, once on the head and once on the merge ref. They are
     different commits, and that is deliberate.
6. **`permissions: contents: read`.** The workflow writes nothing, so `GITHUB_TOKEN` gets nothing
   more. **`timeout-minutes`** 20 / 20 / 60 guard against a hang; the integration value is loose
   because no full `make test-all` duration had been recorded. Tighten it after the first run.

**Verified before any push** — in a git worktree of `93d32ae` with only this lane's four files
applied, and no `.venv`, `.venv-dbt`, `node_modules`, caches or ignored files:

- `make install`: CPython 3.12.14, 77 packages.
- `make check`, 192 s: ruff; format (242 files); mypy (125 files); 7 import contracts kept; all
  three generated-file checks including `gen_hot_path`; the size check; 1,621 passed, 100 deselected.
- The unit tests again with every service pointed at a closed port: 1,621 passed. No unit test
  leans on a running stack, which the quality job will not have.
- `make web-install` + `make web-check` on Node 24.21.0 / npm 11.19.0: 79 files, 846 tests,
  licence audit green. On the local 23.11.0 / npm 11.4.2: green too, with the 38 engine warnings.
  `npm ci` needed no `--legacy-peer-deps` under either npm.

**Checked statically, for linux x86_64** (the adversarial review's five agents all hit the session
limit, so these were done by hand):

- `uv.lock`: every one of the 78 packages the default and dev groups can install, extras included,
  has a CPython 3.12 manylinux x86_64 or pure-Python wheel, so nothing builds from source.
- `package-lock.json`: every darwin-arm64 native has its linux-x64 counterpart (esbuild, rollup,
  rolldown, lightningcss, tailwind oxide, napi-rs lzma), and all 12 linux-x64 entries are MIT or
  MPL-2.0, inside the allowlist.
- The compose images: kafka, clickhouse, postgres and redis publish amd64; both minio images are
  multi-arch manifest lists. The two mounted ClickHouse configs are tracked.
- The seed corpus (three files) is tracked. No code that `make seed` or `make test-all` runs reads
  an ignored path; the equity cache is read only by `scripts/backfill_equity.py`, and its unit test
  passed without the file. There is no `packages.yml`, so no `dbt deps` is needed.
- The YAML parses to the intended triggers, concurrency, permissions and steps. setup-uv's default
  cache glob `**/uv.lock` matches `platform/uv.lock`, and the explicit `version` skips its
  root-`pyproject.toml` lookup.

**What only a real run or the merge could settle** — as written before the push, with what the
first runs showed:

1. **`make up` on the runner** — ✗ on the first run, then fixed (see *The first runs* below).
2. **Memory:** the containers' caps sum to 6.3 GiB — ✓. The repository is public, so it gets the
   larger runners.
3. **dbt:** `make dbt-install` resolves the newest dbt-core 1.x / dbt-clickhouse 1.x on the runner,
   which is neither the local `.venv-dbt` (1.12.3 / 1.9.3) nor `uv.lock`'s `dbt` group
   (1.11.14 / 1.10.2) — ✓ for now: `make seed` and `make test-all` passed on whatever it
   resolved. Still unpinned, so the version can change under a later run.
4. **The integration suite on Linux** — ✓, `make test-all` green in 269 s.
5. **The actions themselves** (setup-uv's cache, setup-node's `.nvmrc`, the push trigger) — ✓.
   The concurrency group and the `pull_request` trigger have not yet had an event to act on.
6. **The merge** — still open. Only this lane's code was pushed. Round 5's other lanes reach CI with
   the merge's push.

**The first runs (2026-09-15, at the founder's request).** Lane D's four code files were committed
alone as `5c3b55f` and `feat/range-lab` was pushed. The round-5 docs, this ADR included, and the
other lanes' work stayed in the working tree.

- **Run 34955622749:** quality ✓ and web ✓ — the first time CI had passed anything — and integration
  ✗ at `make up` after 18 s. A job log needs admin authentication, and the only annotation said
  "exit code 2", so the cause was read from Compose v2.38.2, the runner image's version:
  - `up --wait` waits on every service as "running or healthy", unless another service depends on
    it with `service_completed_successfully` (`getDependencyCondition`, pkg/compose/start.go).
  - It returns `container … exited (0)` for any exited container (`isServiceHealthy`,
    pkg/compose/convergence.go), polled every 500 ms.
  - `minio-init` is a one-shot job that nothing depends on. It passed only when a poll caught `mc`
    still running — usually true under Docker Desktop's VM, and lost on a fast Linux runner. The
    18 s, and the failure-only `docker compose logs` step parsing the file successfully, fit that
    and nothing else examined.
- **Fix, `88625fd`:** `minio-init` has `profiles: ["init"]`, so `up --wait` leaves it out, and
  `make up` runs `docker compose run --rm minio-init` once the stack is healthy. A failed bucket
  creation still fails the target. `run` replaces `container_name` with a generated name
  (pkg/compose/run.go), so a leftover `poker-minio-init` cannot collide. The rule held: the target
  changed, not a copy of it.
- **Run [34957886151](https://github.com/AlexLukinov/data_project/actions/runs/34957886151):
  green in all three jobs.**

  | job | total | make steps |
  |---|---|---|
  | integration | 355 s | `make up` 23 s · `make seed` 53 s · `make test-all` 269 s |
  | quality | 82 s | `make check` 71 s |
  | web | 57 s | `make web-install` 10 s · `make web-check` 40 s |

  **F.1 ticked.** The test counts are in the job logs, which anonymous API calls cannot read.

**Consequences.**
- F.1 is `[x]`. Its other clauses were verified on 2026-09-10; its CI clause by run 34957886151.
- **`feat/range-lab` is on `origin`, and the repository is public.** Every later push runs CI. The
  round-5 merge's push is the first run over the combined tree.
- **Local Node is 24.21.0** (Homebrew `node@24`, keg-only, linked with `--force`). 23.11.0 stays in
  the Cellar; `brew unlink node@24 && brew link node` reverts. The unversioned `node` formula is
  26.8.2, so `brew upgrade node` would skip past 24. Four Nuxt dev servers already running on 23
  were unaffected, and the shared `node_modules` loads under 24.
- The integration `timeout-minutes` (60) can come down to about 20 now that a duration is known.
- **D.9b**'s E2E job follows the same rule: a fourth job calls a make target, and the workflow
  restates nothing.
- **Left as they are, and recorded here:**
  - dbt is unpinned (item 3 above). Pinning it is its own change, with its own run of the mart chain.
  - The actions are pinned by major tag, not by commit SHA.
  - npm 11.19 warns that `esbuild` and `fsevents` install scripts are not covered by `allowScripts`.
    A later npm may stop running them.
  - The empty `platform/.github/workflows/` directories are still on disk. Git does not track empty
    directories; `rmdir` was denied in this session.

---

## ADR-055 — The browser test owns the three processes it needs, refuses to run outside the test environment, and reaches CI as a job of its own

**Date:** 2026-09-16 · **Status:** accepted · **Plan step:** D.9b · **Features:** F-110 (the upload
path it drives) · **Supersedes:** nothing
Constrained by [ADR-051](#adr-051) (the upload flow it walks), [ADR-054](#adr-054) (CI jobs call make
targets and restate none of them), [ADR-024](#adr-024)/[ADR-027](#adr-027) (one Nuxt SPA behind auth).

### Context

D.9b is one sentence — "Playwright login → upload → report, and the CI job that runs it" — over a
flow that needs **three processes the compose stack does not contain**: the API, a **parser worker**
(still a foreground process, not a compose service — ADR-051's own consequence), and the Nuxt dev
server. `make test-all` needs none of them: it drives ingestion in-process. So the question this step
had to answer was not "what does the test assert" but **who starts and stops those three, and what
stops the test from running against the founder's real hands** — the two ways an end-to-end test
turns from a gate into a liability:

1. **A left-behind process.** A worker that survives a failed run consumes from
   `test-parser-workers`, the group `make seed` and `make test-all` drain, and the next suite's
   `drain()` returns 0 while its hands are eaten by the orphan (the trap
   [[parallel-lane-verification-gotchas]] records from D.8).
2. **The wrong databases.** The founder's API answers on :8000 against the real ClickHouse; the app
   on :3000 talks to it. A browser test that finds those ports and signs in would upload synthetic
   hands into `core.*` — exactly the leak B12 cost 384 rows and a wrong VPIP for.

### Decisions

1. **Playwright owns the three processes; there is no shell orchestration.** `webServer` in
   `web/e2e/playwright.config.ts` lists the API, `make worker` and `nuxt dev`. Playwright starts
   them, waits for the two that answer HTTP, and tears all three down when the run ends — pass,
   failure, its own timeout or a Ctrl-C — by signalling **each one's whole process group**
   (`process.kill(-pid, …)` in `WebServerPlugin`, `playwright/lib/runner/index.js`), which is what
   reaches `python` under `uv run` under `make`. Measured: after every run there was no process, no
   listener on :8055 or :3055, and **no member left in the consumer group** (`kafka-consumer-groups
   --describe`: `CONSUMER-ID -`, lag 0).
2. **Ports of its own, and it may not reuse a server it did not start.** :8055 and :3055, with
   `reuseExistingServer: false`, so a port already answering **fails the run in words** instead of
   quietly testing whatever is there. This is the structural half of the safety argument: the test
   cannot reach the founder's :8000/:3000 even by accident, and two E2E runs cannot overlap.
   **The app's readiness is checked as a port, not a URL, and that was measured rather than
   assumed**: `nuxt dev` moves to the next free port when the one it is given is taken, so with a
   URL check a foreign server on :3055 let Nuxt drift to :3056 and the run died on "Timed out
   waiting 180000ms" three minutes later (a decoy HTTP server proved it). Checking the port refuses
   before Nuxt is started at all — "http://localhost:3055 is already used…", immediately. The API
   keeps a URL check, because `/health` is a real readiness answer (it round-trips ClickHouse).
3. **The test environment is a precondition, checked in the config.** `refuseUnlessTestEnvironment`
   (`web/e2e/stack.ts`) mirrors `tests/integration/conftest.py`'s refusal rule for rule: the
   ClickHouse prefix, the Postgres database, the raw bucket, both Kafka topics, the consumer group
   and the Redis logical database must each be the test one, **and be set in the environment** — an
   unset variable fails too, because settings would otherwise fall back to `.env` or to the real
   defaults. `make e2e` supplies them from the Makefile's one `TEST_ENV`; a bare `npx playwright
   test` refuses before it starts a single process (measured, exit 1, and it names the single wrong
   variable when only `POSTGRES_DB` is real).
4. **SIGTERM first, SIGKILL after 15 s** (`gracefulShutdown`). Not politeness: a worker killed
   outright stays a member of the consumer group until the broker's session timeout (45 s) and holds
   the partition away from the next run's worker for that long, which is why the upload's completion
   budget is 90 s and not 10. A worker that gets SIGTERM logs "finishing current batch", closes the
   consumer and leaves the group; the next run starts clean (measured over three runs).
5. **The worker is started but not waited for.** It serves nothing to poll and logs nothing until a
   message arrives, and it does not need to be ready: the consumer reads from the group's committed
   offset (`auto.offset.reset: earliest` for a new group), so a pointer published before it joins is
   still read. A worker that dies at start therefore costs a clear failure rather than a hang — the
   page says the parser is not answering and the worker's traceback is in the output above the
   failure. **Proved by killing it**: the run goes red on the assertion with "the file never landed:
   a line still 'queued' means no worker took it", expected `completed`, received `queued`.
6. **Elements are selected by `data-testid`, and a page this lane does not own is not edited to add
   one.** Three selectors fall back to the accessible name, each with the reason beside it:
   `pages/login.vue`'s email, password and submit (no testids on that page), and the `Upload` nav
   link in `app.vue` (lane E owns it this round). The testids the app is missing are listed for
   whoever owns those files (§4).
7. **Reading My game *before* the upload is part of the proof, not a warm-up.** A fresh account's
   report answers no hands and that answer is cached for `stats_cache_ttl_seconds` (300 s). Because
   the test reads it first, the count it sees afterwards can only come from the worker's writes
   **and** from the worker dropping the tenant's cached reports (ADR-051 decision 6) — a stale cache
   would leave the tile at "—" and turn the test red. The account is registered over the API with an
   email no earlier run used: signing up is not the flow under test, and a fresh tenant makes the
   count attributable to this upload (the seed corpus belongs to tenant 1, the demo user).
8. **The screen-name step is coverage of the account write path, not the reason the count works,
   and the spec says so.** A PokerStars export resolves the uploader from its own `Dealt to` line
   when no name is registered (`resolve_hero`, ADR-051 decision 8), so this file would be counted
   either way. The step asserts the write and its read-back; it must not be read as proof that a
   registered name is what named the seat. (That is ADR-051's own claim, and
   `test_upload_to_report.py` is where the no-seat case is asserted.)
9. **One flow, one browser, no retries** (`retries: 0`): a flaky end-to-end test is a finding, not
   something to paper over. The trace and a screenshot are kept on failure, and the CI job uploads
   them, because a red E2E in CI is otherwise undiagnosable — GitHub job logs need an
   admin-authenticated read (ADR-054).
10. **CI gets a fourth job, not a step after `make test-all`.** The integration session drops the
   test databases at its end, so an E2E step after it would find nothing seeded; a job of its own
   also runs in parallel and keeps the failure attributable. It calls make targets only —
   `make install`, `make web-install`, `make e2e-install`, `make up`, `make seed`, `make e2e` —
   which is why **`make e2e-install` exists at all**: the browser download is a command the workflow
   would otherwise have had to restate (ADR-054's rule).
11. **`make e2e` refuses when another worker already holds the test consumer group.** The port rule
    (decision 2) cannot cover the worker, which has no port, and Kafka gives each partition to one
    member — so a `make test-all` in flight, or a worker orphaned by a killed run, would take the
    upload this test waits for and the test would blame a missing worker. The target asks the broker
    for the group's members first and refuses in words, naming both likely causes. The group name is
    read out of the Makefile's own `TEST_ENV`, never typed a second time.
12. **`nuxt dev`, not a production build.** A build would be the more production-like artifact, but
    `nuxt build` rewrites `apps/web/.nuxt` — the directory the founder's own dev server on :3000 is
    using — and the E2E must never disturb it. `nuxt dev` on a port of its own writes the same
    generated files the running server already has. (Nuxt's dev lock is only enabled for AI-agent
    sessions, `NUXT_IGNORE_LOCK` off by default, so neither CI nor the founder ever meets it.)

### Alternatives

*A shell wrapper with `trap … EXIT` starting the three processes.* Rejected: it reimplements port
waiting, process-group killing and signal handling — three known footguns — for behaviour Playwright
already has and documents, and a `trap` does not fire when the runner is `SIGKILL`ed either.
*Make the worker a compose service so `make up` starts it.* Rejected **for this step**, not on the
merits: it is a product decision about how the platform is deployed (ADR-051 left it open), it needs
an image build in the loop, and it would change what `make up` means for every other target. Worth
revisiting when the platform grows a deployment story.
*Run the E2E as one more step in the `integration` job.* Rejected (decision 10).
*A `channel: 'chrome'` browser, or the system Chrome.* Rejected: the pinned build is the point — one
Playwright version drives one browser build, so a green run says which browser it was green on.
*Assert "no dbt run" inside the browser test* by querying `test_marts.stats_daily` over ClickHouse's
HTTP port. Rejected as the wrong layer: nothing the test starts can run dbt (the stack is the API,
the worker and the app), and `tests/integration/test_upload_to_report.py` already asserts the
tenant's `stats_daily` is empty on this same path over HTTP.
*Let the spec register through the `/register` page.* Rejected: D.2 already covers registration, and
it would add a screen whose failure would read as an upload failure.

### Reviewed adversarially before it was called done

A read-only workflow of four lenses — process lifecycle, CI portability, does-the-test-prove-it, and
safety/rules — each finding then handed to a skeptic told to refute it. **13 findings, 7 refuted, 6
upheld, all 6 fixed**, and one lens (CI portability) died on the session limit, so the workflow's CI
job was checked by hand instead (the YAML parses to four jobs with the intended steps, triggers and
`defaults`, and `uses` paths are repository-root relative). What the upheld six changed:

1. **A SIGTERM or SIGHUP to `make e2e` orphaned all three servers**, the worker included — and the
   worker is the one nothing detects, since it has no port. Playwright registers no signal handlers
   for its `webServer` children (only an `exit` handler; Ctrl-C it handles itself), and each server
   leads its own process group, so a killed runner left a worker consuming the test topics for ever.
   The config now installs `SIGTERM`/`SIGHUP` handlers that call `process.exit`, which runs that
   `exit` handler. **Proved by mutation:** with the handler disabled, a SIGTERM to the runner left
   `ingestion.worker` and the API on :8055 alive; with it, both are gone 8 s later and `make` exits
   143. The skeptic's two corrections are in the code: install it **only in the runner** (this file
   is re-loaded in every forked test worker, which ignores SIGTERM deliberately — `process.send`
   distinguishes them) and exit with the signal's own code, not SIGINT's 130.
2. **Nothing enforced "never beside `make test-all`".** Both run under the same `TEST_ENV`, so both
   workers join `test-parser-workers`, and Kafka gives a partition to exactly one member: the other
   run's worker would take this test's upload and the test would blame a missing worker. `make e2e`
   now **refuses** when the group already has a member, naming the likely cause; the group name is
   read out of `TEST_ENV` itself rather than typed a second time. Measured against a worker started
   by hand: refused, exit 1. It catches an orphan from a killed run too.
3. **`data-status` is the queue's state, not only the server's**, so a file refused in the browser or
   a POST that never landed would have waited the full 90 s and then been reported as "no worker took
   it" — a wrong diagnosis, printed with confidence. The assertion now polls for any **settled**
   status (`completed|failed|error|refused`) and then insists on `completed`, with the row's own text
   as the failure message: two failures, two messages.
4. **The guard accepted a Redis URL with no database segment** (`redis://localhost:6380`), which
   resolves to db 0 — the founder's real cache. It now requires an explicit non-zero index.
   **`tests/integration/conftest.py` has the same hole** and is worth the same one-line fix, so the
   two guards keep saying the same thing; it is not this lane's file.
5. **The guard ran on `process.env`, not on what each server is actually handed.** Playwright merges
   `{...process.env, ...env}`, so an override added to a `webServer` entry later could outrank the
   guard. Each entry's additions now go through `serverEnv`, which guards the merged result. (The
   skeptic refuted the finding as a *present* defect — today's three additions are harmless — and it
   is kept as the structural fix it is.)
6. **The budgets did not add up by construction.** They now live in `e2e/budgets.ts`, and the test
   timeout is derived from them (`NAV + LANDED + 2 × REPORT + slack`), so a slow honest run fails on
   the assertion that was waiting rather than as "test timeout exceeded".

Refuted and left alone, worth recording: that the five `ADR-055` citations are broken (they are
forward references this ADR resolves); that the bare timeout literals broke the no-magic-numbers rule
(the workspace writes declarative config budgets as literals — `budgets.ts` happened anyway, for
reason 6); that a swallowed graceful-shutdown timeout is a defect (it costs the next run a session
timeout, which `LANDED_MS` budgets for); and that the spec oversells the screen-name step (decision 8
above already says it is not load-bearing). One suggestion was rejected on its own merits: giving the
E2E **its own consumer group** would end the collision in 2, but a new group with
`auto.offset.reset: earliest` re-reads the whole topic from offset 0 — every seed pointer and every
earlier upload — so the pre-flight refusal is the cheaper answer.

### Verification

**`make e2e` green six times** — twice back-to-back from one `make up && make seed` (15.1 s, 8.9 s),
once more after the deliberate red below (8.7 s), twice after `make test-all` and a re-seed (9.1 s,
9.0 s), and once after the port check changed (9.2 s); the flow itself is 5.4 s, the rest is starting
the three servers. Each run: a fresh account signed in at `/login?next=/`, My game answering "—" hands,
the screen name `Hero` added for `pokerstars`, `seeds/hands/pokerstars/cash_6max_nl50.txt` handed to
`/upload`'s file input, the line reaching `data-status="completed"` with "2 hands in" and **no
"no seat recognised as yours" warning**, its "See them in My game" link followed, and the `kpi-hands`
tile reading **2**. The worker's own log in each run: `inserted {'hands': 2, …}` → `hot path derived
{'decisions': 35, 'player_hands': 24}` → `upload …: {'found': 2, 'parsed': 2, 'failed': 0,
'without_hero': 0}` — the hot path, not dbt.

**Red when the worker is not running.** The same command with the worker killed as soon as it
appeared and kept dead: the run fails on the upload step with the message written for it, `Expected:
"completed" / Received: "queued"`, after the 90 s budget; the screenshot shows the page's own "Is the
parser worker running?" sentence. The third green run above was the next run after this one, and its
worker also swallowed the orphaned pointer the red run left (`worker stopped after 2 message(s)`) —
the requeue/late-pointer rules from ADR-051 doing their job.

**Teardown, after each green run and after the red one:** no `ingestion.worker`, no uvicorn, no
`nuxt dev` on the E2E's ports, nothing listening on :8055/:3055, and the consumer group with no
member and lag 0.

**The guard, twice:** `npm run e2e` with no test environment refuses with all seven rules listed and
exits 1; with only `POSTGRES_DB=poker` wrong it refuses naming that one.

**It also fails legibly when the databases are not there.** Running `make e2e` straight after
`make seed && make test-all` — whose session drops the test databases when it ends — failed on the
account it registers with `Expected 201 / Received 500`, the API's sanitised `{"detail":"Internal
server error"}`, and the API's own `InvalidCatalogNameError: database "poker_test" does not exist`
piped into the output two lines above it. The expectation now names that case ("run `make seed`"),
since it is the one operator error the ordering invites. Re-seeded, the next two runs were green
(9.1 s, 9.0 s).

**Gates, over the combined tree** (which three other lanes were editing throughout):

- `make check` green (**1,714** passed, 113 deselected), twice — before and after the review's fixes.
- `make web-check` green at **1,210 tests / 119 files** with the licence audit clean, on the run taken
  after lane C fixed its `RangeMatrix` test. A later run over a tree that had grown to 122 files
  (1,256 tests) was red on **two other lanes' files**, neither this lane's:
  `apps/web/app/help/shortcuts.test.ts` (lane E's own registry test doing its job — a key bound with
  no row) and `apps/web/app/components/analyze/Step1Ranges.test.ts`, which lane C then showed was a
  **torn tree, not a defect**: the run caught its `.vue` edited and the test's assertion not yet
  (16/16 alone, and under a shuffled order, minutes later). **This lane's slice was re-run green on
  its own** after that red: typecheck (including `tsc -p e2e`), ESLint over `e2e/`, licence audit.
  Both lanes were told; the standing red at the time of writing is lane E's one file.
- `make seed && make test-all` green (**1,821 passed, 6 skipped**, 5 min 20 s). Nothing changed after
  it that it covers: the later edits were `platform/web/e2e/**` and the Makefile's own `e2e` target.
- `make e2e` green, and its two deliberate reds, as above.

The one cross-lane lesson worth keeping: lane C's `RangeMatrix` now emits one edit per drag, on
pointerup. Playwright's `click()` is a pointer **down and up**, so the E2E was unaffected — a
synthetic `mousedown` alone would not have been.

**What only a real CI run can prove** (the reason D.9b stays `[ ]`):

1. **`make e2e-install` on the runner.** `playwright install --with-deps chromium` is a no-op for
   `--with-deps` on macOS (measured) but on Linux installs system libraries with `sudo apt-get`;
   hosted runners allow passwordless sudo, and this has not been observed here.
2. **A cold Vite/Nuxt dev server on a runner.** First compile there has never been timed; the
   budgets (`webServer` 180 s, test 240 s) are guesses padded for it.
3. **Chromium headless on linux-x64** — every local run used the mac-arm64 build.
4. **The failure-only artifact upload** (`actions/upload-artifact@v7`, path
   `platform/web/e2e/test-results/`): the path is right only if `uses` steps ignore
   `defaults.run.working-directory`, which is documented but unobserved here.
5. **Wall-clock and memory beside the other three jobs** — the e2e job runs its own stack, so the
   runner holds ClickHouse (4 G cap), Kafka, Postgres, Redis, MinIO, a browser and a Nuxt dev server
   at once. The integration job's 6.3 GiB of caps fits; this job adds the browser and Node.
6. **That CI is red when it should be** — a green first run proves the job runs, not that it bites.

### Consequences

- `make e2e` and `make e2e-install` join the make contract; **`docs/CLAUDE.md`'s `platform/` target
  table needs the two rows** (§4). `make e2e` must never run beside `make test-all`: same consumer
  group, and that session drops the databases the E2E needs. The Makefile comment says so.
- **The E2E runs as a first-time reader, on purpose.** Every run is a new account in a fresh browser
  profile, so F.12d's welcome affordance appears in it. Lane E confirmed the offer is an `<aside>` in
  normal flow — nothing fixed, no overlay, no focus trap — so the nav and every `/upload` testid stay
  clickable, and the tour card appears only after someone presses "Take the tour". **That state is
  kept rather than suppressed:** an affordance that starts covering a real click should turn this
  test red, and it is the cheapest warning available. If it ever becomes a nuisance rather than a
  signal, lane E's own escape hatch is one line — `page.addInitScript(() =>
  localStorage.setItem('poker-help/v1', JSON.stringify({ welcomed: true, tour: 'unseen', stop: 0 })))`
  (`HELP_STORAGE_KEY` in `app/help/state.ts`; per profile, never per account) — and `welcome-offer`
  with `welcome-dismiss` inside it is the stable alternative to assert on. Nav links are selected by
  **name**, not position, so lane E's new `Examples` and `Help` entries change nothing here.
- **Playwright is pinned exactly** (`1.63.0`), not by range: one release drives one browser build,
  and `make e2e-install` fetches the build that matches the installed version. Bumping it is a
  deliberate change with a browser download attached. `platform/web/LICENSES.md` carries the row
  (Apache-2.0) and records that the browser binary lives outside `node_modules`, so the licence
  audit never sees it.
- **The lockfile flipped 83 entries from `"dev": true` to `"devOptional": true`.** That is npm
  11.19.0 (Node 24, ADR-054) recomputing flags a lockfile written by npm 11.4.2, not this change:
  `npm install --package-lock-only` on the untouched tree produces the same 83 flips. Versions,
  `resolved` and `integrity` are untouched; the only real additions are `@playwright/test`,
  `playwright` and `playwright-core`.
- The test's own weather report, for whoever reads a slow run: this machine **idle-sleeps**, and one
  deliberate failure that used 240 s of awake time took 15.5 minutes of wall clock. Playwright's
  timeouts are monotonic, so a sleeping laptop stretches durations without changing the verdict.
- Not done, recorded: no second flow (a pool upload, a failed upload retried in the browser — the
  unhappy paths are integration tests, ADR-051); no cross-browser run (one Chromium project); no
  video (ffmpeg is installed but unused); the browser cache is not keyed into the CI cache, so
  `make e2e-install` downloads on every run (~1 min; cache it if that ever matters).

---

## ADR-056 — A word that says how a number was obtained is a glossary entry; a word that names a set is a row in a typed table; both are explained by the same affordance

**Status:** accepted · 2026-09-16 · plan F.12b (round 6, lane C)

**Context.** [POKER_UX_AUDIT.md](POKER_UX_AUDIT.md) §3.3 found two vocabularies on screen and one
glossary. `poker-ui`'s 28 entries cover the metrics the spec names, each a sentence plus a formula behind
`MetricLabel`. Everything else — the pool's tiers and sampling words, the classifier's made-hand and draw
classes, the strategic categories, the ten seats, the node shorthand `BB call vs CO 2.5bb · 40bb · NL10` —
reached the reader as a `title=` hover at best and usually as bare text. The audit asked for the rule before
the entries, and split the decision in two: this ADR is `poker-ui`'s half (tiers, classes, positions, node
shorthand); ADR-057 is the registry's half (stats and dimensions, which are runtime data from
`/v1/definitions`).

**Decisions.**

1. **The rule: a word that names HOW A NUMBER WAS OBTAINED is a glossary entry; a word that names A SET is
   a row in a reference table.** An entry carries a formula, because the number has one. A set's row carries
   the rule that places something in it instead. The line is not stylistic: it decides what has to be true of
   the words. An entry's formula is checked against the query or the maths that produced the number; a row's
   rule is checked against the code that assigns membership.

2. **The tiers are entries** (`glossary.ts`): `observedFrequencies` (tier 1), `showdownRange` (tier 2),
   `reconstructedRange` (tier 3, already there), plus `sampleSize` and `showdownCoverage`, which are how the
   pool says how much it knows. Their formulas are the server's own counting, read out of
   `analysis/pool/node_query.py`, `node_service.py` and `realization.py`. `PoolDataBadge` now explains every
   word it prints — the tier chip, `n`, "insufficient data", "shown down" — with no change to its text or its
   `data-testid`s.

3. **Classes, categories, axes, seats and the node shorthand are tables** (`vocabulary.ts`), each keyed by
   `@poker/core`'s own type: `Record<MadeHandClass, TermEntry>`, `Record<DrawClass, …>`,
   `Record<StrategicCategory, …>`, `Record<Axis, …>`, `Record<Position, …>`. A class core adds without a row
   here does not compile, a test pins every hand term to the label `labelFor` prints, and the category rules
   interpolate `DEFAULT_THRESHOLDS` rather than repeating 60% and 35%. The rules are written from
   `classify.ts` — which classifies *relative to the board* — and from `core/enums.py` for the seats, so
   "set" and "trips" are told apart the way the classifier tells them apart, not the way folklore does.

4. **One affordance for both, and for lane D's registry descriptions: `TermLabel`.** It takes a
   `TermEntry = { term, definition, formula? }`, so a `GlossaryEntry` is one. `MetricLabel` keeps its
   `GlossaryKey` prop and becomes a thin wrapper over it, with identical markup, so a label without a
   glossary entry still fails to typecheck. `TermLabel` has two slots: the **trigger** (scoped with the
   tooltip's `describedby`), so a word that is already a control — a distribution group's button, a
   checkbox's label — stays that control instead of nesting a focusable span inside it; and the **tip**, for
   a body that is not one sentence and a formula. ADR-057 records lane D's use of the same component for the
   registry's descriptions, which are runtime data and never enter `GLOSSARY`.

5. **The node shorthand explains itself in place, and cannot drift.** `nodeLabelParts(key)` cuts
   `nodeKeyLabel(key)`'s own output into its words — seat, verb, `vs`, the seat faced, the size faced, the
   street, the stack, the stake — and a test asserts the pieces joined are that label exactly, over the
   shared `tests/fixtures/nodes.json` and hand-built keys (RFI, iso, 3-bet, 6-bet, a postflop % size, "to
   act", no villain, no stake). The rules that choose the words stay in `@poker/core` alone. `NodeLabel`
   renders it with a tooltip that names every piece; a shorthand the file cannot take apart still prints,
   plainly, because a tooltip is never worth a page that fails to render.

6. **The reference tables are renderable whole.** `VocabularyTable` prints one table as term · meaning ·
   rule (`positions`, `madeHands`, `draws`, `categories`, `axes`, `nodes`, and `tiers` from the glossary),
   for a help overlay or a reference page to mount. The seat legend under a situation editor is its first
   use. The words themselves live in one place, so a tooltip and a table can never disagree.

7. **The glossary test now guards the app too.** It scans `apps/web/app/**/*.vue` for `<MetricLabel …
   term="…">` specifically — another component's `term` prop is not misread — and checks every key exists;
   and it checks each table covers its core type exactly, in core's order, with a one-sentence definition
   and a rule.

**Consequences.** The vocabulary is auditable: a class or a seat that core adds breaks the build until it is
explained, and a tier's formula is checked against the query that counts it. `poker-ui` gained three
components and two modules and no dependency — it still imports `@poker/core` only. The registry's
descriptions stay out of the glossary, so a stat's wording keeps coming from the server (ADR-057).

**Also decided here, because the same lane took them.**

- **Undo is per stroke, not per cell.** `RangeMatrix` used to emit `update:range` for every cell a drag
  crossed, so ⌘Z walked back one cell at a time — useless in the drawing trainer, where a chart is painted
  in strokes. It now paints into a local draft (the cells repaint live) and emits **one** `update:range` when
  the pointer lifts or the gesture is cancelled; a stroke that changed no weight emits nothing. Every
  consumer therefore sees one edit per stroke, and values driven by `update:range` — a combo count, the
  Lab's equity run — settle when the pointer lifts rather than mid-drag.
- **The shortcuts are bound on the window, in one place.** `useUndoShortcuts(target)` (in `useUndoRedo.ts`)
  binds ⌘Z / ⌘⇧Z / Ctrl+Y while the component is mounted, ignores events already handled and leaves text
  boxes their own native undo. The drawing trainer's binding used to be on a wrapper `<div>`, which the
  matrix's own `preventDefault` kept focus out of, so the shortcut never worked; `/lab`'s hand-rolled
  listener now goes through the same helper.
- **An undo has to be saved, or it is not undone.** In analyzer step 1 the history holds the step's list of
  range assignments, and every undo or redo emits the same `workPatch` an edit does, so the autosave (ADR-034)
  carries it to the server. Pressing undo with nothing to undo emits nothing.
- **`useUndoRedo.sync(next, same)`** follows a value that changed outside the history: the same value keeps
  the history, a different one starts a new one. That is what lets a stored range keep its undo across a save
  (the server returns the body that was just saved) and start again after a revert.
- **The equity service comes from a package.** `createLocalEquityService()` in `poker-ui` satisfies
  `EquityServiceLike` in-process over `@poker/core`, so `EquityCalculator` mounts anywhere with a single
  import and no app-specific wiring (acceptance 12); the Worker stays the right choice for a page and is
  three documented lines in the README.

---

## ADR-057 — Registry words reach the screen through one app-side component, from the registry's own descriptions at runtime; a blank area says what it is for and offers one way in; a failure is a sentence that cannot be mistaken for "no data"

**Status:** accepted · 2026-09-21 · plan F.12c (round 6, lane D) · **Constrained by** ADR-021 (the registry is the
one vocabulary), ADR-053 (a number typed and a number sent agree), ADR-051 (the hot path, and the uploader reads
sentences); **shares §3.3 of the UX audit with ADR-056** (F.12b, the Range Lab side).

**Context.** The UX audit (§3.3) found two vocabularies on screen. `poker-ui`'s `GLOSSARY` — 28 hand-written
entries behind `MetricLabel` — covers the six terms the spec names. The other is the stat registry: 65 stats and
80 dimensions, each with a one-line `description` written beside the SQL it compiles to and served by
`GET /v1/definitions`. That second vocabulary reached the screen as a `title=` hover at best (`KpiTile`, `StatGrid`,
`StatPicker`, `ClauseRow`, `SituationBuilder`) and not at all in `LeakTable`, the sessions table, the dashboard's
prose or the filter's chips. A `title=` opens for a mouse and for nothing else. The same audit's §2.4 found
`/reports` and `/pool` blank until *Run*, `/ranges/compare`'s columns saying "No chart…" with no way in, and
`/hands` pointing at an upload control that did not exist; its §2.13 found the generic error fallback printing
"The API answered with status 500." for an API that was simply not running, nine `.catch(() => null)` sites
turning a refusal into "no data", and two ADR-051/053 follow-ups (`FetchOptions.body`, `validationMessages`).

**Decisions.**

1. **The registry is runtime data and is never copied into the glossary.** The descriptions arrive with
   `/v1/definitions` and reach the screen through one module, `app/stats/vocabulary.ts`, and one component,
   `app/components/reports/RegistryTerm.vue` — nowhere else. Copying them into `GLOSSARY` would put words a
   server serves into a file that ships a week later; the registry is validated against the SQL on every load,
   and the screen should say what the server says.
2. **One affordance, the glossary's.** `RegistryTerm` is a dotted-underlined term whose one sentence opens on
   hover, on focus and on tap, with `aria-describedby` wired whether or not it is open — exactly `MetricLabel`'s
   shape, and deliberately the same three props and the same `#default="{ describedby }"` trigger slot as lane C's
   `TermLabel` (ADR-056), so a header or a chip that is already a `<button>` becomes the trigger instead of
   nesting a focusable span inside a control. A `title=` is not a way of explaining a term and is removed wherever
   the description now goes through the component; `app/stats/vocabulary-coverage.test.ts` fails if a
   description goes back behind a `:title` in a converted file. **The one thing not shared with `TermLabel` is
   the positioning:** every table that shows a registry word (`LeakTable`, `SessionTable`, `StatGrid`, `/hands`) is
   inside an `overflow-x-auto` wrapper, which clips an absolutely positioned tip or grows it a scrollbar, so the tip
   is `position: fixed`, placed from the trigger's own rect and kept inside the viewport on the right. The
   click-through `DefinitionPanel` stays: the tip says what a number *is*, the panel says what it *counts*, and
   they are not alternatives (`/pool/players` and `/pool/cohorts` had grid headers whose click went nowhere; they
   now open the panel too).
3. **What a tip says: the registry's sentence, the band with its unit, where it is counted — and not `notes`.**
   42 of the 65 stats carry `notes`, and 40 of those are v1-parity arithmetic written for whoever ported the stat
   ("v1 counted a seat's first decision only (+0.6% opportunities…)"). They stay in `DefinitionPanel`'s "Caveat"
   line, where someone asking what a number counts is already reading. The typical band carries the stat's unit
   ("Usually 0–10 bb/100." — the tile used to print "0–10bb/100"), the grain is said in words ("counted once per
   hand"), and the fact tables are said as what they hold ("hands", "decisions", "the daily statistics") — never
   `player_hands`, `stats_daily`, "decision-grain" or "counted by sketch".
4. **A registry value reads as a word only where it is one.** `5bet_plus` → `5bet+` and `''` → "not applicable"
   apply to an **enum**; a bucket name is printed with its bounds from `dim.buckets` ("small (under 0.37 of the
   pot)", the unit read off the dimension's label, which F.12a made "(fraction of pot)"); anything else comes back
   untouched. The old `filter/label.ts#valueLabel` ran the `_plus` rewrite on every type, so a pool player called
   `a_plus_b` read `a+b` — closed, with a test. What is **sent** does not change: the option's `value` stays the
   registry's code (ADR-053).
5. **"EV" means two things, and every hero surface says which.** The glossary's `ev` is a solver EV
   (`equity × EQR × pot`); the registry's `ev_bb_per_100` is the all-in adjusted result. My game's luck sentence,
   the winnings caption and the chart's series now use one name — **all-in adjusted** — where the page had three
   ("all-in adjusted winrates", "all-in EV", "EV bb/100"). `hero/words.test.ts` reads
   `stats/registry/stats/money.yaml` and fails if `ev_bb_per_100`'s description stops saying so. Splitting the
   glossary's `ev` is F.12b's (ADR-056); renaming the registry label is a `platform/stats/registry` change and is
   not this step's.
6. **The app's own words are a small, separate list under the same affordance.** "the field", "n", "thin",
   "gap", "spots", "grain", "cached" are `APP_TERMS` in `stats/vocabulary.ts` — they are ours, not the registry's,
   and they carry as much weight as any stat ("thin" is the difference between a number worth reading and one
   worth ignoring). Tiers, hand classes, positions and the node shorthand are poker's own vocabulary and are
   ADR-056's (`TermLabel`, `VocabularyTable`, `NodeLabel` in `@poker/ui`); this lane does not repeat them.
7. **A blank area teaches: what it is for, why it is empty, and one way in that exists.** The wording is pure
   text in `reports/emptyState.ts`, `hands/emptyState.ts`, `ranges/compareEmpty.ts`, `pool/words.ts` and
   `hero/words.ts`, rendered by one `EmptyState` (lead, body, actions as a `NuxtLink` or a button that emits
   `act(key)`), so every sentence is asserted as text and every way out is a testid. The rules that shape them:
   *before the first run*, `/reports` and `/pool` say what a grid is (one row per group, one column per stat, every
   cell with its sample) and that *Run report* fills it, and offer that button; *no rows* says whether nothing is
   stored yet (→ the Upload page, and that a file counts here seconds after it lands — true because of the hot path,
   ADR-047/051) or the situation is narrow (→ the buttons that widen it: clear the situation, clear the dates, look
   in the other dataset), and a situation that came with a saved report or preset cannot be cleared here, so it
   says "open another report above" instead; a chosen cohort says that who is in it is recounted when the
   statistics are next rebuilt (ADR-051); the compare page's columns say what would be drawn there, that a stored
   chart counts only on an exact match (seats, stack, table size, stake, texture, every step), and offer the Import
   page — except when this browser's offline copy is what answered, when importing needs the API too; the pool
   column's "insufficient data" keeps its badge and names the two knobs that actually widen it (clear the stake,
   drop a texture word — the two conditions `node_filter.py` adds one by one). Never a route that does not exist:
   the Examples and the tour are lane E's and are not linked from here.
8. **A failure is a sentence that cannot be mistaken for "no data", and it says what to do.** Nuxt wraps a
   failed `$fetch` from `useAsyncData` in an H3Error whose `statusCode` is 500 and whose `cause` is the original,
   so `/hands`, `/hands/[id]`, My game and `/analyze` printed "The API answered with status 500." for an API that
   was stopped. `describeApiError` now unwraps once, guarded on Nuxt's own `__nuxt_error` flag (an error that
   carries a `cause` for its own reasons is still its own message); `errorStatus` and `isUnauthorized` deliberately
   do not, because `auth/session.ts` reads them on the raw rejection of a call it made itself. A 5xx with no
   detail names the terminal running `make api`; any other bare status says the page did not expect it and to
   reload; the three local `error.cause ?? error` unwraps are gone. Of the audit's nine `.catch(() => null)` sites,
   six are this lane's and are fixed (the list is in **D**): the replayer's two pool calls settle independently
   and each refusal is a sentence — worded for a **refusal under load**, because ClickHouse refuses the fifth
   simultaneous query of a fast-stepping reader (E.3's quota) and the API relays it as a sanitized 500, which used
   to read as "the field has never played this spot"; the range-library lookup no longer caches an answer that a
   failure or the offline copy produced, so a node is asked again on the next step; the tier-3 estimate rejects
   and the compare page says the Pool column has fallen back to the showdown range; saved cohorts that could not be
   loaded say so instead of vanishing from the picker, and a `?cohort=` that cannot be resolved **blocks the run**
   instead of silently measuring the whole field under its name. `HandNotes`' tag-vocabulary catch stays and says
   why (it only feeds suggestions). Every page that awaits the registry renders `definitions-error` with a Try
   again; the saved-report library's error carries its reason and a retry, and `PresetMenu` cannot say "None yet"
   over a failed load; `analyzeThisNode`, the import page's file readers and the backup gained a catch in words;
   `DropZone` no longer prints the browser's `error.message`. `FetchOptions.body` carries a `FormData` and
   `upload/api.ts` drops its cast (ADR-051's follow-up); `pool/rules.ts` imports `validationMessages` from
   `auth/api.ts` and its private copy is deleted (the plan's wording; `describeApiError` alone would now do, and
   `describeCohortError` keeps its name and tests).

**Alternatives.**
- *A `term`/`entry` prop on `MetricLabel` itself* — the audit's first option. Rejected for this round: `MetricLabel`
  is lane C's file while F.12b changes `poker-ui`; the app-side twin is shaped to delegate at the merge.
- *Registry descriptions as `GLOSSARY` entries.* Rejected (decision 1): a copy of a served document that drifts
  the first time a description changes, and there are 145 of them.
- *A CSS-only absolute tip, like `MetricLabel`'s.* Rejected (decision 2): clipped inside every table that matters.
- *`DefinitionPanel` everywhere instead of a tip.* Rejected: heavier, needs a panel on My game and the leaks, and
  does nothing for hover or inline reading; the panel stays for what it does well.
- *A percent-style per-value label list in the registry* (enum values explained). Not this lane's file; recorded
  as a follow-up.
- *Surfacing `notes` in the tip.* Rejected (decision 3) until they are rewritten for a reader.

**Verification.** Below, **D**.

**Consequences and follow-ups.**
- **Merge:** lane C's `TermLabel` + `TermEntry` share `RegistryTerm`'s props and slot; the merge may delegate
  `RegistryTerm`'s body to it **only if the fixed positioning is kept** (or lane C adopts it). `NodeLabel`
  adoption on `HandStudy`, `compare.vue` and `ranges/index.vue` is left to the merge (ADR-056).
- **Registry, not this lane:** rewrite the 40 v1-parity `notes` for a reader or leave them off tips for good;
  per-value labels for enums (`pot_type`, `facing`, textures); the `EV bb/100` label; `facing`'s description
  points at "the header of this file".
- `stats/definitions.ts`'s error sentence still ends "…so the situation builder has no vocabulary", which My game
  and the leaks now render although neither has a builder — page-neutral wording is a one-line follow-up.
- `DefinitionPanel` takes no focus and renders above the grid, so a header clicked low on the page opens it
  off-screen (audit §2.11 territory, unchanged). `pages/ranges/compare.vue` still awaits `store.load()` non-lazily.
- `ReportWorkbench.vue` is at 296 raw lines after two extractions (`ReadingOptions.vue`, `reports/widen.ts`); the
  next addition has to extract the save/delete plumbing. `hero/winnings.ts` is 323 raw lines, pre-existing.
- `ClauseRow`'s `OP_TEXT` ("is below"), `filter/label.ts`'s `OP_WORDS` (`<`) and `pool/stats.ts` (now "is
  below") are three wordings of one operator — one module later. `list()` ("a, b and c") is privately duplicated
  in `pool/words.ts`, `reports/emptyState.ts` and `hands/searchable.ts`.
- Not this lane's `.catch(() => null)` sites (listed in **D**): five in lane C's files, one in `heuristics/log.ts`.

---

## ADR-058 — The privacy guard matches a name where its context proves it is one, and runs before every push, never in CI

**Status:** accepted · 2026-09-15 · plan D.9c · round 6, lane B

**Context.** "Only aggregates get committed" has been a rule since the first import, and it was
broken by three lanes and two merges without anyone noticing, because a screen name in a test
fixture or a verification note does not look like data. The round-5 merge found fourteen real
handles reachable from a public branch; the history rewrite that followed removed those fourteen
and missed a fifteenth, in a code comment, because its scan tokenised on word characters and the
handle contains brackets. A rule that depends on remembering it is not a rule. It has to be a
check, and the check has to run at the last moment before publication — the push.

The matching problem is that a screen name is often an ordinary word. Measured over the real
pool's **94,276** keys (every non-hero `player_key` in `core.hand_players`; names are 4–17
characters over the alphabet `a-z 0-9 _ - ! @ [ ]` and the space): **44,824** are letters only,
**40,456** hold a digit or a symbol, **8,748** hold a space, **248** are digits only. Matching all
of them as plain text against this repository's prose finds "board", "facing", "sequence",
"straight flush" — noise that would train us to pass `--no-verify`.

**Decisions.**

1. **What it matches against: the real database, read-only.** Every real opponent's key, from
   `core.hand_players` — the table named explicitly, so `CLICKHOUSE_DB_PREFIX` cannot point the
   check at the `test_` databases — with `settings={"readonly": 1}`, which the server enforces
   (verified: a `CREATE TABLE` through the same client answers code 164). Keys where the seat is
   the hero are excluded: the founder's own screen name is not third-party data. An empty answer
   is an error, never an all-clear.
2. **Three contexts, and each is matched as far as it is proved.**
   - **A hand-history line** — `Seat 3: name ($25 in chips)`, `name: folds|checks|calls|bets|
     raises|posts|shows|mucks|doesn't show hand|…`, `Dealt to name`, `Uncalled bet (…) returned to
     name`, `name collected $X from pot`, and the SUMMARY `Seat N: name (button) folded|showed|
     mucked|won|collected` — is matched by the site grammar, which says exactly where the name is.
     So: **any length, spaces included, no allowlist**. Two of the fourteen were 4 and 7
     characters; nothing but this catches them. A line is tried as a whole and as each of its
     quoted and unquoted pieces, so a fixture inside a Python or TypeScript literal, a JSON value,
     a Markdown bullet or a diff line is matched like a bare one.
   - **A player key** — `ggpoker:name`, the form the API, the marts, the docs and the tests use —
     is matched the same way: the prefix proves it. The longest name that ends where a name can
     end wins, so `ggpoker:ab_cd` never reads as the key `ab`.
   - **Any other text** is where dictionary words collide, so a name is reported only by its shape
     and length: **letters only from 8 characters, a name with a digit or a symbol from 5, a name
     with a space from 13, digits alone never**. A name **in quotes or backticks** is being
     mentioned rather than used, so there a digit, a symbol or a space makes it reportable at any
     length — which is what catches a handle quoted in prose (and what the round-5 rewrite's own
     four-character mention trips). Letters alone still need their 8, because `'fold'` and
     `"button"` are everywhere in this code.
3. **Why those numbers, measured rather than guessed.** Over HEAD's 819 tracked files, the rule's
   cost is the allowlist it needs, and its benefit is the share of real names it would catch in
   prose:

   | letters / mixed / spaced | ordinary words to allowlist | share of the 94,276 keys reportable in other text |
   |---|---|---|
   | 6 / 4 / 10 | 60 | 91.5% |
   | 7 / 5 / 13 | 38 | 80.6% |
   | **8 / 5 / 13** | **26** | **73.2%** |
   | 10 / 8 / 13 | 5 | 46.9% |

   8 / 5 / 13 is the knee: the allowlist stays a page, and everything the rule gives up in prose
   is still caught in a fixture line or a key, which is where names actually arrive.
4. **The allowlist is committed and narrow.** `scripts/privacy_allowlist.txt`, 26 ordinary words
   and phrases that are also real handles. It excuses a word **in other text only** — never in a
   hand-history line, never in a key, where a collision is a name to change (an invented fixture
   name that is also a real handle has to change anyway). A word goes on it only when the
   repository uses it in its ordinary sense; a handle mentioned as a handle is fixed, not listed.
5. **What it scans.** By default every tracked file as it is on disk, plus each file's **index**
   version wherever the two differ — what the next commit would take. `--history REV…` takes any
   `git rev-list` arguments and reads every blob those commits hold. `--pre-push REMOTE` reads
   git's own stdin and scans what the push would send: the local tips, minus the remote tip when
   this clone has it, minus everything already on a remote-tracking ref of that remote. **A remote
   tip this clone does not hold — a force-push over a rewritten history — excludes nothing**, so
   the whole branch is scanned. After a fresh clone or a `filter-repo` there are no
   remote-tracking refs at all; `git fetch` first, or a new branch's push scans every commit.
6. **What it prints: the file, the line number and the key.** Never the line, never a player's
   stats — the guard must not become the leak. (A mutation that appends the line to the output
   turns the test suite red.)
7. **Exit 0 / 1 / 2, and it fails closed.** 0 clean, 1 findings, 2 *nothing could be checked* —
   ClickHouse unreachable, no keys, a git failure, a malformed key. Under the hook, 2 refuses the
   push exactly as 1 does. A check that cannot run must never read as a pass.
8. **It cannot run in CI**, and this is by design, not an omission: CI has no real data (ADR-054's
   jobs run entirely in the `test_` environment) and it must not be given any — a key list on a
   runner is the leak this guard exists to prevent. So it is a **local** gate, run by a **pre-push
   hook** that git does not version: `make install-hooks` writes it per clone, refuses to replace
   a hook it did not write, and honours `core.hooksPath`. The hook calls the make target rather
   than restating it, as ADR-054 requires of CI.
9. **Three modules, because matching is not plumbing.** `scripts/privacy_match.py` is pure — keys
   and text in, findings out, no git and no database, which is what the 38 unit tests exercise
   with invented names. `scripts/privacy_sources.py` yields texts from the working tree, the index
   and git's object store. `scripts/privacy_check.py` owns the keys, the report, the hook and the
   CLI.

**Alternatives considered.**

- **A dependency for the matching** (`pyahocorasick`, or a compiled trie regex over 94,276 names).
  Rejected: a set lookup over the candidates a line can actually hold is already 3 s for the whole
  repository and its history, and the licence allowlist and `uv.lock` churn buy nothing here.
- **A single length threshold for every shape.** Rejected by measurement: it either lets
  `nl50`-shaped handles through or demands an allowlist of every six-letter English word in the
  docs.
- **A system dictionary** (`/usr/share/dict/words`) instead of a committed allowlist. Rejected:
  not reproducible across machines, absent on many, and it would excuse a handle that happens to
  be a word *everywhere*, including in a fixture line.
- **Running it in CI with a committed list of hashed keys.** Rejected: a published hash list of
  94,276 short screen names is a dictionary attack, not a protection, and it would put the pool's
  identities in the public repository in another form.
- **A `pre-commit` hook instead of `pre-push`.** Rejected as the primary gate: a commit is local
  and reversible, a push is publication, and the round-5 leak was published by a push. `make
  privacy-check` before a commit is the same check, one command away.

**Consequences, and the gaps this leaves — each deliberate.**

- **Commit and tag messages are not scanned**, only blobs. The rewrite verified that no message
  mentioned one of the fourteen; if a message ever should be covered, it is ~8 lines in
  `privacy_sources.history`.
- **In prose, a letters-only handle under 8 characters, a spaced one under 13 that is not quoted,
  and a digits-only one are not reported** — the price of an allowlist that stays a page. They are
  still caught in a fixture line and in a key.
- **A name holding a character outside the text alphabet** (`.` or a non-ASCII letter, none today)
  is matched in fixture lines and keys only; the check prints how many such names exist.
- **The allowlist is a list of words that are also real handles.** Ordinary words identify nobody,
  but the list grows as the docs grow, and every addition must be looked at.
- **The guard needs the stack up.** `make up` before a push, or the push is refused with "nothing
  was checked".
- **An old branch breaks the hook loudly**: checked out before this step, the working tree has no
  `privacy-check` target, make fails, the push is refused. That is the correct direction to fail.

---

## ADR-059 — One sentence, one home: the tool catalogue, the page explainer and control help

**Status:** accepted (F.13, 2026-09-21).

**Context.** By round 6 the app wrote three kinds of explanatory sentence and had no rule about
which owned what. The registry describes a stat or a dimension and reaches the screen through
`stats/vocabulary.ts` and `RegistryTerm` (ADR-057). `@poker/ui`'s `vocabulary.ts` and `glossary.ts`
describe the words that name a set — hand classes, draws, positions, node shorthand (ADR-056).
Nothing described a **tool**. Writing that third kind of sentence without a rule would have meant
copying: a screen explaining `min_n` in its own words beside a registry tip already explaining it.

**Decision 1 — one sentence has exactly one home, and the rule that decides it.**
A sentence about a *stat or dimension* belongs to the registry. A sentence about a *word that names
a set* belongs to poker-ui's vocabulary. A sentence about *a tool* belongs to the catalogue in
`app/help/tools/`. **The test: if the sentence would still be true with this screen deleted, it is
not the catalogue's.** A catalogue entry or a control's sentence may name a term; it never defines
one. `tools.test.ts` enforces the one direction that can be checked mechanically — no catalogue
sentence is byte-identical to a glossary or vocabulary definition — and the rule is written at the
top of `help/tools/types.ts` and `help/controls/types.ts` for the cases a test cannot catch.

**Decision 2 — the explainer opens on a first visit to a tool and is collapsed on every later one.**
The alternatives were "always collapsed" (the founder never sees it, and a new screen explains
itself to nobody) and "always open" (clutter on the hundredth visit). The state is per-tool, kept
as a list of ids in `help/state.ts`'s `seen`, so a screen added next month opens its card even for
a reader who has been here a year — a counter or a single "dismissed" flag could not do that.
**Collapsing is what marks the tool read**: a reader who closes the card has been told. Because the
app is `ssr: false`, the decision is read from `localStorage` synchronously in setup, so the card
is in its final state on the first paint and nothing moves — verified by sampling the DOM six times
across the first 720 ms of a cold load. Help ▸ **Explain this page** reopens it, always, and
`Escape` closes it. `parseHelpState` treats a record written before F.13 as "nothing read yet"
rather than discarding it, so nobody loses a tour in progress to a field that did not exist.

**Decision 3 — chapters extend the tour, they do not replace it.**
`TOUR_STOPS` stays one flat list; a chapter is a run of consecutive stops that name the same area.
So the one saved index still resumes the whole tutorial, `TourCard`, `WelcomeOffer` and `HelpMenu`
keep working off the same prop, and a reader mid-tour after the upgrade simply finds themselves at
the stop they were on, in a tutorial that is now longer — `resumeAt` already starts from the top
when a saved stop no longer exists. `HelpMenu` gains a **Chapters** list so any area can be entered
directly, and `/help` repeats it per area as "Walk me through it".

The tour's two old rules bind harder now: every anchor is a `data-testid` the pages already carry,
and every stop is on a **public** page. That is why the first three chapters — My game, Pool, Hands
— stop on `/help` rather than on the screens themselves: those screens cannot be shown to a
signed-out reader, and mocking them would have created a fourth home for a sentence the catalogue
already owns. The catalogue's own page is the honest anchor, and each chapter ends with a worked
example that *can* be opened signed out. Analyze runs on a real example, Ranges & Lab on the real
Range Lab, Train on the real trainers. A third rule was added: **every word a stop says comes from
a named source** — the analyzer's steps, the trainers' modes, or the catalogue — and `tour.test.ts`
checks it, which is decision 1 applied to the tutorial.

**Decision 4 — control help attaches by selector, and adds no markup to anyone's component.**
Most of the 32 controls live in files other lanes own, and several are `<select>`s, checkboxes and
range inputs that cannot host a child element at all. `ControlHelp.vue` is mounted once in the
shell and, for each entry, finds the matching elements and sets exactly two things on them:
`aria-describedby`, pointing at a tip rendered in its own subtree, and `data-help`, its own
attribute, which the styles and the listeners key off. No bound class or attribute is touched, no
node is inserted into another component's DOM, and **no `title=`** is used — a `title` is invisible
to a keyboard and to a finger, which is the same objection ADR-057 raised for registry
descriptions. Listeners are delegated to the document (`pointerover`, `focusin`, `pointerup`,
`keydown`), so a re-render costs nothing and there is nothing to unbind per element; a
`MutationObserver` re-runs the scan when the page changes.

Two consequences worth writing down. **The visible cue is `cursor: help` plus a hairline dotted
outline on hover and focus** — an outline is painted outside the border box and takes part in no
layout, so a cue on an arbitrary control cannot reflow somebody else's page; a `::after` badge
could not have been used on a `<select>` at all. And **a control that nothing can focus gets a
`tabindex="0"`**, the same affordance `TermLabel` gives an explained word, but only where the
element is not focusable and holds nothing focusable, so a picker full of buttons gains no second
tab stop. A tab stop the layer added never counts as "already focusable" when the question is asked
again — without that the attribute was added and removed on alternate scans, and the browser pass
caught exactly that (§4).

**Consequences.** Adding a screen means adding a catalogue entry, or the suite fails. Adding a
chooser means explaining it or writing down why it needs none, or the suite fails. The cost is that
the catalogue's "how it works" sentences are written by hand from the modules that compute the
answers and can age; the guard against that is the rule in decision 1 plus the code comment above
each entry naming the module it was read from.


---

## ADR-060 — A number on a hero screen says what it means, not what it is

**Status:** accepted · **Date:** 2026-09-21 · **Plan step:** F.12 (close-out)

**Context.** Spec §13 asks for "a plain-language sentence next to key outputs, generated from
templates driven by the computed values". F.12b did that for the Range Lab (ADR-056,
`poker-ui/src/explain.ts`); the hero surfaces still printed bare numbers. But the obvious reading
of the line — put the numbers into a sentence — produces nothing: the KPI tile already prints its
value, its band and its `n`, and the leak row already prints four figures. A sentence that
restates them is decoration, and one more thing to keep in sync.

**Decision.** A hero reading says what the figures **mean**, never what they are, and only what
they support. Three rules, all of them branches on a value rather than prose someone believed when
they wrote it:

1. **A tile is read against its band, not against its point estimate.** The question a KPI tile
   poses and does not answer is whether this many hands can tell the number apart from the field's.
   Comparing the *baseline* with the *bounds* answers it from figures the server already sent, and
   it is the only clause on the tile that is not already on the tile.
2. **A stat the registry gives no better end to is a difference, never a fault.**
   `higher_is_better` is `null` for most frequency stats on purpose (`reports/cell.ts#sense`), and
   a red `+14.0` invites exactly the conclusion the platform refuses to make.
3. **A claim is withdrawn the moment the sample stops supporting it.** Under `MIN_N` the reading
   says so and says nothing else. And — the case the browser found, not the code review — when the
   band *contains* the field, the sentence must not then name a side: the founder's own bb/100 on
   2026-09-21 is −1.37 ± 9.52 against a field of −7.54, and the first draft read "this many hands
   cannot tell the two apart. This stat has a better end, and you are on it." Both halves in one
   sentence, the second withdrawing the first.

The sentences live in `apps/web/app/hero/readings.ts`, beside `words.ts` rather than inside it:
`words.ts` is what the **page** says (the luck sentence, the chart caption, the empty states), this
is what a **figure** says. They are tested as text (`readings.test.ts`, 24 cases), each case a rule
the wording may not break rather than a sample of the wording.

**Consequences.** Eight KPI tiles, every leak row and the sittings table carry one. A count carries
none — `reports/cell.ts` withholds its delta as arithmetic, so there is nothing to read. The tile
needed one new field, `KpiTileView.baseline`: `CellView` carries only `baselineText`, and a
formatted string cannot be compared with a bound.

**What was rejected.** Rendering the sentence only on hover or focus, the way the registry's own
description reaches the screen (ADR-057). That is the affordance the audit §2.3 criticised in the
first place ("sentences that exist only as a hover"), and a verdict about *this* measurement is
not a definition of the stat.

---

## ADR-061 — A gate handed a reason prints it; an example therefore opens all nine steps, and step 4 stops printing the answer it is about to ask for

**Status:** accepted · 2026-09-21 · plan round 7, lane B (the analyzer's follow-ups) ·
**Amends** [ADR-050](#adr-050) decision 4 (an example offers five of nine steps) ·
**Constrained by** [ADR-034](#adr-034) (a step's truth is fetched only after the commit),
[ADR-053](#adr-053) (the definition a number is graded by), [ADR-057](#adr-057) decision 8
(a failure is a sentence that cannot be mistaken for "no data").

**Context.** ADR-050 closed F.12d with two follow-ups against the analyzer's own files, and F.12c
listed five `.catch(() => null)` sites as not its own. All of them are one defect in two shapes:
**the analyzer has one way of saying "there is no number here" — silence — and it uses it for three
different facts.** `poolGap(null)` returned `''`, and `PredictionGate` reads `''` as *still
working*, so a committed prediction with no pool behind it waited on "Working out what actually
happens here…" for ever. A pool request that was *refused* produced exactly the same silence as a
pool that had simply not arrived yet, and as an example that has no pool at all. Alongside it,
`Step4Nuts` mounted `RangeComparisonPanel` unconditionally — printing the nut split, the two nut
shares and a sentence naming them, directly above the gate that asks *"What share of the nutted
combos here is yours?"*. Step 3 gates its comparison on the commit and step 6 fetches the pool only
after it; step 4 was the odd one out, and it was found on the example page, where it is the first
thing a first-time reader meets.

**Decisions.**

1. **A missing pool answer travels with its reason.** `StepContext` gains three optional readonly
   strings — `poolMissing`, `poolFacingMissing`, `libraryMissing` — and `poolGap(pool, missing = '')`
   returns `missing` when there is no pool at all. Empty stays the one honest silence: *a request is
   in flight*. The pool and the facing node get separate fields because they are separate requests
   that fail separately; step 9 reads the second, steps 1, 2 and 6 the first.
   *Rejected:* one field for both (a node answered and a facing node refused would have left step 9
   waiting again, which is the bug); folding the reason into `NodeFrequencies` (it is the absence of
   a frequencies object that has to be explained, so the reason cannot live inside one).

2. **`RangeComparisonPanel` gains `nutHiddenReason`, beside the `nutLockedReason` it already had.**
   When set, the nut split bar, the two shares with the threshold, `explainNutAdvantage`'s sentence
   **and the equity bands** are replaced by that one line. **The Advanced fold stays open**, because
   the definition the answer is graded by is chosen *before* the answer — `nutLockedReason` is what
   shuts it afterwards, and the two are deliberately independent. Step 4 passes a reason while
   `step.prediction === null`: the same rule `StepShell` already keeps for `actual`.
   *Rejected:* passing `heroEquities: null` until the commit (blanks the whole panel and prints
   "Set two ranges and a board", which is false); mounting the panel only after the commit (takes
   the definition control away before it is needed, and its test proves the cutoff must be
   changeable first); hiding the section with CSS from the app side (the numbers stay in the DOM).
   **This is the one file outside the lane's paths.** It is additive, defaults to `''`, and no
   existing caller changes.

3. **The equity bands go with the split, because they are it.** `DEFAULT_EQUITY_EDGES`' top band is
   **80–100%**, and `DEFAULT_NUT_CUTOFF` is **0.8** — the same set. `EquityBucketBars` puts each
   side's weighted combos in that band in a `title`, so hero's over hero's plus villain's *is* the
   graded number, one hover from the gate that asks for it. Hiding only the split bar would have
   left the answer on the page and the ADR claiming otherwise. What stays is the work: the
   equities, the range-advantage table and its sentence, and the distribution chart with its
   threshold line — from which the split can be *estimated*, which is the point of being asked.

   The same measure is not taken at step 5, where `BlockerPanel`'s per-combo table lets a reader
   who finds their own hand in it read a percentage off that row. There the table is the step's
   entire subject ("see exactly which of their combos your own two cards make impossible"), and
   removing it would leave nothing to work with. The line that does the arithmetic for them is
   gated instead. The rule this draws: **withhold the figure the gate grades and any summary that
   is arithmetically equal to it; keep the material it is derived from.**

4. **An example opens all nine steps** (amending ADR-050 decision 4). With decision 1 in place its
   four pool-scored steps have something true to say — "An example has no pool: what the field does
   is counted from hands you have uploaded, and this spot ships with the app. Open one of your own
   hands and press *Analyze this node* for the field's own number here." — so ADR-050 fact 3, the
   reason for offering five, no longer holds. Step 1's *Load my chart for this spot* is not offered
   at all rather than offered and broken (`libraryMissing`): a reader with no account has no
   library, and both seats already hold the reference chart the page names. Step 1's ranges and step
   6's size are **still filled in**, because the later steps read them; step 2's split and step 9's
   pot are the reader's to work. Step 9's heuristic is kept in the tab like everything else.
   *Verified:* `/examples/top-pair-dry-board`, signed out, **with the API stopped** — all nine
   committed, nine reveals or honest sentences, no gate waiting, and `indexedDB.databases()` empty,
   so mounting step 1 does not open the range cache and ADR-050 decision 1 still holds.

   **It still arrives on step 3** (`EXAMPLE_OPENS_AT`), not on step 1, and that is not an oversight.
   Steps 1 and 2 are an example's set-up — both ranges are already assigned and there is nothing to
   subtract — so landing there would open on the one screen with nothing to work out and no answer
   to show. Step 3 is the first with a board, a count and a reveal. It is also where `help/tour.ts`
   points its two analyzer stops, whose cards are built from `stepDef(3)`'s own title, question and
   hint: **opening anywhere else silently makes both tour cards describe a step the reader is not
   looking at.** `tour.test.ts` could not catch that — it checks that a stop's words exist verbatim
   in `STEPS` and that its anchor is a real testid, not that the words match the step on screen — so
   `example.test.ts` now pins the two together. `example-prev` is live from the moment the page
   opens, which is how a reader reaches 1 and 2.

5. **Each swallowed failure becomes a sentence that says what could not be asked and how to ask
   again** (`analyze/problems.ts`). It does not repeat `hands/study.ts`'s classifier:
   `describeApiError` already words an unclassified 5xx as the refusal under load it usually is, and
   the replayer's own copy exists only because its wording names *stepping through a hand*. The five
   sites F.12c listed:
   - `analyze/[id].vue`, the pool at this node → `analyzePoolProblem`, shown by the gate;
   - `analyze/[id].vue`, the facing node → `analyzeFacingProblem`, shown by step 9's gate;
   - `analyze/[id].vue`, **the hand → deleted, not worded.** `ctx.hand` is read by no step
     component; the page fetched a hand, converted it, and handed it to nine components that never
     look at it. It is one request per analysis open against an account's ClickHouse budget, for
     nothing. `hand` is gone from `StepContext` too.
   - `Step1Ranges.vue` → `libraryLookupProblem`, which keeps the existing lead verbatim (it now
     imports `LIBRARY_UNREADABLE`, so the two screens that claim to say the same words finally do)
     and appends the reason and "Press the button again to try once more.";
   - `ranges/[id].vue`'s versions → the `.catch(() => [])` is gone, `useAsyncData`'s error is
     rendered with a **Try again**, and "Reading the history…" separates *loading* from *empty*. An
     emptied history had silently removed every revert button.

6. **A refused pool question is asked again.** The watcher now tracks the step number as well as the
   commit: `committed` stays `true` across steps, so it never fired again and a refusal was
   permanent. An answer already held is not re-asked, and one run at a time is allowed — two commits
   in quick succession would otherwise double the very load that causes the refusal.

7. **A trainer that cannot work out its reveal says so** (`AdvantageTrainer.vue`). Its
   `.catch(() => null)` left "Working out both ranges' equities…" on screen for good. It now carries
   the failure and a **Try again** that re-runs it. The trainer's *gate* already said the answer was
   missing (`train/session.ts`); this says the *comparison* is, which is a different sentence.

8. **Step 4 was not the only step printing its own answer.** Reviewing the lane's own diff found
   two siblings, and an example now puts both in front of a first-time reader: **step 5** mounted
   `BlockerPanel` with hero's combo selected, whose "AhKd kills 86 of villain's 630 calling combos"
   is exactly the graded count on a rainbow board (seen: step 5's reveal for that spot is "86
   combos"); **step 8** printed "You are playing 1.00 bluffs per value combo" the moment both halves
   were marked, which is exactly what its gate grades. Both are now handed their input only once
   the prediction is in — step 5 by passing `selectedCombo` as `null` until then, step 8 by gating
   its own sentence, the way step 3 already gated its comparison. `gates.test.ts` states the rule
   once for the two of them rather than leaving it implicit in a test about something else.

9. **An analysis with no situation had the forever-gate all of its own.** With `node_key === null`
   no pool request is made, so no `catch` can fire and no answer can arrive: `poolMissing` stayed
   empty and all four gates waited on "Working out…" indefinitely — the exact bug this round set out
   to end, surviving on the analyzer itself. It is reachable: the API refuses a `manual` analysis
   without a situation but accepts a **`pasted`** one, which is what `/hands/paste` creates. The
   page now answers `NO_SITUATION` for both pool fields when there is no node, and step 9 no longer
   says "Nobody is facing a bet at this node" when there is no node to face one at.

10. **`/dev/components` is the whole of `@poker/ui`, and a test says so.** It mounted 28 of the
   package's 36; `DistributionNode`, `HandActionLog`, `PositionPicker`, `ActionLine`, `NumberInput`,
   `TermLabel`, `NodeLabel` and `VocabularyTable` had README examples and no slot (spec §12 asks for
   every one with fixtures; ADR-024 reviews components on this page). All eight are mounted with
   real fixtures — the distribution tree is built from the page's own two ranges, the action log
   from the replay fixture, and the vocabulary tables are generated from `VOCABULARY` itself, so a
   new table appears without an edit. `pages/dev/components.test.ts` reads `poker-ui/src/index.ts`
   and fails when an exported component has no mount, the same shape as `shortcuts.test.ts`.
   **Checked by mutation:** removing one mount turns it red, naming the component. It is a static
   check on the source and says so: it proves every exported component has a tag and an import on
   the page, not that the tag renders (two sections are behind a `v-if` on the equity result, as
   they must be). That they all draw is what opening the page shows, and it was opened.

**How this lane was reviewed.** Five adversarial lenses over its own diff, each finding then given
to two skeptics told to refute it. **It is honest to say the review mostly did not run:** 14 of its
15 agents died on the session's rate limit, including every skeptic, so the workflow reported five
findings as "refuted" when in truth none had been checked. The one lens that finished was the one
asking whether a step still prints its own answer, and **three of its five findings were real** —
the equity bands (decision 3), steps 5 and 8 (decision 8) and the no-situation gate (decision 9);
all three were then confirmed by hand and in a browser rather than taken on the agent's word. Of
the other two, one was the gallery test claiming more than it checks (its name and doc now say what
it does) and one was a duplicate of the bands. The lesson is the one already in this repo's notes:
a five-lens adversarial pass does not fit in one session, and a review whose verifiers all failed
must be read as *unverified*, never as *refuted*.

**Also found, and fixed because it is the same defect in this lane's own files.** `/train`'s two
`.catch(() => [])`s on the training store made a store that cannot be read (a private window,
blocked site data) read as *nothing practised yet* — "Not started", "0 owed" — for a reader with a
record. It now says the counts are missing rather than zero, and the per-mode line reads "not known"
only when the scores themselves were not read (what is owed can fail on its own), with
`pages/train/index.test.ts` covering all three cases.

**Found and not taken.** `train/session.ts` puts a browser-local exception in the gate verbatim
("DataCloneError: the equity worker could not be reached") through `describeApiError`'s non-fetch
branch. It is pre-existing, it is not one of the five, and wording it well needs a decision about
what a *local* failure should say that this lane did not have to make.

**Verification.** `nuxt typecheck` clean · `eslint .` clean · licences unchanged · Vitest **1,599
passing**; the only failures in the combined tree are lane C's `stats/vocabulary.test.ts` ×2, which
are their own round-7 task (the `EV bb/100` → `All-in adjusted bb/100` rename). `make
privacy-check` green against the real pool's keys.

A browser pass of its own — app :3082, API :8882, a scratch Postgres `poker_laneb` created,
migrated and **dropped**, the real ClickHouse read only — covered, in order:

| What | Seen |
|---|---|
| An example, **signed out, API stopped** | opens on "3. Bucket both ranges on the board" with *previous* live; rail `stepper-1…9`; "0 of 9" → "9 of 9 predictions committed"; steps 1, 2, 6, 9 each printed the no-pool sentence, none waiting; 3, 5, 7 graded; 0 requests to `:8882` (the only one any run made was the app-wide session refresh, which every page makes); `indexedDB.databases()` empty |
| Step 4 before the commit | equities 51.4 / 48.6 and the range-advantage sentence on screen; `compare-nut-split`, `compare-nut-threshold`, `compare-nut-explain` absent; **no equity band on the page and the string "weighted combos" nowhere in its HTML**; the cutoff control still enabled |
| Step 4 after the commit | split "BTN 54%, BB 46%", five bands with "80–100%" at the top, "You said 55%, it is 53.6% — close enough", definition locked |
| Step 5 before / after | no `hand-removal` line; then "AhKd kills 86 of villain's 630 calling combos…" — 86 being exactly what its gate grades |
| Step 8 before / after | both halves painted and no ratio on screen; then "You are playing 1.00 bluffs per value combo… — you are bluffing more often than the size supports", with the verdict |
| An analysis with **no situation** (a saved `pasted` one) | steps 1, 2, 6 and 9 all read "This analysis has no situation yet, so there is nothing to ask the pool about — set one on the hand it came from."; none waiting; **0 requests to `/v1/pool/`** |
| The pool refused (CDP-injected sanitized 500) | step 1: "What the field does in this situation could not be asked. The API could not answer this — often because several questions were asked at once… Moving to another step asks again."; step 9 the same for the fold frequency; neither waiting |
| The retry | the sentence changed on the next step change, then a clean reload answered from the real pool: step 1 58.6%, step 9 46.8% with "Theory folds 39.8%; your pool folds 7.0 points more — bluff here more often." |
| The range library refused (500 + IndexedDB blocked) | "Your range library could not be read — neither the API nor this browser's offline copy answered. DatabaseClosedError: SecurityError site data is blocked in this browser. Press the button again to try once more." |
| The version history refused | "The earlier versions of this range could not be read, so there is nothing here to revert to — this range's own body is the one above, unaffected. …" + **Try again**, which recovered the real v2/v1 list and its revert button |
| The equity worker refused | "Both ranges' equities could not be worked out, so there is no comparison to show. DataCloneError: the equity worker could not be reached." + **Try again**, instead of "Working out…" |
| `/train` store blocked | "Your practice record could not be read from this browser, so the counts below are missing rather than zero. …"; the per-mode line "not known" |
| `/dev/components` | all 36 render; the eight new sections screenshotted with real data |

**Consequences and follow-ups.**

- **Merge:** `RangeComparisonPanel` is this lane's only file outside its paths. One added prop,
  defaulted, plus a `<template v-else>` around three existing elements.
- `hands/study.ts` and `analyze/problems.ts` are two homes for one idea (what a failed call means,
  in words, per screen). Neither duplicates the classifier, but a third would be one too many —
  ADR-057's own follow-up about one wording module now covers three files.
- `train/session.ts` shows a browser-local exception verbatim in the gate
  ("DataCloneError: …") through `describeApiError`'s non-fetch branch. Pre-existing and left.
- ADR-050 follow-ups 3 ("Try an example" in the empty states), 4 (`apps/web/README.md`'s route
  table has no `/examples` row), 5 (a fourth example needs a chart the set does not have) and 6
  (`VocabularyTable` has no home outside `/dev/components` — it now has one there) are untouched:
  they belong to pages this lane does not own.
- The nut-split hiding is step 4's only. Step 3's two distribution panels still let a careful reader
  read off villain's top-pair-or-better share before answering; that is the same trade as decision 3
  and was not this lane's to settle.

---

## ADR-062 — A player is found by the name a person types, not by the key the pipeline stores; and the registry says what it means to a reader, with the porting record kept out of their way

**Status:** accepted · 2026-09-21 · round 7, lane C · **Constrained by** ADR-021 (the registry is the one
vocabulary), ADR-026 (hero and pool are separate modules), ADR-053 (a number typed and a number sent agree),
ADR-057 (registry words reach the screen through one component), ADR-058 (a real screen name is personal data).

**Context.** Two findings of F.13, which had to document them instead of fixing them.

1. **`GET /v1/pool/players` could not find anybody.** It compiled to `startsWith(player_key, …)`, and a
   `player_key` is namespaced: `core.ids.player_key` builds `f"{site}:{screen_name.strip().lower()}"`. Every
   one of the pool's 94,276 keys therefore begins `ggpoker:`, and no screen name begins any key. Measured
   again here, on the real pool: the busiest opponent's own full name, used as a key prefix, returns **0
   rows**. The route answered "no such player" to every real opponent the founder typed — an assertion of
   absence that was never true, §17's failure in its least obvious disguise. `/pool/players` worked around
   it from the client, through the ordinary report path with a `like '%…%'` on `player_key`, and wrote the
   measurement into `pool/stats.ts` as a comment.
2. **The registry was written for whoever ported it.** 42 of the 65 stats carried a `notes` string, and
   almost all of it is v1-parity arithmetic — "v1 counted a seat's first decision only (+0.6%
   opportunities…)". ADR-057 put `notes` on `DefinitionPanel`'s "Caveat" line, where a reader who has never
   heard of v1 meets it. Enum dimensions declared 171 values and named none of them, so the client rewrote
   `5bet_plus` → `5bet+` and `''` → "not applicable" by hand — and `''` means six different things across
   the ten dimensions that declare it, while the `_plus` rewrite once turned a pool player called `a_plus_b`
   into `a+b`. `ev_bb_per_100` was labelled "EV bb/100", colliding with the glossary's solver EV, which
   ADR-057 §5 had to work around on every hero surface. `facing`'s description read "(see the header of
   this file)" — a file no reader is served.

**Decisions.**

1. **A lookup matches the name half of the key, and the site is optional.** `POST /v1/pool/players`
   takes part of a screen name, or a whole key pasted back out of an answer (`<site>:<part of a name>`).
   With no site the pattern is `%:%<fragment>%` — a separator, then anything, then the fragment; every key
   holds a separator and the site half lies to the left of it, so typing the site's own name finds
   **nobody** rather than everybody. **A colon separates only when what precedes it is a site this product
   parses** (`core.enums.Site`): people paste "Villain: someone", and a screen name may hold a colon of its
   own, and reading every left half as a site would turn those into searches for a site that does not
   exist — 0 rows, 200 OK, the same false absence one layer up. `%`, `_` and `\` typed by a person are
   escaped, so a wildcard is a character (verified on the real pool: `<name>%` matches 0 where `<name>`
   matches 859). The text is lower-cased because the pipeline stores keys lowered and `LIKE` is
   case-sensitive; were that to change, the search would stop matching rather than match the wrong player.
   **It is a POST, as the pool's other reads are**, and for a reason this lane had to take seriously: a screen
   name is personal data (ADR-058) and a query string is written into every access log the request passes
   through — `make api` runs uvicorn with its access log on. The old route's `?prefix=` was the same shape
   but inert, because it matched nothing; making it work is what would have made it leak.
2. **Three characters, measured, not guessed.** Over the pool's 94,276 distinct keys the worst
   three-character fragment is inside **2,259** names; the worst two-character one inside **11,829** and the
   worst single character inside **50,726**. The engine's `MAX_LIMIT` is 10,000, so at three characters
   every match is seen — which makes `matched` a count and the ranking a ranking of all of them — and at two
   it would not be. The minimum costs nobody a player: **the shortest screen name in the pool is four
   characters**. It is checked on the *name half*, so `gg:ab` is refused too, and the refusal is a 400 with
   a sentence, not a 422 quoting a pattern.
3. **What happens to a name that is a substring of many: the exact name first, then the busiest.** The sort
   key is `(name != typed, -hands, name)`. The player meant is either the one whose name was typed in full
   or one there are hands on — never the alphabetically first of two thousand, which is what a bare
   `ORDER BY player_key` and a cap would have shown. Verified on the real pool: a name with **269** hands
   ranks above a name containing it with **56,761**.
4. **The answer says how many matched, and whether that is a count.** The response is `PlayerMatches`, a
   `ReportResult` with `matched` (how many players the name matched in all; `rows` holds the busiest
   `limit` ≤ 200 of them) and `matched_capped` (true when more matched than the search counts, making
   `matched` a floor). `hands` stays the total over *everyone* who matched, so a shortened list never reads
   as the whole of it. `matched_capped` is unreachable at three characters on today's corpus; it exists so
   that stays checkable as the corpus grows, because this whole ADR is about a route that lied about
   absence.
5. **The lookup is not cached, alone among the reports here.** What makes the ranking exact is that the
   query is as wide as the match set, and a three-character search on the real pool measures 1,966 rows
   and **1.6 MiB of JSON** (2,259 rows ≈ 1.9 MiB at the worst fragment). Storing that under one typed
   string, to save 580 ms on retyping it, would push out of an LRU cache the report blocks a screen really
   does read twice. `players()` therefore takes no `cache` and the route passes none.
6. **`notes` is the reader's caveat; `v1_parity` is the porting record and no screen renders it.** All 42
   `notes` were rewritten for whoever is reading the number — what it counts, and what it deliberately
   leaves out — and a test fails if one mentions v1 again. The v1 arithmetic moved to a new `v1_parity`
   field with **every measured figure preserved exactly**; nothing was rounded, invented or dropped. The
   field is not decoration: `scripts/fingerprint.py` treats a stat that says how it departs from v1 as
   allowed to disagree with v1's fingerprint, and that predicate now reads `v1_parity` rather than `notes`,
   which is what it always meant. **The change is behaviour-neutral today and correct tomorrow**: of the 54
   stats shared with v1, the same **41** are excused either way (checked), but a stat given a reader caveat
   with no v1 departure would have been excused by the old predicate and is not by the new one. The seed
   `stat_definitions.csv` keeps `notes` — now reader text, which is what a definitions table should hold —
   and does not carry `v1_parity`. The field is `exclude=True`, so it reaches no serialization either:
   `GET /v1/definitions` would otherwise ship the founder's own hero volumes ("2.4% of 5,019") to every
   browser that asks the registry for its labels.
7. **Every enum value is named where it is declared, completely.** `Dimension.value_labels` is a map from
   value to the word a reader sees, and the loader **refuses a registry** where an enum declares a value it
   does not label, or labels one it does not declare. Complete on purpose: a client that had to fall back
   would have to guess, and guessing is what put the `_plus` rewrite and one shared word for ten different
   blanks into the client. 171 labels over 19 enums. The **value is unchanged** — what is sent stays the
   registry's code (ADR-053) — and `''` now says "No flop", "Before the turn", "Nobody raised", "No bet or
   raise yet", "Not shown" or "Preflop or not shown", each in its own dimension.
8. **One name per number, and a description a reader can act on.** `ev_bb_per_100` is labelled **"All-in
   adjusted bb/100"**: "EV" in this product already means a solver's expected value for a line, and one
   name per number is cheaper than an app-side workaround on every surface. Seventeen descriptions that
   pointed at what a reader cannot see were rewritten to stand alone — `facing` and the four action-line
   dimensions now carry their own vocabulary instead of the file's header, `flop_pairing` stops omitting one
   of its three values, `flop_connectedness` says which span is which, and `player_key` stops claiming to
   be "the screen name as the site shows it", which is the same wrong belief the broken route was built on.

**Alternatives.** *Prefix on the name half* — simpler and index-friendlier, but the page already promises
"any part of a name" and a poker screen name is as often remembered by its middle as its start. *Ordering by
hands in SQL* — the right answer, and it needs an `order_by` on `ReportRequest`, which is `stats/`, outside
this lane; at three characters the whole match set is in hand anyway, so sorting in Python is exact rather
than approximate. *Rewriting `notes` in place and dropping the v1 text* — it would have silently flipped
every one of those 42 stats from "expected mismatch" to "regression" in the parity report. *Labels only
where a value is awkward* — leaves the client a fallback, which is the bug.

**Consequences.** The client's `like` workaround and its `valueWords` rewrites are now unnecessary; the
web lane's changes are listed in §D. `api/routers/pool.py` is at **299 lines**, one under its ceiling: the
next line added there should come with the node routes moving to their own router, which is a split the
client already draws (`pool/api.ts` vs `pool/stats.ts`). A registry entry that adds an enum value now fails
to load until it is given a word, which is the point.

---

## ADR-063 — The reading threshold is the one control on a report screen that folds

**Status:** accepted · **Date:** 2026-09-21 · **Plan step:** F.12 (close-out)

**Context.** §13's progressive-disclosure line names four advanced controls — nut threshold, MC
iteration count, rake config, bucket boundaries — all of them Range Lab controls. On `/reports`,
`/pool` and `/hands/[id]` the line had never been answered, and it was not obvious what it even
asked for: `/reports` runs six stacked blocks before the grid, but five of them are the screen's
advertised job ("Any stat, for any situation, grouped any way", `help/tools/myGame.ts`).

**Decision.** Fold the control that **re-reads the answer** rather than **re-asking the question**,
and only that one. The reading threshold (`minn-select`) is the single control on either screen
that qualifies, provably:

- it never reaches the server — `reports/model.ts#request` sends `stats`, `group_by`, the situation
  and `compare_to`, and no `min_n`; the threshold is applied in the browser by `cell.ts#cellView`;
- its default works untouched (`MIN_N` = 100, the same hundred the leak finder and the pool's node
  query use);
- the catalogue already classifies it as post-run — step 4 of 5 on `/pool` is "Run it, **then**
  raise the reading threshold" (`help/tools/pool.ts`).

The compare toggle beside it on `/reports` stays visible: it sets `compare_to`, so it changes the
question. The stat picker and the group-by stay visible: folding the control that delivers the
screen's one job is hiding the job, not disclosing it progressively.

The threshold in use is printed on the `<summary>` — "Advanced: cells under 100 observations are
dimmed" — so the fold can stay closed without hiding what it is doing. That is the rule
`PotOddsPanel` already follows for the rake it folds.

**And the fold is made safe in one place, not per fold.** A closed `<details>` keeps its children in
the DOM, so ControlHelp's scan still attaches the tip and PageHelp still lists the control — and
"point at this control" would then ring a control nobody can see. Measured in Chrome 141 on this
very control: closed, the `<select>` reports `checkVisibility() === false` and a laid-out 220×29
box **380 px below** where it appears once the fold is open, because a closed `<details>` hides its
content with `content-visibility` rather than `display: none`. So `ControlHelp.highlightControl`
now opens every `<details>` ancestor before measuring. Fixed there rather than in each fold so that
adding a fold anywhere cannot quietly break ADR-059's promise that every control can be pointed at.

**Consequences.** `/pool` stops keeping a second copy of the control — it rendered its own bare
`<label>` under no heading at all, which is how the two screens drifted into two spellings of one
thing. The `min-n` help entry follows the control to its new file and loses a name no screen ever
rendered: it was "Hide comparisons under", describing a difference from the field that a pool
report never draws (there is no hero seat, so `reports/model.ts` leaves `compare_to` off it).

**`/hands/[id]` was deliberately not folded**, and it is already met on the spec's own terms: of
§13's four advanced controls, rake config is folded there already (`PotOddsPanel`) and now reaches
`MDFPanel` through the shared ref, the nut threshold belongs to `RangeComparisonPanel`, which that
screen does not mount, and the MC iteration count and the bucket boundaries are props no caller on
it sets. What was *not* met there was §2.1's other bullet — controls that render editable and do
nothing — and folding the panel would have hidden that rather than fixed it: `ComboDistributionPanel`
was mounted with a literal `:group-by` and neither listener, so its four axis checkboxes emitted into
nothing and Export CSV did nothing at all. That is what was fixed instead.
