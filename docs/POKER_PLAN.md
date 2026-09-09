# Poker platform — v2 plan (the file an implementing session works from)

> **Read this after [POKER_STATUS.md](POKER_STATUS.md).** STATUS says *where the build is*; this file
> says *what to build next and how*. "Continue" means: the first unchecked step below.
> Findings that motivate every decision here are in [POKER_AUDIT.md](POKER_AUDIT.md) (B1…B15 refer to
> its numbered findings). Decisions are recorded as ADR-019…026 in [POKER_DECISIONS.md](POKER_DECISIONS.md).

## Status

| | |
|---|---|
| **Phase** | A — Stabilize |
| **Next step** | **A.0** — checkpoint commit (ask the founder first) |
| **Last updated** | 2026-09-09, by the audit session (docs only, no code changed) |
| **Blockers** | ClickHouse container stopped; the anchored rebuild from 2026-09-09 is unverified (B15) |
| **Rules** | Tick a step only when its **Done means** is verified. Add a row to §6 at the end of every session. Never commit without asking. Never load synthetic hands into the analysis databases (`core.*`/`marts.*`) — tests use the `test_` prefix from B.4 on. |

---

## 1. Goals and non-goals

**Goals (the founder's four requirements, made testable):**
1. **Any stat for any situation and kind of play** — a new *situation* is a filter (zero deploys); a new
   *built-in stat* is one registry entry plus `make gen`; a *user stat* is a saved row. Answers on the
   full 9M-hand pool in under a second on a 4 GB node; hero queries in milliseconds.
2. **Module isolation** — an import-linter contract enforces `core ← parser ← ingestion ← stats ←
   analysis ← api`; storage behind Protocols with fakes; one ingest loop; schema in one place.
3. **Easy to add** — every extension point is a registry: parsers, sinks, validation rules, stats,
   dimensions, report presets, analysis modules, UI panels.
4. **Obvious UI** — two areas that mirror how players think (*My game* / *Pool*), one filter model
   everywhere, every number with its sample size, plain-English labels with definitions on hover.

**Non-goals for v2:** live HUD (F-8xx), solver integration (F-904/905), Iceberg/Spark (F-206/B06),
Airflow (F-B05), billing (F-704), new site parsers. Seams stay; nothing else moves.

---

## 2. Target architecture

### 2.1 Layers

```
 L0  object storage      raw hand text, zstd, forever                          (unchanged)
 L1  core.*              canonical facts: hands / hand_players / actions / pot_winners   (unchanged + dataset on all four)
 L2  marts.decisions     ONE ROW PER DECISION with full situation context      ← ADR-020, the truth for situations
     marts.player_hands  one row per (hand, player): dimensions + hand outcomes ← replaces the 156-col flag table
 L3  stats registry      YAML: stats, dimensions, presets                      ← ADR-021, single source
 L4  marts.stats_daily   GENERATED rollup of cached stats (SummingMergeTree)   ← speed for the default reports
 L5  stats/ engine       filter AST → compiler → table router → service       ← ADR-022
 L6  analysis/hero, analysis/pool   two modules, own routers/presets           ← ADR-026
 L7  api/ + web/         FastAPI routers (thin) + Nuxt 4 app                   ← ADR-024
```

### 2.2 Module map and dependency contract (ADR-023, ADR-026)

```
platform/
  core/         models, enums, ids, validation, settings, schema      depends on: nothing
  parser/       registry + sites/                                     core
  ingestion/    pipeline (ONE loop), sinks/ (Protocols + impls + fakes), rows/, worker   core, parser
  stats/        registry/, ast, compiler, router, service              core
  analysis/
    hero/       overview, reports, leaks, sessions  (+ presets.yaml)   stats, ingestion(read client)
    pool/       population stats, cohorts, players, ranges, baselines  stats, ingestion(read client)
  api/          FastAPI app, auth, routers that call analysis/* and ingestion/*   everything above
  web/          Nuxt 4                                                  HTTP only
  dbt/          staging → intermediate → marts (generated files marked)  —
  ch/           migrations + runner                                     core (settings)
  scripts/      thin CLIs                                                anything
```

Contract (`.importlinter`, run by `make lint-arch` inside `make check`):
- layers `api > analysis > stats > ingestion > parser > core` (a lower layer never imports a higher one);
- `analysis.hero` may import `analysis.pool.baselines` **only** (the `BaselineProvider` Protocol); `analysis.pool` never imports `analysis.hero`;
- `api` never imports `parser.sites.*` or `ingestion.sinks.*` implementations directly;
- nothing imports `scripts`.

Extension registries (adding a thing = adding an entry, never editing a consumer):

| Kind | Registry | Adding one |
|---|---|---|
| Site parser | `parser/registry.py` (exists; gets explicit `priority` + ambiguity error in A.7) | one file + `register()` |
| Sink | `ingestion/sinks/__init__.py` (`HandSink`, `RawStore`, `EventBus` Protocols) | one impl module + settings switch |
| Validation rule | `core/validation.py: RULES: list[Rule]` | one function appended |
| Stat / dimension | `stats/registry/*.yaml` | one YAML entry + `make gen` |
| Report preset | `analysis/<module>/presets.yaml` | one YAML entry |
| Analysis module | `analysis/<name>/` with `router.py`, `presets.yaml` | one package + one `include_router` |
| UI report panel | `web/components/reports/<Type>.vue` registered in `web/composables/useReportTypes.ts` | one component |

### 2.3 Data model

**`marts.decisions` — one row per decision point** (a seat that must act; blind/ante posts, shows, mucks,
uncalled returns and wins are not decisions). Est. ~65M rows for the current corpus.

```sql
CREATE TABLE marts.decisions (
  -- identity / tenancy
  user_id UInt32, dataset LowCardinality(String), hand_uid String,
  played_at_utc DateTime64(3,'UTC'), played_date Date,
  seat UInt8, player_key Nullable(String), player_key_norm String, is_hero UInt8, is_anonymized UInt8,
  action_index UInt16,                       -- global order in the hand (join key to core.actions)
  decision_idx UInt8,                        -- n-th decision of THIS seat in the hand, 0-based
  street Enum8('preflop'=0,'flop'=1,'turn'=2,'river'=3),
  -- table dimensions (denormalized from core.hands / hand_players)
  site LowCardinality(String), stake_level LowCardinality(String), game_type LowCardinality(String),
  table_format LowCardinality(String), big_blind Decimal(18,4), players_dealt_in UInt8,
  position LowCardinality(String),
  -- SITUATION: preflop state as of this decision
  n_raises_preflop UInt8, n_limpers UInt8, n_callers_before UInt8, n_cold_callers UInt8,
  am_preflop_opener UInt8, am_preflop_aggressor UInt8,
  opener_position LowCardinality(String), last_raiser_position LowCardinality(String),
  pot_type LowCardinality(String),           -- final preflop shape: limped/srp/3bet/4bet/5bet_plus (hand-level)
  -- SITUATION: this street as of this decision
  n_bets_street UInt8, n_raises_street UInt8,
  facing LowCardinality(String),             -- none | limp | bet | raise | 3bet | 4bet | 5bet_plus
  facing_is_cbet UInt8,                      -- the bet in front is the preflop aggressor's first bet this street
  facing_size_pct Float32, to_call_bb Float32, pot_before_bb Float32,
  players_live UInt8, players_acted_before UInt8, is_first_to_act UInt8, is_last_to_act UInt8, is_ip UInt8,
  am_prev_street_aggressor UInt8, prev_street_my_action LowCardinality(String), prev_street_faced LowCardinality(String),
  preflop_line String, street_line String, line_so_far String,   -- 'r-c', 'x-b', 'pf:r-c|f:x-b' (uppercase = this seat)
  eff_stack_bb Float32, spr Float32,         -- RAW numbers; buckets are presentation (registry)
  -- SITUATION: board at this street
  flop_suitedness LowCardinality(String), flop_pairing LowCardinality(String), flop_high_card LowCardinality(String),
  flop_connectedness LowCardinality(String), flop_span UInt8,
  turn_rank LowCardinality(String), turn_completes_flush UInt8, turn_pairs_board UInt8,
  river_rank LowCardinality(String), river_completes_flush UInt8, river_pairs_board UInt8,
  board_paired UInt8, board_flush_possible UInt8, board_straight_possible UInt8,
  -- SITUATION: holding
  hand_class LowCardinality(String), hand_shape LowCardinality(String), hole_cards String,
  made_hand LowCardinality(String) DEFAULT '',   -- reserved; filled when the evaluator (F-902) lands
  -- THE DECISION
  action Enum8('fold'=0,'check'=1,'call'=2,'bet'=3,'raise'=4), is_allin UInt8,
  amount_bb Float32, size_pct Float32, raise_to_bb Float32,
  -- OUTCOME (hand-level, repeated so outcome stats need no join)
  saw_next_street UInt8, went_to_showdown UInt8, won_hand UInt8, net_won_bb Decimal(12,4), ev_won_bb Decimal(12,4),
  -- meta
  parser_version UInt32, src_parsed_at DateTime64(3,'UTC')
) ENGINE = MergeTree
PARTITION BY toYYYYMMDD(played_at_utc)
ORDER BY (user_id, dataset, player_key_norm, street, played_date, hand_uid, action_index);
```

`facing` derivation — preflop: 0 raises & 0 limpers → `none`; 0 raises & limpers → `limp`; 1 → `raise`;
2 → `3bet`; 3 → `4bet`; ≥4 → `5bet_plus`. Postflop: no aggressive action yet → `none`; one bet → `bet`;
bet + raise → `raise`; more → `3bet`. Every "before this decision" fact comes from per-hand arrays
(`groupArray` over `stg_actions`, then `arrayCount`/`arrayFilter` on `action_index < this index`) — the
technique already proven in `int_preflop_context.sql`, which keeps the right side of every join at hand
grain (9M rows), never at decision grain.

**`marts.player_hands` — one row per (hand, player)**: the identity + table dimensions above, plus
`did_vpip`, `did_pfr`, `saw_flop`, `saw_turn`, `saw_river`, `went_to_showdown`, `won_hand`,
`net_won_bb`, `ev_won_bb`, `showdown_won_bb`, `nonshowdown_won_bb`, `rake_paid_bb`, `hand_class`,
`hand_shape`, `pot_type`, `players_to_flop`, flop texture, `stack_bb`, `src_parsed_at`. Hand-grain
stats (VPIP, PFR, WTSD, WWSF, W$SD, bb/100) read it. This replaces `marts.player_hand_flags`; it has
~25 columns, not 156. It is the **anchor** for the incremental gate (replaces `player_hand_flags` in
`macros/incremental.sql` and `scripts/backfill.py`).

**`marts.stats_daily` — generated** (§2.4). `SummingMergeTree` with **every group key in the ORDER BY**
(fixes B5): `(user_id, dataset, player_key_norm, day, site, stake_level, game_type, table_format, position)`.
One `x_opp`/`x_action` pair per stat marked `cached: true`, computed from `decisions` (decision-grain)
and `player_hands` (hand-grain) in one dbt model.

**`core.*`:** add `dataset` to `core.actions` and `core.pot_winners` (migration 0009) so every core
table prunes on it; write the three orphan columns (B11).

### 2.4 The stat registry (ADR-021)

`platform/stats/registry/dimensions.yaml`, `platform/stats/registry/stats/{preflop,postflop,showdown,money}.yaml`.

```yaml
# dimensions.yaml (excerpt)
- code: position
  label: Position
  type: enum
  values: [UTG, UTG1, UTG2, MP, MP1, HJ, CO, BTN, SB, BB]
  ops: [in, not_in, eq, ne]
  tables: [decisions, player_hands, stats_daily]
- code: spr
  label: Stack-to-pot ratio at the decision
  type: number
  ops: [lt, lte, gt, gte, between]
  tables: [decisions]
  buckets: {'0-1': [0,1], '1-3': [1,3], '3-6': [3,6], '6-13': [6,13], '13+': [13,null]}   # presentation only
- code: facing
  label: What the player is facing
  type: enum
  values: [none, limp, bet, raise, 3bet, 4bet, 5bet_plus]
  ops: [in, not_in, eq, ne]
  tables: [decisions]
- code: street_line
  label: Action on this street so far
  type: line
  ops: [prefix, like, eq]
  tables: [decisions]
```

```yaml
# stats/postflop.yaml (excerpt)
- code: fold_to_cbet_flop
  label: Fold to c-bet (flop)
  category: postflop
  grain: decision
  situation:
    all:
      - {dim: street, op: eq, value: flop}
      - {dim: facing, op: eq, value: bet}
      - {dim: facing_is_cbet, op: eq, value: 1}
  action: {dim: action, op: eq, value: fold}
  higher_is_better: null
  typical: [40, 55]
  cached: true
  description: Folded when facing the preflop aggressor's first bet on the flop.

- code: squeeze
  label: Squeeze
  category: preflop
  grain: decision
  situation:
    all:
      - {dim: street, op: eq, value: preflop}
      - {dim: facing, op: eq, value: raise}
      - {dim: n_cold_callers, op: gte, value: 1}
  action: {dim: action, op: eq, value: raise}
  typical: [4, 12]
  cached: true

- code: vpip
  label: VPIP
  category: preflop
  grain: hand                       # reads player_hands
  situation: {all: []}              # every hand dealt in
  action: {dim: did_vpip, op: eq, value: 1}
  typical: [18, 28]
  cached: true

- code: af_flop                     # arithmetic beyond a single ratio (was inexpressible)
  label: Aggression factor (flop)
  category: postflop
  grain: decision
  format: ratio                     # plain ratio, not a percentage
  numerator:
    add:
      - {countIf: {all: [{dim: street, op: eq, value: flop}, {dim: action, op: eq, value: bet}]}}
      - {countIf: {all: [{dim: street, op: eq, value: flop}, {dim: action, op: eq, value: raise}]}}
  denominator:
    countIf: {all: [{dim: street, op: eq, value: flop}, {dim: action, op: eq, value: call}]}
  cached: false
```

Consumers — generated or loaded, never copied by hand:
- `scripts/gen_stats.py` (`make gen`) renders `dbt/.../marts/stats_daily.sql`, `dbt/.../seeds/dim_stat_definitions.csv`,
  `dbt/.../tests/assert_action_le_opportunity.sql` (every pair), and `web/generated/definitions.json`
  (optional, for offline typing). Generated files carry `-- GENERATED … do not edit`. CI runs
  `make gen && git diff --exit-code`.
- `stats/registry.py` loads YAML into Pydantic models at import, validates every predicate against
  the dimension registry (dimension exists, op allowed, value in enum / correct type, table claims consistent).
- `GET /v1/definitions` serves the registry; the UI reads labels, categories, descriptions, typical
  ranges, dimension types/values/ops from it and holds no stat logic.

### 2.5 Filter AST and custom stats (ADR-022)

```
Node   := Leaf | {"all": [Node…]} | {"any": [Node…]} | {"not": Node}
Leaf   := {"dim": <dimension code>, "op": <op>, "value": <scalar | [scalar…] | [lo, hi]>}
op     ∈ in, not_in, eq, ne, lt, lte, gt, gte, between, prefix, like
Expr   := {"count": true} | {"sum": <numeric dim>} | {"countIf": Node} | {"add"|"sub"|"mul"|"div": [Expr, Expr…]}
Stat   := {"code", "label", "grain", "numerator": Expr, "denominator": Expr, "format": percent|ratio|per100|count}
```

Pydantic models in `stats/ast.py` reject unknown dims/ops at parse time. The compiler
(`stats/compiler.py`) turns a Node into a SQL fragment with **bound parameters only**
(`{p_12:Array(String)}`), qualifies every column with the table alias, and refuses any dimension the
target table does not hold. `tenant_id` and `dataset` are constructor arguments of the compiled query;
neither can come from the filter. All 25 existing `test_query_compiler.py` cases carry over.

### 2.6 Query service and table router

`stats/service.py: run_report(ReportRequest, tenant_id) -> ReportResult`:
1. Resolve stat codes → definitions (registry + the caller's inline custom stats + saved stats).
2. Route: if every stat is `cached` and every filter/group dimension is on `stats_daily` → rollup;
   else split stats by grain → `player_hands` for hand-grain, `decisions` for decision-grain; run ≤2
   queries and merge on the group key. The router considers **stats and dimensions** (fixes B4).
3. Every stat returns `{value, n}`; `format: percent` values are `100·num/den` with `nullIf(den,0)`.
4. Optional `compare_to: population | cohort:<id>` runs the same request against the pool module's
   `BaselineProvider` and attaches `{baseline, baseline_n, delta}` per cell.
5. Redis cache key = tenant + sha256 of the canonical request JSON.

### 2.7 API v2 (additive; the old `/v1/stats*` routes become thin adapters and are deleted in D.9)

| Method | Path | Body / params | Returns |
|---|---|---|---|
| GET | `/v1/definitions` | — | stats, dimensions, presets (typed) |
| POST | `/v1/reports/run` | `ReportRequest` {dataset, date_from/to, filter, group_by ≤4, stats, custom, compare_to, limit} | `ReportResult` {rows: [{group, cells: {code: {value, n, baseline?, delta?}}}], total_hands} |
| GET/POST/PUT/DELETE | `/v1/saved/filters`, `/v1/saved/reports`, `/v1/saved/stats` | typed bodies | typed rows |
| GET | `/v1/hero/overview` | filter params | KPIs (with CI), timeline series (actual/EV/showdown/non-showdown/moving average), sessions |
| POST | `/v1/hero/leaks` | filter | ranked leaks: stat, hero value, pool baseline, n, delta, score |
| GET | `/v1/hero/sessions` | date range | sessions (gap-based, ≥ 30 min idle splits) |
| POST | `/v1/pool/stats` | `ReportRequest` without dataset (always population) | `ReportResult` |
| GET/POST | `/v1/pool/cohorts` | criteria = filter over per-player stats (`vpip between 35 and 100 and hands >= 500`) | cohort id + size |
| GET | `/v1/pool/players?q=` / `/v1/pool/players/{key}/report` | screen-name search, per-opponent report | typed |
| POST | `/v1/pool/ranges` | situation filter | 13×13 grid of shown-down `hand_class` frequencies (F-906 v1) |
| GET | `/v1/hands`, `/v1/hands/{uid}` | filter AST as query param `f=` (base64 JSON) | typed `HandSummary`, `HandDetail` with typed players/actions |
| POST/DELETE | `/v1/hands/{uid}/tags`, `/v1/hands/{uid}/note` | | |
| POST | `/v1/uploads` (+ `dataset` form field, default `hero`) | | unchanged contract otherwise |

`/v1/sites`, `/v1/definitions`, `/health` get typed response models (B: no bare dicts).

### 2.8 The two analysis modules (ADR-026) — as in Hand2Note

Hand2Note separates *player reports* (hero or any opponent, filtered by situation) from *population
analysis* (a cohort of many players; ranges and frequencies by spot). The platform mirrors that:

| | `analysis/hero` — **My game** | `analysis/pool` — **Pool** |
|---|---|---|
| Question | "What do *I* do here, and what does it cost me?" | "What does the *field* (or a cohort, or one opponent) do here?" |
| Dataset | `hero` (own uploads, hero seat only) | `population` (observed hands; real screen names) |
| Owns | overview KPIs + graph, sessions, saved reports, **leaks** (hero vs baseline), hand list context | population stats by situation, **cohorts** by stat criteria (F-602), per-opponent reports, ranges (F-906), `BaselineProvider` |
| Presets | preflop overview, by position, c-bet by texture, blind defence, showdown, money | pool by position, pool vs open by seat, pool c-bet/fold-to-cbet by sizing, regs vs fish |
| Depends on | `stats`, `analysis.pool.baselines` (Protocol only) | `stats` |
| Later feeds | F-603 EV per decision, F-607 coaching | F-604/605 deviation scorer, F-410 opponent-cohort filter |

`BaselineProvider` Protocol: `baseline(request: ReportRequest, cohort: CohortRef | None) -> ReportResult`.
Population is the first implementation; a solver-baseline implementation plugs into the same seam
later (ADR-011). Neither module contains stat SQL; both call `stats.service`.

### 2.9 UI (ADR-024) — Nuxt 4, English only, two entry points

```
web/
  pages/            index (My game) · pool · hands · upload · login · register · settings
  components/
    poker/          THE PRIMITIVES — one component per poker concept, used everywhere, never copied:
                    HandMatrix (13×13 grid; props: values per hand_class, mode = heatmap | select | compare;
                      used by Pool ranges, the holding filter, hand_class group-by results, hero-vs-pool ranges)
                    Card, Board (flop/turn/river with texture badges), PositionPicker (table-shaped seat picker),
                    ActionLine (renders 'pf:r-c|f:x-b' as chips), SizeBadge (pct of pot), StackBadge (bb + SPR)
    filter/         FilterBar (dataset toggle, dates, stakes, site, PositionPicker, saved filters)
                    SituationBuilder (street → facing → ActionLine → sizing → Board → HandMatrix → depth; emits the AST)
    reports/        StatCell (value + n, low-n greyed, baseline delta), StatGrid (rows=group, cols=stats, built from StatCell),
                    StatPicker (by category), DefinitionPanel (label, formula in words, typical range),
                    PresetMenu, SaveReportDialog
    charts/         WinningsChart (actual/EV/showdown/non-showdown, moving average), KpiTile (value ± CI, n)
    hands/          HandList, Replayer (step through: pot, stacks, Board, to-act; uses Card/Board/ActionLine), TagEditor
    upload/         DropZone, UploadList (status polling), PokerAccounts
  composables/      useReport(), useFilterUrlSync(), useDefinitions(), useReportTypes() (panel registry)
  stores/           auth (token in memory, silent refresh), filter (one object, URL-synced), definitions
```

**Component rules (founder requirement: no copies).** A poker concept is rendered by exactly one
component in `components/poker/`; pages and feature components *compose* primitives and never
re-implement a grid, a card or a badge. Every primitive is typed (`defineProps<…>()`), has no
knowledge of the API or the stores (data in, events out), and ships with a small story/fixture page
under `pages/dev/components.vue` so it can be reviewed in isolation. `StatGrid` is built from
`StatCell`; both analysis areas use the same `StatGrid`, `SituationBuilder` and `HandMatrix`. A new
report type registers a panel component in `useReportTypes()` rather than adding a page.

Rules that make it obvious: one filter object shared by every page and encoded in the URL (a report
link reproduces the report); the dataset toggle (*My hands / Pool / Compare*) is on every analytical
page; every number shows `n`, cells under the registry's `min_n` are greyed; labels are plain English
with the registry description on hover; presets are the landing state of each page (nobody starts from
an empty grid); the client holds no stat logic. Auth: access token in memory + refresh via HttpOnly
cookie; CORS explicit origin; per-IP limits on auth routes.

### 2.10 Persistence (Postgres, Alembic)

`saved_filters(id, user_id, name, ast_json, created_at, updated_at)`,
`saved_reports(id, user_id, module, name, definition_json, …)`, `saved_stats(id, user_id, code, label, definition_json, …)`,
`cohorts(id, user_id, name, criteria_json, …)`, `hand_notes(id, user_id, hand_uid, body, …)`,
`hand_tags(id, user_id, hand_uid, tag, …)`. All with `UNIQUE(user_id, name|code|hand_uid[,tag])`, FK indexes, timestamps.

### 2.11 Freshness and scale (ADR-025)

The rollup SQL is generated once; the same template emits the `MATERIALIZED VIEW … TO marts.stats_daily`
DDL (F-202) so dbt and the MV cannot drift, with the boundary-marker backfill and a reconciliation test.
Scale step (design only in v2): shard by `cityHash64(user_id)`, keep the population dataset on its own
shard, `Distributed` tables over `marts.*`, dbt runs per shard. Per-tenant ClickHouse settings profiles
+ quotas (F-208).

### 2.12 Tests and CI gates

- Unit (no stack): parser corpus, validation, `stats` (registry validation, AST parsing, compiler with
  injection attempts, router choices, every registry stat compiles for every table it claims), pipeline
  with fake sinks, row builders vs `core/schema.py`.
- Integration (stack, `test_` databases only): ingest→stats end-to-end, tenant isolation, schema vs
  `system.columns`, parity fingerprint on the seed corpus, dbt build + all law tests.
- Architecture: `import-linter`, size limits (40-line functions / 300-line files) via `scripts/check_sizes.py`,
  `make gen` no-diff.
- Web: `nuxt typecheck`, ESLint, Playwright login → upload → report.

---

## 3. Migration strategy (no big-bang)

1. Build `marts.decisions` and `marts.player_hands` **alongside** the existing chain (new dbt models,
   same incremental gate, anchor still `player_hand_flags` until parity passes).
2. `scripts/fingerprint.py` computes every built-in stat on `hero` and `population`, grouped by
   position, through the OLD path (`player_hand_flags`) and the NEW path (`stats.service`). Ship only
   when all values match within rounding (`reports/parity_<date>.md` records it).
3. Switch the anchor to `player_hands`; cut the API adapters over to `stats.service`.
4. Delete `int_hand_player_flags`, `player_hand_flags`, `int_preflop_context`, `int_postflop_context`,
   `int_player_context` (their logic lives in the decision model), `scripts/pool_report.py`.
   Keep `int_board_texture` and `int_hand_context`.
5. Bootstrap on 4 GB with `scripts/backfill.py` (daily partitions, adaptive batch). Expected peak is set
   by one day's decisions (< 2M rows); measure and record in ADR-020.

---

## 4. Phases and steps

Format: `- [ ] **X.n** what · *files* · *how* · **Done means** …`. Tick only when verified.

### Phase A — Stabilize (correctness first, no new features)

- [ ] **A.0** Checkpoint commit · ask the founder, then `git add -A platform docs CLAUDE.md && git commit -m "feat: incremental stat chain, real-data import, audit + v2 plan"` · **Done means** `git status` clean, CI green on `HEAD`.
- [ ] **A.1** Verify the data state (B15) · `cd platform && make up` · run: partitions per model (`system.parts`, expect 160 on all 8 tables), `count()` of `marts.player_hand_flags` = `core.hand_players FINAL` (54,562,770), no duplicate `(hand_uid, seat)`, `sum(cbet_flop_action)` > 0 for both datasets, `make check` · **Done means** all four true and recorded in STATUS "Data loaded"; if not, rerun `uv run python scripts/backfill.py` and re-check.
- [ ] **A.2** Pool reachable (B1) · `api/queries.py`, `api/routers/stats.py`, `api/schemas.py`, tests · add `dataset: Literal['hero','population'] = 'hero'` to `GET /v1/stats`, `/timeline`, `CustomStatsRequest`; remove `dataset` from `COARSE_FILTERABLE`; `TimelineQuery` gains the dataset predicate; unit test asserts the SQL, integration test asserts `population` returns `hands > 0` · **Done means** `curl …/v1/stats?dataset=population&group_by=position` returns the pool's VPIP by seat.
- [ ] **A.3** One ingest loop (B2) · `ingestion/worker.py`, `ingestion/pipeline.py`, `ingestion/bus.py` · `worker.process()` calls `ingest_text()`; `UploadMessage.dataset` (default `hero`) flows from the upload form field; delete the duplicated `EXCERPT_CHARS` and `parse_failures` column list; unit test of `ingest_text` with a stub client · **Done means** `make test-all` green; a worker unit test exists.
- [ ] **A.4** Routing and rollup (B3, B4, B5) · `stats_daily.sql`, `api/queries.py` · add the 29 orphan counters to `stats_daily` and `COUNTERS`; `_source_for(stats, dims)`; `TimelineQuery` uses it; `stats_daily` ORDER BY = all group keys (new table via rename + `backfill.py`, since a sort key change is a rebuild) · **Done means** fingerprint unchanged (`vpip_action 12,453,044`, `cbet_flop_action 1,824,127` on the pre-purge corpus, or the A.1 numbers), a custom stat over `float_fold_*` works on a coarse query.
- [ ] **A.5** Typed filters (B7) · `api/schemas.py`, `api/queries.py` · `filters: dict[str, list[str | int]]` coerced per `FILTERABLE` type; tests for the six `UInt8` dims · **Done means** `{"is_ip":[1]}` executes.
- [ ] **A.6** Security quick wins (B8) · `api/main.py`, `api/settings.py`, `api/routers/auth.py`, `api/static/index.html` · `CORSMiddleware(allow_origins=settings.cors_origins)`; refuse to start if `jwt_secret` is the default and `settings.environment != "dev"`; cookie `secure=settings.cookie_secure`; escape all `innerHTML` interpolations (`textContent`/escape helper); Redis-backed per-IP limiter on `/v1/auth/login|register` (e.g. 10/min); `/health` returns `"error"` only · **Done means** tests for each; page still works.
- [ ] **A.7** Small fixes · `dbt/poker_dwh/profiles.yml` default port `8124` (B9); `parser/registry.py` explicit registration order + `AmbiguousFormatError` when >1 parser matches; sniff window constant; `core/models.py` remove `starting_stack_bb` placeholder and fix the `anon_alias` docstring (B13) · **Done means** `make check` green, `dbt debug` without env hits 8124.
- [ ] **A.8** dbt law tests for all 46 pairs · `tests/assert_action_le_opportunity.sql` (generated list until C.3), `models/intermediate/schema.yml` with `not_null`/`unique` on keys · **Done means** `make dbt-test` green with the new count.
- [ ] **A.9** Update this file's Status + §6, STATUS's Next action → B.1; ask to commit · **Done means** Status says "Phase B / B.1", §6 has the row, STATUS's Next action matches, the commit was offered.

**Phase A exit:** `make check`, `make test-all`, `make dbt-test` green; fingerprints unchanged; the pool is reachable over HTTP.

### Phase B — Module boundaries (ADR-023)

- [ ] **B.1** Settings and clients out of `api/` (B10) · `core/settings.py` (moved), `ingestion/clickhouse.py` (client factory), `api/db.py` lazy engine (function, not import-time) · update imports in `ingestion/*`, `ch/migrate.py`, `scripts/*` · **Done means** `python -c "import ingestion.worker"` opens no Postgres connection; `python -m ch.migrate` does not import `api`.
- [ ] **B.2** Import-linter · `.importlinter`, `make lint-arch`, CI step · contracts from §2.2 · **Done means** `make check` fails on a backwards import (prove with a temporary one).
- [ ] **B.3** Sinks behind Protocols · `ingestion/sinks/{protocols,clickhouse,s3,kafka,fakes}.py` · `HandSink.insert(hands, tenant_id, dataset)`, `RawStore.put/get`, `EventBus.publish/consume`; `pipeline.ingest_text(sink=…)`; worker/importer construct sinks from settings; unit tests run the pipeline against `FakeHandSink` · **Done means** pipeline unit tests exist and need no stack.
- [ ] **B.4** Test databases (B12) · `core/settings.py: clickhouse_db_prefix` (default `""`), `ch/migrate.py`, `dbt/macros/generate_schema_name.sql` (prefix var), `ingestion/sinks/clickhouse.py`, `tests/integration/conftest.py` (`CLICKHOUSE_DB_PREFIX=test_`, drop the prefixed DBs at session end), `Makefile` (`make seed` → test prefix; `make seed-real` does not exist — real data only via `scripts/import_archive.py`) · **Done means** the integration suite leaves `core.*`/`marts.*` byte-identical (row counts before/after); the purge fixture is deleted.
- [ ] **B.5** Schema in one place (B11) · `core/schema.py` (`TableSpec`/`ColumnSpec` per core table), `ingestion/rows/{hands,players,actions,winners}.py` (row builders ≤40 lines each, replacing `to_rows`), `scripts/gen_schema.py` → `stg_*.sql` SELECT lists, `tests/integration/test_schema_matches_clickhouse.py` (spec vs `system.columns`), migration `0009_dataset_on_actions.sql` (+ write `players_remaining`, `entrants`, `finish_position`; add `cards_revealed` to the model) · **Done means** the schema test passes; no orphan columns.
- [ ] **B.6** Typed hand endpoints · `api/schemas.py` (`HandPlayerOut`, `ActionOut`), `api/routers/hands.py` uses `named_results()` · **Done means** no positional index into a row anywhere in `api/`.
- [ ] **B.7** Size limits · split `parser/sites/pokerstars.py` → `parser/sites/pokerstars/{header,actions,summary,parser}.py`; `core/models.py` → `core/model/{hand,player,action,tournament}.py` with `core/models.py` re-exporting; `scripts/check_sizes.py` in `make check` (40/300) · **Done means** `make check` green with the size check enabled (allow-list only for generated SQL).
- [ ] **B.8** Update Status + §6; ask to commit · **Done means** Status says "Phase C / C.1", §6 row added, STATUS's Next action matches, commit offered.

**Phase B exit:** import-linter and size checks in CI; unit tests use fakes; integration suite writes only to `test_*`.

### Phase C — Stat engine v2 (ADR-020/021/022/026)

- [ ] **C.1** Registry · `stats/registry/dimensions.yaml`, `stats/registry/stats/*.yaml` (port all 37 built-ins + the 29 orphans + AF/AFq), `stats/registry.py`, `stats/ast.py`, tests · **Done means** every existing stat has an entry; loader rejects a bad dimension/op/value with a clear error.
- [ ] **C.2** Decision model · `dbt/.../intermediate/int_hand_arrays.sql` (per-hand arrays of index/seat/street/type/amount/amount_to/pot_before/to_call), `int_decision_state.sql` (per-decision situation from the arrays), `marts/decisions.sql`, `marts/player_hands.sql`; incremental gate unchanged; `backfill.py` anchor param · measure peak memory per daily partition on 4 GB · **Done means** both tables build over the full corpus via `backfill.py` under 4 GB; row count of `decisions` = `countIf(action_type in (fold,check,call,bet,raise))` over `core.actions FINAL`.
- [ ] **C.3** Generator · `scripts/gen_stats.py`, `make gen`, CI no-diff step · generates `stats_daily.sql` (SummingMergeTree, all keys in ORDER BY), `seeds/dim_stat_definitions.csv`, `tests/assert_action_le_opportunity.sql` · **Done means** generated files carry the header; `make gen` is idempotent.
- [ ] **C.4** Compiler, router, service · `stats/compiler.py`, `stats/router.py`, `stats/service.py`, tests (port the 25 compiler tests; add AST injection cases; "every registry stat compiles on every table it claims") · **Done means** unit tests green; `run_report` returns `{value, n}` per cell.
- [ ] **C.5** API v2 + persistence · `api/routers/{definitions,reports,saved}.py`, Alembic migration for §2.10 tables, typed schemas; old `/v1/stats*` routes become adapters over `stats.service` · **Done means** OpenAPI shows no bare dicts; saved report round-trips.
- [ ] **C.6** Parity and cut-over · `scripts/fingerprint.py` (old vs new for every built-in stat, hero + population, by position), `reports/parity_<date>.md`; switch the anchor to `player_hands`; delete the old chain and `pool_report.py` · **Done means** parity within rounding on every stat; `dbt build` green; pool VPIP/RFI/c-bet by position still match `reports/pool_leaks.csv`.
- [ ] **C.7** Analysis modules · `analysis/hero/{service,router,presets.yaml}`, `analysis/pool/{service,router,baselines,cohorts,presets.yaml}`, `BaselineProvider` Protocol; leaks v1 = hero vs population on each preset stat, score = `|delta| · sqrt(n)` with `min_n`; sessions = gap-based split; per-opponent report = `run_report(player_key=…)` on population · **Done means** `/v1/hero/leaks` returns a ranked list on the real hero data; `/v1/pool/cohorts` builds "regs" (`vpip < 25 and hands >= 1000`) and `/v1/pool/stats` on it works.
- [ ] **C.8** Update Status + §6; ask to commit · **Done means** Status says "Phase D / D.1", §6 row added, STATUS's Next action matches, commit offered.

**Phase C exit:** a new situation is a filter (demonstrate: "fold to turn bet ≥ 75% pot after calling a flop c-bet in position" with zero deploys); a new built-in stat is one YAML entry + `make gen`; pool query < 1 s on 4 GB.

### Phase D — UI (ADR-024)

- [ ] **D.1** Scaffold · `platform/web/` (Nuxt 4 in SPA mode `ssr: false` — everything is behind auth and FastAPI is the only server; TS strict, Pinia, ESLint), `make web`, `make web-check` (`nuxt typecheck` + lint), CI job; `cors_origins` includes `http://localhost:3000` · **Done means** `make web` serves a page that calls `/health`.
- [ ] **D.2** Auth · login/register pages, `stores/auth.ts` (token in memory, silent refresh on 401), route middleware · **Done means** refresh works after the 30-min expiry without re-login.
- [ ] **D.3** Poker primitives + filter model · `components/poker/{HandMatrix,Card,Board,PositionPicker,ActionLine,SizeBadge,StackBadge}.vue` with `pages/dev/components.vue` fixtures; `stores/filter.ts` ↔ URL query; `FilterBar`, `SituationBuilder` (composed from the primitives) producing the AST from §2.5; `stores/definitions.ts` from `/v1/definitions` · **Done means** pasting a URL reproduces the filter; `HandMatrix` renders in all three modes on the fixture page; `grep -r "13" components/` finds the grid in one file only.
- [ ] **D.4** My game · `pages/index.vue`: KPI tiles with CI, `WinningsChart`, leaks panel, sessions · **Done means** the founder's hero data renders with correct numbers vs the API.
- [ ] **D.5** Reports workbench · `StatGrid`, `StatPicker`, `DefinitionPanel`, `PresetMenu`, `SaveReportDialog`; used by My game and Pool · **Done means** a saved report reopens from its URL; every cell shows n.
- [ ] **D.6** Pool · `pages/pool.vue` (population workbench, dataset locked), cohorts page, player search + report, ranges via the shared `HandMatrix` (heatmap mode) · **Done means** "regs vs fish" fold-to-cbet by sizing renders; the ranges page adds no new grid code.
- [ ] **D.7** Hands · `HandList` bound to the filter, `Replayer` (step through: pot, stacks, board, to-act), tags/notes · **Done means** clicking a leak opens the matching hands.
- [ ] **D.8** Upload & accounts · `DropZone` with progress via `/v1/uploads/{id}` polling, dataset choice, poker accounts · **Done means** a real file uploaded through the UI produces stats without manual steps (Phase-1 exit criterion, finally).
- [ ] **D.9** E2E + cleanup · Playwright login → upload → report; delete `api/static/index.html` and the old `/v1/stats*` adapters; ADR note · **Done means** CI runs the E2E job green.
- [ ] **D.10** Update Status + §6; ask to commit · **Done means** Status says "Phase E / E.1", §6 row added, STATUS's Next action matches, commit offered.

### Phase E — Freshness and scale (ADR-025)

- [ ] **E.1** MVs from the registry (F-202) · `gen_stats.py` emits the MV DDL as `ch/migrations/00xx_mv_stats_daily.sql`; boundary-marker backfill; reconciliation test dbt-vs-MV on a window · **Done means** an upload is visible in stats without a dbt run.
- [ ] **E.2** Confidence intervals · bb/100 from per-hand variance, ratio stats Wilson interval; service + UI · **Done means** KPI tiles show ± bands.
- [ ] **E.3** Quotas and limits · per-tenant CH settings profile + quota (F-208), API rate limits (F-706) · **Done means** an integration test shows a second tenant's over-budget query is rejected by ClickHouse, not by the API; auth endpoints return 429 past the limit.
- [ ] **E.4** Scale design · `docs/POKER_SCALE.md`: sharding by `cityHash64(user_id)`, population on its own shard, `Distributed` marts, dbt per shard, cost table for 4 GB nodes · **Done means** the doc exists with the shard key, the migration path from one node, and a per-node cost table; recorded as an ADR.
- [ ] **E.5** Equity (F-902/F-309) · vetted evaluator at parse time → `ev_won_bb` real, `made_hand` filled · **Done means** on a hand with a preflop all-in, `ev_won_bb != net_won_bb`; `made_hand` is non-empty on every decision where hole cards are known; the EV line on the chart separates from the actual line.

---

## 5. Risks and how the plan handles them

| Risk | Mitigation |
|---|---|
| `decisions` too heavy for 4 GB | Per-hand arrays keep join sides at hand grain; daily partitions; `backfill.py` adaptive batch; measure in C.2 before C.6 |
| New stats disagree with old | C.6 parity gate on every built-in stat, both datasets, by position; old chain kept until it passes |
| ClickHouse analyzer quirks (alias every column, no CTE joins, zero-padded LEFT JOIN) | Documented in the existing models; carry the same rules into `int_decision_state.sql`; `1 as is_row` guards |
| dbt-clickhouse incremental limits | Keep the proven `insert_overwrite` + macro; generated SQL only for the rollup |
| Registry becomes a second "code" | It is data validated at load; SQL is generated, never edited; CI no-diff |
| UI scope | Presets first; the workbench is one component reused by both modules |
| Real-data rule | `test_` prefix from B.4; `make seed` never touches the analysis DBs |

---

## 6. Status log (newest first)

| Date | Session did | Next |
|---|---|---|
| 2026-09-09 | Audit of code + docs (three agent passes, first-hand reads); wrote POKER_AUDIT.md, this plan, ADR-019 rewrite, ADR-020…026; founder decisions: Hand2Note-class speed and power, separate hero/pool modules, both UI audiences, English only | **A.0** |
