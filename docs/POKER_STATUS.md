# Poker platform — build status

> **This file is the cross-session source of truth for where the build is.**
> Read it at the start of every session; update it at the end of every meaningful step.
> Planning lives in [POKER_FEATURES.md](POKER_FEATURES.md) (what & why) and
> [POKER_ROADMAP.md](POKER_ROADMAP.md) (order & learning mapping). This file is *how far*.

**Current phase: 1 — MVP thin slice → v2 plan phase F (Range Lab) interleaved with D (UI)** · **Status: spine complete · 9.1M real hands loaded · audited · POKER_PLAN.md phases A, B and C done and merged (registry, 73.7M decisions, generated rollup, report engine, API v2 + saved objects, v1 chain deleted, hero/pool analysis modules) · Range Lab: F.1–F.9 committed with D.1/D.2 (headless core, equity engine, metrics and blockers, the Nuxt app and `poker-ui`, sign-in, the range library with importers, the hand replayer, the pool's tiered answers at a node, and the 9-step analyzer); F.10 (tier 3 + empirical EQR) done, verified and uncommitted; the §5b corpus re-parse and the whole-chain rebuild ran on 2026-09-11 — **pool showdown cards 17.4% → 100%**, hero fingerprint unmoved; CI run pending a push**
**Last updated:** 2026-09-11 (session 8, F.10 + the §5b re-parse and rebuild)

---

## Next action

> **Read this first. "Continue" means: do this.** Keep it concrete enough to start from cold —
> which file, which command, what "done" looks like. Rewrite it at the end of every session.

### ▶ Implement [POKER_PLAN.md](POKER_PLAN.md) phase **F / D**, next step **F.11** (training modes), then **F.12**

The build is **plan-driven**: [POKER_PLAN.md](POKER_PLAN.md) holds the v2 architecture
(ADR-020…035) and phases A–F as checkbox steps, each with a "Done means". Its `## Status` block
names the next step. This block only points there.

**Where things stand (2026-09-10):** phases A–C are done and merged into `main` (`f18049b`);
the backend answers any stat for any situation (`POST /v1/reports/run`), serves definitions,
saved objects, hero leaks/sessions and pool reports/cohorts/players. On 2026-09-10 the founder
delivered the **Range Lab** spec — a range-thinking learning platform (stepped analyzer, weighted
equity calculator, blockers, pool-derived ranges, replayer). It is saved verbatim as
[POKER_RANGE_LAB_SPEC.md](POKER_RANGE_LAB_SPEC.md); the Phase 0 exploration report and the
integration surface are [POKER_RANGE_LAB.md](POKER_RANGE_LAB.md); the decisions are ADR-027…029;
the work is plan phase **F**, interleaved with phase D in the order the report's §9 gives
(F.1–F.3 are headless TypeScript, then D.1 = F.4's app shell). Branch `feat/range-lab`.

**Where F.6 stands (2026-09-10):** committed as `951107a` (ADR-031). **`NodeKey`
now exists** — it was scheduled for F.8 but the library stores it: `analysis/pool/nodes.py`
(the one definition, ADR-028), `packages/poker-core/src/node.ts` (its twin: `parseNodeKey`,
canonical JSON, `nodeKeyLabel`), `tests/fixtures/nodes.json` parsed by both suites. The
convention, written into both: the action sequence **ends with hero's own action**; a stored
range is the combos that take the last step. Backend: `api/models_ranges.py` (`ranges`,
append-only `range_versions`), migration `c4d5e6f7a8b9`, `api/schemas_ranges.py` (the body is
the canonical combo text, refused with the entry number otherwise), `api/range_library.py`,
`api/routers/ranges.py` (`GET /v1/ranges` with filters, `POST`, `POST /bulk` with skip-or-version,
`POST /lookup` with the typed key, `GET /export`, `GET/PUT/DELETE /{id}` — a body in a PUT makes
a new version, metadata alone does not — `GET /{id}/versions`, `POST /{id}/revert/{v}` as a new
version). TypeScript: `packages/poker-importers` (SPH text, our own JSON, GTO Wizard, PioSOLVER,
Equilab, CSV, plain text; `detectImporter`, `importFiles` with the §11.2 report; `inferFromName`
with confidence and notes; `.bin` refused with a pointer to SPH's text export, nothing decoded);
app `ranges/{api,cache,library,review,files}.ts` + `stores/ranges.ts`; pages `/ranges`,
`/ranges/[id]`, `/ranges/import`, `/ranges/compare`; `poker-ui` `NodeKeyEditor`,
`RangeDisagreementTable`; `dexie` + `fake-indexeddb` (Apache-2.0) in `LICENSES.md`. Verified in
Chrome against the API running on the **test** databases (an account registered in
`poker_test`, nothing in the real ones): four files into the import → three situations inferred
with high confidence, `notes.txt` flagged and fixed in the review, batch tool/tags applied, 4
created; a GTO Wizard percent file imported with the "divided by 100" warning; edit page:
metadata save keeps v1, a cell edit saves as v2 with its note, revert to v1 makes v3;
`/ranges/compare`: my chart | solver | pool stub side by side, "74 combos in both · only in
Solver: 88 (60.5 weighted)", 12 disagreements — **acceptance 7**; API stopped → `/ranges` lists
the five cached ranges under the offline banner; no console errors. Two defects found in the
browser and fixed with tests (reactive proxies handed to IndexedDB; the `3-bet_v2` tokenizer).
`make check` 338 unit tests, 5 new integration tests; `make web-check` 277 tests.

**Where F.8 stands (2026-09-10):** done and **verified, uncommitted** (ADR-033). It began with
the question the plan put first, and the answer changed the step: **the pool's missing showdown
cards were a parser gap, not missing data.** Observed GGPoker tables print a card-less
`Dealt to <name>` line for every seat and the revealed cards **only** in the per-seat SUMMARY
(`Seat 3: name (big blind) showed [Qd Js] and won ($6.08)`), and the parser skipped the summary
block. Of 752 cardless showdown seats sampled from 371 real pool hands, 752 had their cards
there. `grammar.SEAT_SUMMARY` + `lines.summary_seat_line` fix it — keyed on the seat number, and
`setdefault` so a self-export's own cards are never overwritten — taking a whole real pool file
from **168 of 907 showdown seats with cards (18.5%) to 923 of 923 (100%)**. Nothing changes in
the database until the corpus is re-parsed: that plan is [POKER_PLAN.md](POKER_PLAN.md) §5b and
is the founder's to schedule. `parser/sites/pokerstars/lines.py` hit the 300-line limit on the
way and its action handlers now live in `actions.py`.

The engine: `raise_to_bb` gains buckets; `analysis/pool/node_filter.py` turns a `NodeKey` into
the filter over `decisions` (position, street, `facing`, the seat's own line, table size, the
effective-stack **bucket**, stake, texture tags looked up in the flop dimensions), naming the
villain only through a column that means it (`last_raiser_position`, `opener_position`, else
`is_ip`); `analysis/pool/node_service.py` answers tier 1 and tier 2 as `run_report` calls and
refuses to print a figure under `MIN_N = 100`. `POST /v1/pool/node/{frequencies,showdown-range}`
take the typed key. UI: `PoolDataBadge`, the pool column of `/ranges/compare` built from the
field's own showdown counts (per **combo**, so a 12-combo class is not double-counted), and the
replayer's situation panel. **Verified in Chrome against the real pool, read-only** (the API on
the real ClickHouse, auth on the test Postgres, nothing written): one of the founder's own NL10
hands replayed node by node — `HJ fold · 100bb · NL10` fold 78.8% / raise 20.7% / call 0.5%
(n = 1,443,908); `BB call vs CO 2.5bb · 40bb` 61.4 / 32.3 / 6.3 (n = 32,239); `BB bet vs CO ·
turn` check 68.8% / bet 31.2% (n = 8,786) — and `/ranges/compare` drew the pool's UTG-RFI
showdown range (AA 100%, AKs 64%, AQs 35%; n = 27,867; "0.5% of the decisions here were shown
down"), while a trips flop said **"insufficient data — 35 of the 100 needed"** — **acceptance
10**. One defect found in the browser and fixed on both sides: `nodeKeyAt` carried every street's
decisions into the sequence, so every postflop node asked for a line nobody ever took.
`make check` 377, `make test-all` 410 (33 integration), `make web-check` 323.

**Where F.9 stands (2026-09-10):** done and **verified, uncommitted** (ADR-034). The nine steps
of spec §15 are the product's spine, and everything F.1–F.8 built is an input to them. Backend:
`analyses` (Alembic `d5e6f7a8b9c0`), `api/models_analyses.py`, `api/schemas_analyses.py` (one
flat `StepWork` covering all nine steps; range bodies validated by the range library's own
combo-text rule, so nothing unparseable is ever stored), `api/analysis_store.py`,
`api/routers/analyses.py` — and **a save is a merge by step number**, so the autosave writing
the step being worked on can never wipe the steps before it. `poker-ui` gains `PredictionGate`
(the answer is committed **before** the truth is asked for; `unavailable` says why there is no
truth rather than waiting for ever) with its scoring in `prediction.ts`, and `StepperNav`
(click, `←`/`→`, digits 1–9). App: `analyze/api.ts`, `steps.ts` (the nine questions, tolerances
and units as data), `spot.ts` (what steps 1–5 have built, read back as one spot), `reveals.ts`
(every scored number, each hand-counted in a test), `facing.ts`, `cache.ts` (Dexie), `session.ts`
(debounced save, offline queue, retry), `stores/analysis.ts`; nine step components over a shared
`StepShell`; `/analyze` and `/analyze/[id]`; **Analyze this node** on the replayer, which is how
an analysis normally starts. **Verified in Chrome against the real pool, read-only** (API on the
real ClickHouse, auth and the analyses on the test Postgres): one of the founder's own NL10
hands taken from the replayer's `BB bet vs CO · turn · 40bb` node through all nine steps with a
prediction committed at each — the field takes this line 30.0% of the time (n = 40,680); 25.5%
of villain's range is top pair or better; the BB holds 69.5% of the nut combos; A♣5♦ removes 20
combos; the field checks 70 / bets 30; the hand places as a **semi-bluff** at the 19.2nd
percentile of its own range by made-hand class; 1.50 bluffs per value combo against 0.33
balanced for a half-pot bet; and the CO folds **43.2%** (n = 3,988) against an MDF of 39.8%,
"bluff here more often" — ending in a saved heuristic and `9 of 9` in the list: **acceptance 9**.
Four defects found in the browser and fixed: the step context was rebuilt per render, so two
patches in one tick both built on the same stale snapshot and the first was lost (now one object
read through getters); `classifyCombos` throws on a board that is not 3–5 cards, which froze
step 3 while the flop was being clicked out (`isDealt`, with a regression test); step 8 read its
own bet size instead of step 6's; and step 9 asked hero's own node for a fold frequency, where
the answer is always zero (`facingNode()` swaps the seats). One **server** bug fixed with them:
the process-wide ClickHouse client stamped every request with one session id and ClickHouse
refuses a second query inside a session while the first runs, so a hand and a pool query issued
together failed outright — `autogenerate_session_id` is now off, with a concurrency integration
test. `make check` 387, `make test-all` 429, `make web-check` 364.

**Where F.7 stands (2026-09-10):** committed as `317fab4` (ADR-032). The replay
engine is in `poker-core/src/hand/`: `types.ts` (one hand shape for all three sources),
`replay.ts` (`replayStates` — one state per step; chips are tracked as *committed in front* plus
the *settled pot*, and the street's bets are collected exactly when the next card is dealt), and
`node.ts` (`nodeKeyAt` — the situation the hand is in, **ending with the decision just made**, so
stepping walks the node tree and every stored range is one lookup). `poker-ui` gains
`PokerTable.vue` (6-max oval in CSS: seats with stacks in bb, chips in front, the board, the pot,
the dealer button, the seat to act, the last action as a bubble, the winner named at the end),
`HandActionLog.vue` and `HandReplayer.vue` (step, seek, play with speed, `←`/`→`/space/`1`–`4`,
`nodeChange` on every move). Backend: `api/hand_parse.py` (paste → one hand, or a sentence
saying why not — two hands are refused rather than truncated, and a hand that does not reconcile
is refused as the ingest loop refuses to store one), `api/hand_query.py` (the reads both routers
share), `stats/hands.py` + `HandSearch` (the report filter asked backwards, answering with the
matching **decisions** so the seat comes too); `POST /v1/hands/parse` (ADR-029),
`POST /v1/hands/search`, `GET /v1/pool/hands`, and `seat` on `HandSummary`. App: `/hands` (my
hands · pool, with street/position/facing/action as a situation filter), `/hands/[id]`,
`/hands/paste`, and `components/hands/HandStudy.vue`, which binds my stored chart, pot odds, MDF,
the distribution and the equity of my node's range against the villain node's to the current
step. **Verified in Chrome** against the API on the `test_` databases (`make seed`, the demo
account): the corpus lists with the seat to open on; hand `38dcad35` steps from the deal to the
muck with the chips, the flop, the log and the keyboard all behaving; the situation reads
`BTN RFI · 105bb · NL50` at step 6 and `SB 3-bet vs BTN 3bb · 100bb · NL50` at step 7, where the
two stored ranges gave **64.2% / 35.8%** and pot odds "calling 5.5 to win 8 is 1.5 : 1, 40.7%" —
**acceptance 8**; a pasted PokerStars hand replayed and junk text was refused in the parser's own
words; the Pool tab listed two pool hands, each opening on the seat that showed cards. One defect
found in the browser and fixed with a test: `marts.decisions.hand_uid` is `FixedString(16)` while
`core.*` and every URL use the hex form, so the search returned ids matching no hand and the list
was silently empty. `make check` 354, `make test-all` 385 (8 new integration tests),
`make web-check` 317.

**Where F.5 stands (2026-09-10):** committed as `021f7ae`.

**Where D.2 stands (2026-09-10):** committed as `3e5cabe`. `apps/web/app/auth/{api,session,
paths}.ts` hold the sign-in logic framework-free (the access token in memory only, the refresh
token in the API's HttpOnly cookie, one shared refresh, 401 → refresh → retry, `bootstrap` from
the cookie), `stores/auth.ts` binds it to Nuxt, `useApi()` hands the authorized `$fetch` to
pages, `middleware/auth.global.ts` protects every route unless the page sets
`definePageMeta({ public: true })`; pages `/login`, `/register`, `/account`. Verified in Chrome
with a 1-minute token: the expired token refreshes silently on the next call and the page never
changes; reload resumes from the cookie; sign-out revokes it; `localStorage` holds no token.

**Where F.1–F.4 stand (2026-09-10):** the headless core of the Range Lab is complete and the
first UI is running. F.1 (`e74c148`), F.2 (`2216e3e`), F.3 (`fd11451`) and F.4 = D.1
(`232e096`) are committed. F.4: `platform/web/apps/web` (Nuxt 4 SPA; `make web` on :3000;
`/` calls `/health`, `/lab` is the calculator, `/dev/components` the fixture page) and
`packages/poker-ui` (the nine §12 components, `useUndoRedo`, theme tokens); acceptance 1, 2, 4
and 5 of the spec's §18 checked in Chrome against the dev server. F.2:
`evaluator/fast.ts` (table-driven, 76 ns per 7-card rank), `equity/` (exact heads-up with
exact card removal, Monte Carlo 2–10 players, cancellation, progress, `equityKey`),
`packages/poker-workers` (`EquityService` + Comlink worker/client), a 35-spot fixture generated
with treys (`fixtures/gen_equity_spots.py`) all within tolerance, benchmark flop 181 ms / turn
8 / river 1 / preflop MC 100k 74 ms. F.3: `metrics/` (pot odds with rake raw and adjusted,
EQR, range and nut advantage), `blockers/` (scores, card heatmap, class breakdown, board
effects, bluff ranking, unblockers), `distribution/` (six axes, nested tree, compare, export);
`make web-check` 144 tests green. F.1's workspace: `platform/web/` is an npm workspace (`make web-install` = `npm ci`; on this machine npm 11.4 needs
`--legacy-peer-deps` for a fresh install — an arborist bug, the lockfile is committed).
`packages/poker-core` holds `cards.ts`, `range.ts`, `formats/{combo,classes,index}.ts`,
`evaluator/{types,ts,wasm}.ts`, `classify.ts`, `numbers.ts`, with 61 Vitest tests: the
1326-entry fixture (generated by an independent Python script) round-trips byte for byte; the
WASM and TypeScript evaluators agree on 100,000 seeded 7-card hands; all 2,598,960 five-card
hands map onto exactly 7,462 ranks. `make web-check` (tsc + ESLint + Vitest + licence audit)
is green; `make check` was 310 then (338 after F.6). CI job `web` (Node 24) is in `ci.yml` but has not run yet.
`platform/web/LICENSES.md` lists every direct dependency; MPL-2.0 `lightningcss` (unmodified,
dev-only) and the CC-BY-3.0 `spdx-exceptions` data file are flagged there for the founder.

**Where F.10 stands (2026-09-11):** **done, uncommitted** (ADR-035). Tier 3 reconstructs a prior
at a node and shows its own error; empirical EQR is split between the pool and the engine;
`invested_bb` is a new column on `marts.decisions`. The estimator deviates from the spec's
literal wording for a measured reason: counting a class's revealed hands and taking the share
that took the action reads *"the field opens 97% of AQs, 85% of KTo, 80% of QTo"* at a node
where tier 1 says it opens **18.35%** at all — folders are never shown, so every class saturates
against the ceiling. Tier 3 reweights by a **likelihood ratio** instead, which cancels the reveal
rate, leaves the posterior unchanged and makes `implied_frequency` equal tier 1's observed
frequency exactly when the prior matches the field's own class mix. Verified in Chrome against
the real pool at the BB's flop lead: 35 of 51 chart classes reweighted, KK/AA/AKo to ~1.6× and
22 to 0.33× (22 falls from 100% of the prior to 20% of the estimate), implied 12.9% against
observed 14.1%. `EQRPanel`'s pool slot — left empty in F.5 — is filled in the replayer.

**And §5b ran with it (2026-09-11).** `scripts/reparse.py` re-read the whole 9.07M-hand pool
corpus from the raw text in object storage, so the F.8 parser fix finally reaches hands imported
before it. The rebuild that followed needed **no downtime**: `REPLACE PARTITION` only wants
identical structure, so `ALTER TABLE marts.decisions ADD COLUMN invested_bb Float32 AFTER
pot_before_bb` plus the ordinary `scripts.backfill` fills the column a day at a time with the
marts queryable throughout — rehearsed on the test databases first and written up in
`macros/incremental.sql` as the preferred path for a column-only change.

**It worked, and the numbers are verified.** Pool showdown-seat card coverage went from
**387,740 of 2,227,803 (17.4%) to 2,273,342 of 2,273,342 (100.0%)**; pool decision coverage
1.89% → **13.35%**; the BB flop lead went from **35 of 51** chart classes reweighted to **169 of
169**. The **hero fingerprint did not move** — 19,802 hands, VPIP .229573, PFR .188466, WTSD
.033835, −1.37 bb/100 — which was the load-bearing check, because hero exports always contained
their own cards and any movement there would have meant a parser regression, not a recovery. Row
counts are unchanged (73,679,949 decisions / 54,562,770 player-hands); pool WTSD rose .040919 →
.041756 as previously-unidentifiable showdowns became identifiable.

**Three bugs surfaced during the rebuild, all fixed** (details in plan §5b):
`scripts/backfill.py` ran whole-table data tests every pass and `dbt build` skips nodes
downstream of a failed test, so the anchor never built (`--skip-tests`); an `ALTER ADD COLUMN`
dirties no partition, so **both hero months silently kept `invested_bb = 0`** while the eight
months the re-parse touched came out right (`--rebuild-from`, with an advancing floor so the
loop still converges); and the assertion that should have caught that sampled by day-of-month,
covering 4 months of 10 — it now samples on `cityHash64(hand_uid)`. Dead letters were also
deduplicated to a single generation, 128,340 → **19,117**, with the original preserved as
`core.parse_failures_pre_dedupe_20260911` (drop it once these numbers have been accepted).

**Do this:**
1. **F.10 is done and verified, uncommitted** — commit it as one commit when the founder says
   so. Backend: `analysis/pool/{node_query,reconstruct,realization}.py` (new),
   `analysis/pool/node_service.py` (rebased on the shared query), `api/routers/pool.py`,
   `api/schemas_pool.py`; data: `dbt/poker_dwh/macros/decision_state.sql`,
   `macros/incremental.sql` (the no-downtime ALTER path), `stats/registry/dimensions.yaml`,
   `dbt/poker_dwh/tests/assert_invested_bb_is_the_seats_own_chips.sql` (new);
   `scripts/reparse.py` (new); tests `tests/test_node_tier3.py`, `tests/test_reparse.py`,
   `tests/integration/test_pool_tier3.py` (new), `tests/test_api_v2.py` (the dimension count).
   Web: `web/packages/poker-ui/src/estimate.ts`,
   `src/components/{EstimatedRangePanel,PoolRealizationPanel}.vue`, `test/tier3.test.ts` (new),
   `src/{index.ts,glossary.ts}`; `web/apps/web/app/pool/{estimate.ts,estimate.test.ts}` (new),
   `app/pool/api.ts`, `app/pages/ranges/compare.vue`, `app/components/hands/HandStudy.vue`,
   `app/pages/dev/components.vue`. Also from the rebuild: `scripts/anchors.py` (the dirty-gate
   SQL moved here beside the anchor SQL, plus `dirty_where`/`advance`/`partition_of`),
   `scripts/backfill.py` (`--rebuild-from`), `tests/test_backfill_anchors.py`,
   `tests/test_backfill_tests_flag.py`, and `dbt/poker_dwh/profiles.yml` (`max_threads`, scoped
   to dbt). Docs: plan, this file, ADR-035, `CLAUDE.md`. A ready commit message is not stored in
   the repo — write one; the gates were `make check` 420, `make test-all` 469 (2 skipped),
   `make web-check` 386, licence audit unchanged.
2. Nothing on `feat/range-lab` is pushed yet; **after a push, when the CI `web` job is green,
   tick F.1** (it is the one step held open purely on a CI run).
3. **F.11 Training modes** (plan F.11, spec §16). Concretely: the six modes, the scoring store,
   `/progress`, spaced repetition, and the **heuristic log with its 14-day review prompt** —
   which is a query over `analyses.heuristic`, the column F.9 deliberately kept out of the steps
   JSON for exactly this. `/v1/heuristics` follows the same shape as `/v1/analyses`.
   `PredictionGate`, `scorePrediction` and the step definitions in `analyze/steps.ts` are the
   reusable pieces — the nine questions, tolerances and units are already data, not code.
   **Done means** acceptance 11.
4. Carried over, unchanged: **B.5b**'s `core.*` rebuild; the phase-E performance note; the real
   Postgres `users` table still holds old `e2e-*`/`iso-*` test accounts; on a comma-decimal
   locale `PotOddsPanel`'s number inputs display `2,5` for 2.5 (recorded for F.12).

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
- [x] F-301 Flag table (dbt intermediate → `marts.player_hand_flags`) *(replaced by `marts.decisions` + `marts.player_hands`, plan C.2/C.6)*
- [x] F-302…F-310 Core stat library (~20 stats, all sliceable by position/stake/site/date) *(now 65 registry stats)*
- [x] F-311 Stat definitions registry (`dim_stat_definitions`) *(now `stats/registry/` → generated `marts.stat_definitions`)*
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
the marts are `decisions` **3.84 GiB** (73.7M rows, 55.9 B/row), `player_hands` **2.18 GiB**
(54.6M rows, 43 B/row) and `stats_daily` 278 MiB — the v1 `player_hand_flags` was 3.20 GiB for
the same hands, 52% of it the 32-char `hand_uid` that plan B.5b turned into `FixedString(16)`
on the marts (`core.*` still holds the hex). (The earlier "143.75M actions" was a physical count
including ReplacingMergeTree duplicates.) Chain state: 160/160 daily partitions on every model;
the v2 facts were bootstrapped on 2026-09-09 in 35 passes / 641 s and the rollup in 35 passes /
186 s on the 4 GB node.
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
| 2026-09-11 (24) | **Plan F.10 done — tier 3, empirical EQR, and the §5b corpus re-parse.** Committed F.9 (`5852d14`). Tier 3 reconstructs a prior you bring by a **likelihood ratio** rather than the spec's literal estimator, which saturates at ~97% on real data because folders are never shown (ADR-035); empirical EQR sits beside it on a new `decisions.invested_bb`. Then **§5b**: `scripts/reparse.py` re-read all 2,492 objects from object storage (9,079,995 hands stored, 19,097 `pot_mismatch` failures, **0 unreadable**), and the chain was rebuilt with **no downtime** — `ALTER TABLE ... ADD COLUMN ... AFTER` plus the ordinary backfill, since `REPLACE PARTITION` only wants identical structure. **Pool showdown-seat card coverage went 17.4% → 100.0%**, pool decision coverage 1.89% → **13.35%**, and the BB flop lead went from 35 of 51 chart classes reweighted to **169 of 169**. The **hero fingerprint did not move** (.229573 / .188466 / .033835 / −1.37) — the load-bearing check, since hero exports always had their own cards. Three real bugs surfaced and were fixed: the backfill ran whole-table data tests every pass and `dbt build` skipped the anchor downstream of their failure (`--skip-tests`); an `ALTER` dirties no partition, so **both hero months silently kept `invested_bb = 0`** (`--rebuild-from`); and the assertion that should have caught that sampled by date, covering 4 months of 10 — it now samples by `cityHash64(hand_uid)`. Dead letters deduped to one generation (128,340 → 19,117; original kept as `core.parse_failures_pre_dedupe_20260911`). Verified in Chrome, read-only: tier 3 reweighted 51 of 51 (AA 4.90×, KK 4.77×, JTo 0.57×), implied 19.1% vs observed 14.7%; the **EQR panel now answers** (52.5% of pot, 8.33 bb from here) where it could only say `needs_rebuild` before; one copy bug fixed where full coverage made "the rest" describe an empty set. `make check` 420, `make test-all` 469, `make web-check` 386. Uncommitted. | **Commit F.10 + §5b, then F.11** (training modes). |
| 2026-09-10 (23) | **Plan F.9 done — the 9-step analyzer.** Committed F.8 (`45ff8f3`). `analyses` in Postgres with **merge-by-step** saves (`/v1/analyses`), so an autosave of one step can never lose another; `PredictionGate` (the truth is fetched only after the answer is committed) and `StepperNav` in `poker-ui`; the `analyze/` module in the app (the nine questions as data, the spot the earlier steps build, every reveal computed and hand-counted in tests, Dexie autosave with an offline queue and retry); nine step components; `/analyze`; and **Analyze this node** on the replayer. Verified in Chrome against the **real** pool, read-only: all nine steps run on one of the founder's NL10 hands, a prediction committed at each, ending in a saved heuristic and `9 of 9` — **acceptance 9**; the CO folds 43.2% (n = 3,988) against an MDF of 39.8%. Four browser-found defects fixed (a stale step snapshot losing a patch; `classifyCombos` throwing on a partial board; step 8 reading its own size; step 9 asking the wrong side of the bet) and one server bug: the shared ClickHouse client refused concurrent queries because of its session id. `make check` 387, `make test-all` 429, `make web-check` 364. ADR-034. Uncommitted. | **Commit F.9, decide on the re-parse, then F.10** (tier 3 + empirical EQR). |
| 2026-09-10 (22) | **Plan F.8 done — the pool at a node, and the parser gap behind it.** Committed F.7 (`317fab4`). Answered the plan's first question: the pool's missing showdown cards were a **parser gap** — observed GG tables print revealed cards only in the per-seat SUMMARY, which the parser skipped (752 of 752 sampled cardless showdown seats had them there). Fixed with `SEAT_SUMMARY` + `summary_seat_line`; a whole real pool file goes from 18.5% to 100% card coverage on re-parse, and §5b holds the re-parse plan for the founder to schedule. Then the step itself: `raise_to_bb` buckets, `node_filter` (a `NodeKey` as a predicate over `decisions`, the villain named only through a column that means it, the stack by registry bucket), `node_service` tiers 1 and 2 as `run_report` calls, `POST /v1/pool/node/{frequencies,showdown-range}` with `MIN_N = 100` and no numbers below it, `PoolDataBadge`, the pool column of `/ranges/compare` (per-combo weights) and the replayer's frequencies panel. Verified in Chrome against the **real** pool read-only: real nodes answered with n in the millions, the UTG-RFI showdown range drawn with its coverage caveat, a thin node gated — **acceptance 10**. Fixed `nodeKeyAt` carrying every street into the sequence. `make check` 377, `make test-all` 410, `make web-check` 323. ADR-033. Uncommitted. | **Commit F.8, decide on the re-parse, then F.9** (the 9-step analyzer). |
| 2026-09-10 (21) | **Plan F.7 done — the hand replayer.** Committed F.6 (`951107a`). Replay engine in `poker-core/src/hand/`: one hand shape for all three sources, `replayStates` (chips as *committed in front* plus the *settled pot*; the street's bets collected exactly when the next card is dealt; the engine's pot and to-call checked against the parser's own figures for every action of a real hand), and `nodeKeyAt` (the situation **ending with the decision just made**, so stepping walks the node tree). `poker-ui`: `PokerTable` (6-max oval, stacks in bb, chips in front, board, pot, button, the seat to act, the last action as a bubble, the winner named at the end), `HandActionLog`, `HandReplayer` (step, seek, play, `←`/`→`/space/`1`–`4`). Backend: `POST /v1/hands/parse` (ADR-029 — nothing stored; two hands or a hand that does not reconcile are refused in words), `POST /v1/hands/search` (the report filter asked backwards, answering with decisions so the seat comes too), `GET /v1/pool/hands`, `seat` on `HandSummary`. App: `/hands` (my hands · pool, situation filter), `/hands/[id]`, `/hands/paste`, `HandStudy` binding my stored chart, pot odds, MDF, distribution and equity to the current node. Verified in Chrome on the test databases — **acceptance 8** (the two stored ranges at the node gave 64.2% / 35.8%), a pasted hand replayed, junk refused, pool hands listed on their showdown seat. Found and fixed the `FixedString(16)` hand id in the decision mart (the search was silently empty). `make check` 354, `make test-all` 385, `make web-check` 317. ADR-032. Uncommitted. | **Commit F.7, then F.8** (pool integration, tiers 1 and 2). |
| 2026-09-10 (20) | **Plan F.6 done — range library and importers.** Committed F.5 (`021f7ae`). `NodeKey` defined once (`analysis/pool/nodes.py`; twin `poker-core/src/node.ts`; `tests/fixtures/nodes.json` parsed by both suites; the sequence ends with hero's action). Postgres `ranges` + append-only `range_versions` (migration `c4d5e6f7a8b9`), `/v1/ranges` (list with filters, bulk with skip-or-version, lookup by the typed key, export, versions, revert as a new version; the body is canonical combo text, validated with the entry number). `packages/poker-importers` (SPH, own JSON, GTO Wizard, Pio, Equilab, CSV, plain text; detection; folder report; filename inference with confidence; `.bin` refused, nothing decoded). App: `/ranges` (browse, filters, backup), `/ranges/[id]` (matrix, `NodeKeyEditor`, history, revert), `/ranges/import` (drop or pick, review table, per-row situation editing, batch source/tool/tags, report), `/ranges/compare` (my chart · solver · pool stub, `RangeDiffView`, `RangeDisagreementTable`); Dexie copy with offline fallback. Verified in Chrome against the API on the `test_` databases: import → review → compare (acceptance 7), versions and revert, offline list. Two browser-found defects fixed with tests. `make check` 338, `make web-check` 277, 5 integration tests. ADR-031. Uncommitted. | **Commit F.6, then F.7** (hand replayer). |
| 2026-09-10 (19) | **Plan F.5 done — metrics and visualization UI.** Committed D.2 (`3e5cabe`). `packages/poker-ui`: `glossary.ts` (25 terms, one sentence + formula) behind `MetricLabel` (typed `GlossaryKey`; a test scans the components for static labels), `explain.ts` (the "explain the number" templates), `PotOddsPanel` (raw and after-rake, implied odds as an estimate, rake behind Advanced), `MDFPanel` (MDF/alpha, the defending set → villain's matrix), `EQRPanel`, `EquityDistributionChart` + `EquityBucketBars` (plain SVG — ADR-030, no Chart.js, no new dependency), `RangeComparisonPanel` (mean/median, nut split bar, buckets, graph), `RangeDiffView` (signed heatmap on `RangeMatrix`); `poker-core/metrics`: `equityCurve`, `equityAtShare`, `defendingSet`. Wired into `/lab` and `/dev/components`. Found and fixed an F.4 defect: `EquityCalculator` restarted on every parent re-render (fresh `ranges` array) and, once the panels consumed the result, cancelled the exact job forever while Monte Carlo looped — it now watches `equityKey` (regression test). Verified in Chrome without the API: acceptance 3 (exact in 177 ms after a board change, both curves drawn), acceptance 6 (pot 100 / bet 66: 2.5 : 1, 28.4%, MDF 60.2%, alpha 39.8%; after a 5% rake capped at 3: 59.5% / 40.5% / 28.8%), tooltips on all 24 labels. `make web-check` 217 tests. Uncommitted. | **Commit F.5, then F.6** (range library + importers). |
| 2026-09-10 (18) | **Plan D.2 done — sign-in in the SPA.** Committed F.3 (`fd11451`) and F.4 + D.1 (`232e096`). Built `apps/web/app/auth/{api,session,paths}.ts` (framework-free; 17 tests with a fake `$fetch`), the Pinia `stores/auth.ts`, `useApi()` (bearer header, 401 → one shared refresh → retry), `middleware/auth.global.ts` (protected by default, `definePageMeta({ public: true })` opts out), pages `/login`, `/register`, `/account`. Verified in Chrome with `ACCESS_TOKEN_MINUTES=1`: an expired token refreshes silently on the next call (`/me` 401 → `/refresh` 200 → `/me` 200) with the page unchanged; reload resumes from the cookie; sign-out revokes it; no token in `localStorage`. `make web-check` 190 tests. Uncommitted. | **Commit D.2, then F.5** (metrics and visualization UI). |
| 2026-09-10 (17) | **F.4 done, plan D.1 done — the Range Lab has a UI.** `apps/web`: Nuxt 4.5 in SPA mode with Tailwind 4 and Pinia; `/` calls `GET /health` (showed `ok / ok / ok` against the live API in Chrome), `/lab` is the calculator (two matrices with undo/redo and a weight brush, text I/O in both notations, board and dead cards, equity with Monte Carlo first then exact, hero-vs-villain distribution with group-click highlighting, blockers with hero's hand and the bluff arithmetic, the 52-card removal heatmap), `/dev/components` shows every component with fixtures. `packages/poker-ui`: `RangeMatrix` (partial fill, drag/shift-drag, brush, heatmap overlay, blocked shading, highlight ring, arrow keys + Enter/Space), `RangeTextIO`, `CardPicker`, `BoardSelector`, `CardRemovalPanel`, `EquityCalculator` (service through a prop — poker-ui imports poker-core only, enforced by ESLint), `ComboDistributionPanel`, `BlockerPanel` (sortable; class breakdown for the selected hand), `CardBlockerHeatmap`, `ComboDrilldown`, `useUndoRedo`, own theme tokens. Acceptance 1, 2, 4, 5 verified in Chrome by script (byte-identical 10,618-char round trip; QQ 75% / AKo 50%; Overpair → AA ringed; A♥5♠ → "overpair 6 → 3, ace high 144 → 105…" + ranked bluffs). Two browser-only defects found and fixed: the WASM package initialised on import (now a dynamic import in `WasmEvaluator.ready()`), and Vue reactive arrays cannot cross `postMessage` (plain copies). `make web-check` 173 tests, licence audit clean (`caniuse-lite` CC-BY data excluded by name, `node-forge` dual BSD/GPL under BSD, both recorded). Uncommitted. | Commit F.3 + F.4 → **D.2** auth in the SPA → **F.5** |
| 2026-09-10 (16) | **F.2 committed** (`2216e3e`; founder: "commit and continue"). **F.3 done — the headless core is complete.** `metrics/`: MDF, alpha, required equity (both forms), bluff break-even, odds text, implied odds, `RakeConfig` (pct + cap) with `potOdds()` giving raw and rake-adjusted figures side by side, EQR both ways, weighted mean/median, equity buckets, `rangeAdvantage`, `nutThreshold` on the combined distribution and `nutAdvantage` in cutoff and top-percent modes with the nut-share split. `blockers/`: §6.1 scores from per-card weight sums (dead cards removed first), 52-card removal heatmap overall and per made-hand class, class-removal breakdown for a hero combo across made and draw classes ("flush draws 5 → 2"), board effects card by card, bluff candidates ranked by `bluffScore` and sized to the bet with shortfall, unblockers, value candidates. `distribution/`: six axes (made, draw, strategic with visible thresholds, equity bucket, structure, nut), nested tree with raw / weighted / share at every level and multi-membership on the draw axis, compare (hero vs villain or before vs after), CSV and text export. **Spec deviation recorded in the plan:** balanced bluffs-per-value is `bet/(pot+bet)` (= alpha); the spec's `alpha/(1−alpha)` contradicts its own 1 : 2 example. 31 hand-worked tests (two of my hand counts were wrong, the code was right: 7d6d's backdoor flush with the Kd, and a wheel backdoor). `make web-check` 144 tests green. Uncommitted. | Commit F.3 → **F.4** app shell (= D.1) + `poker-ui` |
| 2026-09-10 (15) | **F.0 + F.1 committed** (`af4626c` docs, `e74c148` code; founder: "commit and continue"). **F.2 equity engine done.** Measured the three evaluators first: WASM binding 465 ns per `rank7` (embind objects), reference 152 ns, so built `evaluator/fast.ts` — table-driven (49,205-entry rank-count hash + 8,192-entry flush table, filled from the reference at first use), 76 ns, three-way agreement on 200k hands. `equity/`: exact heads-up by enumerating every runout, each side ranked once, weights bucketed by rank with prefix sums and indexed by card so card removal is exact in two binary searches per combo; Monte Carlo for preflop and 2–10 players (whole-matchup draws with tuple rejection, `confidence95`); `AbortSignal` cancellation, progress, `equityKey`. `packages/poker-workers`: `EquityService` (cache, cancel by id, supersede) + Comlink worker and client. Fixture `equity_spots.json`: 35 spots enumerated by brute force in Python with treys (independent evaluator), all exact spots within 0.01 pp incl. per-combo equities, preflop within 0.5 pp. Bench: flop 181 ms (full vs full 413), turn 8, river 1, preflop MC 100k 74 ms — every §5.3 target met with room. ESLint now enforces 40-line functions / 300-line files. `make web-check` 113 tests. Uncommitted. | Commit F.2 → **F.3** blockers, distribution, metrics |
| 2026-09-10 (14) | **Range Lab spec received; Phase 0 done; F.1 started.** Committed phase C (`f18049b`) and the founder's spot census (`f973f82`) separately, fast-forwarded `main`, branched `feat/range-lab`. Saved the spec verbatim (`POKER_RANGE_LAB_SPEC.md`); wrote the exploration report (`POKER_RANGE_LAB.md`): a node is a predicate over `marts.decisions`, tier-1 frequencies and tier-2 showdown classes are single `run_report` calls, buckets already live in the registry, the frontend is greenfield, auth is bearer + rotating HttpOnly refresh. Verified Appendix A byte for byte against the founder's `.bin` file (now gitignored). Counted pool showdown cards: 387,740 seats with cards of 2,227,803 at showdown — F.8 must explain the gap from the raw text. Founder decided (4 questions): one Nuxt 4 SPA shell, server-side hand parsing, `.bin` out of git, commit first. ADR-027…029; plan phase F (13 steps) with its ordering against D. **F.1 built and verified locally**: `platform/web/` npm workspace (corepack broken here; npm needs `--legacy-peer-deps`), `packages/poker-core` — cards/combos, `WeightedRange` + all §4.2 ops, combo notation (byte-identical 1326-entry round trip against a Python-generated fixture), class notation (`AQs+`, `A5s-A2s`, `:0.5`, auto-detect, actionable errors; connectors climb, other hands keep the high card, gappers warn), pure-TS Cactus-Kev evaluator (all 2,598,960 five-card hands → exactly 7,462 ranks) + PHE WASM binding agreeing on 100,000 seeded hands, board-relative made-hand/draw classifier; 61 tests; `make web-check` (tsc, ESLint, Vitest, licence audit with the ADR-027 allowlist) green; CI `web` job (Node 24) added; `LICENSES.md` with MPL `lightningcss` and CC-BY `spdx-exceptions` flagged. `make check` 310. Uncommitted. | Commit → push → CI green → tick **F.1** → **F.2** equity engine |
| 2026-09-09 (7) | **Off-plan (founder request): pool spot-frequency census + board texture.** Five new modules — `scripts/spot_nodes.py` (preflop/flop *node* per hand from `core.actions`, e.g. `BU open, BB call`; seat→position is a fixed lookup because `button_seat` is always 1, and `FINAL` is skippable because `parser_version` is uniform and `hand_uid` unique, both asserted at runtime by `verify_corpus_assumptions()`), `spot_texture.py` (flop classifier, ace counted **high or low** so A-2-3 is connected), `spot_report.py`, `spot_plan.py`, `spot_frequency.py` → `reports/spot_frequency.{md,csv}`. One unified ranking of all 346 nodes over 9,093,794 six-max hands: 5 spots = 43% of decisions, 10 = 62%. **Three findings.** (1) The texture classifier is parity-checked each run against enumeration of all C(52,3)=22,100 flops — connectedness and suitedness match to 0.07pp, confirming the board parser. (2) The high card deliberately does *not* match, and the deviation is card removal: ace-high flops fall monotonically 23.89% (limped) → 21.7% (SRP) → 20.2% (3bet) → 17.9% (4bet) → 15.1% (5bet), vs 21.74% for a random deck. Texture is otherwise independent of the spot, so spot × texture is a clean product. (3) A node ending in a raise can still show flops — an already-all-in player owed a runout, not a parse bug. **Found a real defect in the dbt chain:** `int_board_texture.sql` computes straight span ace-high only, so A-2-3 lands in `disconnected`; it disagrees with this classifier and should be fixed. `make check` 240 green. **Overlaps plan C.2** — this node grammar is C.2's action-line tokens; reconcile with `marts.decisions`, do not duplicate. | Back to plan **C.2** (decision model); fix `int_board_texture.sql` wheel handling |
| 2026-09-10 (13) | **Plan C.7 + C.8 done — phase C complete.** `analysis/` package (ADR-026): hero leaks ranked by `\|delta\|·√n` with a `min_n` floor, baseline through the `BaselineProvider` seam (population or a cohort); sessions by gap in play (ClickHouse window functions); pool reports, player lookup by prefix, cohorts by stat criteria; YAML presets validated at load. Engine extension for cohorts: `player_key` as a rollup dimension and `ReportRequest.cohort` compiled to a per-player `HAVING` subquery (`stats/query.py`, `stats/cohort.py`); Postgres `cohorts` (migration `8b2f4c6d1e3a`). Routers `api/routers/{hero,pool}.py` (analysis may not import api). Real data: 33 leaks in 1.3 s (steal +9, c-bet flop +18, fold to 3-bet +22 points vs the pool), 55 sessions, regs = 7,711 players, regs by position in 0.2 s. Phase-C exit demonstrated: a new situation as a filter — hero 0.05 s, pool 1.6 s (was 4.3 s; `hands` on `decisions` is now `uniqCombined64(20)`). `make check` 310, `make test-all` 328 + 2 skipped. Uncommitted, pending the founder's word. | **D.1** Nuxt scaffold |
| 2026-09-09 (12) | Founder said "drop". **C.6 cut-over done**: nine v1 ClickHouse tables dropped one statement at a time with counts checked, `marts.stats_daily_v2` renamed to `marts.stats_daily`, `int_hand_arrays` turned into the `hand_arrays()` macro (verified hash-identical on 2024-12-31, the densest day, 505 MiB peak) and its 2.39 GiB table dropped; in the repo the nine v1 dbt models, both hand-written law tests, `api/queries.py` + its three test files and `scripts/pool_report.py` deleted, `_v2` suffix gone, the v1 counter pairs frozen in `scripts/v1_stats.py`, size baseline empty, README/CLAUDE.md layout updated. Verified: `make check` 275, `make seed` (chain + 23 dbt tests on the test corpus), `make dbt-build` 32/32 real data nothing dirty, backfill 0 passes, `make test-all` 289 + 2 skipped, pool VPIP/RFI by position = `pool_leaks.csv` within rounding; c-bet flop differs by the (now fuller) registry note — v1 counted all-in preflop aggressors as missed c-bets. | **C.7** analysis modules |
| 2026-09-09 (11) | C.5 merged (`cab27e3`). **C.6 parity done**: `scripts/fingerprint.py` → `reports/parity_2026-09-09.md`, 756 cells, 0 mismatches, 20 more registry `notes`; two v1 undercounts found (4-bet%, 5-bet%). Cut-over drops await confirmation. | Plan **C.6 cut-over** (after the founder confirms the drops) |
| 2026-09-09 (10) | C.4 merged (`a2b8741`). **Plan C.5 done**: `/v1/definitions`, `/v1/reports/run`, saved filters/reports/stats CRUD (migration `513730dcd5be`), v1 `/v1/stats*` routes as adapters over the engine. 12 unit + 3 integration tests; `make check` 317, `make test-all` 331 + 2 skipped. | Plan **C.6** (parity report, then the v1 cut-over) |
| 2026-09-09 (9) | C.3 merged (`af503bb`). **Plan C.4 done**: `stats.service.run_report` — resolve, route (rollup vs facts by stats and dimensions), one bound-parameter query per plan, merge, population baseline, per-tenant cache; 37 new unit tests (305); real reports verified from all three tables. | Plan **C.5** (API v2 + saved filters/reports/stats) |
| 2026-09-09 (8) | C.1 + C.2 committed and merged into `main` (`8d8b5ac`). **Plan C.3 done**: `scripts/gen_stats.py` renders the rollup (`marts.stats_daily_v2`), the definitions seed and the law test from the registry; `stats/compiler.py` underneath; `make gen`/`gen-check`/CI extended. Rollup bootstrapped in 35 passes / 186 s at ≤1.66 GiB; sums equal the facts and v1; law test green on real data. `make check` 273. | Plan **C.4** (router + service on the compiler) |
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
| Generator | `platform/scripts/pool_report.py` at commit `cab27e3` — deleted with the v1 chain (plan C.6); the same figures come from `POST /v1/reports/run` on `population` |
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
