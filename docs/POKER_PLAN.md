# Poker platform — v2 plan (the file an implementing session works from)

> **Read this after [POKER_STATUS.md](POKER_STATUS.md).** STATUS says *where the build is*; this file
> says *what to build next and how*. "Continue" means: the first unchecked step below.
> Findings that motivate every decision here are in [POKER_AUDIT.md](POKER_AUDIT.md) (B1…B15 refer to
> its numbered findings). Decisions are recorded as ADR-019…026 in [POKER_DECISIONS.md](POKER_DECISIONS.md).

## Status

| | |
|---|---|
| **Phase** | **C — Stat engine v2** (C.1–C.5 done 2026-09-09; **B.5b**'s mart half is done — every v2 table carries `hand_uid FixedString(16)` — its `core.*` rebuild stays open) |
| **Next step** | **C.6** — parity and cut-over: `scripts/fingerprint.py` (v1 vs v2 for every built-in stat, hero + population, by position) → `reports/parity_<date>.md`; then delete the v1 chain, drop the `_v2` suffix, delete `api/queries.py` and `pool_report.py`, make `int_hand_arrays` a macro CTE |
| **Branch** | `feat/phase-c-stat-engine` (C.1–C.4 merged into `main` at `a2b8741`) |
| **Last updated** | 2026-09-09, session 5 (C.1–C.5 done and verified) |
| **Blockers** | none — the v2 engine serves `/v1/reports/run`, `/v1/definitions`, the saved-object CRUD and the v1 adapters; `make check` 317 unit tests, `make test-all` 331 passed / 2 skipped |
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
  preflop_line String, street_line String, line_so_far String,   -- own actions: 'l-c', 'x', 'r/x-c/' (tokens: dimensions.yaml)
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

**Action lines** are the seat's *own* actions, one letter each — `f x l c b r`, where `l` is a preflop
call with no raise in front — joined by `-`. `street_line` stops before the current decision (`''` =
first decision this street, `'x'` = checked and now facing something); `line_so_far` joins streets
with `/`. `prev_street_faced` is what the seat faced at its last decision on the previous street and
`prev_street_my_action` its line there, so `'x'` + `none` means "checked through, from this seat's
view". **`stats/registry/dimensions.yaml` is the column contract** (C.1): C.2 builds to it, the compiler
qualifies only what it lists.

**`marts.player_hands` — one row per (hand, player)**: the identity + table dimensions above, plus
`did_vpip`, `did_pfr`, `saw_flop`, `saw_turn`, `saw_river`, `went_to_showdown`, `won_hand`,
`net_won_bb`, `ev_won_bb`, `showdown_won_bb`, `nonshowdown_won_bb`, `rake_paid_bb`, `hand_class`,
`hand_shape`, `pot_type`, `players_to_flop`, flop texture, `stack_bb`, `src_parsed_at`. Hand-grain
stats (VPIP, PFR, WTSD, WWSF, W$SD, bb/100) read it. This replaces `marts.player_hand_flags`; it has
~25 columns, not 156. The incremental gate's **anchor stays the last model of the chain**
(`marts.stats_daily`, generated) — a model downstream of the anchor never sees a dirty partition
(learned the hard way on 2026-09-09: anchoring on `player_hand_flags` left `stats_daily` empty).

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
- `stats/registry/` (the package; `registry()`) loads YAML into Pydantic models on first use, validates every predicate against
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

- [x] **A.0** Checkpoint commit · done 2026-09-09 as three logical commits (`7bd880d` real-data ingestion, `d8a6abc` incremental stat chain, `6841ee2` audit + plan) on branch `feat/incremental-chain-and-v2-plan`; `make check` green locally (129 tests, ruff, mypy) as the CI proxy · **Done means** `git status` clean (only the local `.claude/` settings untracked), `make check` green on `HEAD`.
- [x] **A.1** Verify the data state (B15) · `cd platform && make up` · run: partitions per model (`system.parts`, expect 160 on all 8 tables), `count()` of `marts.player_hand_flags` = `core.hand_players FINAL` (54,562,770), no duplicate `(hand_uid, seat)`, `sum(cbet_flop_action)` > 0 for both datasets, `make check` · **Done means** all four true and recorded in STATUS "Data loaded"; if not, rerun `uv run python scripts/backfill.py` and re-check.
  *Verified 2026-09-09 after a full rebuild from empty (42 passes, 1,411 s, row-budgeted):* 160 partitions on every full-coverage table (158 on the two flop-only models = two flopless days, correct); rows 54,562,770 = core; duplicates 0 (disk-spilling GROUP BY); pending 0; rollup equals the mart on every counter; hero rows 19,802 = core. New fingerprint in STATUS "Data loaded".
  *2026-09-09:* the earlier rebuild had been interrupted at 58/160 partitions. Before refilling, the founder's storage analysis was applied: the 15 bucket columns (`pot_type`, `spr_bucket`, `hand_class`, flop texture, bet/faced size …) are now `LowCardinality(String)` and `players_to_*` are `UInt8` at their origin models. **Measured after the change: no disk saving** (63.7 bytes/row vs 64.3) — LZ4 already compressed those repetitive strings to ~0.4 bytes/row; the types are still right for GROUP BY/filter cost. `hand_uid` stays at 52% of the table → **B.5b**. `stats_daily` got A.4's shape at the same time so the chain is built once. The chain was recreated empty with the new DDL (`dbt run --full-refresh --vars 'empty_chain: true'`, see `macros/incremental.sql` "Changing the chain's DDL") and 22 orphaned `__dbt_new_data` scratch tables (396 MiB) were dropped. Rebuild from empty in progress; the `hand_uid` half of the analysis (51% of the table as 32-char hex) is **B.5**.
- [x] **A.2** Pool reachable (B1) *(2026-09-09: `GET /v1/stats?dataset=population&group_by=position` → VPIP BB 25.4 / BTN 26.9 / CO 22.0 / HJ 19.9 / SB 23.6 / UTG 19.2 over 9.07M hands, from the rollup)* · `api/queries.py`, `api/routers/stats.py`, `api/schemas.py`, tests · add `dataset: Literal['hero','population'] = 'hero'` to `GET /v1/stats`, `/timeline`, `CustomStatsRequest`; remove `dataset` from `COARSE_FILTERABLE`; `TimelineQuery` gains the dataset predicate; unit test asserts the SQL, integration test asserts `population` returns `hands > 0` · **Done means** `curl …/v1/stats?dataset=population&group_by=position` returns the pool's VPIP by seat.
- [x] **A.3** One ingest loop (B2) · `ingestion/worker.py`, `ingestion/pipeline.py`, `ingestion/bus.py` · `worker.process()` calls `ingest_text()`; `UploadMessage.dataset` (default `hero`) flows from the upload form field; delete the duplicated `EXCERPT_CHARS` and `parse_failures` column list; unit test of `ingest_text` with a stub client · **Done means** `make check` green with worker unit tests that drive `process()` against a fake client (`tests/test_worker_process.py`); the integration suite is run at **B.4**, once it targets `test_*` databases — running it before that writes synthetic hands into the analysis tables (and into the marts mid-rebuild), which the founder's real-data rule forbids.
- [x] **A.4** Routing and rollup (B3, B4, B5) *(2026-09-09: `float_fold` 22.1% (n 957,320) and `river_check_fold` 62.1% answered from the rollup on a coarse query; rollup sums equal the mart's on every counter)* · `stats_daily.sql`, `api/queries.py` · add the 29 orphan counters to `stats_daily` and `COUNTERS`; `_source_for(stats, dims)`; `TimelineQuery` uses it; `stats_daily` ORDER BY = all group keys (new table via rename + `backfill.py`, since a sort key change is a rebuild) · **Done means** fingerprint unchanged (`vpip_action 12,453,044`, `cbet_flop_action 1,824,127` on the pre-purge corpus, or the A.1 numbers), a custom stat over `float_fold_*` works on a coarse query.
- [x] **A.5** Typed filters (B7) *(2026-09-09: `{"is_ip":["1"],"players_to_flop":[2]}` executed against the real pool)* · `api/schemas.py`, `api/queries.py` · `filters: dict[str, list[str | int]]` coerced per `FILTERABLE` type; tests for the six `UInt8` dims · **Done means** `{"is_ip":[1]}` executes.
- [x] **A.6** Security quick wins (B8) *(2026-09-09: preflight from `localhost:3000` gets `access-control-allow-origin`; 20th bad login/min → 429; `refuse_unsafe_config` unit-tested; page renders with escaping)* · `api/main.py`, `api/settings.py`, `api/routers/auth.py`, `api/static/index.html` · `CORSMiddleware(allow_origins=settings.cors_origins)`; refuse to start if `jwt_secret` is the default and `settings.environment != "dev"`; cookie `secure=settings.cookie_secure`; escape all `innerHTML` interpolations (`textContent`/escape helper); Redis-backed per-IP limiter on `/v1/auth/login|register` (e.g. 10/min); `/health` returns `"error"` only · **Done means** tests for each; page still works.
- [x] **A.7** Small fixes *(2026-09-09: bare `dbt debug` connects to 8124; ambiguity test in `tests/test_registry.py`)* · `dbt/poker_dwh/profiles.yml` default port `8124` (B9); `parser/registry.py` explicit registration order + `AmbiguousFormatError` when >1 parser matches; sniff window constant; `core/models.py` remove `starting_stack_bb` placeholder and fix the `anon_alias` docstring (B13) · **Done means** `make check` green, `dbt debug` without env hits 8124.
- [x] **A.8** dbt law tests for all pairs · `tests/assert_action_le_opportunity.sql` (a Jinja loop over all 52 tuples; a unit test fails if a ratio stat lacks one), `models/intermediate/schema.yml` with `not_null` + `accepted_values` on keys and buckets (`unique` deliberately not a per-pass test: a 54M-row aggregation inside every incremental pass would trip the 4 GB node; uniqueness is verified after a bootstrap with a disk-spilling GROUP BY) · **Done means** `make dbt-test` green with the new count *(2026-09-09: 38/38, was 22)*.
- [x] **A.9** Update this file's Status + §6, STATUS's Next action → B.1; ask to commit · **Done means** Status says "Phase B / B.1", §6 has the row, STATUS's Next action matches, the commit was offered.

**Phase A exit:** `make check`, `make dbt-test` green; the fingerprint re-established on the purged corpus and the rollup equal to the mart; the pool is reachable over HTTP. (`make test-all` — the integration suite — is deliberately deferred to B.4, see A.3.) **Met 2026-09-09.**

Lessons recorded in phase A, for later phases: the incremental anchor must be the *last* model (ADR-019); a DDL change is `empty_chain` + backfill (ADR-019); `LowCardinality` did not shrink the table — `hand_uid` does (B.5b); the server's total memory (3.6 GiB of 4 GB), not the per-query ceiling, is what bounds a pass, so passes are sized by rows.

### Phase B — Module boundaries (ADR-023)

- [x] **B.1** Settings and clients out of `api/` (B10) *(2026-09-09: `core/settings.py`, `ingestion/clickhouse.py`, lazy `api/db.py`; verified no `api.*` module loads for the worker or `ch.migrate`)* · `core/settings.py` (moved), `ingestion/clickhouse.py` (client factory), `api/db.py` lazy engine (function, not import-time) · update imports in `ingestion/*`, `ch/migrate.py`, `scripts/*` · **Done means** `python -c "import ingestion.worker"` opens no Postgres connection; `python -m ch.migrate` does not import `api`.
- [x] **B.2** Import-linter · `.importlinter`, `make lint-arch`, CI step · contracts from §2.2 · **Done means** `make check` fails on a backwards import (prove with a temporary one). *(2026-09-09: a planted `core → api` import broke the layers contract; clean tree 4/4 kept. The `api ↛ parser.sites` contract is direct-imports-only, since the registry legitimately imports every site.)*
- [x] **B.3** Sinks behind Protocols *(2026-09-09: `ingestion/sinks/`, fakes, `tests/test_pipeline.py` + reworked worker tests, no stack; contract `api ↛ ingestion.sinks.{clickhouse,s3,kafka}`)* · `ingestion/sinks/{protocols,clickhouse,s3,kafka,fakes}.py` · `HandSink.insert(hands, tenant_id, dataset)`, `RawStore.put/get`, `EventBus.publish/consume`; `pipeline.ingest_text(sink=…)`; worker/importer construct sinks from settings; unit tests run the pipeline against `FakeHandSink` · **Done means** pipeline unit tests exist and need no stack.
- [x] **B.4** Test databases (B12) · `core/settings.py: clickhouse_db_prefix` (default `""`) + `Settings.db()`, `ch/migrate.py` rewrites database names at apply time (`prefixed()`, unit-tested) and `drop_all()` refuses without a prefix, dbt reads the prefix from the environment (`generate_schema_name`, sources, profile, the macro's anchor), every Python literal goes through `settings.db()`, `api/provision.py` creates Postgres DB + ClickHouse DBs + raw bucket + empty dbt tables, `tests/integration/conftest.py` **refuses to start** unless the ClickHouse prefix, a `_test` Postgres DB, a `-test` bucket, `test.` Kafka topics/group and a non-zero Redis db are set, then provisions and drops them per session; `Makefile TEST_ENV` for `seed` and `test-all`; CI env · **Done means** the integration suite leaves `core.*`/`marts.*` byte-identical (row counts before/after); the purge fixture is deleted. *(2026-09-09: 171 passed / 2 skipped in the test env; real counts 9,093,796 / 54,562,770 / 54,562,770 and 31 users identical before and after; no `test_*` database left; the suite exits with the refusal message when run without the env.)*
- [x] **B.5** Schema in one place (B11) *(2026-09-09: `core/schema/` specs; loader iterates them; staging models generated (`make gen`); spec-vs-`system.columns` integration test green on all four tables; migration 0009 applied to the real DB in 4 s incl. the pool repair — actions 218,258 hero / 100,127,900 pool, 0 disagreements)* · `core/schema.py` (`TableSpec`/`ColumnSpec` per core table), `ingestion/rows/{hands,players,actions,winners}.py` (row builders ≤40 lines each, replacing `to_rows`), `scripts/gen_schema.py` → `stg_*.sql` SELECT lists, `tests/integration/test_schema_matches_clickhouse.py` (spec vs `system.columns`), migration `0009_dataset_on_actions.sql` (+ write `players_remaining`, `entrants`, `finish_position`; add `cards_revealed` to the model) · **Done means** the schema test passes; no orphan columns.
- [ ] **B.5b** `hand_uid` as `FixedString(16)` (founder's storage analysis, 2026-09-09: the 32-char hex id is 1.07 GiB = 51% of the 2.09 GiB flag table and does not compress; 16 raw bytes halve it) · `core/ids.py` keeps producing hex for the API and logs; `core/schema.py` declares `hand_uid FixedString(16)`; loaders write `unhex()`/`bytes.fromhex`; the API converts at the boundary (`hex(hand_uid)` in SELECTs, `unhex({uid:String})` in WHERE); dbt models pass it through untouched. It is in every `core.*` sort key, so this is a **table rebuild, not a migration** (ADR-017): create `core.<t>__v2` with the new DDL, copy partition by partition (`INSERT … SELECT … WHERE toYYYYMMDD(played_at_utc) = …`, bounded memory on 4 GB), `EXCHANGE TABLES`, then recreate the mart chain empty (`empty_chain: true`) and backfill · **Done means** `system.columns` shows `FixedString(16)` on every core and mart table, the replayer and `/v1/hands` still resolve a hand by its hex id, the parity fingerprint is unchanged, and `marts.player_hand_flags` compressed size drops by ~0.5 GiB (`system.parts`). *2026-09-09 (C.2):* the **mart half is done** — `int_hand_arrays`, `int_board_by_street`, `decisions` and `player_hands` all carry `hand_uid FixedString(16)` (`toFixedString(unhex(hand_uid), 16)` at the staging boundary; `lower(hex(hand_uid))` gives the hex back); `core.*` still holds the hex string, so the core rebuild above is what remains.
- [x] **B.6** Typed hand endpoints *(2026-09-09: `HandPlayerOut`/`ActionOut`, `named_results()`, mapping unit-tested)* · `api/schemas.py` (`HandPlayerOut`, `ActionOut`), `api/routers/hands.py` uses `named_results()` · **Done means** no positional index into a row anywhere in `api/`.
- [x] **B.7** Size limits *(2026-09-09: `scripts/check_sizes.py` in `make check` and CI with a burn-down baseline `scripts/size_baseline.txt` — an entry that stops violating fails too, so it can only shrink; 28 violations → 6, all in `api/queries.py` and `scripts/pool_report.py`, which phase C replaces. `parser/sites/pokerstars.py` → package `{grammar,state,header,lines,finalize,parser}.py` with `split_on()` shared with GG, fingerprint of the real hero export identical before/after (33 files, 19,813 hands); `Tournament` → `core/tournament.py` (the rest of `core/models.py` is under 300 lines, so the four-file split was not needed); importer's archive walking and ledger → `ingestion/{archive,ledger}.py`; the compiler tests split into security vs routing files)* · **Done means** `make check` green with the size check enabled (allow-list only for generated SQL).
- [x] **B.8** Update Status + §6; ask to commit *(2026-09-09)* · **Done means** Status says "Phase C / C.1", §6 row added, STATUS's Next action matches, commit offered.

**Phase B exit:** import-linter and size checks in CI; unit tests use fakes; integration suite writes only to `test_*`.

### Phase C — Stat engine v2 (ADR-020/021/022/026)

- [x] **C.1** Registry · `stats/registry/dimensions.yaml`, `stats/registry/stats/*.yaml` (port all 37 built-ins + the 29 orphans + AF/AFq), `stats/registry.py`, `stats/ast.py`, tests · **Done means** every existing stat has an entry; loader rejects a bad dimension/op/value with a clear error. ✅ 2026-09-09. `stats/registry/` is a **package** (`__init__.py` = `Registry` + `registry()`, `loader.py`, the YAML beside them) rather than `stats/registry.py` next to a data directory of the same name; `stats/ast.py` checks shape, `stats/definitions.py` holds the entry models, `stats/checks.py` checks meaning against the dimensions. Every §2.3 column is a dimension (type, ops, enum values, presentation buckets, tables); 65 stats = all 54 v1 built-ins + AF/AFq per street and total + `call_cbet_flop`, `sd_bb_per_100`, `nsd_bb_per_100`. Definitions follow the standard tracker meaning; where that tightens v1 (a c-bet opportunity is *facing nothing*, a probe is out of position, float-fold counts turns where a bet was faced) the entry's `notes` says so, for C.6. Tests: every v1 stat present, enum dimensions mirror `core.enums`, 24 broken-registry cases each rejected naming file, entry and leaf.
- [x] **C.2** Decision model · `dbt/.../intermediate/int_hand_arrays.sql` (per-hand arrays of index/seat/street/type/amount/amount_to/pot_before/to_call), `int_decision_state.sql` (per-decision situation from the arrays), `marts/decisions.sql`, `marts/player_hands.sql`; incremental gate unchanged; `backfill.py` anchor param · measure peak memory per daily partition on 4 GB · **Done means** both tables build over the full corpus via `backfill.py` under 4 GB; row count of `decisions` = `countIf(action_type in (fold,check,call,bet,raise))` over `core.actions FINAL`. ✅ 2026-09-09. Built to `dimensions.yaml`. Two deviations from the file list: the per-decision SELECT is a **macro** (`macros/decision_state.sql`) rather than an ephemeral `int_decision_state` model, because `is_incremental()` is evaluated against the owning model and an ephemeral one is never incremental — its gate would have meant "every partition"; and `int_board_by_street.sql` (board facets at each street) supersedes the flop-only `int_board_texture` for the v2 chain. The gate's anchor became a list (`anchors` var in `macros/incremental.sql`, mirrored by `scripts/anchors.py`; `backfill.py --anchor TABLE:DATE --select`), so the two sibling marts bootstrapped beside the untouched v1 chain: **35 passes, 641 s; peak 1.21 GiB** (`decisions`), 1.07 GiB (`int_hand_arrays`), 0.79 GiB (`player_hands`) per insert — under half the 2.5 GB ceiling, ~5× faster per pass than v1. Row counts exact: `decisions` 73,679,949 = the countIf over `core.actions FINAL`; `player_hands` 54,562,770; 160/160 partitions. Verified on the 8-hand test corpus column by column against `core.actions` first (one bug found and fixed there: `is_last_to_act` counted folded seats as acted). Parity preview on the real corpus, hero + population: hands, VPIP, PFR, RFI opp/action, c-bet flop, WTSD, W$SD, net bb **identical**; 3-bet opportunities +0.6% (v1 measured a seat's first preflop decision only, so a limper's second decision was missed), fold-to-c-bet and check-raise opportunities −0.5…−0.9% (v1 counted a c-bet as faced even after another player had raised it) — each recorded in the entry's `notes` for C.6. Sizes: `decisions` 3.84 GiB (55.9 B/row; `hand_uid FixedString(16)` is 854 MiB = 21.7%), `player_hands` 2.18 GiB (43 B/row) vs `player_hand_flags` 3.20 GiB. **Open for C.6:** `int_hand_arrays` persists 2.39 GiB that no consumer reads after the pass — turn it into a macro CTE like `decision_state` when the v1 chain is deleted.
- [x] **C.3** Generator · `scripts/gen_stats.py`, `make gen`, CI no-diff step · generates `stats_daily.sql` (SummingMergeTree, all keys in ORDER BY), `seeds/dim_stat_definitions.csv`, `tests/assert_action_le_opportunity.sql` · **Done means** generated files carry the header; `make gen` is idempotent. ✅ 2026-09-09. Generated as **`marts/stats_daily_v2.sql`** (the hand-written v1 `stats_daily` keeps serving the API until C.5 switches the routes; C.6 deletes v1 and drops the suffix), **`seeds/stat_definitions.csv`** (replaces the `dim_stat_definitions` model at C.6) and **`tests/assert_v2_action_le_opportunity.sql`**, each with a `GENERATED` header; `make gen` / `make gen-check` / CI extended; a unit test also fails when a generated file is stale. `stats/compiler.py` arrived with it (Node/Expr → SQL; `Params` binds every request value, `Literals` inlines registry values for generated files only; `check_leaf` re-runs on every leaf), so C.4's "every registry stat compiles on its table" gate is already a test. The rollup is a UNION ALL of a `decisions` branch and a `player_hands` branch, each zero-filling the other's columns (sums widened to Decimal(38,4)); SummingMergeTree adds rows sharing a key, so `sum(x)` is exact before and after merges. 57 cached stats → 114 `_opp`/`_action` columns + `hands`. Bootstrapped with `--anchor stats_daily_v2:day --select stats_daily_v2`: **35 passes, 186 s, peak 1.66 GiB**. Sums equal the v2 facts on every checked figure and the v1 rollup on every stat without `notes`; the law test passes on the real data. 25 new unit tests (273).
- [x] **C.4** Compiler, router, service · `stats/compiler.py`, `stats/router.py`, `stats/service.py`, tests (port the 25 compiler tests; add AST injection cases; "every registry stat compiles on every table it claims") · **Done means** unit tests green; `run_report` returns `{value, n}` per cell. ✅ 2026-09-09. `stats/request.py` (`ReportRequest` / `CustomStatSpec` in, `ReportResult` / `ReportRow` / `Cell {value, n, baseline, delta}` out; no tenant field exists), `stats/resolve.py` (built-in codes + custom specs → one `ResolvedStat`; a custom stat may not take a built-in's or a dimension's name and must compile on its grain's table), `stats/router.py` (rollup only when every stat is cached AND every filter/group dimension is on it, else one plan per grain; a decision dimension on a hand-grain stat is a named `ReportError`, not a ClickHouse error), `stats/query.py` (one parameterized query per plan: tenant/dataset/hero gate, dates, player key, the filter tree and **every registry value too** through `Params`, number group-bys through the registry buckets, `{value, n}` per stat, a `__hands` column per table — `uniqExact(hand_uid)` on `decisions`), `stats/service.py` (`run_report(request, tenant_id, run=, cache=)`: ≤2 queries merged on the group key, `compare_to: population` re-runs the request as the pool and attaches baseline/delta per cell, cache key `report:<tenant>:<sha256 of the canonical request>`). 37 new unit tests (305): the v1 compiler and routing cases ported, AST-shaped injection (bound for free-text dimensions, refused for enums before any SQL), merging/baseline/cache with a fake database. Verified on the real data: hero VPIP 22.96% over 19,802 hands from the rollup; fold-to-c-bet at SPR 3–6 from `decisions` (Enum8 columns compare with String parameters); pool RFI by position; hero-vs-pool deltas; c-bet by SPR bucket with AF. Open: rows of a bucketed group-by come back in label order, not bucket order (a UI concern for D, or an `ORDER BY` on the bucket index later).
- [x] **C.5** API v2 + persistence · `api/routers/{definitions,reports,saved}.py`, Alembic migration for §2.10 tables, typed schemas; old `/v1/stats*` routes become adapters over `stats.service` · **Done means** OpenAPI shows no bare dicts; saved report round-trips. ✅ 2026-09-09. `GET /v1/definitions` serves the registry's own models (`Stat`, `Dimension` with the computed `allowed_ops`); `POST /v1/reports/run` takes `ReportRequest`, returns `ReportResult`, runs in FastAPI's thread pool (the ClickHouse client is blocking), maps `ReportError`/`RegistryError` to 400; `api/routers/saved.py` is CRUD for `saved_filters` / `saved_reports` / `saved_stats` (migration `513730dcd5be`, UNIQUE per user, FK-indexed, JSONB documents that ARE the engine's models — a saved report is validated end to end by `stats.service.validate_request` before it is stored, a saved filter by `check_node_anywhere`, a saved stat as an inline custom stat; every row scoped by `user_id` in the WHERE, 404 not 403). The old `/v1/stats`, `/v1/stats/custom`, `/v1/stats/timeline` are adapters over the engine (`stats/timeline.py` builds the winnings series from the rollup, or `player_hands` under a fine filter); counter-based v1 custom stats answer 400 pointing at `/v1/reports/run`; the v1 `/v1/stats/definitions` is gone. Deviations: only the three tables the API uses were created — `cohorts`, `hand_notes`, `hand_tags` from §2.10 arrive with C.7 and phase D — and the v1 `StatsResponse.groups` rows stay an untyped dict until D.9 deletes the adapters (every v2 response is typed). 12 unit tests with the user injected and a fake runner, 3 integration tests (round trip + run, validation, the tenancy wall); `make check` 317 unit, `make test-all` 331 passed / 2 skipped.
- [ ] **C.6** Parity and cut-over · `scripts/fingerprint.py` (old vs new for every built-in stat, hero + population, by position), `reports/parity_<date>.md`; switch the anchor to `player_hands`; delete the old chain and `pool_report.py` · **Done means** parity within rounding on every stat whose registry entry has no `notes`, and an explained delta in the expected direction on each that does; `dbt build` green; pool VPIP/RFI/c-bet by position still match `reports/pool_leaks.csv`.
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
| 2026-09-09 (session 5, C.5) | **C.5 done**: `GET /v1/definitions` (registry models), `POST /v1/reports/run` (`ReportRequest` → `ReportResult`), saved filters/reports/stats CRUD (migration `513730dcd5be`; documents validated by the engine before storage; 404 across tenants), the v1 `/v1/stats*` routes as adapters over the engine (`stats/timeline.py` for the series). Every v2 response typed; only the v1 `groups` rows stay a dict until D.9. `make check` 317, `make test-all` 331 + 2 skipped. | **C.6** |
| 2026-09-09 (session 5, C.4) | **C.4 done**: `stats/{request,resolve,router,query,service}.py` — `run_report()` resolves built-in and custom stats, routes to the rollup or to the facts by stats and dimensions, builds one bound-parameter query per plan (registry values bound too; Enum8 vs String parameters verified on ClickHouse), merges on the group key, attaches a population baseline per cell, caches per tenant. 37 new unit tests (305) incl. the ported v1 security cases; real reports verified from all three tables. | **C.5** |
| 2026-09-09 (session 5, later still) | **C.3 done**: `scripts/gen_stats.py` renders `marts/stats_daily_v2.sql`, `seeds/stat_definitions.csv` and `tests/assert_v2_action_le_opportunity.sql` from the registry (`make gen` / `gen-check` / CI); `stats/compiler.py` (Params for requests, Literals for generated files) underneath. Rollup bootstrapped in 35 passes / 186 s, peak 1.66 GiB; sums equal the v2 facts and the v1 rollup (stats without `notes`); law test green on real data. `make check` 273. | **C.4** |
| 2026-09-09 (session 5, later) | **C.2 done**: the v2 facts — `int_hand_arrays` (per-hand action + seat arrays, `hand_uid FixedString(16)`), `int_board_by_street`, `marts.decisions` (73.7M rows, one per decision, ~85 columns of state-before-the-decision) and `marts.player_hands` (54.6M) — built to `dimensions.yaml`; per-decision SELECT is the macro `decision_state()`; gate anchor is now a list (`anchors` var, `scripts/anchors.py`, `backfill.py --anchor/--select`). Bootstrapped beside the untouched v1 chain in 35 passes / 641 s, peak 1.21 GiB. Row counts exact vs `core.* FINAL`; parity preview identical on 9 of 16 figures, the rest explained by definition and noted in the registry. `make check` 248. Both C.1 and C.2 staged, not committed (commit prompt declined once). | **C.3** |
| 2026-09-09 (session 5) | Phase B merged into `main` (fast-forward to `1d7f7b9`). **C.1 done**: the `stats/` package — `ast.py` (filter/expression tree, shape only), `definitions.py` (entry models), `checks.py` (meaning against the dimensions), `registry/` (loader with located errors, `dimensions.yaml` = every §2.3 column with type/ops/values/buckets/tables, 65 stats in `stats/{preflop,postflop,showdown,money}.yaml`: all 54 v1 built-ins + AF/AFq ×4 + `call_cbet_flop`, `sd_bb_per_100`, `nsd_bb_per_100`). Action-line tokens fixed in §2.3. Definitions tightened to standard tracker meaning with `notes` for the C.6 parity check; C.6's Done-means amended to expect those deltas. `make check` 240 unit tests (65 new); mypy, import-linter and the size check cover `stats/`. | **C.2** |
| 2026-09-09 (session 4) | **Phase B complete** (B.5b deferred to C.2's rebuild). B.1 settings/client out of `api/`; B.2 import-linter (5 contracts, planted violation caught); B.3 sinks behind Protocols with fakes, one ingest loop; B.4 test environment (`test_` prefix, `_test` Postgres DB, `-test` bucket, `test.` topics, Redis db 1; conftest refuses otherwise; analysis DBs byte-identical before/after); B.5 schema declared once in `core/schema/`, staging models generated, spec-vs-`system.columns` test, migration 0009 (dataset on actions/pot_winners + pool repair); B.6 typed hand endpoints; B.7 size limits enforced (28 → 6 baselined violations; PokerStars parser is a package, fingerprint identical). Founder's storage analysis recorded as B.5b. Six commits on `feat/phase-b-module-boundaries`; `make check` 175, `make test-all` 186 + 2 skipped. | **C.1** |
| 2026-09-09 (later) | **Phase A complete.** A.0 checkpoint (3 commits), A.2–A.8 fixes (pool reachable, one ingest loop, all counters routed, typed filters, CORS/secret/cookie/rate limit/escaping, sniff ambiguity, dbt port, law test for all 52 pairs, intermediate schema tests). Found and fixed on the way: the anchor must be the last model (`stats_daily` was empty); `empty_chain` recreate procedure; row-budgeted backfill (2.0M rows/pass) with scratch-table cleanup; LowCardinality retype measured as no disk saving. Full rebuild from empty: 42 passes / 1,411 s; A.1 verified. | **B.1** |
| 2026-09-09 | Audit of code + docs (three agent passes, first-hand reads); wrote POKER_AUDIT.md, this plan, ADR-019 rewrite, ADR-020…026; founder decisions: Hand2Note-class speed and power, separate hero/pool modules, both UI audiences, English only | **A.0** |
