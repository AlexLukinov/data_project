# Feature backlog — poker hand-analysis platform

> Companion docs: [POKER_STATUS.md](POKER_STATUS.md) *(live progress)* · [POKER_ROADMAP.md](POKER_ROADMAP.md) · [POKER_ARCHITECTURE.md](POKER_ARCHITECTURE.md) · [POKER_DATA_MODEL.md](POKER_DATA_MODEL.md) · [POKER_DECISIONS.md](POKER_DECISIONS.md) · [POKER_GAP_ANALYSIS.md](POKER_GAP_ANALYSIS.md) · [POKER_OBSERVABILITY.md](POKER_OBSERVABILITY.md)
>
> The master backlog — a **planning snapshot of 2026-09-06**. About 45 features have shipped
> since; live status per feature lives in [POKER_STATUS.md](POKER_STATUS.md). The 2026-09-09 audit
> ([POKER_AUDIT.md](POKER_AUDIT.md)) and the v2 plan ([POKER_PLAN.md](POKER_PLAN.md)) supersede the
> *how* described here for F-301/F-313/F-403/F-408/F-409/F-511 (stat registry, decision-level fact,
> filter AST) and F-5xx (Nuxt UI, two areas). Where this file and those disagree, they win.
> Note: the master index below counts 99 ids but the file lists 104; F-115 appears in two tiers.

## How to read this

**Tiers**

| Tier | Meaning |
|---|---|
| **MVP** | Parity essentials. Without these there is no product. Phases 0–1. |
| **Differentiator** | The defensible core — population analysis, EV/leak detection, AI coaching. This is *why* someone switches from PT4. Phases 2–3. |
| **Expansion** | Real value, not urgent. Phase 4+. |
| **Future** | Live HUD, solver, marketplace. Seams designed now, built much later. |

**Effort** (solo maintainer, ~15–20 h/week): **S** ≤ 1 day · **M** 2–4 days · **L** 1–2 weeks ·
**XL** 3+ weeks.

**Stack tags** — `parser` `core` `ch` (ClickHouse) `dbt` `pg` (Postgres) `api` `web` `redis`
`kafka` `lake` `spark` `airflow` `infra` `agent`

**Status** — every feature below is `planned`. Statuses change only in
[POKER_STATUS.md](POKER_STATUS.md); this file records *what* and *why*, not *how far*.

**Format** — `ID · Name` — `stack tags` · effort · status, then description, dependencies, and
the incumbent that does it best.

---

## Master index

| Tier | Count | IDs |
|---|---|---|
| MVP | 47 | F-001…008, F-101…117, F-201…205, F-208…209, F-301…312, F-401…409, F-501…505, F-508…510, F-701…704, F-706, F-801, F-B01…B02, F-B07 |
| Differentiator | 17 | F-115, F-210, F-313…314, F-410, F-506…507, F-511, F-601…608, F-906 |
| Expansion | 21 | F-118, F-206…207, F-315, F-407, F-512, F-610, F-705, F-707, F-901…903, F-A01…A04, F-A07…A10, F-B03…B06, F-B08 |
| Future | 14 | F-609, F-802…808, F-904…905, F-A05…A06 |

---

## F-0xx · Foundation & tooling

**F-001 · Monorepo structure** — `infra` `core` · **M** · planned
> Service layout: `core/` (canonical model, shared types), `parser/`, `ingestion/`, `api/`,
> `web/`, `dbt/poker_dwh/`, `infra/`. One `uv` workspace so `core` is importable everywhere
> without publishing.
> **Deps** — none · **Reference** — n/a

