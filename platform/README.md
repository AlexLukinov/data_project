# Poker platform — Phase 0 + Phase 1 (MVP)

Cloud, post-session poker hand-analysis platform. This directory is **the product**. The
minikube data-engineering lab lives one level up and is a separate, deliberately independent
environment ([ADR-015](../docs/POKER_DECISIONS.md#adr-015--docker-compose-for-the-product-minikube-stays-the-learning-lab)).

Planning docs: [POKER_STATUS.md](../docs/POKER_STATUS.md) (live progress) ·
[POKER_FEATURES.md](../docs/POKER_FEATURES.md) · [POKER_ARCHITECTURE.md](../docs/POKER_ARCHITECTURE.md) ·
[POKER_DATA_MODEL.md](../docs/POKER_DATA_MODEL.md) · [POKER_DECISIONS.md](../docs/POKER_DECISIONS.md)

---

## Quickstart

```bash
cd platform
cp .env.example .env          # defaults already match docker-compose
make install                  # uv sync
make dbt-install              # dbt in its OWN venv — its pins clash with the app's
make up                       # ClickHouse + Postgres + Kafka + Redis + MinIO, waits for health
make seed                     # migrations + sample hands through the REAL pipeline + dbt build
make api                      # http://localhost:8000  (dashboard at /, OpenAPI at /docs)
```

Demo login: `demo@example.com` / `demo-password-123`

In a second terminal, to process uploads continuously:

```bash
make worker
```

| Command | Does |
|---|---|
| `make up` / `down` / `nuke` | stack lifecycle (`nuke` needs typed confirmation) |
| `make migrate` | Alembic (Postgres) + versioned SQL (ClickHouse) |
| `make seed` | migrate → load corpus via object storage/Kafka/worker → dbt build |
| `make test` | unit tests, no stack needed |
| `make test-all` | everything, including integration |
| `make check` | lint + typecheck + unit tests (what CI runs) |
| `make dbt-build` / `dbt-test` / `dbt-docs` | the stat layer |

**Ports** are shifted off the defaults so this stack and the minikube lab can run side by
side: ClickHouse `8124`, Postgres `5434`, Kafka `9094`, Redis `6380`, MinIO `9010`/`9011`.

---

## How a hand becomes a statistic

```
POST /v1/uploads ─► object storage (zstd, immutable, forever)
                 ─► Postgres `uploads` row
                 ─► Kafka `hands.uploads.v1`  (a POINTER, ~200 bytes — not the file)
                 └─► 202 Accepted, under 200 ms. No parsing happened yet.

worker ─► fetch object ─► split into hands ─► parse() ─► VALIDATE (pot math)
       ─► batched insert into core.hands / hand_players / actions
       └─► commit Kafka offset ONLY after the insert succeeded

dbt ─► staging (FINAL) ─► intermediate (preflop/postflop context)
    ─► ★ player_hand_flags  (one row per hand+player, opportunity/action counter pairs)
    └─► stats_daily (AggregatingMergeTree rollup)

GET /v1/stats ─► Redis (hit ≈5 ms) ─► ClickHouse (miss: one aggregate query)
```

The single idea worth internalizing: **every poker stat is `sum(action) / sum(opportunity)`**.
Compute both counters once per hand into a wide flag row, and every stat — sliced by position,
stake, site, date, table size — becomes a `GROUP BY` rather than a new query.

---

## Layout

```
core/        canonical hand model, enums, positions, ids, validation   (no I/O, pure)
parser/      parse(raw_text, site) -> CanonicalHand + site registry    ← the Rust seam
ingestion/   object storage, Kafka, ClickHouse loader, worker
api/         FastAPI: auth, uploads, stats, hands + the demo dashboard
ch/          ClickHouse migrations (numbered SQL) + runner
migrations/  Alembic (Postgres)
dbt/         the stat layer: staging → intermediate → marts
seeds/hands/ synthetic regression corpus (real exports are gitignored)
tests/       unit (no stack) + integration (needs the stack)
```

### Where to make a change

| Task | Touch |
|---|---|
| Add a poker network | one file in `parser/sites/` + one `register()` call |
| Add a game variant | a `GameType` member + a name in the parser's lookup |
| Add a statistic | one counter pair in `int_hand_player_flags.sql` + `api/queries.py` |
| Add a filter | `FILTERABLE` in `api/queries.py` + a column on the flag table |
| Change a schema | a new numbered file in `ch/migrations/` — append-only, never edit |

---

## Format coverage

Everything below is modelled from day one, because retrofitting any of it means re-parsing
every hand ever stored.

- **Table sizes** — heads-up through 10-max, including the heads-up special case where the
  button *is* the small blind and acts first preflop but last postflop.
- **Tournaments** — freezeout, rebuy, knockout, progressive/mystery KO, satellite, shootout;
  any speed (slow → hyper-turbo); MTT, SNG and Spin & Go. Bounties are per-player-per-hand,
  because in a PKO one hand moves bounty value to several stacks.
- **Variants** — Hold'em, Short Deck, Omaha 4/5/6, Omaha Hi-Lo, Courchevel, Stud, Stud Hi-Lo,
  Razz, 5-Card Draw, Badugi, 2-7 Triple/Single Draw, All-in-or-Fold, Flipout, HORSE, 8-Game.
  Downstream code branches on `GameType.structure` (flop / stud / draw / mixed), never on a
  list of variant names — which is what keeps adding Badugi from being a rewrite.

**A variant we have never seen still imports.** It lands as `GameType.UNKNOWN` with the
printed name preserved, rather than failing the file. Adding real support is then an enum
member plus a re-parse from stored raw text.

---

## When a site changes its format

It will happen. Four mechanisms, in order of how much they actually save you:

1. **Raw text is kept forever.** Everything is recoverable because the source bytes are still
   in object storage. This is the one that matters.
2. **`unparsed_lines`** — lines the parser did not recognize are *stored*, never dropped. A
   format change spikes here days before any statistic goes wrong. (It caught a real gap on
   its first run: PokerStars' `doesn't show hand`.)
3. **`format_signature`** — a fingerprint of each hand's structural shape:
   ```sql
   SELECT site, format_signature, hands, first_seen, unparsed_lines_total
   FROM core.v_format_drift ORDER BY first_seen DESC
   ```
   A new signature appearing for a site is the alert.
4. **`extra` (Map)** — recognized-but-unmodelled values, round-tripped so a field can be
   promoted to a column later without re-parsing petabytes.

Plus `schema_version` on every row, so a partially re-parsed table stays interpretable and a
targeted re-parse is `WHERE schema_version < n`.

**Schema evolution rules:** columns are additive with defaults · never reuse a column name for
a new meaning · **never change a sort key** (that is a table rebuild, which is why `user_id`
leads from migration 0001) · a change to what a field *means* bumps `schema_version`.

---

## Correctness

Two things guard the failure mode that matters — plausible wrong numbers, with no error
anywhere:

**Pot-math validation.** Every hand must satisfy
`contributed − uncalled_returns == awarded + rake` to within a cent. A hand that does not
balance is dead-lettered, not stored. This caught a genuine parser bug on its first run: the
`*** HOLE CARDS ***` marker was resetting per-street bet tracking, wiping the blinds, so a
raise from a blind seat over-counted by the blind.

**Two dbt tests encoding laws.** `assert_vpip_gte_pfr` (you cannot raise preflop more often
than you voluntarily put money in) and `assert_action_le_opportunity` (no stat can exceed
100%). A `not_null` test catches a plumbing failure; these catch a *logic* failure.

**Tenant isolation** is tested adversarially — forged tenant ids, another tenant's hand id,
tampered parameters — and the suite must stay in CI forever.

---

## Not built yet (deliberate)

Scaffolded seams, marked in code: `marts.baseline_strategies` (solver/GTO baselines, empty),
`hands.live.v1` (HUD stream), population analysis, EV-per-decision, AI coaching. The
ClickHouse materialized view that makes rollups incremental is Phase 2 (F-202) — Phase 1
builds them in batch via dbt. See [POKER_ROADMAP.md](../docs/POKER_ROADMAP.md).
