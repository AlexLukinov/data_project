# Poker platform — architecture & code audit

**Date:** 2026-09-09 · **Scope:** `platform/` (all code, dbt, infra) and `docs/POKER_*.md` ·
**Against:** the four founder requirements — (1) any stat for any situation and kind of play,
(2) changing one module cannot break another, (3) new modules are easy to add, (4) the UI is
obvious. **Outcome:** [POKER_PLAN.md](POKER_PLAN.md) — the v2 plan that another session implements.

> Every finding cites `file:line` as of the working tree on the audit date (40 files were
> uncommitted; see §7). Line numbers drift as files change — the *finding* is the durable part.

---

## 0. Verdict in one table

| Area | Verdict | Why |
|---|---|---|
| Parser boundary (`parser/`) | ✅ **keep** | Protocol + registry; a new site is one file + two lines |
| Canonical model + validation (`core/`) | ✅ keep | Site-agnostic, pot-math reconciliation rejects bad hands loudly |
| Tenant isolation | ✅ keep | `tenant_id` is a constructor argument, only from the token, adversarially tested |
| Incremental chain + 4 GB sizing | ✅ keep | Daily partitions, per-partition watermark, anchored selection, backfill loop |
| Query compiler parameterization | ✅ keep | Every literal bound, every identifier allowlisted |
| **Stat model** (156-col flag row) | ❌ **replace** | "Situation" = 28 pre-bucketed columns + `IN`; a new situation is a dbt edit and a rebuild |
| **Stat definitions** | ❌ replace | Three hand-written copies, already diverged; 29 stats unreachable from the API |
| **Ingest loop** | ❌ fix | Two copies (worker vs importer) that already differ on `dataset` and memory |
| **Module layering** | ⚠️ fix | `ingestion` and `ch` import from `api`; storage clients are singletons with no interface |
| **Schema** | ⚠️ fix | Spelled out in 7 places; 3 columns never written; positional row indexing in the API |
| **API surface** | ⚠️ fix | Pool data unreachable; 4 of 28 filters exposed; no CORS; default JWT secret |
| **UI** | ❌ replace | One static page, three controls, no upload, no reports, no pool comparison |
| **Docs** | ⚠️ truth-up | 23 stale claims; ADR-019 describes a design that was reverted |
| Tests | ⚠️ extend | Unit tests are pure and good; no fake sink; integration writes into the analysis DB |

---

## 1. What is sound — keep it

**Parser seam.** `parser/base.py:70-86` defines `SiteParser` as a `runtime_checkable` Protocol
(`site`, `matches`, `split`, `parse_hand`); `parser/registry.py:21-79` holds the registry and
`sniff()`. No `if site == …` branch exists anywhere downstream. Adding a third network is
`parser/sites/<site>.py` + two lines in `registry.py:78-79` + a corpus + a test file — verified by
tracing the enum (`core/enums.py:16-20` already has `WPN`, `IPOKER`, `PARTYPOKER`, `WINAMAX`,
`EIGHT88`), the ClickHouse `site` column (`LowCardinality(String)`), and `/v1/sites`
(`api/routers/uploads.py:42` reads `supported_sites()` dynamically).

**Canonical model.** `core/models.py:190-268` is variant-agnostic (`hole_card_count`,
`GameType.structure`, `Tournament` sub-object) and carries provenance (`raw_object_key`,
`raw_byte_offset`, `parser_version`, `schema_version`) plus forward-compat fields
(`unparsed_lines`, `extra`, `format_signature`).

**Validation.** `core/validation.py:90-96` runs four checks; the pot equation at `:183-199`
(`contributed + cash_drop == awarded + rake + jackpot_drop ± 0.01`) rejects and dead-letters rather
than storing a wrong hand. Adding a rule is one `_check_*` function plus one line. It caught
seven real parser bugs (`POKER_STATUS.md` parser-corrections table).

**Tenant isolation.** `api/queries.py:377` (`tenant_id` positional, required), `:435-436` (first
predicate, always), `api/deps.py:28-35,65-67` (re-read from Postgres, not trusted from the JWT),
`api/cache.py:34-39` (tenant-namespaced keys), `tests/integration/test_tenant_isolation.py`
(forged tokens, cross-tenant ids, tampered params). `user_id` leads every `ORDER BY` in every
table without exception.

