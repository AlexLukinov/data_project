# Range Lab — Phase 0 exploration report and integration plan

**Date:** 2026-09-10 · **Spec:** [POKER_RANGE_LAB_SPEC.md](POKER_RANGE_LAB_SPEC.md) (the founder's
text, verbatim) · **Plan:** [POKER_PLAN.md](POKER_PLAN.md) phase F · **Decisions:** ADR-027…029 in
[POKER_DECISIONS.md](POKER_DECISIONS.md).

This is the written report the spec's §0 asks for, plus the integration surface it asks to have
proposed. Every claim below was read from the code or run against the live stack on 2026-09-10;
file references are to `platform/`.

---

## 1. Verdict in five lines

1. **The pool side of Range Lab is mostly already built.** A "node" is a predicate over
   `marts.decisions` (ADR-020), and *action frequency at a node* is one `POST /v1/reports/run`
   with `group_by: [action]`. Tier 1 needs no new SQL, only a `NodeKey → filter AST` compiler.
2. **Showdown ranges (Tier 2) are one more group-by** (`hand_class`) with `hole_cards != ''`
   on the same fact table: revealed hole cards are stored per seat for every showdown, pool
   included.
3. **The frontend is greenfield.** The only UI is a 297-line vanilla demo page slated for
   deletion (plan D.9). `poker-ui` and the spec's §12 components merge with plan D.3's
   primitives; there is nothing to reuse and nothing to fight.
4. **The hand replayer payload exists** (`GET /v1/hands/{uid}` → `HandDetail`: seats, hole
   cards, every action with pot and to-call). The GG parser is Python, validated by pot-math on
   9M hands; it will be reused through `POST /v1/hands/parse` rather than ported.
5. **Appendix A of the spec is verified byte for byte** against the file the founder placed at
   the repo root (§7 below). The `.bin` importer stays backlog, as the spec says.

---

## 2. ClickHouse schema for hand histories

Three raw tables (`core.*`, ReplacingMergeTree, one row per hand / seat / action, declared once
in `core/schema/*.py`) and three analytical tables (`marts.*`, built by dbt from the raw ones).

### 2.1 Raw (`core.*`) — what a hand history becomes

| Table | Grain | Columns that matter to Range Lab |
|---|---|---|
| `core.hands` | one row per hand | `hand_uid`, `site`, `played_at_utc`, `game_type`, `table_format` (`rush` for Rush & Cash), `stake_level` (`NL2`, `NL5` …), `big_blind`, `max_seats`, `players_dealt_in`, `button_seat`, `board_flop_1..3`, `board_turn`, `board_river`, `total_pot`, `rake`, `hero_seat`, `raw_object_key` (the raw text is kept forever, ADR-010) |
| `core.hand_players` | one row per occupied seat | `seat`, `player_key` (NULL when anonymized — every pool seat on GG), `screen_name`, `is_hero`, `position` (`UTG/HJ/CO/BTN/SB/BB` on 6-max), `starting_stack`, `starting_stack_bb`, **`hole_cards`** (`'As Kd'`; `''` unless dealt to hero or shown at showdown), `net_won`, `net_won_bb`, `allin_equity`, `ev_won_bb`, `saw_flop/turn/river`, `went_to_showdown`, `won_hand` |
| `core.actions` | one row per action, **global order within the hand** | `action_index`, `street`, `seat`, `action_type` (posts, fold, check, call, bet, raise, allin, show, muck, uncalled_return, win), `amount`, `amount_to`, `pot_before`, `to_call`, `is_allin`, `is_voluntary`, `cards_revealed` |

Both datasets live in the same tables under the founder's tenant, separated by the `dataset`
column (`hero` = own hands, `population` = the anonymized pool). Every query is scoped by
`user_id` from the token and by `dataset`.

### 2.2 Analytical (`marts.*`) — what Range Lab will actually query

| Table | Rows (2026-09-10) | Grain | Use |
|---|---|---|---|
| **`marts.decisions`** | 73,679,949 | one row per **decision point**, with the state *before* it | every "node" question: frequencies, sizes, showdown ranges, outcomes |
| `marts.player_hands` | 54,562,770 | one row per hand × seat | hand-grain facts (VPIP, PFR, net won, showdown) |
| `marts.stats_daily` | generated rollup | day × table dims × player | cached stats, cohorts |

`decisions` carries ~85 columns; the ones a `NodeKey` maps onto are listed in §3. Column
contract: `stats/registry/dimensions.yaml` (78 dimensions, each with type, allowed operators,
enum values and **presentation buckets**).

### 2.3 Postgres

