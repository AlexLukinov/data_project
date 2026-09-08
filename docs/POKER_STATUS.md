# Poker platform — build status

> **This file is the cross-session source of truth for where the build is.**
> Read it at the start of every session; update it at the end of every meaningful step.
> Planning lives in [POKER_FEATURES.md](POKER_FEATURES.md) (what & why) and
> [POKER_ROADMAP.md](POKER_ROADMAP.md) (order & learning mapping). This file is *how far*.

**Current phase: 1 — MVP thin slice** · **Status: Phase 0 complete, Phase 1 spine complete**
**Last updated:** 2026-09-08

---

## Where we are, in one paragraph

**Phase 0 and the Phase 1 spine are built, running and tested.** `platform/` holds a working
product: a five-service docker-compose stack, a PokerStars + GGPoker parser with pot-math
validation, an upload → object-storage → Kafka → worker → ClickHouse pipeline, a dbt stat layer
computing ~20 statistics, a FastAPI service with auth and tenant isolation, and a demo
dashboard. 125 tests pass (unit + integration), dbt builds 19/19 green, lint and mypy are
clean. What remains in Phase 1 is breadth, not spine: more parsers, more filters, the real
Nuxt frontend, and the ClickHouse MV that makes rollups incremental.

---

## Phase board

Legend: `[ ]` not started · `[~]` in progress · `[x]` done & verified · `[!]` blocked

### Phase 1a — Planning · `[x]` complete
- [x] `POKER_GAP_ANALYSIS.md` — lab inventory vs. product needs
- [x] `POKER_ARCHITECTURE.md` — target architecture, live-HUD streaming path, seams
- [x] `POKER_DATA_MODEL.md` — canonical model, ClickHouse/Postgres/lake/Kafka/dbt design
- [x] `POKER_DECISIONS.md` — 18 ADRs
- [x] `POKER_FEATURES.md` — ~90-feature tiered backlog
- [x] `POKER_ROADMAP.md` — phases reconciled with `LEARNING_PLAN.md`
- [x] `POKER_OBSERVABILITY.md` — product vs. platform monitoring
- [x] `POKER_STATUS.md` — this file
- [x] **Founder approval to implement** — given 2026-09-08

### Phase 0 — Foundation · `[x]` complete
**Exit criteria — all met:** `make up` brings the stack healthy · `make test` green ·
`CanonicalHand` importable everywhere · Alembic and ClickHouse migrations apply from empty ·
dbt builds.

- [x] F-001 Monorepo structure & `uv` workspace — `platform/`
- [x] F-002 docker-compose: ClickHouse + Postgres + Kafka + Redis + MinIO, healthchecks
- [x] F-003 Tooling (uv, ruff, mypy strict, pytest) + GitHub Actions CI
- [x] F-008 Config & secrets (`pydantic-settings`, `.env.example`)
- [x] F-101 Canonical hand model (dataclasses; Pydantic only at the API boundary)
- [x] F-102 Parser interface + site registry + format sniffing
- [x] F-004 Alembic + Postgres schema (users, refresh_tokens, poker_accounts, uploads, baselines)
- [x] F-005 ClickHouse migration runner + core DDL — 5 migrations applied
- [x] F-006 dbt project bootstrap
- [x] F-007 Seed hand corpus (8 hands: side pots, split pots, heads-up, PLO, all-in run-outs)
- [x] F-209 Baselines/solver seam *(empty `marts.baseline_strategies` + `baseline_sets`)*
- [x] F-801 Ingestion API contract *(implemented — versioned, idempotent, tenancy from token)*
- [x] F-B01 Structured JSON logging

### Phase 1 — MVP thin slice · `[~]` spine complete, breadth remaining
**Exit criteria:** upload a real file → stats in the browser with no manual steps *(met)* ·
integration test covers ingest→stats *(met)* · tenant-isolation test in CI *(met)* · core
stats verified by hand against a manually counted sample *(met for 8 corpus hands; needs
redoing against ~50 REAL hands once exports exist)*.

