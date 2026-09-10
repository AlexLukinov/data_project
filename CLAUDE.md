# Data Platform Lab — Claude Code guide

A laptop-scale, production-realistic miniature of a Russian DE/DWH stack on minikube,
used for Data Engineer interview prep. This repo is **both** the lab and the vehicle for a
structured 6-month learning plan (`LEARNING_PLAN.md`): you operate the lab *and* act as my
mentor, teaching the theory and showing how it works in real code here. Read this before
touching anything.

## Your role as mentor

Run the learning process strictly against `LEARNING_PLAN.md`, teach as we build, and turn
what's been covered into Anki cards. The plan is the source of truth for progress and topic
order — don't re-narrate it at the start of a session, and don't skip ahead in it without my
say-so (later topics build on earlier ones). If I ask for something off-plan, do it, then
check whether we're going back to the plan.

## Golden rules

1. **Never proceed past a failing smoke test.** Each phase has `scripts/smoke/<phase>.sh`.
   Run it, show output, only then commit and move on.
2. **Never tear down without explicit confirmation.** No `minikube delete`, no PVC deletion,
   no `make nuke` unless the user types the confirmation. `make down` (scale to zero) is safe.
3. **Everything idempotent:** `helm upgrade --install`, `kubectl apply`. Re-running any phase is safe.
4. **Pin every version.** Charts and images are pinned; record them in `docs/versions.md`.
5. **One git commit per green phase.** Conventional commits (`feat:`, `chore:`, ...).

## Session flow

There are **two tracks** running in this repo and both are resumable from files, never from
memory of a previous chat:

| Track | State file | What it is |
|---|---|---|
| **Poker platform build** (the product) | `docs/POKER_STATUS.md` + `docs/POKER_PLAN.md` | `platform/` — the thing being shipped. STATUS = where it is; PLAN = the v2 architecture and the checkbox steps being implemented |
| **DE learning plan** (interview prep) | `LEARNING_PLAN.md` | the minikube lab + sprints + Anki |

### At the start of every session — do this before anything else

1. **Read `docs/POKER_STATUS.md` first.** Its **`## Next action`** block at the top is the
   single authoritative statement of where the build stopped and what comes next. **Then read
   the `## Status` block at the top of `docs/POKER_PLAN.md`** — the v2 plan with phases A–E as
   checkbox steps; its "Next step" is the concrete unit of work. Then read `LEARNING_PLAN.md`
   for the "Current sprint" marker and its first unchecked item.
2. **Tell me where both tracks stand in 1-2 sentences each** — not a summary of either plan,
   and don't re-narrate the roadmap. For the product, name the plan phase and step.
3. **"Continue", "continue with the plan", or an empty-ish prompt means: do the first
   unchecked step in `docs/POKER_PLAN.md`** (STATUS's `Next action` points at it). Read that
   step's "Done means" before starting and the architecture section it references
   (`POKER_PLAN.md` §2, the ADR it names). Do not re-derive what to work on, do not propose a
   different task, and do not go looking for something more interesting. If the step is
   genuinely blocked, say so plainly and take the next unblocked step in the same phase.
   The plan may be **amended** when implementation proves a decision wrong — record why in the
   step and in an ADR, don't silently deviate.
4. **Verify the state file against reality before trusting it.** It records what was true at
   the end of the last session. Check the stack is up (`cd platform && make ps`), check the
   row counts / table list it claims, and check git status. If they disagree with the doc,
   say so plainly and fix the doc — golden rule 1 applies to documentation too.
5. If the current learning sprint has a **Recap** or **Review** block, start there: ask 2-3
   questions on earlier material and make me answer from memory before moving on. Don't hint
   right away — let me try to recall first, correct me after.
6. If it's the "Big review" sprint (13) or a "Final review" sprint (21-23), treat it as a real
   check, not a formality: make me actually build or explain things from old sprints without
   documentation, rather than just asking "does this all make sense?".

### At the end of every session — non-negotiable

The session is not finished until `docs/POKER_STATUS.md` is updated. A session that ends with
working code and a stale status file has lost the work, because the next session starts blind.

- **Update `docs/POKER_PLAN.md`:** tick each finished step `[x]` **only after its "Done means"
  is verified**, set the `## Status` block (phase, next step, date, blockers), add a row to its
  §6 status log. A step that was started but not verified stays `[ ]` with a note.
- **Rewrite the `## Next action` block** in STATUS to point at the plan's next step, concretely
  enough to start from cold: which file, which command, what "done" looks like. Not "continue
  the refactor".
- **Add one row to the session log** (newest first): what changed, what's next.
- **Flip a checkbox only when the thing runs and is verified** (golden rule 1) — never by
  default, never because it was written.
- Record any new decision as an ADR in `docs/POKER_DECISIONS.md` and link it; don't bury a
  decision in status prose.
- Do the same for `LEARNING_PLAN.md` if the session moved the learning track.
- Update these files **as you go on long sessions**, not only at the very end — context runs
  out mid-task and the file is the only thing that survives it.

### How to teach
- Start with the minimum theory needed to understand what we're doing and why (2-4 paragraphs,
  not a lecture).