`users`, `refresh_tokens`, `poker_accounts`, `uploads`, `saved_filters`, `saved_reports`,
`saved_stats`, `cohorts` (Alembic; `api/models_pg.py`). Range Lab adds `ranges`,
`range_versions`, `analyses`, `heuristics` (plan F.6, F.9).

---

## 3. How a "node" is represented today, and how `NodeKey` maps onto it

The spec's `NodeKey` is `{stake, tableSize, effectiveStackBB, heroPosition, villainPosition,
actionSequence, street, boardTexture?}`. Nothing in the platform stores a node as an object; a
node is **a predicate over one `decisions` row**, which is exactly what makes it composable
with every other filter. The mapping:

| `NodeKey` field | `decisions` columns (all filterable through the AST) |
|---|---|
| `stake` | `stake_level` (`NL2`, `NL5`) · `table_format = 'rush'` · `site` |
| `tableSize` | `players_dealt_in` (6) |
| `effectiveStackBB` | `eff_stack_bb` — raw number; buckets `0-40 / 40-75 / 75-125 / 125-200 / 200+` in the registry (the spec's 80–120 ⇒ "100" is a different bucket set; see §8) |
| `heroPosition` | `position` |
| `villainPosition` | `opener_position`, `last_raiser_position` (the seat that made the first / most recent raise) |
| `actionSequence` (preflop) | `n_raises_preflop` (0 / 1 / 2 / 3 …), `facing` (`none / limp / raise / 3bet / 4bet / 5bet_plus`), `n_limpers`, `n_cold_callers`, `n_callers_before`, `players_live`, own line `preflop_line` (`r`, `l-c`, `r-c`) and `pot_type` |
| `actionSequence` (postflop) | `street_line` (own actions this street), `line_so_far` (`r/x-c/`), `prev_street_my_action`, `prev_street_faced`, `am_preflop_aggressor`, `am_prev_street_aggressor`, `facing`, `facing_is_cbet`, `facing_size_pct`, `n_bets_street`, `is_ip`, `players_live` |
| `street` | `street` |
| `boardTexture` | flop: `flop_suitedness`, `flop_pairing`, `flop_high_card`, `flop_connectedness`, `flop_span`; turn/river: `turn_rank`, `turn_completes_flush`, `turn_pairs_board`, `river_*`; cumulative `board_paired`, `board_flush_possible`, `board_straight_possible` |
| bet size buckets | `facing_size_pct` / `size_pct` buckets `small <37% / mid / large / pot / overbet >110%` (registry); `raise_to_bb` is raw with **no buckets yet** |

**What this gives for free.** *UTG opens 2–2.5bb, BTN 3-bets, UTG faces it*: `position = UTG`,
`am_preflop_opener = 1`, `facing = 3bet`, `last_raiser_position = BTN`, `street = preflop`,
`raise_to_bb between …`. *BB called a CO open, flop, facing a 33% c-bet, IP villain*:
`position = BB`, `opener_position = CO`, `pot_type = srp`, `street = flop`,
`facing_is_cbet = 1`, `facing_size_pct < 0.37`. Every such node is a filter, and every
`group_by` (action, size bucket, hand class, texture) is a report — zero deploys.

**What is not a single column.** The *full multi-seat action sequence* (`[UTG raise, BTN
3bet, UTG call]`) is not stored as one string; it is reconstructible from the columns above for
heads-up and two-raise lines, which is the whole of NL2/NL5 Rush & Cash preflop that has sample
size. The founder's off-plan `scripts/spot_nodes.py` already derives a node grammar
(`BU open, BB call`) from `core.actions` and ranks all 346 preflop/flop nodes by frequency
(`reports/spot_frequency.csv`); that grammar is the precedent for `NodeKey` and will be reconciled
with the `decisions` columns rather than duplicated (ADR-028).

**Gap for empirical EQR (spec §10.4).** `net_won_bb` on a decision row is the *whole-hand* net,
not "chips won from this point". The seat's investment before the decision is not a column
(`pot_before_bb` and `to_call_bb` are the pot's, not the seat's). F.10 adds `invested_bb` to the
decision model (one macro line, one registry entry, one rebuild of the daily partitions).

**Showdown hole cards are stored for the pool.** `hand_players.hole_cards` is filled whenever a
seat's cards were shown (§2.1), and `decisions.hole_cards` / `hand_class` / `hand_shape` repeat
it on every decision of that seat — so a Tier 2 showdown range at a node is
`group_by: [hand_class]` with `hole_cards != ''` added to the node predicate (verified counts in
§7).

---

## 4. Query and API layer

### 4.1 The report engine (`stats/`, ADR-021/022) — what Range Lab reuses

- `ReportRequest` (Pydantic, strict): `dataset` (`hero` | `population`), `stats: [codes]`,
  `filter` (JSON AST: `all / any / not / dim op value`), `group_by: [dims]`, `date_from/to`,
  `compare_to: population`, `cohort`, `player_key`, `min_n`.
- `run_report()` resolves stats, routes to the cheapest table, builds **one bound-parameter
  ClickHouse query per plan** (tenant is a constructor argument, never a request field), merges,
  attaches a baseline, caches per tenant in Redis. Tested adversarially for tenancy.
- Custom stats are `{numerator, denominator}` expressions over `count`, `sum(col)`,
  `countIf(pred)`; so *frequency of action X at node N* and *mean net at node N* are both
  expressible without SQL.
- `GET /v1/definitions` serves every dimension (type, operators, enum values, **buckets**) and
  stat (label, formula, typical range). This is where the spec's "buckets configurable in one
  place" already lives: the front end reads bucket boundaries from here, never hardcodes them.

### 4.2 Endpoints that exist (all under `/v1`, bearer token)

| Route | For Range Lab |
|---|---|
| `POST /reports/run` | Tier 1 frequencies, Tier 2 showdown classes, any node stat |
| `GET /definitions` | labels, buckets, glossary seeds |
| `GET /hands?date_from&date_to&limit`, `GET /hands/{hand_uid}` | hero hand list + **the replayer payload** (`HandDetail`: seats with hole cards and stacks, board, every action with `pot_before` / `to_call` / `is_allin`) |
| `GET /hero/leaks`, `/hero/sessions`, `/hero/presets` | "load a hand from a leak" entry points |
| `/pool/cohorts`, `POST /pool/stats?cohort_id`, `/pool/players`, `/pool/presets` | pool frequencies restricted to a cohort (regs / fish) — free upgrade for every pool number |
| `/saved/{filters,reports,stats}` | persistence pattern to copy for ranges and analyses |
| `POST /uploads` | already ingests the founder's hand histories |

Missing for Range Lab: a hand list over the **pool** dataset (`list_hands` pins `is_hero = 1`),
a **parse-only** endpoint for pasted hands, node endpoints in the spec's shape, and range /
analysis persistence. All are listed in §8.

### 4.3 Analysis modules (`analysis/`, ADR-026)

`analysis/hero` (leaks, sessions) and `analysis/pool` (reports, players, cohorts,
`BaselineProvider`) contain no SQL and call the engine. Node endpoints belong in
`analysis/pool/nodes.py` (the `NodeKey → AST` compiler + the four node services) and a
router `api/routers/pool_nodes.py`; analysis may not import api (import-linter).

---

## 5. Frontend stack and shared components

- **Shipped:** `api/static/index.html`, 297 lines of vanilla HTML/JS served by FastAPI at `/`;
  login, a stats table and a hand list. Its own header says "replace it, don't grow it"; plan
  D.9 deletes it.
- **Decided (ADR-016/024), not yet built:** `platform/web/`, Nuxt 4 in SPA mode (`ssr: false`),
  TypeScript strict, Pinia setup stores, ESLint, `nuxt typecheck` in CI; primitives in
  `components/poker/` (`HandMatrix` 13×13, `Card`, `Board`, `PositionPicker`, `ActionLine`,
  `SizeBadge`, `StackBadge`) reviewed on a fixture page; one filter object in the URL.
- **No JS toolchain exists yet** in the repo: no `package.json`, no lockfile, no node CI job.
  Node 23.11 and npm 11.4 are installed on the founder's machine; corepack's pnpm cache is broken
  there, so the workspace uses **npm workspaces** (no extra tooling, one lockfile).
- **Consequence:** `poker-ui` is greenfield, and the spec's `RangeMatrix` *is* plan D.3's
  `HandMatrix` — one 13×13 component, in `packages/poker-ui`, used by the pool ranges view, the
  holding filter, the analyzer and the trainers. The rule "a poker concept is rendered by exactly
  one component" (ADR-024) and the spec's "nothing in `poker-ui` imports from the app" are the
  same rule; ESLint enforces it.

---

## 6. Auth and session model

- **Registration/login** (`/v1/auth/register`, `/login`): Argon2id password hashes; per-IP
  rate limit on both routes.
- **Access token:** JWT, 30 minutes, claims `sub` (user id), `tid` (tenant id), `typ: access`.
  Sent as `Authorization: Bearer`. **`tenant_id` is re-read from Postgres on every request**, so a
  disabled account or reassigned tenant takes effect immediately.
- **Refresh token:** 48-byte random, stored hashed, **HttpOnly cookie** scoped to `/v1/auth`,
  `SameSite=Lax`, `Secure` from settings (the process refuses to start in prod without it),
  **rotated on every refresh** (replay of a stolen token fails and is detectable). `/logout`
  revokes.
- **CORS:** explicit origins (`http://localhost:3000`, `http://127.0.0.1:3000` by default),
  credentials allowed, methods and headers enumerated.