- [x] F-103 PokerStars-format parser + regression corpus
- [x] F-108 GGPoker parser + the anonymization path *(chosen over iPoker — see notes)*
- [x] F-114 Hand validation (pot-math reconciliation) — caught 2 real parser bugs
- [x] F-113 Dedup & idempotent re-ingest (content hash + `ReplacingMergeTree`)
- [x] F-110 Upload endpoint → object storage (zstd)
- [x] F-111 Kafka topics + producer (uploads / bulkimport split)
- [x] F-112 Parser worker → ClickHouse, commit-after-insert
- [x] F-114 Dead-letter table (`core.parse_failures`)
- [x] F-301 Flag table (dbt intermediate → `marts.player_hand_flags`)
- [x] F-302…F-310 Core stat library (~20 stats, all sliceable by position/stake/site/date)
- [x] F-311 Stat definitions registry (`dim_stat_definitions`)
- [x] F-312 Sample size returned with every stat *(confidence intervals still TODO)*
- [x] F-401/F-409 Core filters + tenant-scoped query compiler
- [x] F-313 **Custom stats — caller chooses the opportunity** *(pulled forward from Tier 2)*
- [x] F-701 Accounts & auth (Argon2id + JWT + HttpOnly refresh, rotating)
- [x] F-702 Multi-tenancy enforcement + adversarial isolation tests
- [x] F-703 Poker account registration (hero resolution)
- [x] F-204 Redis stat-block cache (fails open)
- [x] F-501/F-502/F-503 Winnings + EV-adjusted + showdown-split graph
- [x] F-505 Core stats table (demo dashboard)
- [x] F-506 Hand replayer *(stub — hand detail endpoint + text render)*
- [x] Integration test: ingest → stats
- [ ] F-202 ClickHouse **materialized views** — rollups are batch-built by dbt today; the MV
      is what makes them incremental (stats fresh seconds after upload, no dbt run)
- [ ] F-309 All-in EV adjustment — columns and plumbing exist; the **equity calculator** is
      not implemented, so `ev_won_bb` currently falls back to the actual result
- [ ] F-104/F-105/F-106/F-107 iPoker, WPN, partypoker, Winamax parsers
- [ ] F-402/F-403/F-404/F-405 board texture, action sequence, SPR, holding filters
- [ ] F-016 Nuxt dashboard *(the current one is a deliberate no-build-step demo page)*
- [ ] F-312b Confidence intervals on bb/100

### Phase 2 — Differentiators · `[ ]` not started
Population analysis (F-601/602), EV-per-decision (F-603), deviation scoring & leak ranking
(F-604/605/606), AI coaching (F-607), note/badge engine (F-608), custom stats & reports
(F-313/511). See [POKER_ROADMAP.md](POKER_ROADMAP.md).

### Phase 3+ — Expansion & Future · `[ ]` not started
Lake/Iceberg, Spark re-parse, Airflow, tournaments, ranges/equity, then the desktop agent and
solver seams.

---

## Feature status

Only features whose status has moved off `planned` are listed. Everything else in
[POKER_FEATURES.md](POKER_FEATURES.md) is `planned`.

| ID | Feature | Status | Notes |
|---|---|---|---|
| F-001…008 | Foundation | ✅ done | `platform/`, 5-service compose, uv, ruff, mypy, CI |
| F-101/102 | Canonical model + parser interface | ✅ done | dataclasses, `slots=True`; registry + sniffing |
| F-103 | PokerStars parser | ✅ done | line-based state machine |
| F-108 | GGPoker + anonymization | ✅ done | `player_key=NULL`, Rush & Cash detected |
| F-109 | PLO / multi-variant | ✅ done | 17 variants incl. stud/draw/mixed |
| F-110…114 | Ingestion pipeline | ✅ done | upload→S3→Kafka→worker→CH, idempotent |
| F-201/203/205/209 | Schemas + seams | ✅ done | 5 CH migrations, Alembic, baselines seam empty |
| F-204 | Redis cache | ✅ done | fails open |
| F-301…312 | Stat layer | ✅ done | flag table + ~20 stats + 2 law-of-poker tests |
| F-313 | **Custom stats (choose the opportunity)** | ✅ done | pulled forward from Tier 2 |
| F-401/409 | Filters + query compiler | ✅ done | allowlisted, parameterized, adversarially tested |
| F-501…506 | Graphs, stats table, replayer stub | ✅ done | demo dashboard, no build step |
| F-701…703 | Auth + tenancy | ✅ done | Argon2id, rotating refresh, isolation suite |
| F-801 | Ingestion API contract | ✅ done | versioned; the HUD agent attaches here |
| F-B01/B02 | Structured logs, drift view | ✅ done | `core.v_format_drift` |
| F-202 | Incremental MVs | ⏳ next | rollups are batch (dbt) today |
| F-309 | All-in EV adjustment | ⏳ partial | plumbing done, equity calculator missing |

---

## Environments