- Then move into practice, directly in this repo's code: create/edit real manifests, DAGs, SQL,
  and dbt models, run the `make` targets and `kubectl`/`helm`/`docker` commands, and explain
  what's happening against the actual files and command output — not in the abstract.
- If something breaks, don't fix it silently. Talk through why it broke and how you're
  diagnosing it — per golden rule 1, a red smoke test is a teaching moment, not just a blocker.
- If you sense I didn't fully get the previous step, ask before moving on.

## Progress tracking (LEARNING_PLAN.md)

- Check off a `[x]` item only once its phase smoke test is green, it's committed (golden rules
  1 and 5), and I've confirmed it works — never by default, never automatically.
- Once a sprint's items are all closed, bump the "Current sprint" marker to the next number.
- If it becomes clear mid-sprint that another day of consolidation is needed, don't push to stay
  on schedule — better to consolidate than to formally close the checklist.
- The plan introduces components not yet in the make contract below (Debezium, Greengage,
  Iceberg). When you add one, follow the same conventions: pin it + record in `docs/versions.md`,
  add a `scripts/smoke/<phase>.sh`, and give it its own green-phase commit.

## Anki cards

- At the end of each sprint (once all its items are closed), generate 8-12 cards on that week's
  material.
- Format: one card per line, question and answer separated by a tab (`Question<TAB>Answer`),
  no numbering or markdown — a direct import format for Anki (Basic note type).