- **Tenancy:** `CurrentUser` is the only source of `tenant_id`; no endpoint accepts one; tested
  by `tests/test_tenant_isolation.py` with forged tokens and other tenants' ids.

**For Range Lab:** the SPA keeps the access token in memory (Pinia), calls `/v1/auth/refresh`
silently on 401, and never touches `localStorage` for credentials (plan D.2). Everything offline
(equity, ranges, blockers, distribution, trainers) needs no token; everything pool-side and the
server-side range library do.

---

## 7. Verified against the live stack (2026-09-10)

**Appendix A of the spec, checked against `6Max Calculated Preflop Ranges.bin` (3,727,413
bytes) with a 20-line Python script:** magic `CA 9A 2D EC`; two `{uint32 LE length, zlib}`
streams (1,557,846 → 18,656,418 bytes and 2,169,555 → 13,023,995 bytes) that consume the file
exactly to EOF; stream 0 header `(106, 0.0, 5.0, 10.0, 0, 6)`; six player blocks of
`float32[1326]` (every weight 1.0) + `float32` stack 1000.0, ending at byte 31,872. Every
"verified ✅" line of Appendix A reproduces. The file is gitignored (`*.bin`); a trimmed fixture
(header + one player block, a few KB) will be committed when the importer R&D starts.