**Incremental chain.** `dbt/poker_dwh/macros/incremental.sql` — partition-grain `insert_overwrite`,
per-partition watermark on `core.hands.parsed_at`, every model anchored on
`marts.player_hand_flags`, `scripts/backfill.py` with adaptive batching. Measured: hero increment
781 s → 4 s at 591 MiB; full bootstrap of 9.09M hands on a 4 GB node in 19 passes / 581 s.
`infra/clickhouse/small-node.xml` + `limits.xml` size the caches to the box.

**Idempotency.** Upload sha256 (`api/routers/uploads.py:85-93`), content-addressed object keys
(`ingestion/storage.py:52-69`), `hand_uid = sha256(site:site_hand_id)` (`core/ids.py:22`),
`ReplacingMergeTree(parsed_at)` on every core table, Kafka commit after insert
(`ingestion/worker.py:232`).

**`dataset` separation.** `ch/migrations/0007_dataset.sql` keeps the founder's own hands apart from
the 9M observed pool hands; the rationale there (averaging bb/100 over hands you never played is
meaningless) is correct and the column is in every mart sort key.

---

## 2. Broken now — fix before building anything new

Numbered so [POKER_PLAN.md](POKER_PLAN.md) phase A can reference them.

### B1. The pool dataset cannot be queried through the API
`StatsQuery.dataset` defaults to `"hero"` (`api/queries.py:382`) and emits
`s.dataset = {dataset:String}` (`:440-442`). No router ever sets it (`api/routers/stats.py:83-100`,
`:165-174`). `dataset` is *also* in `COARSE_FILTERABLE` (`queries.py:37`), so the only way a client
can mention it — `POST /v1/stats/custom` with `filters={"dataset":["population"]}` — produces
`… AND s.dataset = 'hero' AND s.dataset IN ('population')`: zero rows, no error.
`TimelineQuery.build()` has no dataset predicate at all (`queries.py:487`) and relies on
`is_hero = 1`. **Consequence:** the 9.08M-hand pool — the entire Differentiator tier — is reachable
only by `scripts/pool_report.py`, which shells out to `clickhouse-client`.

### B2. Two ingest loops, already diverged
`ingestion/pipeline.py:1-11` says it is "the one parse → validate → store loop, shared by the Kafka
worker and the bulk importer". `ingestion/worker.py` does not import it; `worker.process()`
(`worker.py:114-188`) is a hand copy. Differences today:

| | `pipeline.ingest_text` | `worker.process` |
|---|---|---|
| `dataset` | parameter (`pipeline.py:57`), passed to `insert_hands` (`:73`) | **absent** — `insert_hands(client, parsed, message.tenant_id)` at `worker.py:177,182` defaults every upload to `hero` |
| batch size | `batch_size` arg (`:58`) | `settings.insert_batch_size` (`:176`) |
| memory | streaming, bounded by batch | accumulates the whole `parsed` list (`:124`) |
| `EXCERPT_CHARS` | `pipeline.py:28` | redefined `worker.py:43` |
| `parse_failures` columns | — | written out at `worker.py:100-110` **and** `scripts/import_archive.py:253-263` |

Only `scripts/import_archive.py:47` uses `ingest_text`. The product path (HTTP upload) and the
bulk path run different code.

### B3. 29 stats exist in the mart but not in the product
Present in `int_hand_player_flags.sql:286-388` (`limp_faced_raise_*`, `raise_cbet_f_action`,
`float_fold_*`, `fold_to_donk_*`, `fold_to_{flop,turn,river}_raise_*`, `bet_call_river_action`,
`fold_to_probe_*`, `fold_to_delayed_cbet_*`, `probe_r_*`, `river_face_bet_opp`,
`river_raise_action`, `river_check_*`), absent from `stats_daily.sql`, from `COUNTERS`
(`queries.py:237-325`) and from `STATS`. Only `pool_report.py` reads them.

### B4. Table routing ignores the requested stats
`_source_for()` (`queries.py:82-91`) picks rollup vs fact by *filters and group_by only*. A stat
not in `stats_daily` on a coarse query fails with `UNKNOWN_IDENTIFIER`. `TimelineQuery`
validates against all of `FILTERABLE` (`:479-483`) but hardcodes `FROM marts.stats_daily`
(`:506`): any fine filter is a latent 500.