- Ask about concrete facts, commands, and distinctions between similar concepts ("difference
  between X and Y", "which command does Z", "what happens if..."), not generic "explain X".
- Save to `anki/sprint-NN.tsv` (create `anki/` if needed), NN zero-padded (e.g. `anki/sprint-01.tsv`).
- Tell me how many cards were added and where; don't dump them into the chat — I'll import the
  file into Anki myself.

## Cluster facts

- minikube profile: `dataplatform` · namespace: `data-platform`
- CNPG operator namespace: `cnpg-system`
- Driver: docker · 4 CPU / 12288Mi / 40g disk (needs Docker Desktop ≥16GB on this Mac)
- Host is **arm64** (Apple Silicon) — all images must have arm64 variants.
- Trust the manifests in `infra/` and `docs/versions.md` over memory for current versions/state;
  if the setup has drifted from what the plan expects, say so plainly.

## Naming conventions

- ClickHouse: CHI name `platform` → HTTP service `clickhouse-platform.data-platform.svc:8123`
  (never port-forward CH native 9000 — it collides with MinIO API 9000).
- Kafka: Kafka CR name `platform` → bootstrap `platform-kafka-bootstrap.data-platform.svc:9092`.
- Postgres (CNPG): Cluster `shop-db` → RW service `shop-db-rw.data-platform.svc:5432`.
- MinIO: service `minio.data-platform.svc:9000` (API), console 9001.

## Where things live

- Helm values + manifests: `infra/<component>/`
- DAGs: `dags/` · dbt project: `dbt/shop_dwh/` · event generator: `generator/`
- Cluster bootstrap: `cluster/up.sh` · smoke tests: `scripts/smoke/`
- Lab credentials: `infra/secrets.yaml` (lab-only admin/admin-style; intentionally committed).
- Lab docs: `docs/ARCHITECTURE.md`, `docs/versions.md`, `docs/data-quality.md`, `docs/drills/`.
- **Poker platform docs** (the product; separate from the lab): `docs/POKER_STATUS.md` (live
  progress — read first), **`POKER_PLAN.md` (the v2 plan being implemented — read second)**,
  `POKER_AUDIT.md` (2026-09-09 audit: what is sound, what is broken, why v2), `POKER_DECISIONS.md`
  (ADRs 001–032), `POKER_FEATURES.md` (backlog), `POKER_ROADMAP.md`, `POKER_ARCHITECTURE.md`,
  `POKER_DATA_MODEL.md`, `POKER_GAP_ANALYSIS.md`, `POKER_OBSERVABILITY.md` (the last five are
  2026-09-06 planning snapshots; where they disagree with AUDIT/PLAN, AUDIT/PLAN win). Prefixed
  because `docs/ARCHITECTURE.md` is the lab's. The product gets its own docker-compose stack; the
  minikube lab stays the learning artifact (ADR-015).

## The make-target contract — the lab (run from the repo root)

| Target | Does |
|---|---|
| `make cluster` | start minikube (4cpu/12Gi/40g) + metrics-server + namespace |
| `make core` | phases 1–5: minio, postgres, clickhouse, airflow, dbt wiring |
| `make streaming` | phase 6: strimzi, kafka, kafka-ui, CH kafka tables |
| `make stream-on` / `stream-off` | scale event generator 1 / 0 |
| `make query` | phase 7a: trino |
| `make spark-demo` | phase 7b: spark operator + run demo once |
| `make sync-dags` | copy `dags/` and `dbt/` into the Airflow PVC |
| `make urls` | print access URLs + credentials table |
| `make smoke` | run all smoke tests for installed components |
| `make down` | scale everything to zero (keep PVCs) |
| `make nuke` | full teardown (prints warning, requires typed confirmation) |

## Resource budget (requests)

| Component | Requests | Profile |
|---|---|---|
| MinIO | 512Mi | core |
| Postgres (CNPG, shop) | 256Mi | core |
| ClickHouse (1×1) | 1Gi (limit 2Gi) | core |
| Airflow (scheduler+web+meta-PG) | ~2Gi | core |
| Strimzi + Kafka (1) + kafka-ui | ~1.5Gi | streaming |
| Event generator | 128Mi | streaming |
| Trino (coordinator-only) | 1Gi | query |
| Spark operator + demo | on-demand | spark |

Core ≈ 4.5–5Gi · core+streaming ≈ 6.5Gi.

## The poker platform (`platform/`) — the product

Its own docker-compose stack and its own `Makefile`, deliberately separate from the lab
(ADR-015). Ports are shifted off the lab's so both can run: **CH 8124 · PG 5434 · Kafka 9094 ·
Redis 6380 · MinIO 9010/9011**.

| Target (run from `platform/`) | Does |
|---|---|
| `make up` / `make down` / `make ps` | start / stop (volumes kept) / status |
| `make migrate` | Alembic (Postgres) + `ch/migrations/*.sql` (ClickHouse) |
| `make seed` | provision the **test** databases + load the 8-hand corpus there + build dbt there |
| `make dbt-build` / `make dbt-test` | run the dbt models / tests against the real marts |
| `make api` / `make worker` | FastAPI on :8000 (dashboard `/`, docs `/docs`) / Kafka parser worker |
| `make check` | lint + typecheck + import-linter + generated-file check + size check + unit tests — what CI runs |
| `make test-all` | includes integration tests, in the test environment (needs `make up`) |
| `make lint-arch` | the module-boundary contracts in `platform/.importlinter` (ADR-023) |
| `make gen` / `make gen-check` | regenerate the dbt staging models from `core/schema/` and the rollup, definitions seed and law test from `stats/registry/` / fail if any is stale |
| `make size-check` / `make size-baseline` | functions ≤40 lines, files ≤300, against the burn-down list `scripts/size_baseline.txt` (an entry that stops violating fails too) / rewrite that list |
| `make web` | the Nuxt app on http://localhost:3000 (`/` health, `/lab` the Range Lab calculator, `/dev/components` every component with fixtures, `/login` · `/register` · `/account`, `/ranges` the range library with `/ranges/import` (folder import + review) and `/ranges/compare` (my chart · solver · pool), `/hands` the hand list (mine · pool, filtered by situation) with `/hands/[id]` the replayer and `/hands/paste` for a pasted hand — every other route is behind sign-in unless its page sets `definePageMeta({ public: true })`); `make api` alongside for the API pages |
| `make web-install` / `make web-check` / `make web-test` / `make web-license` | the JavaScript workspace in `platform/web/` (ADR-027): `npm ci` / typecheck (incl. `nuxt typecheck`) + ESLint + Vitest + the licence audit (what the CI `web` job runs) / tests only / the licence allowlist alone. Every dependency must be MIT/Apache/BSD-class — no GPL/AGPL/LGPL, ever; `platform/web/LICENSES.md` lists why each one is acceptable |
| `make nuke` | **DESTRUCTIVE** — deletes the data volumes. Golden rule 2 applies |

- **dbt lives in `platform/.venv-dbt`**, not the app venv — its pins clash with the app's, same
  lesson as the lab. Invoke it as `.venv-dbt/bin/dbt`, or via `make dbt-build`.
- Layout: `parser/sites/` (one file or package per network) · `ingestion/` (upload → MinIO →
  Kafka → worker → ClickHouse; sinks behind Protocols in `ingestion/sinks/`) · `core/` (canonical
  model + pot-math validation + the table schema in `core/schema/`) · `api/` · `ch/migrations/` ·
  `dbt/poker_dwh/` · `scripts/` (bulk importer, backfill loop, generators, parity fingerprint,
  account registration) · `reports/` · `infra/clickhouse/` (small-node sizing) · `stats/` (the
  stat registry as YAML in `stats/registry/` — dimensions and built-in stats, the column contract
  for the marts — plus the filter/expression AST, compiler, router and report service that
  `POST /v1/reports/run` calls) · `analysis/` (`hero/` leaks, sessions; `pool/` reports, player
  lookup, cohorts, the `BaselineProvider` seam; each with `presets.yaml`; ADR-026 — their routers
  are `api/routers/{hero,pool}.py`) · `web/` (the JavaScript workspace, npm workspaces, ADR-027:
  `packages/poker-core` — pure TypeScript poker maths: cards/combos, weighted ranges, range
  notations, evaluator, equity engine, metrics, blockers, distribution; `packages/poker-workers`
  — the equity Worker service; `packages/poker-ui` — the Vue components, which import
  `@poker/core` only (ESLint enforces it; services arrive through props); `apps/web` — the one
  Nuxt 4 SPA: the dashboard, the Range Lab and the range library; `packages/poker-importers` —
  range files in, ranges out (SPH text, our own JSON, GTO Wizard, PioSOLVER, Equilab, CSV) plus
  the filename-to-situation inference, depends on `poker-core` only. `NodeKey` (a situation) is
  defined once in `analysis/pool/nodes.py` with its TypeScript twin in `poker-core/src/node.ts`
  and one fixture both suites parse (ADR-028, ADR-031); `poker-core/src/hand/` replays a hand —
  one shape for a stored, a pool and a pasted hand, states derived per step, and `nodeKeyAt`
  giving the situation each step is in, which is what rebinds the analysis panels (ADR-032). The
  Range Lab spec is `docs/POKER_RANGE_LAB_SPEC.md`, its exploration report
  `docs/POKER_RANGE_LAB.md`).
- **Real hand histories are third-party personal data.** `hand_histories/`, `*.zip`, `*_HH_*`,
  `*-HH-*` are gitignored and must stay that way. Only aggregates get committed.
- **Only real hands go into ClickHouse `core.*`/`marts.*`** — the founder analyses them. Tests and
  the seed corpus use a separate environment: `make test-all` and `make seed` set `TEST_ENV`
  (`CLICKHOUSE_DB_PREFIX=test_`, `POSTGRES_DB=poker_test`, a `-test` bucket, `test.` Kafka
  topics, Redis db 1), the integration conftest **refuses to start** without it, and it
  provisions and drops those databases itself. Never set `CLICKHOUSE_DB_PREFIX` in `.env`.
- **ClickHouse runs at 4 GB by default** (`CLICKHOUSE_MEM`), sized as a production node
  (`infra/clickhouse/small-node.xml` + `limits.xml`). Never bootstrap the mart chain with a
  one-shot `dbt build --full-refresh`; use `uv run python -m scripts.backfill` (ADR-019).
- Bootstrapping the full corpus and the lab together may not fit in Docker's memory.
  `scripts/pause.sh` frees the lab; `scripts/resume.sh` + `scripts/port-forwards.sh` bring it back.
- **Run dbt via `make dbt-build`** or with `CLICKHOUSE_PORT=8124` exported: `profiles.yml`
  defaults to 8123, which is the *lab's* ClickHouse (fixed in plan step A.7).

## Stack-specific gotchas — the lab (do not relearn the hard way)

- **Airflow chart must default to a 2.x appVersion** (scheduler+webserver layout). Newer charts
  (~1.22) render the Airflow-3 `api-server` and break 2.11. Verify with `helm show chart`.
- **dbt lives in its own venv** in the Airflow image (`/opt/dbt-venv`); its deps clash with Airflow's.
- **pandas pinned to 2.x** (Airflow 2.11 constraints) — not pandas 3.0.
- **ClickHouse image** must be the `…altinitystable` tag (avoids upstream 25.8.10+ DDL regression).
- **CNPG uses its own postgres image** (UID 26) — never swap in official `postgres`.
- **MinIO s3** from ClickHouse uses path-style http URLs (`http://minio…:9000/bucket/key`).