**Showdown hole cards in the pool** (`marts.player_hands`, tenant 1, queried 2026-09-10) — the
basis for Tier 2:

| dataset | seats | seats at showdown | seats with hole cards | of which villains |
|---|---|---|---|---|
| population | 54,443,958 | 2,227,803 | 387,740 | 387,740 |
| hero | 118,812 | 4,356 | 23,488 | 3,686 |

387,740 pool combos is a real Tier 2 sample. But only 17% of pool seats that reached showdown
carry cards: GG's anonymized histories show mucked hands only sometimes, or the parser drops a
line. **F.8 must settle which** by reading the raw text of a few pool showdown hands (the raw
object is kept, ADR-010) before any showdown range is shown — the selection bias the spec warns
about is stronger than "showdown only" if losers' cards are systematically missing.

---

## 8. Proposed integration surface

### 8.1 Where the packages live

```
platform/web/                       npm workspaces root (one lockfile, one licence audit, one CI job)
  packages/poker-core/              pure TS: cards, ranges, formats, evaluator, equity, blockers,
                                    distribution, metrics, classifier, NodeKey type   (spec §4–8)
  packages/poker-workers/           Comlink wrappers, WASM loading                       (spec §5.3)
  packages/poker-importers/         range importers, pure TS                              (spec §11.3)
  packages/poker-ui/                Vue 3 SFCs, depends on poker-core only               (spec §12)
  apps/web/                         ONE Nuxt 4 app in SPA mode: the phase-D dashboard (My game,
                                    Pool, Hands, Upload) AND the Range Lab routes
                                    (/analyze, /blockers, /ranges, /train, /progress)   (ADR-027)
  LICENSES.md                       every direct dependency, its licence, why it is acceptable
```

Deviation from the spec's §3/§3.2 (`apps/range-lab` as a Vite SPA): the founder chose one Nuxt 4
app shell on 2026-09-10 — one auth client, one API client, one `poker-ui`, and Nuxt is Vite +
vue-router underneath, so Workers, Comlink and Dexie are unaffected. `LICENSES.md` sits at the
JS workspace root rather than the repository root because the repository root is shared with
the minikube lab.

### 8.2 Endpoints — reuse first