### B5. `stats_daily` sort key vs group key mismatch on an AggregatingMergeTree
`order_by='(user_id, dataset, player_key, day, site, stake_level, position)'`
(`stats_daily.sql:6`, 7 keys) but the `GROUP BY` (`:146-148`) has 11: `game_type`,
`table_format`, `is_hero`, `is_anonymized` are group keys, not sort keys. `AggregatingMergeTree`
collapses rows sharing a sort key; two rows differing only in `game_type` lose one on merge. No
column is declared `SimpleAggregateFunction` despite the header comment (`:12-15`). Masked today
because `insert_overwrite` writes one row per group per partition; one append-path write away
from silent loss.

### B6. Stat definitions in three places, already diverged
1. `int_hand_player_flags.sql` — 154 columns of SQL (the truth).
2. `api/queries.py` — `STATS` (37) + `COUNTERS` (86), hand-maintained.
3. `marts/dim_stat_definitions.sql` — 33 rows with `category`, `definition`, `typical_low/high`,
   **read by nothing** (`/v1/stats/definitions` serves from the Python dicts, `stats.py:48-72`).
Drift: `defend_vs_open`, `fold_vs_open`, `call_4bet`, `hands` exist only in Python; the 29 counters
of B3 exist only in SQL. `tests/assert_action_le_opportunity.sql:11-24` covers 14 of 46 pairs and
its own header says "adding a stat means adding a line here". `macros/incremental.sql` says
"155 columns"; the model emits 154 and the mart 156.

### B7. Numeric filters are typed as strings
`CustomStatsRequest.filters: dict[str, list[str]]` (`api/schemas.py:128`) but `players_dealt_in`,
`players_to_flop`, `is_multiway`, `is_ip`, `board_paired_final`, `board_flush_possible` are
declared `Array(UInt8)` (`queries.py:46-64`).

### B8. Security gaps
- **No CORS middleware** anywhere in `api/`. Works only because the page is same-origin; the Nuxt
  app of ADR-016 will be blocked on its first request.
- Access token in `localStorage` (`api/static/index.html:127,151`) — exactly what
  `api/security.py:6-10` warns against; the page never calls `/v1/auth/refresh`.
- **Stored XSS** from hand-history text: `innerHTML` interpolation of `s.label` (`index.html:176`)
  and of `h.site`, `h.stake_level`, `h.hole_cards`, `h.board` (`:232-238`).
- `jwt_secret` has a working default (`api/settings.py:52`, `.env.example:49`) and nothing refuses
  to start with it.
- Refresh cookie `secure=False` hardcoded (`api/routers/auth.py:54`).
- No rate limiting on `/v1/auth/login` or `/register` (F-706 unbuilt).
- `/health` returns the exception class name to unauthenticated callers (`api/main.py:68`).

### B9. dbt defaults to the wrong ClickHouse
`dbt/poker_dwh/profiles.yml:9-12` — `env_var('CLICKHOUSE_PORT', '8123')`. 8123 is the minikube
lab. `make dbt-build` works because `Makefile:12` exports 8124; a direct `.venv-dbt/bin/dbt build`
(which `CLAUDE.md` documents) targets the lab. `scripts/backfill.py:96` re-adds the env var for
exactly this reason.

### B10. Backwards imports; import-time side effects
`ingestion/storage.py:22`, `ingestion/bus.py:24`, `ingestion/worker.py:29-30`, `ch/migrate.py:26`
import `api.settings` / `api.db`. `api/db.py:14,19` calls `get_settings()` and builds an async
SQLAlchemy engine **at import time**, so `python -m ingestion.worker` and the migration runner
construct a Postgres engine before doing anything. `pyproject.toml:57` lists `api` as a runtime
package of the worker. The dependency graph is `core ← parser ← ingestion ⇄ api`, not a DAG.