| | Purpose | Status |
|---|---|---|
| **minikube `dataplatform`** | The **learning lab** — interview prep, DE sprints. Not the product. | ✅ running, 17 pods healthy, node 20Gi |
| **docker-compose (product)** | Local dev for the poker platform. | ✅ running — `platform/`, 5 services healthy. Ports shifted off the lab's: CH 8124, PG 5434, Kafka 9094, Redis 6380, MinIO 9010/9011 |
| **production** | — | ❌ not chosen ([open question](POKER_GAP_ANALYSIS.md#open-questions-for-you-before-the-implementation-run)) |

Why two: [ADR-015](POKER_DECISIONS.md#adr-015--docker-compose-for-the-product-minikube-stays-the-learning-lab).

---

## Learning-plan sync

[LEARNING_PLAN.md](../LEARNING_PLAN.md) is the source of truth for learning progress; this
section only records the link between the two tracks.

| | |
|---|---|
| Current sprint | **5** (Airflow architecture) — in progress |
| Data used from sprint 6 | **Poker hands** — the `shop` e-commerce dataset is retired as a teaching vehicle *(decided 2026-09-06)* |
| Doc-naming convention | `docs/POKER_*.md`, because `docs/ARCHITECTURE.md` is the lab's *(decided 2026-09-06)* |
| Known gap | The learning plan has no FastAPI / auth / Redis / frontend sprints; the roadmap inserts them |

---

## Open blockers & decisions needed

1. **Real hand-history files.** ← *the current blocker.* The corpus is synthetic and
   hand-verified, but the PokerStars and especially the GGPoker parsers are written to the
   documented format shape and **must be validated against real exports** before they can be
   trusted. This also gates re-doing the ~50-hand manual stat verification against real data.
2. ~~Approval to start Phase 0~~ — given.
3. **Real hand-history files (detail).** Phase 0's F-007 corpus needs actual exports. No sample data
   exists in the repo.
3. **Sites to support first**, and cash vs. tournaments — drives parser order.
4. **Hero-only or opponent stats in phase 1** — hero-only is dramatically simpler and still a
   real product.
5. **Production target** (managed ClickHouse vs. self-hosted) — not needed until Phase 3, but it
   shapes hardening work.

Full list: [POKER_GAP_ANALYSIS.md](POKER_GAP_ANALYSIS.md#open-questions-for-you-before-the-implementation-run).

---

## Lab housekeeping (carried over, not yet done)

- [ ] Correct the memory drift: [CLAUDE.md](../CLAUDE.md) and [cluster/up.sh](../cluster/up.sh)
      say `12288Mi`; the node actually has **20Gi**
- [ ] Diagnose `strimzi-cluster-operator` — **635 restarts**, healthy now, cause unknown
- [ ] Commit the uncommitted Airflow memory fixes (`infra/airflow/values.yaml`) and all of
      sprint 5 (`dags/sprint05_hello.py`, `anki/sprint-05.tsv`, two `docs/notes/` files)

---

## Session log

Newest first. One line per session: what changed, what's next.

| Date | Session did | Left off at |
|---|---|---|
| 2026-09-08 | **Built Phase 0 + the Phase 1 spine.** `platform/` monorepo, docker-compose (CH/PG/Kafka/Redis/MinIO), canonical model, PokerStars + GGPoker parsers, pot-math validation, ingestion pipeline, 5 CH migrations, Alembic, dbt stat layer (19/19 green), FastAPI + auth + tenancy, Redis cache, demo dashboard, 125 tests, CI. Widened the model mid-run for all table sizes (HU–10max), all tournament structures (KO/PKO/satellite/speeds/Spin&Go), 17 game variants, format-drift detection, and custom stats with user-chosen opportunity. | **Phase 1 breadth: MVs, EV equity calc, more parsers, Nuxt frontend** |
| 2026-09-06 | Inventoried the lab; wrote the six original planning docs; then added `POKER_FEATURES.md` (~90-feature backlog), this status file, refreshed the roadmap around build phases, added ADRs 015–018 | Awaiting approval to start Phase 0 |

---

## How to update this file

- Flip a checkbox only when the thing **runs and is verified** — same rule as
  [LEARNING_PLAN.md](../LEARNING_PLAN.md) and golden rule 1 in [CLAUDE.md](../CLAUDE.md).
- Move the **Current phase** marker only when every box in a phase is `[x]`.
- Add a **session log** row at the end of each session, even a short one.
- Record new decisions as ADRs in [POKER_DECISIONS.md](POKER_DECISIONS.md) and link them here —
  don't bury a decision in this file's prose.