| Spec (§10.2) | Decision |
|---|---|
| `GET /api/hero/hands?filter=` | **exists** as `GET /v1/hands` (hero); gains `filter` = the ADR-022 AST in F.7 |
| `GET /api/hero/hand/:id` | **exists** as `GET /v1/hands/{hand_uid}` → `HandDetail` |
| `GET /api/pool/hands?filter=` | **new** `GET /v1/pool/hands` — the same query without `is_hero = 1`, `dataset = population` (F.7) |
| (paste a hand) | **new** `POST /v1/hands/parse` → `HandDetail` from raw text, nothing stored (ADR-029, F.7) |
| `GET /api/pool/node/frequencies?node=` | **new** `POST /v1/pool/node/frequencies` (body: `NodeKey`) = `run_report(group_by=[action, size_pct])` over the compiled predicate (F.8) |
| `GET /api/pool/node/showdown-range?node=` | **new** `POST /v1/pool/node/showdown-range` = `group_by=[hand_class]` + `hole_cards != ''`, `showdownBiasWarning: true` always (F.8) |
| `GET /api/pool/node/estimated-range?node=&prior=` | **new**, F.10 (Tier 3 over the two above) |
| `GET /api/pool/node/eqr?node=` | **new**, F.10, after `invested_bb` lands on `decisions` |
| (range library) | **new** `/v1/ranges` CRUD + `/v1/ranges/{id}/versions` (F.6), `/v1/analyses` (F.9), `/v1/heuristics` (F.11) — same pattern as `/v1/saved/*` |

Node endpoints take the `NodeKey` as a JSON body (`POST`), not a query string: it is a nested
object and the platform's convention is typed Pydantic bodies. Every pool answer carries
`{tier, sampleSize, confidence}`; below `min_n` (default 200, registry-configurable) the value
is `null` and the UI shows "insufficient data" (spec §17).

### 8.3 `NodeKey` — one definition, two languages (ADR-028)

- Python: `analysis/pool/nodes.py` — `NodeKey` (Pydantic, strict) and `node_filter(key) -> Node`
  (the AST). Bet sizes bucket through the registry's `buckets` (a `raise_to_bb` bucket set is
  added to `dimensions.yaml`; `facing_size_pct` / `size_pct` already have one), so the buckets
  live in **one file** and reach the front end through `/v1/definitions`.
- TypeScript: `packages/poker-core/src/node.ts` — the same shape.
- A JSON fixture of nodes (`tests/fixtures/nodes.json`) is parsed by both test suites, so the two
  definitions cannot drift.

### 8.4 What the report engine needs (small, F.8/F.10)

1. `raise_to_bb` buckets in `dimensions.yaml` (preflop size buckets, spec §10.1).
2. `invested_bb` on `decisions` (seat's chips in before the decision) for empirical EQR (F.10).
3. Nothing else: frequencies, showdown classes, cohort-restricted pool numbers and
   sample sizes are all expressible today.

---

## 9. Phase mapping (spec §14 → plan phase F)

| Spec phase | Plan step | Notes |
|---|---|---|
| 0 Exploration | **F.0** | this report |
| 1 poker-core + licence CI | **F.1** | started 2026-09-10; also creates the workspace root |
| 2 Equity engine | **F.2** | |
| 3 Blockers + distribution | **F.3** | includes the §8 metrics module |
| 4 Core UI | **F.4** | = plan **D.1** app shell + `poker-ui`; from here D and F interleave |
| 5 Metrics + visualization | **F.5** | |
| 6 Range library + importers | **F.6** | needs D.2 (auth in the SPA) |
| 7 Hand replayer | **F.7** | absorbs plan **D.7**'s replayer |
| 8 Pool integration | **F.8** | Tier 1 + 2 |
| 9 9-step analyzer | **F.9** | |
| 10 Tier 3 + EQR | **F.10** | |
| 11 Training | **F.11** | |
| 12 UX polish | **F.12** | |
| backlog `.bin` | backlog | Appendix A verified; trimmed fixture when picked up |

Ordering: F.1 → F.2 → F.3 (headless TypeScript, no dependency on the API) → D.1 + F.4 → D.2 →
F.5 → F.6 → F.7 → F.8 → D.4–D.6 (the dashboard pages, on the same components) → F.9 → F.10 →
F.11 → F.12 → D.8/D.9.

---

## 10. Risks specific to Range Lab

| Risk | Mitigation |
|---|---|
| Flop exact ≤ 1.5 s needs ~2.3M `rank7` calls per range pair | PHE WASM (`poker-hand-evaluator-wasm` 0.4.0, Apache-2.0) is the primary evaluator; the pure-TS fallback exists for tests, not for speed; benchmark script in F.2 |
| Sample sizes at NL2/NL5 postflop nodes | buckets from the registry, cohorts optional, `min_n` gating everywhere, never a fabricated number |
| Two definitions of `NodeKey` | shared JSON fixture parsed by both suites (§8.3) |
| Licence drift in transitive deps | `license-checker-rseidelsohn` allowlist in `make web-check` and CI from F.1 |
| A second stat vocabulary in the front end | the client reads labels, buckets and definitions from `/v1/definitions`; `poker-core` computes equities and combos, never pool stats |