**F-002 · Local dev environment (docker-compose)** — `infra` · **M** · planned
> ClickHouse + Postgres + Kafka (single broker, KRaft) + Redis + MinIO with healthchecks and
> `depends_on: service_healthy`. `make up` / `make seed` / `make test` / `make down`. **Separate
> from the minikube lab** — see [ADR-015](POKER_DECISIONS.md#adr-015--docker-compose-for-the-product-minikube-stays-the-learning-lab).
> **Deps** — F-001 · **Reference** — n/a

**F-003 · Python tooling & CI** — `infra` · **S** · planned
> `uv` + `pyproject.toml`, ruff (lint+format), pytest, mypy strict, pydantic v2. GitHub Actions:
> lint → typecheck → test → dbt parse.
> **Deps** — F-001 · **Reference** — n/a

**F-004 · Postgres migrations** — `pg` · **S** · planned
> Alembic from the first table, SQLAlchemy 2.x `Mapped[]`, `MetaData(naming_convention=…)` so
> constraint names are stable forever. Never `create_all()`.
> **Deps** — F-001 · **Reference** — n/a

**F-005 · ClickHouse schema management** — `ch` `infra` · **M** · planned
> ClickHouse has no Alembic. Versioned `.sql` files applied by a small idempotent runner —
> see [ADR-017](POKER_DECISIONS.md#adr-017--clickhouse-migrations-are-versioned-sql-not-a-framework).
> **Deps** — F-002 · **Reference** — n/a

**F-006 · dbt project bootstrap** — `dbt` · **S** · planned
> `poker_dwh` project: profiles from env, `sources.yml` over `core.*`, staging skeleton, the
> `generate_schema_name` macro reused from [dbt/shop_dwh](../dbt/shop_dwh/).
> **Deps** — F-005 · **Reference** — n/a

**F-007 · Seed hand corpus** — `core` `parser` · **S** · planned
> A handful of real hands per supported format, plus the pathological set: all-in side pots,
> uncalled bet returned, split pot, straddle, sit-out mid-hand, no showdown, heads-up (button *is*
> the small blind), run-it-twice. The permanent regression fixture.
> **Deps** — F-001 · **Reference** — n/a

**F-008 · Config & secrets** — `infra` · **S** · planned
> `pydantic-settings`, `.env.example` committed, `.env` never. One settings object per service.
> **Deps** — F-001 · **Reference** — n/a

---

## F-1xx · Ingestion & parsing

**F-101 · Canonical hand model** — `core` · **L** · planned
> `CanonicalHand` + `HandPlayer` + `Action` + `Pot` as typed Python. Variant-agnostic (variable
> hole-card count for PLO), currency- and chip-aware, timezone-normalized. The contract every
> parser emits and every consumer reads. Full design in [DATA_MODEL §2](POKER_DATA_MODEL.md#2-the-canonical-hand-model).
> **Deps** — F-001 · **Reference** — PT4's normalized schema

**F-102 · Parser interface & site registry** — `parser` · **S** · planned
> `parse(raw_text, site) -> CanonicalHand` plus a registry keyed by site and a sniffer that
> detects the format when the site isn't declared. **The Rust seam**
> ([ADR-001](POKER_DECISIONS.md#adr-001--python-primary-with-a-hard-parser-boundary)).
> **Deps** — F-101 · **Reference** — n/a

**F-103 · PokerStars-format parser** — `parser` · **L** · planned
> The reference format; several networks approximate it. Cash + tournament headers, all streets,
> summary block, rake, side pots.
> **Deps** — F-102, F-007 · **Reference** — PT4 / HM3 (both near-perfect on it)

**F-104 · iPoker parser (XML)** — `parser` · **L** · planned
> Structurally different — XML, not text. Proves the interface actually abstracts format shape
> and not just regex dialect. Worth doing second for exactly that reason.
> **Deps** — F-102 · **Reference** — Hand2Note

**F-105 · WPN / ACR parser** — `parser` · **M** · planned
> PokerStars-like with quirks; anonymous-table option.
> **Deps** — F-103 · **Reference** — PT4 (anonymous-table capture)

**F-106 · partypoker parser** — `parser` · **M** · planned
> Own text format, changed across client versions — versioned sub-parsers.
> **Deps** — F-102 · **Reference** — Hand2Note

**F-107 · Winamax parser** — `parser` · **M** · planned
> Own conventions, FR/EN locales, decimal-comma amounts.
> **Deps** — F-102 · **Reference** — Hand2Note

**F-108 · GGPoker / PokerCraft parser + anonymization** — `parser` `core` · **L** · planned
> Text export plus the anonymization constraint: opponents carry per-hand pseudonyms with no
> cross-hand identity. Sets `is_anonymized`, nulls `player_key`, keeps `anon_alias`. Hero stats
> work; opponent stats and HUD do not. See [DATA_MODEL §3](POKER_DATA_MODEL.md#3-the-ggpoker-anonymization-constraint).
> **Deps** — F-103 · **Reference** — Hand2Note (handles GG best); no incumbent solves the identity problem — it's unsolvable

**F-109 · PLO / multi-variant support** — `core` `parser` `dbt` · **L** · planned
> 4-card (and later 5/6-card) Omaha through the whole chain: variable hole cards, pot-limit
> sizing rules, variant-aware stat definitions. **In MVP scope per the Tier-1 brief** ("top NLHE
> + PLO networks").
> **Deps** — F-101, F-103 · **Reference** — PT4 (solid PLO); Flopzilla Pro (PLO equity)

**F-110 · Upload endpoint → object storage** — `api` `lake` · **M** · planned
> `POST /v1/uploads`: authenticate, quota-check, sha256, write zstd to MinIO/S3 under
> `site=/user_id=/ingested_date=`, row in `uploads`, return 202. Under 200 ms; no parsing inline.
> **Deps** — F-701, F-002 · **Reference** — n/a

**F-111 · Kafka ingestion topic & producer** — `kafka` · **M** · planned
> `hands.uploads.v1` carrying **pointers**, keyed by `user_id`. Separate `hands.bulkimport.v1`
> so a 10M-hand backfill can't starve live uploads. See [DATA_MODEL §7](POKER_DATA_MODEL.md#7-kafka-topic-design).
> **Deps** — F-110 · **Reference** — n/a

**F-112 · Parser worker** — `parser` `ch` `kafka` · **L** · planned
> Consume pointer → fetch object → split into hands → parse → Polars columnar normalize →
> batched insert to ClickHouse → commit offsets **after** the insert. At-least-once + engine
> dedup, the pattern from [dags/shop_cdc_consumer.py](../dags/shop_cdc_consumer.py).
> **Deps** — F-111, F-103, F-201 · **Reference** — n/a

**F-113 · Dedup & idempotent re-ingest** — `parser` `ch` `pg` · **M** · planned
> `hand_uid = sha256(site + site_hand_id)`, content-hash fallback. `UNIQUE(user_id, sha256)` on
> uploads so re-uploading a file is a no-op. `ReplacingMergeTree(parsed_at)` collapses redeliveries.
> **Deps** — F-112 · **Reference** — PT4 (duplicate detection on import)

**F-114 · Hand validation** — `parser` · **M** · planned
> Reconcile pot math (contributions = pot + rake + uncalled returns), detect truncated/corrupt
> hands, assert action sequence legality. **A hand that doesn't balance must fail loudly**, not
> silently produce wrong stats.
> **Deps** — F-101 · **Reference** — HM3 (strict import validation)

**F-115 · Re-parse pipeline** — `parser` `lake` `ch` · **L** · **Differentiator** · planned
> Parser v_n ships → re-derive canonical rows from raw text at hand-level granularity → new rows
> supersede old via `parsed_at`. Python-worker-scale first, Spark later (F-B06).
> **Deps** — F-113, F-205 · **Reference** — none do this well; it's a cloud-native advantage

**F-116 · Archive & bulk import** — `api` `parser` · **M** · planned
> Zip/tar/gz uploads, multi-GB, resumable, progress reporting. First-run experience for a user
> with 5M hands is *the* onboarding moment.
> **Deps** — F-110 · **Reference** — PT4/HM3 bulk import

**F-117 · Encoding, timezone & currency normalization** — `parser` `core` · **M** · planned
> UTF-8/UTF-16/cp1251, ET/local/UTC → UTC (keeping the original), decimal-comma locales,
> multi-currency, tournament chips ≠ money.
> **Deps** — F-101 · **Reference** — Hand2Note (broadest locale coverage)

**F-118 · Tournament summary parsing** — `parser` · **M** · **Expansion** · planned
> Separate summary files carrying buy-in, finish position, prize — needed for ROI, absent from
> hand histories.
> **Deps** — F-103 · **Reference** — PT4/HM3 tournament reports

---

## F-2xx · Storage & data model

**F-201 · ClickHouse core tables** — `ch` · **L** · planned
> `core.hands` / `hand_players` / `actions`, `ReplacingMergeTree(parsed_at)`,
> `PARTITION BY toYYYYMM(played_at_utc)`, **`user_id` first in every `ORDER BY`**. DDL in
> [DATA_MODEL §4.2](POKER_DATA_MODEL.md#42-core-tables).
> **Deps** — F-005 · **Reference** — n/a

**F-202 · AggregatingMergeTree rollups + MVs** — `ch` `dbt` · **L** · planned
> Incremental aggregation on insert, so stats are fresh seconds after upload with no
> orchestrator. Two-tier with dbt per [ADR-003](POKER_DECISIONS.md#adr-003--dbt-owns-the-stat-definitions-clickhouse-mvs-own-the-hot-path).
> **Deps** — F-301 · **Reference** — n/a

**F-203 · Postgres system-of-record schema** — `pg` · **L** · planned
> Accounts, auth, poker_accounts, uploads, parse_jobs, parser_versions, notes, tags, saved
> filters, baseline_sets, coaching_reports. Outline in [DATA_MODEL §5](POKER_DATA_MODEL.md#5-postgresql--the-system-of-record).
> **Deps** — F-004 · **Reference** — n/a

**F-204 · Redis stat-block cache** — `redis` `api` · **M** · planned
> Cache key = `stats:{user_id}:{filter_hash}`. Nothing authoritative; LRU eviction; invalidate on
> new hands for that user.
> **Deps** — F-403 · **Reference** — n/a

**F-205 · Data lake raw layout** — `lake` · **M** · planned
> `s3://poker-raw/site=/user_id=/ingested_date=/*.txt.zst` — immutable, forever. The actual
> source of truth ([ADR-010](POKER_DECISIONS.md#adr-010--raw-hand-text-is-the-source-of-truth-clickhouse-is-derived)).
> **Deps** — F-110 · **Reference** — none keep raw text server-side; this is a cloud advantage

**F-206 · Iceberg tables over the lake** — `lake` `spark` · **L** · **Expansion** · planned
> `raw_hand_texts` (per-hand) + `hands_history` (canonical, all parser versions). Schema and
> partition evolution for a model that *will* change ([ADR-007](POKER_DECISIONS.md#adr-007--iceberg-over-delta-lake)).
> **Deps** — F-205 · **Reference** — n/a

**F-207 · Hot/cold tiering** — `ch` · **M** · **Expansion** · planned
> `TTL played_at + INTERVAL 18 MONTH TO VOLUME 's3'` on `core.*`; rollups stay hot forever.
> **Deps** — F-201 · **Reference** — n/a

**F-208 · Per-tenant quotas** — `ch` `api` · **M** · planned
> CH `SETTINGS PROFILE` + `QUOTA` per tier: `max_memory_usage`, `max_execution_time`,
> `max_rows_to_read`, queries/hour. Stops one heavy user degrading everyone.
> **Deps** — F-201, F-702 · **Reference** — n/a

**F-209 · Baselines / solver-output seam** — `ch` `pg` · **S** · planned *(scaffold only)*
> Empty `baseline_sets` (Postgres) + `baseline_strategies` (ClickHouse) keyed by `spot_key`, with
> a read interface. **Created in Phase 1, populated much later** —
> [ADR-011](POKER_DECISIONS.md#adr-011--the-solver-is-a-baseline-producer-behind-a-spot_key-seam).
> **Deps** — F-201 · **Reference** — GTO Wizard (baseline distribution model)

**F-210 · `spot_key` derivation** — `dbt` · **L** · **Differentiator** · planned
> Deterministic hash of (game, stakes bucket, positions, stack depth, preflop sequence, street,
> board texture). The join key between user stats, population baselines and solver output.
> **Emit from Phase 1 even with nothing to join against.**
> **Deps** — F-301, F-402 · **Reference** — GTO Wizard / Hand2Note spot taxonomy

---

## F-3xx · Statistics

**F-301 · Flag table (opportunity/action pairs)** — `dbt` `ch` · **L** · planned
> **The single most important model.** One wide row per (hand, player) with a counter pair per
> stat, so every stat is `sum(action)/sum(opportunity)` sliceable by any dimension. Design in
> [DATA_MODEL §4.3](POKER_DATA_MODEL.md#43-the-flag-table--the-heart-of-the-stat-layer).
> **Deps** — F-201 · **Reference** — PT4/HM3 both do this internally

**F-302 · Preflop stats** — `dbt` · **M** · planned
> VPIP, PFR, 3-bet, 4-bet, fold-to-3bet, fold-to-4bet, cold-call, squeeze, limp, limp-raise.
> **Deps** — F-301 · **Reference** — PT4 (definitional gold standard)

**F-303 · Steal & blind defense** — `dbt` · **M** · planned
> Steal attempt (CO/BTN/SB first-in), fold BB/SB to steal, blind defense %, 3-bet vs. steal.
> **Deps** — F-302 · **Reference** — PT4

**F-304 · Postflop aggression by street** — `dbt` · **L** · planned
> C-bet flop/turn/river, fold-to-cbet each street, double/triple barrel, delayed c-bet.
> **Deps** — F-301 · **Reference** — HM3

**F-305 · Postflop specialty stats** — `dbt` · **M** · planned
> Check-raise, float, donk bet, probe bet — by street. The stats that separate a serious tracker
> from a toy.
> **Deps** — F-304 · **Reference** — Hand2Note

**F-306 · Showdown stats** — `dbt` · **S** · planned
> WWSF, WTSD, W$SD.
> **Deps** — F-301 · **Reference** — PT4

**F-307 · Aggression factor & frequency** — `dbt` · **S** · planned
> AF = (bets+raises)/calls; AFq = (bets+raises)/(bets+raises+calls+folds). Both, because people
> quote both and mean different things.
> **Deps** — F-301 · **Reference** — PT4

**F-308 · Win-rate metrics** — `dbt` · **M** · planned
> bb/100, net won, rake paid, rake-adjusted win rate. Rake is the difference between "winning
> player" and "winning player after rake".
> **Deps** — F-301 · **Reference** — PT4/HM3

**F-309 · All-in EV adjustment** — `dbt` `core` · **L** · planned
> Equity at the moment of the all-in → EV-adjusted winnings. Requires a hand evaluator
> ([ADR-018](POKER_DECISIONS.md#adr-018--all-in-equity-uses-a-vetted-evaluator-computed-at-parse-time)).
> Feeds the EV graph (F-502) — the most-looked-at chart in any tracker.
> **Deps** — F-301 · **Reference** — PT4/HM3 (both have it; it's table stakes)

**F-310 · Positional breakdowns** — `dbt` · **M** · planned
> Every stat by BTN/SB/BB/UTG/…/CO. Free from the flag table — it's a `GROUP BY` column, not N
> more models.
> **Deps** — F-301 · **Reference** — PT4

**F-311 · Stat definitions registry** — `dbt` `api` · **S** · planned
> `dim_stat_definitions`: code, human name, formula, good/bad direction, typical range. API,
> frontend and LLM prompt all read *one* definition instead of drifting copies.
> **Deps** — F-302 · **Reference** — none do this; it's a maintainability win

**F-312 · Sample size & confidence intervals** — `dbt` `api` `web` · **M** · planned
> Sample size returned with **every** stat; confidence bands on bb/100. A 3-bet% over 40
> opportunities is noise and showing it bare is misleading users. **Genuine differentiator** —
> most trackers show point estimates with false precision.
> **Deps** — F-308 · **Reference** — none do this well

**F-313 · Custom stat builder** — `dbt` `api` `web` · **L** · **Differentiator** · planned
> User-defined stats as safe SQL expressions over the flag table, appearing as columns/report
> fields. Needs an expression allowlist, not raw SQL.
> **Deps** — F-311, F-409 · **Reference** — PT4 (custom stats/columns — best in class)

**F-314 · Stats-as-seen-at-play** — `dbt` `ch` · **L** · **Differentiator** · planned
> Point-in-time stat snapshot: what a HUD *would have shown* at hand N, using only hands before
> it. Makes the replayer honest about what you actually knew.
> **Deps** — F-301, F-506 · **Reference** — HM3 (replayer stat context)

**F-315 · Tournament-specific stats** — `dbt` · **L** · **Expansion** · planned
> Stage-aware (early/bubble/ITM/FT), M-ratio, ICM-adjusted aggression, push/fold conformance.
> **Deps** — F-118, F-407 · **Reference** — HM3 tournament reports

---

## F-4xx · Filtering & query

**F-401 · Core filters** — `dbt` `api` · **M** · planned
> Date range, stakes, position, game type, table size, site, session. The always-on dimensions.
> **Deps** — F-301 · **Reference** — PT4

**F-402 · Board texture filter** — `dbt` `core` · **L** · planned
> Categorize flop/turn/river: paired, monotone/two-tone/rainbow, connectedness, high-card class,
> straight/flush-possible. Also feeds `spot_key` (F-210).
> **Deps** — F-301 · **Reference** — Flopzilla (texture taxonomy), PT4 (filter UI)

**F-403 · Action-sequence filter** — `dbt` `api` · **L** · planned
> "Preflop: raise, call · Flop: bet, raise, call" — per-street sequences. The filter serious
> players actually use, and the hardest one to model.
> **Deps** — F-301 · **Reference** — PT4 + Hand2Note (both strong)

**F-404 · Stack depth / SPR filter** — `dbt` · **M** · planned
> Effective stack in bb, stack-to-pot ratio at each street.
> **Deps** — F-301 · **Reference** — Hand2Note

**F-405 · Holding filter** — `dbt` `core` · **M** · planned
> Specific hands and range notation (`AKs`, `TT+`, `A2s-A5s`). Needs the range parser (F-901's
> lighter half).
> **Deps** — F-301 · **Reference** — PT4, Flopzilla

**F-406 · Players / players-to-flop filter** — `dbt` · **S** · planned
> Dealt-in count, players seeing the flop (heads-up vs. multiway changes everything).
> **Deps** — F-301 · **Reference** — PT4

**F-407 · Tournament stage filter** — `dbt` · **M** · **Expansion** · planned
> Blind level, players remaining, bubble proximity, ITM.
> **Deps** — F-118 · **Reference** — HM3

**F-408 · Saved & quick filters** — `pg` `api` `web` · **M** · planned
> Named filter sets, one-click presets ("BTN vs BB 3-bet pots"). Cheap, and it's what makes the
> filter engine usable daily.
> **Deps** — F-409 · **Reference** — PT4 (saved filters), HM3

**F-409 · Filter → ClickHouse query compiler** — `api` `ch` · **L** · planned
> Typed filter AST → parameterized SQL. **Tenant injected server-side, never from the payload**;
> no string interpolation anywhere. The security-critical component of the whole product.
> **Deps** — F-401 · **Reference** — n/a

**F-410 · Opponent-cohort filter** — `dbt` `api` · **L** · **Differentiator** · planned
> Filter hands by *villain* stat criteria ("vs. opponents with VPIP > 30 over ≥ 500 hands").
> The gateway to population analysis.
> **Deps** — F-601 · **Reference** — Hand2Note Range Research (category leader)

---

## F-5xx · Visualization & reporting

**F-501 · Winnings graph** — `web` `api` · **M** · planned
> Cumulative net won over hands/time, filterable.
> **Deps** — F-308 · **Reference** — PT4/HM3

**F-502 · All-in / EV-adjusted line** — `web` `api` · **M** · planned
> The second line on the winnings graph. **The single most emotionally important chart in poker
> software** — it's how a player distinguishes running bad from playing bad.
> **Deps** — F-309, F-501 · **Reference** — PT4/HM3

**F-503 · Showdown vs. non-showdown split** — `web` `api` · **M** · planned
> Red line / blue line. Diagnoses whether winnings come from aggression or from showdowns.
> **Deps** — F-501 · **Reference** — PT4

**F-504 · Moving-average win rate** — `web` `api` · **S** · planned
> Windowed bb/100 to show trend rather than cumulative noise.
> **Deps** — F-308 · **Reference** — HM3

**F-505 · Core stats table** — `web` `api` · **M** · planned
> The main grid: stats × dimensions, with sample sizes, driven by the filter engine.
> **Deps** — F-302…F-310, F-409 · **Reference** — PT4

**F-506 · Hand replayer** — `web` `api` · **L** · **Differentiator** *(stub in MVP)* · planned
> Step through a hand with pot, stacks, bet sizes and board per decision. MVP ships a
> read-only stub; the full version is a differentiator.
> **Deps** — F-201 · **Reference** — HM3 (best replayer)

**F-507 · Equity display in replayer** — `web` `core` · **M** · **Differentiator** · planned
> Hand/range equity at each decision point.
> **Deps** — F-506, F-902 · **Reference** — HM3, Flopzilla

**F-508 · Hand tagging & marking** — `pg` `api` `web` · **S** · planned
> Tag hands for review, colour labels, free-text notes. Postgres, not ClickHouse — a human
> edits it.
> **Deps** — F-203 · **Reference** — PT4/HM3

**F-509 · Session review** — `web` `api` · **M** · planned
> Per-session summary: hands, duration, result, biggest pots, stat deltas vs. baseline.
> **Deps** — F-505 · **Reference** — HM3

**F-510 · Standard reports** — `dbt` `api` `web` · **M** · planned
> By position / stakes / session / date / opponent. Pre-built, no configuration.
> **Deps** — F-505 · **Reference** — PT4

**F-511 · Custom report builder** — `api` `web` · **L** · **Differentiator** · planned
> Pick rows, columns, filters, stats; save and share. PT4's "My Reports" is the target.
> **Deps** — F-510, F-313 · **Reference** — PT4 My Reports (best in class), HM3 Situational Views

**F-512 · Export** — `api` · **S** · **Expansion** · planned
> CSV of any report; original hand text for a filtered set.
> **Deps** — F-510 · **Reference** — PT4

---

## F-6xx · Analysis & intelligence — **the defensible core**

**F-601 · Population aggregation engine** — `dbt` `ch` · **XL** · **Differentiator** · planned
> Aggregate across *all* users' hands into pool tendencies by spot, stake and site. **This is the
> ClickHouse-ideal workload** and the thing a local desktop tracker structurally cannot do — it
> only ever sees one player's database. Anonymized-site hands feed this fine, since identity is
> irrelevant to an aggregate.
> **Deps** — F-210, F-301 · **Reference** — Hand2Note Range Research (the category leader)

**F-602 · Cohort definition by stat criteria** — `dbt` `api` · **L** · **Differentiator** · planned
> Define a player cohort by stat thresholds, then ask what that cohort does in a spot.
> **Deps** — F-601, F-410 · **Reference** — Hand2Note Range Research

**F-603 · EV-per-decision (action profit)** — `dbt` `core` · **XL** · **Differentiator** · planned
> Expected value in bb of each action taken, versus the alternatives, per spot. **The hardest and
> most valuable feature in the backlog** — it converts "your 3-bet is 4% vs. 9% baseline" into
> "this costs you 1.3 bb/100."
> **Deps** — F-601, F-309 · **Reference** — Hand2Note Action Profit

**F-604 · Deviation scorer** — `dbt` · **L** · **Differentiator** · planned
> Join user stats to baselines on `spot_key`; compute signed deviation and significance given
> sample size. Pure SQL, no LLM.
> **Deps** — F-601, F-210 · **Reference** — GTO Wizard (deviation reports)

**F-605 · Leak ranking** — `dbt` `api` · **L** · **Differentiator** · planned
> Rank deviations by magnitude × frequency × estimated EV loss. **Ship this without the LLM** —
> a ranked table is already a product.
> **Deps** — F-604, F-603 · **Reference** — HM3 LeakBuster (55+ filters, 465+ weak areas → 10–25 ranked leaks)

**F-606 · Scored recommendations** — `api` `web` · **M** · **Differentiator** · planned
> Each leak with a severity score, an EV cost, the spot it occurs in, and a concrete corrective
> action — template-driven, before any LLM involvement.
> **Deps** — F-605 · **Reference** — HM3 LeakBuster

**F-607 · LLM coaching reports** — `api` `pg` · **L** · **Differentiator** · planned
> Aggregate-first: top 3–5 ranked leaks + 3–5 worst example hands each → a few KB of prompt →
> natural-language advice → cached in Postgres. **Never raw hands in bulk**
> ([ADR-012](POKER_DECISIONS.md#adr-012--the-ai-layer-is-aggregate-first-and-batch-only)).
> **Deps** — F-606 · **Reference** — no incumbent does this well — the clearest open lane

**F-608 · Automated note & badge engine** — `dbt` `pg` `api` · **L** · **Differentiator** · planned
> Rule engine: pattern detected over N hands → auto-generate a note/label/badge on a player.
> User-definable rules. Anonymized sites excluded by construction.
> **Deps** — F-602 · **Reference** — NoteCaddy (original), Hand2Note badges (current best)

**F-609 · GTO / solver-baseline comparison** — `dbt` `api` · **L** · **Future** · planned
> Same deviation machinery as F-604, pointed at solver baselines instead of population.
> **Deps** — F-604, F-905 · **Reference** — GTO Wizard

**F-610 · Leak progress tracking** — `dbt` `web` · **M** · **Expansion** · planned
> Did the leak close? Same stat, same spot, over time, since the coaching report.
> **Deps** — F-605 · **Reference** — none — a genuine retention hook

---

## F-7xx · Accounts, billing & tenancy

**F-701 · Accounts & auth** — `api` `pg` · **M** · planned
> Registration, login, short-lived JWT access + HttpOnly refresh cookie, password reset.
> **Deps** — F-203 · **Reference** — n/a

**F-702 · Multi-tenancy enforcement** — `api` `ch` `pg` · **M** · planned
> Tenant from the token only; `user_id` a non-optional constructor argument on every query
> builder so it *cannot* be forgotten. **An automated isolation test that tries to break it, in
> CI forever.**
> **Deps** — F-701 · **Reference** — n/a

**F-703 · Poker account registration** — `api` `pg` · **M** · planned
> Register screen names per site; that mapping is how `is_hero` gets resolved. Verification later.
> **Deps** — F-701 · **Reference** — PT4/HM3 ("your aliases")

**F-704 · Billing hooks** — `api` `pg` · **M** · planned
> Plans, subscriptions, invoices, webhook endpoints. Hooks in MVP, a real provider later.
> **Deps** — F-701 · **Reference** — n/a

**F-705 · Freemium gating** — `api` `pg` · **M** · **Expansion** · planned
> Free tier capped by hand count and/or stakes; paid unlocks population analysis, EV/leak AI and
> (later) HUD. Enforced at query time, not just at signup.
> **Deps** — F-704, F-208 · **Reference** — Hand2Note Learner (200k hands free), HM3 (~500-hand report cap)

**F-706 · Usage quotas & rate limiting** — `api` `redis` · **M** · planned
> Per-tenant request and ingest limits, backed by Redis.
> **Deps** — F-701, F-204 · **Reference** — n/a

**F-707 · Data export & account deletion** — `api` · **M** · **Expansion** · planned
> GDPR / 152-ФЗ obligations. Non-trivial: hand histories contain *other* players' data, so
> "delete my account" has a defined, documented scope.
> **Deps** — F-203 · **Reference** — n/a

---

## F-8xx · Live HUD & desktop agent — **Future**

**F-801 · Stable ingestion API contract** — `api` · **M** · planned *(MVP — contract only)*
> Versioned `/v1/uploads`, `/v1/hands:batch`, reserved `/v1/stream`. Content-addressed
> idempotency; tenancy from the token; **clients send raw text, never parsed structures**
> ([ADR-014](POKER_DECISIONS.md#adr-014--the-ingestion-contract-is-versioned-and-frozen-early)).
> Design it in Phase 1 while there's one client and changing it is free.
> **Deps** — F-110 · **Reference** — n/a

**F-802 · Desktop agent: watcher + uploader** — `agent` · **L** · **Future** · planned
> Local file-watcher on the poker client's HH folder, pushing to the same contract. Crash-safe
> re-scan must be harmless (idempotency does that).
> **Deps** — F-801 · **Reference** — Hand2Note, PT4 auto-import

**F-803 · Streaming ingestion endpoint** — `api` `kafka` · **L** · **Future** · planned
> WebSocket → `hands.live.v1`, ack under 50 ms. Design in
> [ARCHITECTURE](POKER_ARCHITECTURE.md#the-live-hud-path-future--phase-7).
> **Deps** — F-802 · **Reference** — Hand2Note (fastest live pipeline)

**F-804 · HUD overlay renderer** — `agent` · **XL** · **Future** · planned
> On-table overlay, per-seat stat panels, table detection and window tracking. Genuinely hard
> desktop work, per-OS.
> **Deps** — F-805 · **Reference** — Hand2Note (best-in-class), PT4

**F-805 · Real-time opponent stat lookup** — `api` `redis` · **L** · **Future** · planned
> Pre-warm Redis blocks for seated players on table-open; serve in <100 ms. **Read path is
> independent of the write path** — a HUD that blocks is unusable; one showing 30-second-stale
> stats is fine.
> **Deps** — F-204, F-803 · **Reference** — Hand2Note

**F-806 · Dynamic / context-aware HUD** — `agent` `api` · **XL** · **Future** · planned
> Stats that change with the spot (popups by street/action), not a fixed panel.
> **Deps** — F-804 · **Reference** — Hand2Note (invented the category)

**F-807 · Per-network HUD policy gating** — `agent` `pg` · **M** · **Future** · planned
> **GGPoker bans HUDs entirely; PokerStars restricts dynamic HUDs.** A policy flag per network,
> enforced agent-side, maintained as sites change rules.
> **Deps** — F-804, F-B07 · **Reference** — n/a (compliance, not a feature)

**F-808 · HUD layout editor & marketplace** — `web` `agent` · **L** · **Future** · planned
> Drag-and-drop layout builder; share/sell stat packs.
> **Deps** — F-804 · **Reference** — Hand2Note packs, PT4 HUD marketplace

---

## F-9xx · Ranges, equity & solver

**F-901 · Range notation parser & editor** — `core` `web` · **M** · **Expansion** · planned
> `TT+, AJs+, KQo` ↔ a 169-combo grid; visual editor. Also unlocks F-405.
> **Deps** — F-101 · **Reference** — Flopzilla, Equilab

**F-902 · Equity calculator** — `core` · **L** · **Expansion** · planned
> Range vs. range vs. board, Monte-Carlo or exhaustive. Shares the evaluator with F-309.
> **Deps** — F-901 · **Reference** — Equilab, Flopzilla Pro

**F-903 · Range-vs-board analysis** — `core` `web` · **L** · **Expansion** · planned
> How a range hits a board: made hands, draws, equity distribution.
> **Deps** — F-902, F-402 · **Reference** — **Flopzilla** (the definitive tool)

**F-904 · Solver integration** — `infra` · **XL** · **Future** · planned
> TexasSolver (or equivalent) as a queued compute service. **Never in the request path.**
> **Deps** — F-905 · **Reference** — PioSOLVER, GTO Wizard

**F-905 · Baseline set ingestion** — `ch` `pg` · **M** · **Future** · planned
> Load solver output (own or purchased) into the `spot_key` seam.
> **Deps** — F-209, F-210 · **Reference** — GTO Wizard

**F-906 · Range research on real data** — `dbt` `web` · **L** · **Differentiator** · planned
> The *observed* range a cohort actually shows up with in a spot — reconstructed from showdowns.
> Population data answers what solvers can't: what people really do.
> **Deps** — F-601, F-901 · **Reference** — Hand2Note Range Research

---

## F-Axx · Expansion & integrations

| ID | Feature | Tier | Effort | Note |
|---|---|---|---|---|
| **F-A01** | Short Deck (6+) support | Expansion | L | Different hand rankings and equities — a real gap PT4/HM3/Flopzilla leave open |
| **F-A02** | 5/6-card PLO | Expansion | M | Extends F-109; growing format |
| **F-A03** | Mixed games (HORSE etc.) | Expansion | XL | Stud/draw need a different action model; largest coverage gap in the market |
| **F-A04** | SharkScope-style integration | Expansion | M | External player results lookup |
| **F-A05** | Table finder | Future | L | Needs live site data; per-network legality varies |
| **F-A06** | HUD / stat-pack marketplace | Future | L | Depends on F-808 |
| **F-A07** | ICM analysis | Expansion | L | Tournament equity; needs F-118 |
| **F-A08** | Bubble / final-table analysis | Expansion | M | Needs F-407 |
| **F-A09** | ROI reporting & chip-stack tracking | Expansion | M | Needs F-118 |
| **F-A10** | Mobile / responsive web | Expansion | M | Review on phone; a cloud-native advantage over desktop incumbents |

---

## F-Bxx · Observability & operations

| ID | Feature | Tier | Effort | Note |
|---|---|---|---|---|
| **F-B01** | Structured logging + correlation ids | MVP | S | `request_id`/`user_id`/`upload_id` threaded end-to-end. **Start immediately** — painful to retrofit |
| **F-B02** | Ingest lag metric | MVP | S | Upload accepted → hand queryable. The single most important operational number |
| **F-B03** | Prometheus + Grafana | Expansion | M | Platform tier; see [OBSERVABILITY](POKER_OBSERVABILITY.md) |
| **F-B04** | dbt tests as runtime alerts | Expansion | S | A failing stat test means users see wrong numbers with **no infrastructure symptom** |
| **F-B05** | Airflow orchestration | Expansion | L | Only once >3 interdependent scheduled jobs exist ([ADR-005](POKER_DECISIONS.md#adr-005--airflow-deferred-to-phase-4)) |
| **F-B06** | Spark bulk re-parse | Expansion | L | Scales F-115 past Python-worker range |
| **F-B07** | Site-policy registry | MVP | S | Per-network rules on HUDs, tracking, third-party tools — needed before F-807, and it changes |
| **F-B08** | Backup & DR | Expansion | M | Asymmetric: losing ClickHouse costs time, losing object storage costs the product |

---

## What is deliberately **not** in this backlog

- **Real-time assistance (RTA).** Prohibited everywhere, ends the business. Not a roadmap item at
  any tier.
- **Bot / automation features.** Same.
- **Scraping other players' hands.** The platform analyzes hands its users legitimately possess.
- **A solver of our own.** [ADR-011](POKER_DECISIONS.md#adr-011--the-solver-is-a-baseline-producer-behind-a-spot_key-seam)
  — integrate, don't build.
- **Greengage anywhere in production.** [ADR-008](POKER_DECISIONS.md#adr-008--greengage-is-a-sandbox-not-a-product-component).

---

## Where the competitive lane actually is

Worth stating plainly, because it should drive prioritization once MVP parity is reached:

**PT4 and HM3 are excellent at parity features** — stats, filters, reports, graphs, replayer.
Matching them is necessary and is not a reason for anyone to switch. **Hand2Note leads on
population analysis and EV-per-decision** and is the real competitor for the differentiator tier.

The three things a *cloud* platform can do that a desktop tracker structurally cannot:

1. **Population analysis across all users** (F-601/602/906) — a local database only ever sees one
   player's hands. This is the biggest structural advantage and it compounds with every user.
2. **Server-side raw-text retention and re-parse** (F-115/205) — parser bugs become a background
   job rather than permanent corruption.
3. **AI coaching on aggregates** (F-604…607) — nobody does this well yet, and the aggregate-first
   approach makes it affordable.

Everything in Tier 1 exists to earn the right to build those.