### B11. Schema in seven places; three columns never written
`core.hands` is spelled out in `ch/migrations/0001_core.sql:22-59`, `0003:18-31`, `0004:29-34`,
`0006/0007/0008`, `ingestion/loader.py:32-87` (`HANDS_COLUMNS`), `stg_hands.sql:7-53`,
`api/routers/hands.py:34-38,72-74`. Nothing checks them against each other. Result:
`players_remaining`, `entrants` (`0003:30-31`) and `finish_position` (`0003:40`) exist in
ClickHouse and in `core/models.py:166-169` but are never written by `loader.py`; `cards_revealed`
(`0003:45`) has no model field; `dataset` is missing on `core.actions` and `core.pot_winners`.
`api/routers/hands.py:47-57,103-116` indexes result rows positionally (`h[7]…h[13]`) — reordering
a SELECT silently corrupts the replayer payload. `HandPlayer.starting_stack_bb`
(`core/models.py:113-116`) returns the unconverted stack ("placeholder"); `loader.py:267` computes
the real value.

### B12. No test database
`"core.hands"` etc. are string literals (`loader.py:336-340`, `worker.py:98`, `hands.py`,
`backfill.py:75,79`, `seed.py:168-171`). `tests/integration/conftest.py:20-24` says so and
compensates with `_purge_test_tenants` (`:45-74`), which is cleanup not prevention, only purges
`core.*` (never `marts.*` or `parse_failures`), and does not run after a killed session. A previous
leak moved measured hero VPIP from 22.425% to 22.484% — plausible and wrong.

### B13. Parser internals
`GGPokerParser(PokerStarsParser)` (`parser/sites/ggpoker.py:68`) rewrites the header and calls the
Stars state machine; `PARSER_VERSION` is per file (`ggpoker.py:45` = 4, `pokerstars.py:207` = 1),
so a shared-grammar fix cannot be targeted by `WHERE parser_version < N` for GG. GG-only syntax
lives in `pokerstars.py` (`DROPS` at `:100`, `ACT_CASHOUT` at `:148-151`). `sniff()` is
insertion-order dependent with no specificity or ambiguity check (`registry.py:66-79`); matchers
read only `text[:400]` (`pokerstars.py:221`, `ggpoker.py:78`). `core/models.py:89` (`anon_alias`
"per-hand") contradicts `ggpoker.py:9-13` ("recurs across ~2.8 tables").

### B14. Uncommitted work
40 files (26 modified, 14 untracked) including `infra/` (bind-mounted by `docker-compose.yml`),
the incremental macro, three intermediate models, the importer, the backfill loop, the pool report
and the loader regression tests. CI (`.github/workflows/ci.yml`) tests `HEAD`. A fresh clone of
`HEAD` cannot `make up` (Docker creates directories where the XML files should be).

### B15. Unverified data state
ClickHouse was **stopped** during this audit. The previous session's anchored rebuild (all 8
models truncated and rebuilt via `backfill.py`) is therefore **unverified**: 160 partitions on every
model, c-bet counters non-zero, `marts.player_hand_flags` rows = `core.hand_players FINAL`
(54,562,770), no duplicate `(hand_uid, seat)`. [POKER_PLAN.md](POKER_PLAN.md) A.1 verifies it first.

---

## 3. Structural limits against the four requirements

### 3.1 "Any stat for any situation and kind of play"
The design is `sum(action)/sum(opportunity)` over one wide row per (hand, player)
(`int_hand_player_flags.sql:1-13`). Within what is materialized it works: 86 counters × 28
dimensions, sliceable by position/stake/site/date/board/SPR/sizing. The ceiling:

- **A situation is one of 28 pre-bucketed columns, combined with `IN` only** (`queries.py:457`).
  No `<`, `>`, `BETWEEN`, `NOT`, `OR`. "Effective stack < 40bb" is only `stack_bucket IN ('0-40')`.
- **Raw numerics are computed and discarded:** `spr`, `stack_at_flop_bb`
  (`int_player_context.sql:116-127`), `bet_size_pct`, `faced_size_pct`
  (`int_postflop_context.sql:93-94`), `open_to` (`int_preflop_context.sql:140`). Bucket boundaries
  (`0.37/0.60/0.85/1.10`, `1/3/6/13`, `40/75/125/200`) are baked into the fact table, duplicated
  (`int_postflop_context.sql:97-112`), and `pool_report.py:707` admits re-bucketing "is a schema
  change plus a rebuild".
