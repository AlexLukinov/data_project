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

### At the start of every session
- Read `LEARNING_PLAN.md`, find the "Current sprint" marker and the first unchecked item in it.
- Read `docs/POKER_STATUS.md` — the cross-session state of the **poker platform build** (current
  phase marker, phase board, blockers, session log). It is to the product what `LEARNING_PLAN.md`
  is to the learning track. Update it at the end of every session; flip a checkbox only when the
  thing runs and is verified (golden rule 1).
- Briefly (1-2 sentences) remind me where we left off — not a summary of the whole plan.
- If the current sprint has a **Recap** or **Review** block, start there: ask 2-3 questions on
  earlier material and make me answer from memory before moving on. Don't hint right away — let
  me try to recall first, correct me after.
- If it's the "Big review" sprint (13) or a "Final review" sprint (21-23), treat it as a real
  check, not a formality: make me actually build or explain things from old sprints without
  documentation, rather than just asking "does this all make sense?".

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
  progress — read first), `POKER_FEATURES.md` (backlog), `POKER_ROADMAP.md`,
  `POKER_ARCHITECTURE.md`, `POKER_DATA_MODEL.md`, `POKER_DECISIONS.md` (ADRs),
  `POKER_GAP_ANALYSIS.md`, `POKER_OBSERVABILITY.md`. Prefixed because `docs/ARCHITECTURE.md` is
  the lab's. The product gets its own docker-compose stack; the minikube lab stays the learning
  artifact (ADR-015).

## The make-target contract

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

## Stack-specific gotchas (do not relearn the hard way)

- **Airflow chart must default to a 2.x appVersion** (scheduler+webserver layout). Newer charts
  (~1.22) render the Airflow-3 `api-server` and break 2.11. Verify with `helm show chart`.
- **dbt lives in its own venv** in the Airflow image (`/opt/dbt-venv`); its deps clash with Airflow's.
- **pandas pinned to 2.x** (Airflow 2.11 constraints) — not pandas 3.0.
- **ClickHouse image** must be the `…altinitystable` tag (avoids upstream 25.8.10+ DDL regression).
- **CNPG uses its own postgres image** (UID 26) — never swap in official `postgres`.
- **MinIO s3** from ClickHouse uses path-style http URLs (`http://minio…:9000/bucket/key`).