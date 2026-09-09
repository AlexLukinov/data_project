# Poker platform — build status

> **This file is the cross-session source of truth for where the build is.**
> Read it at the start of every session; update it at the end of every meaningful step.
> Planning lives in [POKER_FEATURES.md](POKER_FEATURES.md) (what & why) and
> [POKER_ROADMAP.md](POKER_ROADMAP.md) (order & learning mapping). This file is *how far*.

**Current phase: 1 — MVP thin slice → v2 plan phase C** · **Status: spine complete · 9.1M real hands loaded · audited · POKER_PLAN.md phases A and B done and merged · C.1 (stat registry) and C.2 (decision model, 73.7M decisions built) done**
**Last updated:** 2026-09-09 (phase C session, C.2)

---

## Next action

> **Read this first. "Continue" means: do this.** Keep it concrete enough to start from cold —
> which file, which command, what "done" looks like. Rewrite it at the end of every session.

### ▶ Implement [POKER_PLAN.md](POKER_PLAN.md) phase **C**, next step **C.3**

The build is **plan-driven**: [POKER_PLAN.md](POKER_PLAN.md) holds the v2 architecture
(ADR-020…026) and phases A–E as checkbox steps, each with a "Done means". Its `## Status` block
names the next step. This block only points there.

**Where C.2 left things (2026-09-09):** the v2 facts exist and are full. `marts.decisions`
holds 73,679,949 rows — one per fold/check/call/bet/raise in `core.actions FINAL`, exactly — over
160/160 daily partitions (3.84 GiB), and `marts.player_hands` 54,562,770 rows (2.18 GiB). They
are built from `intermediate.int_hand_arrays` (per-hand action and seat arrays) and
`int_board_by_street` by the macro `decision_state()`; the columns are the `decisions` /
`player_hands` entries of `stats/registry/dimensions.yaml`, and every v2 table carries
`hand_uid FixedString(16)` (B.5b's mart half). Bootstrapped beside the **untouched v1 chain**
(`player_hand_flags`, `stats_daily` still serve the API) with
`uv run python -m scripts.backfill --anchor decisions:played_date --anchor player_hands:played_date --select '+decisions +player_hands'`
in 35 passes / 641 s, peak 1.21 GiB per insert. Parity preview (hero + population): hands, VPIP,
PFR, RFI, c-bet flop, WTSD, W$SD, net bb identical to the v1 fingerprint below; the other stats
differ by documented definition (`notes` in the registry). The stat registry (C.1) is in
`platform/stats/`. **C.1 and C.2 are staged on `feat/phase-c-stat-engine`, not committed** — the
founder declined the commit prompt once; ask again.

**Do this:**
1. `cd platform && make ps` (all five services healthy), then `make check` (248 unit tests).
2. Ask whether to commit the staged work (two commits: the registry; the decision model).
3. Read `docs/POKER_PLAN.md` `## Status` → **C.3**: `scripts/gen_stats.py` renders from the
   registry: `dbt/poker_dwh/models/marts/stats_daily.sql` (SummingMergeTree, every group key in
   the ORDER BY, one `<code>_opp` / `<code>_action` pair per `cached` stat — decision-grain
   stats from `decisions`, hand-grain from `player_hands`, unioned on the group key),
   `seeds/dim_stat_definitions.csv`, `tests/assert_action_le_opportunity.sql`, each with a
   `-- GENERATED` header; `make gen` / `make gen-check` extended. Mind two things: the
   generated `stats_daily` **replaces the hand-written one the v1 API reads**, so either the
   v1 routes switch to `stats.service` in the same step or the v1 counter names
   (`api/queries.py` `COUNTERS`) are generated as aliases until C.5; and once `stats_daily`
   reads both v2 facts it is downstream of them again, so the default anchor applies
   (recreate it empty with `empty_chain: true` and backfill with the default anchor). "Done
   means" is in the step.
4. Continue down phase C in order. Tick a step only when verified; update the plan's Status and
   §6 and this block at the end.

**Time-independent fingerprint** (`marts.player_hand_flags`, purged corpus, verified 2026-09-09
after a rebuild from empty; the rollup `marts.stats_daily` reproduces every figure exactly):

| dataset | rows = hands dealt | vpip_action | rfi_opp | cbet_flop_action | float_fold_action |
|---|---|---|---|---|---|
| population | 54,443,958 | 12,426,230 | 29,016,384 | 1,820,175 | 211,875 |
| hero | 118,812 | 26,635 | 63,542 | 3,893 | 426 |

Any change to the parser or the chain must reproduce these (a re-parse that *fixes* something
will move them — say which and why).

---

## Where we are, in one paragraph

**The spine is built, tested, and loaded with ~9.1M real hands.** `platform/` holds a working
product: a five-service docker-compose stack, a PokerStars + GGPoker parser with pot-math
validation, an upload → object-storage → Kafka → worker → ClickHouse pipeline, a dbt stat layer,
a FastAPI service with auth and tenant isolation, and a demo dashboard. 135 tests pass, dbt
builds 22/22 green, lint and mypy are clean.

Two bodies of real data are loaded under tenant 1, separated by the `dataset` column — see
[Data loaded](#data-loaded). Keeping them apart is a correctness boundary, not a nicety:
averaging a win rate over hands nobody played is meaningless, so `StatsQuery` defaults to
`dataset='hero'` and pool baselines are opt-in.

The stat layer went from 34 counters to **115** (155 columns in all, the rest being keys and
dimensions), with **24 filterable dimensions** (board texture, SPR, bet sizing, hand class, pot
type, in/out of position, opener's seat). That is what
makes PokerTracker-style custom reports possible without new SQL per question, and it is what
the pool-leak extraction and the range-heatmap artifact are both built on.

What remains in Phase 1 is breadth, not spine: more parsers, the Nuxt frontend, the incremental
MV, the all-in equity calculator, and an expression DSL so new counters stop requiring a dbt
edit.

**2026-09-09 audit verdict** ([POKER_AUDIT.md](POKER_AUDIT.md)): the spine is sound (parser seam,
canonical model, validation, tenancy, incremental chain), but the wide-flag stat model cannot
express arbitrary situations, stat definitions live in three drifting copies, the pool dataset is
unreachable through the API, the worker and the importer run two diverged ingest loops, and the UI
is a demo page. The remedy is the v2 plan in [POKER_PLAN.md](POKER_PLAN.md): a decision-level fact
table, a data-driven stat registry, a typed filter AST, enforced module layering, separate
hero/pool analysis modules, and a Nuxt UI with one shared filter model.

---

## Phase board

Legend: `[ ]` not started · `[~]` in progress · `[x]` done & verified · `[!]` blocked

### Phase 1a — Planning · `[x]` complete
- [x] `POKER_GAP_ANALYSIS.md` — lab inventory vs. product needs
- [x] `POKER_ARCHITECTURE.md` — target architecture, live-HUD streaming path, seams
- [x] `POKER_DATA_MODEL.md` — canonical model, ClickHouse/Postgres/lake/Kafka/dbt design
- [x] `POKER_DECISIONS.md` — 26 ADRs (019–026 added 2026-09-09)
- [x] `POKER_AUDIT.md` + `POKER_PLAN.md` — audit of the shipped code and the v2 plan (2026-09-09)
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
- [x] F-402/F-404/F-405 **board texture, SPR and holding filters** — delivered by the wide-flag
      expansion; `flop_pairing`/`suitedness`/`high_card`/`connectedness`, `spr_bucket`,
      `stack_bucket`, `hand_class`, `hand_shape`, bet/faced size buckets, `is_ip`, `pot_type`
- [ ] F-403 action-sequence filter — the individual actions are all counters now, but there is
      no way to express an arbitrary line ("raise-call-bet-raise") without a new counter
- [ ] Nuxt dashboard (ADR-016/024; no feature id — the current page is a deliberate
      no-build-step demo) → [POKER_PLAN.md](POKER_PLAN.md) phase D
- [ ] F-312 Confidence intervals on bb/100 → plan E.2
- [ ] **Custom stats for any situation** (F-313/F-403/F-511) → plan phase C: decision-level
      fact table + stat registry + filter AST (ADR-020/021/022) replace the "expression DSL" idea
- [~] **Incremental flag table** — implemented (ADR-019: daily partitions, anchored,
      `backfill.py`, 4 GB default) and fingerprint-verified at monthly grain; the daily anchored
      rebuild is **unverified** (ClickHouse was down) → plan A.1

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
| F-B01 | Structured logs (+ `core.v_format_drift`) | ✅ done | F-B02 ingest-lag metric is **not** built (was wrongly listed here) |
| F-202 | Incremental MVs | ⏳ next | rollups are batch (dbt) today |
| F-309 | All-in EV adjustment | ⏳ partial | plumbing done, equity calculator missing |
| F-402/404/405 | Board texture, SPR, holding filters | ✅ done | delivered by the wide-flag expansion |
| F-403 | Action-sequence filter | ⏳ partial | actions are counters; arbitrary lines need the DSL |
| F-601 | Population analysis | ⏳ partial | pool aggregates extracted (`reports/pool_leaks.md`); cohort API not built |
| — | Bulk archive importer | ✅ done | `scripts/import_archive.py`, nested zips, 40k hands/s, resumable |
| — | Pool leak extraction | ✅ done | 436 stats, 74 queries → `reports/pool_leaks.{md,csv}` |
| — | Range heatmap artifact | ✅ done | 10 tabs × 13×13 grids, published artifact |

---

## Data loaded

Cross-session state: what is actually in ClickHouse right now.

| | `dataset='hero'` | `dataset='population'` |
|---|---|---|
| What it is | The founder's own play | Observed pool hands (someone else's export) |
| Hands | **19,802** | **9,073,994** (total 9,093,796 after the duplicate purge; counted 2026-09-09) |
| Stakes | NL2 6.4k · NL5 11.8k · NL10 1.6k | NL10 2.97M · NL25 6.11M |
| Dates | 2026-08-18 → 2026-09-04 | 2023-08-29 → 2025-05-13 |
| Hero seat | present (`Hero`) | **none** — hero exclusion is structural |
| Opponents | anonymized, session-scoped aliases | **real screen names**, 94,276 distinct ids |
| Opponent tracking | impossible across sessions | possible (not yet built) |

Totals (logical, after `FINAL` and the duplicate purge): **9,093,796** hands ·
**54,562,770** player-rows · **100,346,158** actions · ~5 GB on disk for `core.*`;
`marts.player_hand_flags` is **3.20 GiB** (63 bytes/row, 52% of it the 32-char `hand_uid` —
plan B.5b). (The earlier "143.75M actions" was a physical count including ReplacingMergeTree
duplicates.) Chain state: 160/160 daily partitions on every model, rebuilt from empty on
2026-09-09 in 42 passes / 1,411 s on the 4 GB node.
Parse validity: pool **99.74%**, hero **99.94%**. Raw text for every file is in MinIO,
content-addressed, so any parser fix can be replayed from the archive alone.

**Sources are gitignored and must stay that way** — `hand_histories/` and `*.zip` contain other
players' screen names and betting behaviour (third-party personal data). Only aggregates are
committed.

**Performance measured on this hardware:** import **40,100 hands/s** across 8 processes
(full 9.1M archive, 2,494 nested-zip members, in **226–260 s**); full dbt refresh **~10–11 min**;
a stat query over the 54M-row fact table uses **13–29 MiB** and returns in **under 0.1 s**.

---

## Environments

| | Purpose | Status |
|---|---|---|
| **minikube `dataplatform`** | The **learning lab** — interview prep, DE sprints. Not the product. | ⏸️ **PAUSED** via `scripts/pause.sh` to free ~11.5 GiB for the 9.1M-hand build. PVCs intact; `scripts/resume.sh` + `scripts/port-forwards.sh` to restore |
| **docker-compose (product)** | Local dev for the poker platform. | ✅ running at the end of the phase-A session (`cd platform && make up` if not). Ports shifted off the lab's: CH 8124, PG 5434, Kafka 9094, Redis 6380, MinIO 9010/9011 |
| **ClickHouse memory** | Sized as a production node. | ✅ **4 GB** default (`CLICKHOUSE_MEM`), per-query ceiling 2.5 GB, caches sized in `platform/infra/clickhouse/small-node.xml`, spill + `grace_hash` + `max_threads 2` in `limits.xml`. Bootstrapping the full corpus is `scripts/backfill.py`, never a one-shot full refresh (ADR-019) |
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

1. ~~Real hand-history files~~ — **resolved.** 9.1M pool + 19,880 hero hands loaded and
   validated; the parsers were corrected against them (four real bugs, below).
2. **23,787 pool hands (0.26%) still fail pot reconciliation** and are discarded rather than
   stored wrong. Characterised, not fixed: 97% are *overpays* (winner collected more than went
   in), median $0.04, on small pots, and almost none carry a Cash Drop line. A rounding
   hypothesis was tested and **rejected** — median discrepancy is 15% of the pot with a $60 max,
   so loosening the validator's tolerance would be wrong. Root cause unknown; this is the next
   parser dig.
3. ~~The flag table must become incremental~~ — **done** (ADR-019). The remaining scale steps
   are in [POKER_PLAN.md](POKER_PLAN.md) phase E: MV (F-202) → shard by `user_id` → quotas.
   **New, from the audit:** the stat *model* itself is the limit for "any situation" and is
   replaced in phase C (ADR-020); fifteen concrete breakages (AUDIT B1–B15, e.g. the pool dataset
   unreachable via the API, two diverged ingest loops) are fixed in phase A.
4. **~50-hand manual stat verification against REAL hands** is still outstanding. It was done
   against 8 synthetic hands. Everything downstream rests on it.
5. **Stake mismatch to be aware of when interpreting pool stats.** The pool is NL10/NL25; the
   founder plays NL2–NL5. The two pools open within half a point of each other at every seat,
   but that equivalence has only been checked preflop.
6. **Opponent tracking is now possible in the pool** (real screen names, 94,276 ids) and remains
   impossible in the hero export (session-scoped aliases). Whether to build per-opponent stats
   is an open product decision.
7. **Production target** (managed ClickHouse vs. self-hosted) — not needed until Phase 3, but it
   shapes hardening work.
8. **Sites to support next**, and cash vs. tournaments — drives parser order. No PokerStars or
   tournament export has been tested against real data yet.

Full list: [POKER_GAP_ANALYSIS.md](POKER_GAP_ANALYSIS.md#open-questions-for-you-before-the-implementation-run).

---

## Parser corrections made against real data

Kept here because each was **silent** — the parser raised nothing and the hands validated.

| # | Bug | Cost | Fixed in |
|---|---|---|---|
| 1 | Rake regex unreachable past a `$` anchor | 47% of hands got `rake=0` | v2 |
| 2 | Jackpot/Bingo/Fortune/Tax drops uncounted | further 8% | v2 |
| 3 | GG opponents assumed anonymous | destroyed 881k real identities | v2 |
| 4 | Alias regex anchored at exactly 8 hex chars | leaked 6.2% of aliases (GG renders a uint32 with `%x`, no zero-padding) | v3 |
| 5 | `Cash Drop to Pot` unparsed | 56,872 hands wrongly rejected; recovered 33,050 | v4 |
| 6 | LEFT JOIN padding invented a phantom raise in every raise-less pot | inflated every 3-bet/4-bet **denominator** | dbt |
| 7 | Two dbt models quadratic in players × raises | died at 9M hands; rewritten with window/array aggregation | dbt |

Bug 6 is the one to remember: ClickHouse pads unmatched LEFT JOIN rows with the type's **zero**,
not NULL, so `r.action_index < first_idx` was true against padding. Guard joins on an explicit
`1 as is_row` marker, never on a column whose zero is a legal value.

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
| 2026-09-09 (7) | **Off-plan (founder request): pool spot-frequency census + board texture.** Five new modules — `scripts/spot_nodes.py` (preflop/flop *node* per hand from `core.actions`, e.g. `BU open, BB call`; seat→position is a fixed lookup because `button_seat` is always 1, and `FINAL` is skippable because `parser_version` is uniform and `hand_uid` unique, both asserted at runtime by `verify_corpus_assumptions()`), `spot_texture.py` (flop classifier, ace counted **high or low** so A-2-3 is connected), `spot_report.py`, `spot_plan.py`, `spot_frequency.py` → `reports/spot_frequency.{md,csv}`. One unified ranking of all 346 nodes over 9,093,794 six-max hands: 5 spots = 43% of decisions, 10 = 62%. **Three findings.** (1) The texture classifier is parity-checked each run against enumeration of all C(52,3)=22,100 flops — connectedness and suitedness match to 0.07pp, confirming the board parser. (2) The high card deliberately does *not* match, and the deviation is card removal: ace-high flops fall monotonically 23.89% (limped) → 21.7% (SRP) → 20.2% (3bet) → 17.9% (4bet) → 15.1% (5bet), vs 21.74% for a random deck. Texture is otherwise independent of the spot, so spot × texture is a clean product. (3) A node ending in a raise can still show flops — an already-all-in player owed a runout, not a parse bug. **Found a real defect in the dbt chain:** `int_board_texture.sql` computes straight span ace-high only, so A-2-3 lands in `disconnected`; it disagrees with this classifier and should be fixed. `make check` 240 green. **Overlaps plan C.2** — this node grammar is C.2's action-line tokens; reconcile with `marts.decisions`, do not duplicate. | Back to plan **C.2** (decision model); fix `int_board_texture.sql` wheel handling |
| 2026-09-09 (7) | **Plan C.2 done**: v2 facts built — `marts.decisions` (73.7M rows, one per decision with the state before it) and `marts.player_hands` (54.6M) from per-hand arrays, `hand_uid FixedString(16)`; multi-anchor incremental gate; bootstrapped beside the v1 chain in 35 passes / 641 s at ≤1.21 GiB; counts exact vs `core.* FINAL`; parity preview 9/16 identical, rest by definition. `make check` 248. Staged, not committed. | Plan **C.3** (generator: `stats_daily` from the registry) |
| 2026-09-09 (6) | Merged phase B into `main` (fast-forward). **Plan C.1 done**: `stats/` package — filter/expression AST, entry models, semantic checks, and the YAML registry (77 dimensions, 65 stats, definitions tightened to standard tracker meaning with `notes` for the parity check). 65 new unit tests; `make check` 240 green; mypy, import-linter, size check extended to `stats/`. Branch `feat/phase-c-stat-engine`. | Plan **C.2** (decision model, built to `dimensions.yaml`) |
| 2026-09-09 (5) | **Phase B (module boundaries) done and verified**, on branch `feat/phase-b-module-boundaries` (6 commits; phase A merged to `main` at `35acf83`). Settings and the ClickHouse client out of `api/`; import-linter with 5 contracts; sinks behind Protocols with fakes and one ingest loop; a `test_`-prefixed test environment the integration conftest insists on (analysis databases byte-identical before/after); the core schema declared once in `core/schema/` with generated staging models and a spec-vs-`system.columns` test; migration 0009 (dataset on actions/pot_winners + pool repair, 0 disagreements); typed hand endpoints; size limits enforced (28 → 6 baselined violations; PokerStars parser split into a package, real-export fingerprint identical). Founder's storage analysis recorded as plan step B.5b (`hand_uid` FixedString(16)), deferred to C.2's rebuild. `make check` 175 unit tests, `make test-all` 186 passed / 2 skipped. | Phase-B gate: merge the branch (founder's call), then **POKER_PLAN.md C.1** (stat registry as data) |
| 2026-09-09 (4) | **Phase A (stabilize) done and verified**, on branch `feat/incremental-chain-and-v2-plan` (11 commits). Pool dataset reachable over HTTP; one ingest loop (worker = importer) with `dataset` on the message; 29 stranded counters rolled up and exposed as 17 stats; typed integer filters; CORS, placeholder-secret refusal, cookie flag from settings, auth rate limit, escaped dashboard; sniff ambiguity check; dbt port default; law test for all 52 pairs + intermediate schema tests. Found and fixed: the incremental anchor must be the **last** model (`stats_daily` had been silently empty); `empty_chain` recreate procedure; row-budgeted backfill with scratch-table cleanup. Applied the founder's storage analysis (LowCardinality buckets, UInt8 counts) — measured no disk saving; `hand_uid` (52%) is B.5b. Full rebuild from empty: 42 passes / 1,411 s; fingerprint re-established. | **`POKER_PLAN.md` step B.1** |
| 2026-09-09 (3) | **Audited the platform and wrote the v2 plan.** Three agent audits (stat engine, module boundaries, API/UI) plus first-hand reads → `POKER_AUDIT.md` (keep / 15 breakages / structural limits / benchmark vs PT4 & Hand2Note / 23 doc-drift items). Founder decisions: Hand2Note-class speed and power, **separate hero and pool analysis modules**, both UI audiences, English only, Vue/Nuxt confirmed. Wrote `POKER_PLAN.md` (decision-level fact table, stat registry as data, JSON filter AST, enforced layering, Nuxt SPA, phases A–E with checkbox steps), rewrote ADR-019 (daily + anchored + backfill), added ADR-020…026, made CLAUDE.md plan-driven. | phase A |
| 2026-09-09 (2) | **Timezone fix landed in data; chain made daily, anchored, bootstrapped on 4 GB.** Re-imported both datasets with aware datetimes; purged 41,677 orphaned pre-fix rows (ReplacingMergeTree dedups only within a partition), 384 test-tenant rows and the 8 seed hands. Converted the chain to daily partitions with a per-partition watermark; found and fixed two silent bugs (global watermark skipped partitions; per-model selection zeroed c-bets after a failed pass) by anchoring every model on `player_hand_flags`; `scripts/backfill.py` with adaptive batching (19 passes / 581 s / 2.0 GiB); ClickHouse default 4 GB with sized caches. Launched the final anchored rebuild — **unverified** (session ended, container later stopped). | verify the rebuild |
| 2026-09-09 | **Made the build resumable across sessions.** Audited the dbt chain and designed the incremental conversion (partition-grain `insert_overwrite`, watermark on `core.hands.parsed_at`, dirty-month predicate on both sides of every join) — recorded in full under [Next action](#next-action), not yet implemented. Captured the pre-change fingerprint of `marts.player_hand_flags` to verify against. Added a `## Next action` block to this file and a deterministic start/end-of-session procedure to [CLAUDE.md](../CLAUDE.md), plus a `platform/` make-target contract there so a cold session knows how to run the product stack. | **[Next action](#next-action) — implement the incremental chain** |
| 2026-09-08 (3) | **Widened the stat layer to 115 counters and extracted pool stats.** Added a generic facing-an-open triple (`vs_open_opp/_call/_fold`) so cold-call, BB and SB defence come from one counter set sliced by seat and opener, plus 25 leak counters (limp follow-through, raise-c-bet, float-fold, fold-to-donk, fold-to-raise per street, probe/delayed-c-bet folds, river probe/raise/bet-call, check-fold vs check-call). Published a 10-tab 13×13 range-heatmap artifact with a companion 'never shown' grid. Produced `reports/pool_leaks.{md,csv}` — 436 stats, 74 audited queries, low-N flagged. Raised ClickHouse to 15 GB and paused the lab to fit the full-refresh build. | **Make the flag table incremental, then drop ClickHouse back to ~4 GB** |
| 2026-09-08 (2) | **Loaded real data and widened the stat layer.** Imported 19,810 hero hands + ~9.07M population hands (2,494 source files inside nested zips) via a new bulk importer, at ~40k hands/s. Added the `dataset` column separating own play from observed pool. Widened `int_hand_player_flags` from 34 to ~130 counters and ~24 filterable dimensions (board texture, SPR, bet sizing, hand class, pot type, IP/OOP); API now routes coarse queries to the rollup and fine ones to the fact table. **Four real bugs fixed:** GG alias regex missed 6.2% of aliases (uint32 `%x`, not zero-padded); a LEFT-JOIN padding bug invented a phantom raise in every raise-less pot, inflating 3-bet/4-bet denominators; `Cash Drop to Pot` was unparsed, failing pot reconciliation on 56,872 hands; two dbt models were quadratic and died at 9M hands. | **Verify stats vs GG's own reports; then F-601 population analysis** |
| 2026-09-08 | **Built Phase 0 + the Phase 1 spine.** `platform/` monorepo, docker-compose (CH/PG/Kafka/Redis/MinIO), canonical model, PokerStars + GGPoker parsers, pot-math validation, ingestion pipeline, 5 CH migrations, Alembic, dbt stat layer (19/19 green), FastAPI + auth + tenancy, Redis cache, demo dashboard, 125 tests, CI. Widened the model mid-run for all table sizes (HU–10max), all tournament structures (KO/PKO/satellite/speeds/Spin&Go), 17 game variants, format-drift detection, and custom stats with user-chosen opportunity. | **Phase 1 breadth: MVs, EV equity calc, more parsers, Nuxt frontend** |
| 2026-09-06 | Inventoried the lab; wrote the six original planning docs; then added `POKER_FEATURES.md` (~90-feature backlog), this status file, refreshed the roadmap around build phases, added ADRs 015–018 | Awaiting approval to start Phase 0 |

---

## Artifacts produced

| What | Where |
|---|---|
| **Audit of the shipped code and docs** (2026-09-09) | `docs/POKER_AUDIT.md` |
| **v2 plan — the file "Continue" resumes from** | `docs/POKER_PLAN.md` |
| Pool statistics report (436 stats, SQL appendix) | `platform/reports/pool_leaks.md` |
| Same, flat for slicing | `platform/reports/pool_leaks.csv` |
| Generator (re-runnable, lint-clean) | `platform/scripts/pool_report.py` |
| Bulk archive importer | `platform/scripts/import_archive.py` |
| Screen-name registration | `platform/scripts/register_account.py` |
| Range heatmaps (10 tabs, published) | https://claude.ai/code/artifact/32a965f9-8c77-456d-99a3-cfd533e74618 |

---

## How to update this file

- **Rewrite [`## Next action`](#next-action) at the end of every session.** It is the first
  thing the next session reads and the only thing that makes "continue" mean something. Write
  it for someone starting cold: name the file, the command, and what "done" looks like.
  "Continue the refactor" is a failed handoff. While [POKER_PLAN.md](POKER_PLAN.md) is being
  implemented, this block points at the plan's next step and the plan's `## Status` block is
  updated in the same session.
- Update this file **as you go on a long session**, not only at the end — context runs out
  mid-task and this file is the only thing that survives it.
- Flip a checkbox only when the thing **runs and is verified** — same rule as
  [LEARNING_PLAN.md](../LEARNING_PLAN.md) and golden rule 1 in [CLAUDE.md](../CLAUDE.md).
- Move the **Current phase** marker only when every box in a phase is `[x]`.
- Add a **session log** row at the end of each session, even a short one.
- Record new decisions as ADRs in [POKER_DECISIONS.md](POKER_DECISIONS.md) and link them here —
  don't bury a decision in this file's prose.