- **Key situation facts never reach the mart:** `is_preflop_aggressor`, `is_preflop_opener`,
  `raises_before`, `n_limpers_before`, `n_cold_callers_before` (`int_preflop_context.sql:116-143`)
  — you cannot filter "hands where I was the aggressor"; `players_to_turn/river/showdown`,
  `pot_at_flop` (`int_hand_context.sql:91-95`); `flop_span`, `flop_all_broadway`
  (`int_board_texture.sql:111-116`); no turn/river texture beyond two booleans.
- **No action-line filter (F-403).** The data model planned `preflop_seq`/`flop_seq` strings
  (`POKER_DATA_MODEL.md` §11.3); none exist. "raise-call-bet-raise" is inexpressible.
- **No arithmetic beyond one ratio.** AF = (bets+raises)/calls cannot be built although `aggr_f`,
  `call_f`, `fold_f` exist; `pool_report.py:481-497` hand-writes SQL for it.
- **Cost of one new counter:** two physical columns on a 54.5M-row, 156-column table; edits in
  `int_hand_player_flags.sql`, `stats_daily.sql` (mandatory, see B4), `queries.py` (twice),
  `dim_stat_definitions.sql`, the dbt test, the dashboard, `pool_report.py` — **5–7 files** —
  plus a rebuild, because no model sets `on_schema_change` (default `ignore` drops the new column
  silently on an incremental run).
- **Grain.** There is no decision-level table the API can see. `core.actions` is the true event
  log (`0001_core.sql:94-116`) and `int_postflop_context` is street-grain, but `queries.py:76-77`
  hardcodes `marts.stats_daily` / `marts.player_hand_flags`.
- **Tournament dimensions** (14 columns in `0003_tournaments_and_variants.sql:18-32`) stop at
  `stg_hands.sql`; none reach the flag table.

### 3.2 "Changing one module must not affect other modules"
- The one-directional seams (`core ← parser`) hold; the rest do not (B10, B2, B11).
- Storage clients are `lru_cache` singletons with no Protocol (`api/db.py:29-43`,
  `ingestion/storage.py:29-44`, `ingestion/bus.py:60-76`); `worker.process` constructs
  `clickhouse()` itself (`worker.py:116`). No test uses a fake sink; every ClickHouse-touching test
  is an integration test.
- `stats_daily` → API coupling: a stat that exists in one but not the other fails at runtime (B4).
- The dashboard hardcodes stat lists, format rules and thresholds (`index.html:178-179,259`)
  that ADR-016 says belong on the server.
- `scripts/backfill.py:84-90` and `pool_report.py:19` shell out to `docker compose exec` — bound
  to a local compose deployment, not to a client.

### 3.3 "Modules should be easy to add"
| Module kind | Today | Verdict |
|---|---|---|
| Site parser | 1 file + 2 registry lines + corpus + test | ✅ easy |
| Validation rule | 1 function + 1 line in `validate()` | ✅ easy (but WARNINGs are computed and thrown away — no store-with-flag path) |
| Stat | 5–7 files + full rebuild | ❌ |
| Filter dimension | 2–6 files + rebuild; +sort-key rebuild if it must be coarse | ❌ |
| Storage backend / sink | no interface; hardcoded `core.*` names | ❌ |
| Ingestion source | must copy one of two loops | ❌ |
| Report | a Python script with raw SQL | ❌ |
| UI panel | edit the one HTML file | ❌ |

### 3.4 "UI should be obvious"
`api/static/index.html` is the entire surface (288 lines): login with hardcoded demo credentials,
date-from/date-to/site controls (`:76-81`), three KPI tiles, one hand-rolled SVG (showdown series
fetched but not drawn), a core-stats table, a by-position table with a hardcoded stat list
(`:259`), and a `<pre>` text dump as the "replayer" (`:241-253`). Missing: upload control, dataset
toggle (hero / pool / compare), 20 of 24 filters, stat selection, custom stats, saved filters,
reports, export, poker-account registration, refresh flow. The page's own header (`:7-15`) says
"Replace it, don't grow it." No `web/`, no `package.json`, no `.vue` file exists despite ADR-016
and the repo layout in `POKER_ARCHITECTURE.md:503`.

---

## 4. Benchmark — how the incumbents model "any stat, any situation"

**PokerTracker 4** layers *columns* (SQL expressions over its per-hand-player table) → *variables*
→ *statistics* (formulas over columns/variables) → *formats*, and lets *filters* (action filters by
street, expression filters over any column or stat) restrict the hand sample at report level.
Custom reports pick rows/columns/filters and are saved ("My Reports"). Sources:
[Custom Statistics Guide](https://docs.pokertracker.com/pt4/tutorials/reports-stats-and-filters/custom-statistics-guide/),
[Creating My Reports](https://docs.pokertracker.com/pt4/tutorials/reports-stats-and-filters/creating-my-reports/),
[Use Custom Columns in Expression Filters](https://www.pokertracker.com/forums/viewtopic.php?f=61&t=97706).
*Lesson:* the custom layer is SQL-shaped, which the current `queries.py:230-236` correctly refuses
for a multi-tenant cloud product — but the *layering* (base facts → named expressions → stats →
presentation) is exactly what B6 lacks.

**Hand2Note** builds filters as a **sequence of decision-tree elements per street** ("Player
Raises", "Villain Calls", "Bet size / Pot in range 0.45–0.55", initial player count, position),
and *smart reports* auto-select the stats relevant to the filtered situation. Sources:
[Custom Filter in Reports](https://hand2note.com/Help/Features/custom-filter-in-reports),
[Smart reports](https://hand2note.com/Help/Features/smart-reports),
[Reports](https://hand2note.com/Help/Features/reports).
*Lesson:* the unit of analysis is the **decision**, and a situation is a predicate over its
context. That is the model [POKER_PLAN.md](POKER_PLAN.md) adopts (ADR-020/022), with ClickHouse
doing what Hand2Note's in-process engine does.

---

## 5. Rule violations (from `~/.claude/CLAUDE.md`)

`ruff check .` is green, but the configured rules do not encode these limits
(`pyproject.toml:63-73`; `ANN401` is ignored "because Any is banned by convention").

**Files > 300 lines (7):** `parser/sites/pokerstars.py` 847 · `scripts/pool_report.py` 725 ·
`api/queries.py` 510 · `dbt/.../int_hand_player_flags.sql` 469 · `scripts/import_archive.py` 396
· `ingestion/loader.py` 362 · `core/models.py` 342.

**Functions > 40 lines (25):** `pool_report.build()` **409** · `loader.to_rows()` 165 ·
`import_archive.main()` 91 · `pokerstars._action_line()` 88 · `pool_report.write_md()` 82 ·
`pipeline.ingest_text()` 79 · `uploads.create_upload()` 77 · `worker.process()` 75 ·
`seed.publish_corpus()` 71 · `import_archive._process_one()` 70 · `pokerstars._finalize()` 67 ·
`pokerstars._parse_tournament()` 63 · `stats.timeline()` 60 · `hands.get_hand()` 56 ·
`backfill.main()` 51 · `StatsQuery.build()` 50 · `pokerstars._parse_header()` 49 ·
`pokerstars._consume()` 48 · `_State.add_action()` 48 · `register_account.main()` 48 ·
`hands.list_hands()` 43 · `stats._run_stats()` 43 · `pool_report.rate()` 41 · two integration tests.

**`Any` (30 occurrences, 9 files):** worst is `loader.py:162` —
`tuple[list[list[Any]], list[list[Any]], list[list[Any]], list[list[Any]]]` for four
differently-shaped row sets. `StatsResponse.groups: list[dict[str, object]]`
(`schemas.py:138`) and `HandDetail.players/actions` (`:190-191`) make every report row and the
whole replayer payload untyped. Three endpoints return bare dicts (`/v1/sites`,
`/v1/stats/definitions`, `/health`).

**Magic numbers / inlined vocabularies:** position lists in three vocabularies
(`core/enums.py:271-284`, `int_hand_player_flags.sql:118-171`, `pool_report.py:23,27`);
`core/enums.py:292` `is_steal_seat` duplicates the SQL steal definition and is used by nothing;
sniff window `400` twice; bucket boundaries (§3.1); `text[:2000]` vs `EXCERPT_CHARS`;
`hands.py:21,25` limits; `pool_report.py:98` low-n thresholds.

**Docstrings:** complete at module/class/top-level; four nested functions undocumented
(`pokerstars.py:678`, `pipeline.py:70`, `hands.py:101`, `import_archive.py:346`).
**TODOs:** none. **Bare `dict`:** none.

---

## 6. Documentation drift

| # | Doc says | Code says |
|---|---|---|
| 1 | `POKER_FEATURES.md:5` "nothing here is built yet"; `POKER_ARCHITECTURE.md:6` "nothing here is implemented yet" | ~45 features shipped |
| 2 | `POKER_ARCHITECTURE.md:498-513` repo layout at repo root with `web/` | everything under `platform/`; no `web/` |
| 3 | `POKER_ARCHITECTURE.md:210-213` `POST /v1/hands:batch`, `WS /v1/stream` | not implemented |
| 4 | `POKER_ARCHITECTURE.md:158` `GET /v1/stats?player=me&stakes=` | params are `date_from/to`, `stake_level`; no `player` |
| 5 | `POKER_ARCHITECTURE.md:171-177` MVs aggregate on insert | F-202 unbuilt; rollup is batch dbt |
| 6 | **ADR-019** monthly partitions, "daily was tried and rejected — do not redo it", per-model watermark | code is **daily**, per-partition, **anchored** on `marts.player_hand_flags`, bootstrapped by `backfill.py` |
| 7 | `POKER_DECISIONS.md:12-31` ADR index stops at 018; `POKER_STATUS.md:110` "18 ADRs" | 19 ADRs |
| 8 | `POKER_STATUS.md:173-174` `F-016`, `F-312b` | ids do not exist in `POKER_FEATURES.md` |
| 9 | `POKER_STATUS.md:214` F-B02 ingest-lag metric ✅ | no such metric; `v_format_drift` is a different thing |
| 10 | `POKER_STATUS.md:206` F-203 ✅ incl. notes/tags/saved filters | `models_pg.py` has User, RefreshToken, PokerAccount, Upload, BaselineSet only |
| 11 | `POKER_STATUS.md:159` F-502 EV-adjusted line ✅ | `ev_won_bb` falls back to the actual result (`:165-166`); the two lines coincide |
| 12 | `POKER_STATUS.md:240` "143.75M actions" | physical count incl. duplicates; logical is 100,346,158 |
| 13 | `POKER_STATUS.md` `## Next action` = timezone re-import | done; the anchored rebuild that followed is unverified (B15) |
| 14 | `POKER_OBSERVABILITY.md:118` `assert_flags_le_opportunities` | file is `assert_action_le_opportunity.sql` |
| 15 | `POKER_GAP_ANALYSIS.md:137,146,155,223` Redis/app layer/parser/sample data "absent" | all exist (planning snapshot of 2026-09-06, still linked as current) |
| 16 | `POKER_FEATURES.md:37-38` master index counts 99; F-115 counted in two tiers | 104 entries |
| 17 | `POKER_ROADMAP.md:161-163` "uploaded through the UI" | the UI has no upload control |
| 18 | ADR-016 "frontend holds no stat logic" | `index.html:178-179,259` hardcode stat lists, formats, thresholds |
| 19 | `macros/incremental.sql` "155 columns" | 154 / 156 |
| 20 | `CLAUDE.md` "ClickHouse memory is currently oversized on purpose (15 GB)" | default is 4 GB since ADR-019 |
| 21 | `POKER_STATUS.md:260` Environments: 15 GB | 4 GB |
| 22 | no ADR records shipping a static-JS dashboard instead of Nuxt | rationale lives in an HTML comment (`index.html:7-15`) |
| 23 | `POKER_STATUS.md:82` "135 tests" | 129 at last `make check` |

---

## 7. State of the tree on the audit date

- Branch `main`, one product commit (`64ea6cf`). 26 modified + 14 untracked files (see B14).
- ClickHouse container stopped; last known good chain state unverified (B15).
- Real data (not to be replaced by synthetic hands, per the founder): 9,093,796 hands ·
  54,562,770 player rows · 100,346,158 actions · hero 19,880 / pool 9,079,995 (pre-purge figures;
  A.1 re-counts).

## 8. What follows

[POKER_PLAN.md](POKER_PLAN.md) turns this into: phase **A** (fix B1–B12, verify B15), phase **B**
(module boundaries, ADR-023), phase **C** (decision-level stat engine + registry, ADR-020/021/022),
phase **D** (Nuxt UI, ADR-024), phase **E** (freshness and scale, ADR-025). Decisions are recorded
in [POKER_DECISIONS.md](POKER_DECISIONS.md) ADR-019 (rewritten) and ADR-020…025.
