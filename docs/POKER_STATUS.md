# Poker platform — build status

> **This file is the cross-session source of truth for where the build is.**
> Read it at the start of every session; update it at the end of every meaningful step.
> Planning lives in [POKER_FEATURES.md](POKER_FEATURES.md) (what & why) and
> [POKER_ROADMAP.md](POKER_ROADMAP.md) (order & learning mapping). This file is *how far*.

**Current phase: 1 — MVP thin slice → v2 plan phase F (Range Lab) interleaved with D (UI)** · **Status: spine complete · 9.1M real hands loaded · audited · POKER_PLAN.md phases A, B and C done and merged (registry, 73.7M decisions, generated rollup, report engine, API v2 + saved objects, v1 chain deleted, hero/pool analysis modules) · Range Lab: F.1–F.9 committed with D.1/D.2 (headless core, equity engine, metrics and blockers, the Nuxt app and `poker-ui`, sign-in, the range library with importers, the hand replayer, the pool's tiered answers at a node, and the 9-step analyzer); F.10 (tier 3 + empirical EQR) done, verified and uncommitted; the §5b corpus re-parse and the whole-chain rebuild ran on 2026-09-11 — **pool showdown cards 17.4% → 100%**, hero fingerprint unmoved; **CI real and green since 2026-09-15, F.1 ticked (ADR-054)****
**Last updated:** 2026-09-15 (session 20, **the round-5 merge** — D.9a `5c68433`, D.8 `00b6f8a`, F.12a `58d368a` committed, plus a heuristics clock fix `1d8be0e` and a fixture scrub `785ec83`; F.1 had committed and pushed itself. **D.9a ticked.** Gates green on the third run: `make check` 1,675 · `make web-check` 1,015 / 99 · `make seed && make test-all` **1,783 passed, 6 skipped**. **Found: fourteen real opponents' screen names in the public history** — the founder's decision, below.)

**Previously:** 2026-09-15 (session 19, **the round-4 merge** — E.1b `1b11db0`, D.7b `ac1be5e`, D.6b `3cd1c2a` and the F.12 audit `7f3e2bf` reconciled and committed. **D.7b ticked** after its six never-run integration tests passed by name; E.1 and E.1b ticked by their lane. `make check` green · `make web-check` green (846 / 79 files) · `make seed && make test-all` **1,715 passed, 6 skipped**. Found: the real Postgres is four create-only migrations behind head.)

**Previously:** 2026-09-14/15 (**round 4**, four parallel lanes: **E.1b** the hot path, owned the stack, applied 0012 and `built_by` to the real database and verified 0 / 0; **D.7b** notes and tags, owned the Alembic head; **D.6b** the cohort form, web only; the **F.12 audit**, docs only.)

**Previously:** 2026-09-14 (**D.6b** — cohort create / edit / copy / delete, D.6's write half; ADR-049. **Web workspace only** (`app/pool/**`, `components/pool/**`, `pages/pool/**`), one of three parallel lanes (A owned the stack, B `app/hands/**`). **Amended before it was built:** the backend was already complete — six routes, the `cohorts` table, the 409/400/422 sentences, all confirmed and untouched — and the client bound only the three reads, so the step shrank to the client's write half, a rule builder and the form. **Done, reviewed adversarially, verified 37/37 in a headless Chrome of its own against a scratch Postgres (dropped) and the real pool read-only, ticked, uncommitted.** Gate: **`make web-check` green over the combined tree** — typecheck clean, lint clean, Vitest 846 / 79 files, licence unchanged.)

**Previously:** 2026-09-12 (session 18, **the round-3 merge** — four parallel lanes (E.3, E.1, D.6, D.4) reconciled and committed as `9d72503`, `0247f2d`, `61dff34`, `fcff2af`. **E.3 ticked**; E.1 deliberately left `[ ]` pending E.1b. `make check` green (1,552) · `make web-check` green (806 tests / 76 files) · `make seed && make test-all` **1,655 passed, 6 skipped** — green only after two fixes to E.3, the lane whose gate had never been run.)

**Previously:** 2026-09-12 (session 16, **D.4** — **My game**: the founder's own play on one
page. Eight KPI tiles carrying E.2's confidence intervals, a four-line winnings curve on which
actual and EV separate for the first time, D.7's `LeakTable` composed in, and the sessions table;
ADR-045. **Done, verified in Chrome against the real hero data read-only, ticked, uncommitted.**
One of four parallel lanes, **web workspace only**; the others: E.1 (MVs, owned the stack), E.3
(quotas) and D.6 (Pool, still in flight in `app/pool/`).)

**Previously:** 2026-09-11 (session 34, **E.3** — per-tenant ClickHouse settings profiles and
quotas so an over-budget query is refused by the **server**, not by the API, plus F-706's Redis
request budgets; ADR-043. Built, `make check` green at 1,582 unit tests, **its two integration
tests deliberately unrun and the step left `[]`**.)

**Previously:** 2026-09-11 (session 13, **D.5** — the reports workbench: `StatGrid` where every
cell carries its own `n` and a thin one is dimmed and left uncompared, `StatPicker`,
`DefinitionPanel` generated from the registry's own AST, presets, and a saved report that reopens
from its URL; ADR-042. **Done, verified in Chrome on the real pool read-only, ticked, uncommitted.**
One of four sessions running in parallel — the others: the E.5 data backfill, E.2's confidence
intervals (session 11, ADR-040, left unticked), and F.12)

---

## Next action

> **Read this first. "Continue" means: do this.** Keep it concrete enough to start from cold —
> which file, which command, what "done" looks like. Rewrite it at the end of every session.

### ✅ D.8 — upload & accounts: done 2026-09-15 (round 5, lane A, ADR-051) — committed `00b6f8a`

**A file dropped on `/upload` is counted in My game with no command typed after the click** — verified in
a browser of its own against the test environment, with the API and `make worker` both under `TEST_ENV`:
drop → `completed` in 2.8 s → My game's report 2 hands, `cached: false`, `stats_daily` empty for that
tenant (no dbt run). 29/29 browser checks, `test_upload_to_report.py` (4) and `test_upload_contract.py`
(8) green by name, `make check` · `make web-check` · `make seed && make test-all` (**1,783 passed, 6
skipped**) green. File list: `scratchpad/lane-d8.files`. What the merge needs to know:

- **Operator step on the real stack: `make pg-migrate`** (after `pg_dump -t uploads`). Revision
  `a8b9c0d1e2f3` adds `uploads.dataset` (nullable) and `uploads.hands_without_hero` — metadata-only on
  Postgres 16. Any API started on the real database after this code needs it; the long-running `:8000`
  predates D.7b and was not touched. The real Postgres holds no `failed` upload, so no old exception
  text is exposed by the new page.
- **"Without manual steps" assumes a running worker**: `make worker` is still a foreground process, not
  a compose service. Under `TEST_ENV` it needs the same env as the API, or uploads wait in `queued`
  (the page says so after 20 s).
- **Merge follow-ups** (ADR-051): widen `FetchOptions.body` to carry a `FormData` and narrow two lines in
  `app/ranges/api.test.ts`, then drop the one cast in `app/upload/api.ts`; `pool/rules.ts` can import
  `auth/api.ts`'s `validationMessages`.
- **Not done, recorded:** moving or deleting an upload (a pool export under My hands is flagged, not
  movable); `.zip` upload (F-116); a per-tenant upload budget (F-706); cohort membership still reads
  dbt's rollup only; `hand_query.hero_hands` has no dataset predicate.
- `migrations/env.py` now calls `fileConfig(..., disable_existing_loggers=False)`: in-process
  migrations (`api.provision`, every integration session) had been silencing every logger imported
  before them, the worker's included.
- The UX audit's "two delete handlers with no catch" are in `pages/analyze/index.vue` and
  `ReportWorkbench.vue` (§2.13), not `account.vue` — F.12a's, not D.8's.

### ✅ F.12a — the audit's mechanical half: done 2026-09-15 (round 5, lane C, ADR-053) — committed `58d368a`

**Every §7-item-1 fix and the three known issues are in, and seen in a browser of its own**: a headless
Chrome launched `--lang=ru-RU`, driven over CDP with request interception, against the app on `:3053` and
an API on `:8853` over a scratch Postgres (`poker_f12a_verify`, **dropped**) and the real ClickHouse
read-only — **113/113 checks** at 1280 and 700 px, light and dark, typing `2,5` and `2.5` key by key.
`make web-check` green (**1,015 tests / 99 files**, licences unchanged) · `make check` green (1,676; `make gen`
changed no file). File list: `scratchpad/lane-f12a.files`. What the merge needs to know:

- **One number convention**: `poker-ui`'s `NumberInput` (+ `src/number.ts`), appended to `src/index.ts`. All
  28 former `type="number"` inputs use it; a native one on this machine *displays* `2,5` (measured, while it
  accepts both separators when typed). A reader types either; the app writes a dot.
- **Shared files with lane A**: `app.vue` — lane C changed only the `<nav>` classes (it wraps); the Upload
  entry in `links` is lane A's. `pages/hands/index.vue` — lane C: `lazy: true`, the loading sentence, the
  count hidden until the list answers; the `/upload` sentence is lane A's.
- **Found in the browser, not in the audit:** an awaited `useAsyncData` held the whole app blank while it
  loaded, so no "Loading…" could ever show; four pages and the compare lookups are now lazy
  (`/analyze/[id]` behind its own `opened` gate — the store still holds the previous analysis).
- **Follow-ups** (ADR-053): persist step 4's nut definition in `StepWork` (an API change) and drop the lock's
  caveat; `describeApiError` should read `error.cause` for `useAsyncData` errors (lane A's `auth/api.ts`) —
  `/hands`, `/hands/[id]` and `/analyze` print "status 500" for a stopped API; `ReportWorkbench`'s refused
  delete has no component test (browser-verified). Left for F.12: the replayer's first step prints core's
  "pot must be positive, got 0".
- **F.12 stays `[ ]`** and solo: the glossary rule, undo and keyboard, explain-the-number, empty states /
  Examples / the tour (ADR-050), acceptance 12.

### ✅ D.9a — retire the v1 API: ticked at the merge 2026-09-15 (round 5, lane B, ADR-052) — committed `5c68433`

*This block was rebuilt at the merge from `scratchpad/lane-d9a.files`; the lane's own was lost when another lane
rewrote this file.* The winnings curve moved to **`GET /v1/hero/winnings`** (dates only, over
`stats.timeline.build_timeline`), not a `day` dimension; `heroApi.winnings()` kept its return type, and the
curve matched the v1 timeline field by field on all 18 days of the real hero data. `/v1/stats*`, the static
dashboard and its mount are gone — the merge did the `git rm`, which the lane's session could not — and
every probe of them was re-pointed, none deleted: `test_tenant_isolation.py` (5 passed, 2 demo-user tests
skipped as before) and `test_rate_limits.py` (3) green **by name inside the full run**, where the
query-string probe has teeth (alone, the prober is tenant 1 and it proves nothing).

**The real Postgres is one migration behind again.** It was brought to `f7a8b9c0d1e2` on 2026-09-15
(four create-only migrations, after a dump to `platform/backups/poker-pg-pre-f7a8b9c0d1e2-20260915.sql`);
D.8 adds **`a8b9c0d1e2f3`** — `uploads.dataset` (nullable) and `uploads.hands_without_hero`, add-column only.
Not applied by the merge. `cd platform && make pg-migrate` after a dump, before any API runs this code
against the real database.

**CI is real and green since 2026-09-15 — F.1 ticked** (ADR-054). The workflow sat at
`platform/.github/workflows/ci.yml`, which GitHub never reads. It is now `.github/workflows/ci.yml`,
runs on every push to every branch, and calls the make targets only: `make check`, `make web-check`,
`make seed` + `make test-all`. At the founder's request, lane D's code was committed alone (`7e4cfeb`)
and **`feat/range-lab` was pushed** (the repository is public). The first run was red at `make up`, on
the one-shot `minio-init` under `docker compose up --wait`. `3a4b2ea` fixed it, and
[run 34957886151](https://github.com/AlexLukinov/data_project/actions/runs/34957886151) is **green in all
three jobs** (integration 6 min, quality 1.5 min, web 1 min). The round-5 merge committed ADR-054 and these docs;
**nothing after `3a4b2ea` is pushed**, and the next push waits for the founder's decision on the public
history (below). Job logs need a signed-in admin; anonymous API calls show only job and step results.
**Local Node is now 24.21.0** (Homebrew `node@24`, per `platform/web/.nvmrc`); 23.11.0 stays in the
Cellar, and `brew unlink node@24 && brew link node` reverts.

**Two things E.1b leaves for the operator**, both in ADR-047: after a re-parse or a bulk import, once
`scripts.backfill` has caught up, run `uv run python -m scripts.mv_sync --verify` and, if it reports
drift, `--recreate`; and `stats_cache_ttl_seconds` no longer bounds freshness for uploads (the worker
invalidates the tenant's cache), but still does for dbt-only changes. ADR-047 also carries the exact
upgrade recipe for any environment whose marts predate it.

**Solo-only from here:** **F.12** and **B.5b** each need the tree to themselves. F.12
touches every page and the glossary — **its audit is done** (2026-09-14):
[POKER_UX_AUDIT.md](POKER_UX_AUDIT.md) is the checklist it starts from, §7 the order. B.5b is a full
`core.*` table rebuild. **D.9 was split on 2026-09-15:** **D.9a** (the v1 cleanup and D.4's timeline
obligation) ran as round 5's lane B (below); **D.9b** (the Playwright E2E and its CI job) waits for
D.8's upload page, and its CI half is now reachable since F.1. **F.1** is ticked: CI runs on every
push (ADR-054).

### ⚠ The public history holds real opponents' screen names — the founder's decision

`feat/range-lab` was pushed to the **public** `origin` at `3a4b2ea` on 2026-09-15 for F.1's CI run. The
round-5 merge scanned every blob reachable from that ref against the real pool's 94,278 player keys and
found **fourteen real handles**: one pool player's key with their WTSD and
WWSF in PLAN and STATUS (written in the round-3 merge), a real regular's key in
`web/apps/web/app/pool/stats.test.ts` (D.6), two real hands with nine handles (two of them short enough
to be found only by matching fixture lines exactly) in
`tests/test_parser_ggpoker.py`, and three handles in an old version of `parser/sites/ggpoker.py`. **None are
on `origin/main`**; they have been public for hours, not months. The tree is scrubbed (`785ec83`), with
invented names checked against the same key list. **The history is not**, and changing it is yours to
decide. The options, in the order I'd take them:

1. **Make the repository private now** — GitHub → Settings → General → Danger Zone → Change visibility.
   Immediate, reversible, and CI keeps working (private repos get Actions minutes).
2. **Rewrite the branch's history** so the names are gone from every commit (`git filter-repo
   --replace-text` with the fourteen name pairs), then **force-push** `feat/range-lab`. Destructive: every
   commit hash on the branch changes, the CI run links in the docs go stale, and GitHub can keep
   unreferenced commits reachable by hash for a while. Worth it only if the repository will be public.

**No push until this is decided** — D.9b's CI half included. D.9c (round 6) turns "only aggregates get
committed" from a rule three lanes and two merges broke into a check that runs before every push.

### Round 5 is merged (2026-09-15)

| commit | step |
|---|---|
| `7e4cfeb`, `3a4b2ea` | **F.1** CI at the repository root, calling the make targets (ADR-054) — committed and pushed by its lane at the founder's request; green in run 34957886151 |
| `5c68433` | **D.9a** retire the v1 API; the winnings curve on `/v1/hero/winnings` (ADR-052) — **ticked on merge** |
| `00b6f8a` | **D.8** upload & accounts: `/upload` → My game with no command (ADR-051) — ticked by its lane |
| `58d368a` | **F.12a** one number input for `2,5` and `2.5`; the audit's mechanical fixes (ADR-053) — ticked by its lane |
| `1d8be0e` | fix: the heuristic log stamps a review with the database's clock (ADR-038's correction) |
| `785ec83` | test: real screen names in two fixtures replaced with invented ones |

**The gates took three runs, and one of the reds was invisible.** Run 1 (full, verbose): 1 of 1,789
failed — `test_heuristics.py` saw a confirmed review come due 0.22 s *earlier* than before, because
`confirmed_at` came from the API's clock and `created_at` from the database's. Run 2 failed on the unit
test the fix broke, **while both background-task notifications reported exit 0**: the wrapper's `echo`
succeeded; the log's own `EXIT 2` did not lie. Every gate after that was read from its log. Run 3:
`make check` **1,675** · `make web-check` **1,015 / 99 files** · `make seed && make test-all` **1,783
passed, 6 skipped** · `uv lock --check` clean. By name in the verbose run: `test_tenant_isolation.py`
(5 + 2 skipped), `test_rate_limits.py` (3), `test_upload_to_report.py` (4), `test_upload_contract.py` (8).

**Two process findings.** (1) **A docs race:** D.9a's plan note, §6 row, STATUS block and session-log
row were overwritten by another lane's later rewrite of the same files — rebuilt from its manifest. From
round 6, **lanes do not edit `POKER_PLAN.md`, `POKER_STATUS.md`, `POKER_DECISIONS.md` or
`POKER_UX_AUDIT.md`**; each writes its text to `scratchpad/lane-<name>.docs.md` and the merge places it.
(2) **A lane session cannot delete files** (`rm` is denied); a lane lists deletions in its manifest and the
merge runs `git rm`. Three files carried two lanes' hunks (`api/schemas.py`, `app.vue`,
`pages/hands/index.vue`) and were committed hunk by hunk.

**Still needs a human:** the history decision above · `make pg-migrate` for `a8b9c0d1e2f3` (above) ·
the 30 leftover `@example.com` accounts on the real Postgres · `platform/.github/workflows/` is two empty
directories (git ignores them; `rmdir` by hand) · local Node is 24.21.0 since lane D
(`brew unlink node@24 && brew link node` reverts) · `docker compose rm poker-minio-init` if the old exited
container bothers you · keep `platform/.equity-cache.pkl` · `platform/backups/` holds two dumps.

### Round 6 — five lanes, who owns what (2026-09-15)

| lane | step | owns | ADR |
|---|---|---|---|
| **A** | **D.9b** Playwright E2E + its CI job | **the stack** (`make up/seed/test-all`, API, worker, Nuxt for the E2E) · `.github/` · `platform/web/package.json` + lock (Playwright) · new `platform/web/e2e/**` · Makefile targets appended at the end | 055 |
| **B** | **D.9c** privacy guard | new `scripts/privacy_check.py`, `tests/test_privacy_check.py`; one Makefile target appended at the end; the **real** ClickHouse, read-only | 058 |
| **C** | **F.12b** words and keys, Range Lab side | `packages/poker-ui/**` (append-only `src/index.ts`) · `app/analyze/**`, `components/analyze/**` · `app/train/**`, `components/train/**` · `pages/lab.vue`, `pages/progress.vue`, `pages/train/**`, `pages/analyze/**`, `pages/ranges/[id].vue` | 056 |
| **D** | **F.12c** words, empty states, errors, data side | `app/{auth,reports,pool,hands,hero,upload,filter,stats}/**`, `app/ranges/**` · `components/{reports,pool,hands,filter,hero,charts,upload,ranges}/**` · `pages/index.vue`, `pages/leaks.vue`, `pages/account.vue` · `pages/{reports,pool,hands,upload}/**` · `pages/ranges/{index,compare,import}.vue` | 057 |
| **E** | **F.12d** Examples, first-run tour, `?` overlay | `app.vue` · new `app/help/**`, `components/help/**`, and the Examples' home it chooses | 050 |

**Rules for every lane:** no `git add`/`git commit`/push; no edits to the four shared docs (text goes in
`scratchpad/lane-<name>.docs.md`); deletions listed for the merge; `scratchpad/lane-<name>.files` as before;
**never rename or remove a `data-testid`** (lane A's E2E selects by them); only A runs `make seed`/`make test-all`.

### Round 4 is merged (2026-09-15)

Four parallel lanes, committed on `feat/range-lab` in this order:

| commit | step |
|---|---|
| `1b11db0` | **E.1b** the hot path — an upload is in stats with no dbt run (ADR-047) — **ticked, and E.1 with it** |
| `ac1be5e` | **D.7b** notes and tags on a hand, `?tag=` on every hand list (ADR-048) — **ticked on merge** |
| `3cd1c2a` | **D.6b** cohort create / edit / copy / delete (ADR-049) — ticked by its lane |
| `7f3e2bf` | the **F.12 audit** — [POKER_UX_AUDIT.md](POKER_UX_AUDIT.md); F.12 itself unstarted |

**D.7b was the lane that handed over integration tests it could not run** — the exact shape that
produced round 3's E.3 bug — so the merge budgeted for a red first run. It was green:
`make seed && make test-all` **1,715 passed, 6 skipped**, and then `test_hand_notes.py` (6),
`test_hot_path.py` (5) and `test_mv_reconciliation.py` (3) run again **by name, verbose: 14 of 14**.
The re-run was not ceremony: 1,715 is also the number E.1b's lane reported, and an unchanged total
over a shared tree says nothing about which files it counted.

**Gates over the combined tree:** `make check` green (7 contracts kept, size check clean) ·
`make web-check` green (**846 tests / 79 files**, licence audit unchanged) · `make test-all` as above.
The three lanes' file lists covered the dirty tree exactly — 75 paths, none claimed twice, none unclaimed.

**Fixed in the merge:** ADR-047's `ALTER TABLE … ADD COLUMN built_by` on the real fact tables was
recorded only as prose — the ADR now carries the exact recipe and why it needs no backup (0012 drops
only a derived table; the `ADD COLUMN`s change no stored row). `test_quotas.py` still said
**NOT YET RUN** a round after it ran. The ADR bodies had landed 049, 048, 047 and are re-ordered;
index 49/49 with every anchor valid.

**Still needs a human:** the real Postgres holds **31 accounts, all `@example.com`, all created
2026-09-08**, with 2,556 uploads between 27 of them — residue of integration runs from before B.4 gave
the tests their own databases. Only tenant 1 owns hands in ClickHouse (19,802 hero, the pool). There
is no delete-account endpoint; clean them by hand when convenient, after checking which is yours.
(`d7-verify@example.com`, long listed here, is **not** on the real Postgres — that item was wrong.) `make test-all` dropped `poker_test`, so re-run
`make seed` before any test-environment work. Keep `platform/.equity-cache.pkl` (3.9 MB, gitignored,
69,364 solved match-ups): deleting it costs ~2 h. `platform/backups/` holds the dead-letter export
(gitignored; restore command in plan §5b). Follow-up recorded in ADR-049: the 422-list reader in
`app/pool/rules.ts` belongs in `auth/api.ts`.

The build is **plan-driven**: [POKER_PLAN.md](POKER_PLAN.md) holds the v2 architecture
(ADR-020…035) and phases A–F as checkbox steps, each with a "Done means". Its `## Status` block
names the next step. This block only points there.

**Where E.1b stands (2026-09-15): done, verified on the real database, ticked with E.1 — uncommitted** (ADR-047).
One of four parallel lanes; it owned the Docker stack, both ClickHouse database sets, Postgres, dbt and the
backfill scripts, and touched no web workspace file and no other lane's code. The two questions the step
named were settled in writing before code and are the ADR's two sections: the lost-update race is guarded by
**provenance** (`built_by` on every fact row, the rollup aggregating dbt's rows only, and a gate clause that
calls a partition with a hot row dirty), and the union lives in the **query builder** below the router, each
(tenant, dataset, day) from exactly one rollup. The hot path is the dbt models rendered a second time; it
derives a batch in ~0.25 s + ~0.3 s once the decisions statement is planned by the legacy analyzer (3.2 s
otherwise, same rows). On the real database: migration 0012, `built_by` on both fact tables, the views
created and `marts.stats_daily_mv` backfilled over 160 partitions in 100 s (4,955,456 rows), `mv_sync --verify` **0 / 0 over 160 day-partitions**, the hero fingerprint 19,802 hands, VPIP 22.96, PFR 18.85, WTSD 29.92 (n 2,239), −1.374 bb/100 — identical to the read-only check taken before any write.
Gates: `make check` 1,621 unit tests · `make seed && make test-all` **1,715 passed, 6 skipped**, with
`test_hot_path.py` (5) and `test_mv_reconciliation.py` (3) confirmed by `--collect-only` by name. The lane's
file list is `scratchpad/lane-e1b.files`.

**Where E.1 stands (2026-09-12):** **built, verified, uncommitted — and deliberately still
`[ ]`** (ADR-044). One of four parallel sessions; it owned the Docker stack, ClickHouse, Postgres,
dbt and the backfill scripts, and touched **no web workspace file and no other lane's code**.

**Why it is not ticked, and it is not a missing test this time.** All three scoped deliverables are
done and green. E.1's "Done means" is *"an upload is visible in stats without a dbt run"*, and that
**cannot be delivered by a materialized view at all** — the reason is mechanical and was verified
live rather than reasoned about. A ClickHouse MV fires only on a plain `INSERT` into its source
table. dbt writes the marts with `ALTER TABLE ... REPLACE PARTITION`, a part-level swap: in a
scratch database the source table went from **2 rows to 5 and the view never saw the 3**, and the
installed adapter confirms why (it CTASes into `__dbt_new_data_<invocation>`, then swaps parts).
Nothing outside dbt inserts into `marts.*` — the ingest path stops at `core.*`. So the views are
correct and **inert**, and the piece that actually closes the sentence is the hot path, now filed
as **E.1b** with the one race it has to guard.

**The finding that changed the design, and it is the load-bearing one.** The obvious build — an MV
writing into `marts.stats_daily` — would have silently broken the incremental chain. That table is
the dbt anchor: `dirty_partitions()` marks a day dirty when `max(core.hands.parsed_at)` exceeds the
`max(src_parsed_at)` already built for it, a **strict** `>`. And `parsed_at` is stamped **once per
ingest batch** precisely so the four core tables agree to the millisecond, then flows unchanged
into `src_parsed_at`. A view writing there makes `built_max` equal `src_max` at the instant a batch
lands — `T > T` is false — so **the day reads clean for ever and `marts.decisions` is never built
for those hands**, while the rollup shows them. Since `stats/router.py` answers from the rollup or
from the fact tables depending on which stats are asked for, the same question asked two ways would
return two different numbers, permanently, with nothing red. Two further mechanics, both measured
on this build, close off the shared-table design entirely: **`SummingMergeTree` does not sum
`DateTime64`** — two rows for one key summed their counter 5+7=12 while `src_parsed_at` kept the
*first-inserted* value, so a shared watermark is insertion-order dependent — and **`REPLACE
PARTITION` deletes MV-written rows**, which rules out storing the boundary as a row inside the
rollup, since it would be destroyed by the very mechanism it exists to coordinate with.

**What landed.** `scripts/rollup_sql.py` is the point of the step: **one renderer**,
`select_body()`, emits the SELECT for the dbt model, for the materialized views and for the
backfill, so ADR-003's drift is not guarded against but unwritable. `make gen` now also writes
`ch/migrations/0011_mv_stats_daily.sql` (the boundary table and the MV target, both free of any
dbt dependency because `api/provision.py` migrates *before* it builds the marts) and
`ch/views/stats_daily_mv.sql` (the two views). The views live outside the numbered migrations
deliberately: the runner is append-only and skips a version it has applied, so a **regenerated**
file would never reach the database and the view would quietly keep the previous registry's logic.
`scripts/mv_sync.py --create/--refresh/--status` applies them and runs the boundary-marker backfill
— boundary `T` written into the future, view fenced at `>= T`, wait, then backfill `< T` one
day-partition at a time — which has no gap and no overlap at any interleaving.

**Verified.** `tests/integration/test_mv_reconciliation.py` is **green, 3 tests**, comparing
**113 counters across 11 group keys in both directions**. It compares group sums rather than row
counts on purpose — both tables are `SummingMergeTree` and can hold a different *number* of rows
while meaning the same thing. Traffic is driven through the view in **12 separate insert blocks**
so partial aggregation is actually exercised, and **every test asserts the rollup's total mass
moved before asserting the two agree about it**, so it cannot pass vacuously. Proved by mutation:
weakening one condition in one of the 57 cached stats turns it red (5 group-rows disagree each
way), and `make gen` restores the file byte-identically. `tests/test_rollup_sql.py` adds **8 unit
tests** that need no database, including the no-drift assertion itself — also mutation-checked.
Gates on my files: ruff, ruff-format and mypy strict clean; `make gen-check` green; `make lint-arch`
**7 contracts kept**; unit suite **1,574 passed**. The generator refactor changed **no generated
output** — `--check` was green immediately after it.

**On the real database:** migration `0011` applied (two empty tables); `marts.decisions`
**73,679,949**, `marts.player_hands` **54,562,770** and `marts.stats_daily` **2,484,751** all
unchanged, and **zero materialized views** — they are created in the test environment only, because
until E.1b exists they would do nothing there.

**Where F.12's audit stands (2026-09-14):** **written, docs only, nothing to tick.**
[POKER_UX_AUDIT.md](POKER_UX_AUDIT.md) is the file the solo F.12 session implements from. It
scores every §13 line with the current state and the file that would change — **2 met** (sensible
defaults; no modal traps), **9 partial**, **2 missing** (the `?` shortcut overlay; the first-run
tour and the Examples section) — and settles what the session would otherwise have had to
rediscover: the glossary's 28 entries cover the six terms the spec names and the metric panels,
while the app-side vocabulary (the registry's stats and dimensions, pool tiers, hand classes,
positions, the node shorthand, "the field") reaches the screen as `title=` hovers at best and in
`LeakTable` not at all; acceptance 13 is met (`npm run license-check` exit 0 over 805 packages,
no copyleft) and 12 partial (the equity-service adapter and the bundler settings exist only in
`apps/web`; no README example per component; nothing outside `apps/web` mounts the components).
The three recorded issues are confirmed and mapped, with one fact the recording lacked: the
document already carries `lang="en"` and Chrome on this `ru_RU` machine still renders the Lab's
custom-brush input as `0,6` — seen in a headless screenshot — so the `lang` route is closed and
28 numeric inputs (17 of them fractional in normal use) share the display. Also found on the way:
the compare page shows its "No chart stored" empty state *while* the lookup is running and words
a failed pool call as "insufficient data"; step 1 never names the chart it loaded; the equity
trainer omits the provenance line the other four trainers print; the replayer and the pot-odds
trainer mount pot-odds panels whose inputs render editable and change nothing; step 4's Advanced
nut definition never reaches the graded number; `HandStudy` still carries F.10's stale
"needs `invested_bb`" developer text. **The audit takes no decisions** (ADR-050 unused; the one
decision it points at — where the Examples live, given the real-hands rule — belongs to the
session). Method: five of twelve planned agent passes completed before the pool hit its session
limit; the rest was read by hand from every page and the components named; the public pages were
rendered read-only in a scratch headless Chrome; nothing seeded, nothing tested, no account
touched. The tree carried two other lanes' uncommitted D.6b and D.7b files, untouched.

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
`core.parse_failures_pre_dedupe_20260911`. **Accepted and dropped on 2026-09-11 (session 28)**
after the numbers were re-verified against the live tables (19,097 + 20 hero = 19,117 over
19,108 identities; 0 live rows missing from the backup) and the table was exported to
`platform/backups/parse_failures_pre_dedupe_20260911.tsv.zst` — **restored into a scratch table
and checksum-matched on all 128,340 rows before the DROP**, DDL saved beside it, the directory
gitignored because the rows carry real hand text. Plan §5b has the restore command.

**Where F.11 stands (2026-09-11):** **built, browser-verified, uncommitted — and deliberately
still `[ ]`** (ADR-038). One of three parallel sessions; it touched the web workspace, its own
Alembic migration and no data at all.

**Why it is not ticked:** `platform/tests/integration/test_heuristics.py` has never been run. It
needs the stack, which another session owned for the whole of this one, so the four new Python
files behind `/v1/heuristics` have not yet met a database. Everything else is verified. See the
`Next action` block above for the one command that closes it.

**What the constraint was, and what it decided.** Spec §17 says the trainers must work with no
backend at all, and that shaped the design more than §16 did. A spot is built from a **seed**, not
stored, and its answer comes from `@poker/core` — so `/train` and `/progress` are `public: true`,
hold no token, and are correct with the API stopped. The scoring store is therefore the one Dexie
database in this app that the **browser owns** rather than caches; the heuristic log is the
opposite case and is split out into its own database behind `/v1/heuristics`, with every row saying
on screen whether it has reached the server.

**What landed.** `@poker/core` gains `training/schedule.ts` — Leitner over `[0, 1, 3, 7, 16, 35]`
days with the clock injected, plus the 14-day heuristic rule — so a month of review behaviour is a
unit test instead of a month of waiting. App: `app/train/` (`types.ts`, `modes.ts`, `charts.ts`,
`sampler.ts`, `texture.ts`, `spot-{equity,combos,drawing,blockers,advantage,potodds}.ts`, `spot.ts`,
`cache.ts`, `session.ts`, `progress.ts`, `view.ts`, `numbers.ts`), `app/heuristics/{api,cache,log}.ts`
+ `stores/heuristics.ts`, `components/train/` (a shell, one component per mode, `AccuracyTrend`,
`HeuristicLog`), pages `/train`, `/train/[mode]`, `/progress`, and two nav links. Backend:
`heuristics` (Alembic `e6f7a8b9c0d1`), `api/models_heuristics.py`, `api/schemas_heuristics.py`,
`api/heuristic_store.py`, `api/routers/heuristics.py`, wired in `api/main.py` and `migrations/env.py`
— including `GET /v1/heuristics/candidates`, the bridge ADR-034 promised when it gave `analyses` a
`heuristic` column of its own: the log offers a step-9 takeaway for adoption instead of making the
founder retype it.

**Three decisions worth remembering (ADR-038).** The scoring store is browser-owned. A spot's hash
is **content-derived, not seed-derived**, so two seeds that build the same question are one thing to
relearn and changing how seeds are drawn does not orphan a month of history. And the range-drawing
mode is scored on **total absolute weight error** — the metric §16 names — while its gate compares
how *wide* the range is; a range of the right width made of the wrong hands is not a range you know,
so both numbers are on screen and labelled.

**Verified in Chrome with every `/v1/` call refused at the fetch boundary** — a headless Chrome of
its own over CDP on a separate profile, leaving the parallel sessions' browser, :3000 and :8000
untouched. All six modes answered. Six rake-free pot-odds spots were **re-derived independently
from the §8 formulas inside the harness and matched the app to a tenth of a point**. The advantage spot's second question appeared only once the first
was committed. The blocker mode named its best bluff from `bluffScore`, with the full ranking beside it.
The drawing mode reported *"298 combos of total error against 51 allowed — not yet; this one comes
back"*. A heuristic written with the API down came back tagged `turn · CO · paired`, marked *"in
this browser only"* and dated *"next asked 2026-09-25"* — fourteen days out — and survived a reload.
`/progress` charted 5 of 14 right with 9 bucket rows across hand class, texture and bet size.
**3 API calls attempted, all refused; 0 console errors.**

**One defect found in the browser and fixed with two regression tests:** the guard against
`PredictionGate` re-emitting `reveal` was keyed on the spot and never cleared between servings, so a
spot answered again after coming back for review was scored once and never again — eight answers,
four rows on `/progress`. Gates: `make web-check` lint clean, **556 tests**, 83 of them this step's, licence audit
unchanged; the heuristics slice ruff/format/mypy clean, 12 unit tests, 7 import-linter contracts
kept.


**Where E.2 stands (2026-09-11):** **built, gate-green, uncommitted — and deliberately still
`[ ]`** (ADR-040). One of four parallel sessions; it touched `platform/stats/`, `poker-ui` and
tests, and **no data, no migration, no `core/`, `scripts/`, `dbt/` or `ingestion/`**.

**Why it is not ticked, and it is two reasons.** `platform/tests/integration/test_intervals.py`
has never been run — it needs the stack, which the E.5 lane owned throughout — and the step's
"Done means" is *"KPI tiles show ± bands"*, but the tiles are **D.4**, which this step was
deliberately sequenced ahead of so the service and the component exist before their first
consumer. Everything E.2 itself builds is verified; `/dev/components` renders four `MetricValue`
states from the engine's own numbers.

**The step was amended before it was built.** E.2 says "ratio stats Wilson interval". In this
registry `ratio` is exactly one thing — the aggression factor, `(bets + raises) / calls` — and it
is **not a proportion**: the numerator and denominator count *disjoint* row sets, the value is
unbounded above and undefined at zero calls, and Wilson is not defined for it. The format that
gets Wilson is **`percent`**: all 56 of them, including the four `afq_*` built from
numerator/denominator whose row sets still nest. `ratio` and `count` get no interval, by name, in
one function. The amendment is in the step and in ADR-040.

**What landed.** `stats/interval.py` — the typed `Interval` (`low`, `high`, `n`, `level`,
`method`), Wilson for a proportion, `100 · z · sd / sqrt(n)` for a per-100 mean, and `for_cell` as
the single place the format-to-estimator mapping is written. `ResolvedStat.dispersion` names the
column whose per-row spread is a stat's standard error; `plan(..., dispersion=)` refuses the
rollup for such a stat; `stat_columns` emits `stddevSamp(x) AS <code>__sd` beside the value and
the `n`; `ReportRequest.confidence` (`90 | 95 | 99 | null`) and `Cell.interval` carry it.
`poker-ui` gains **`MetricValue`** and a `confidenceInterval` glossary entry. **`api/` did not
change at all** — `POST /v1/reports/run` declares `ReportRequest` in and `ReportResult` out, so a
field on each model is the entire wire change, which is ADR-023's layering earning its keep.

**Three decisions worth remembering (ADR-040).** *Wilson, not Wald* — Wald collapses to zero width
at p = 0, so it prints `0.00 ± 0.00, n = 3` in exactly the case that needs the warning, while
Wilson says **0–56%**. *Intervals are opt-in* — `marts.stats_daily` stores a daily sum and count
per stat and **no sum of squares**, so a per-100 band cannot come from the rollup at any price and
asking for one drops that report to `player_hands`; a proportion needs only the value and `n`, so
a KPI row of VPIP/PFR/3-bet keeps the fast path and only the winrate tile pays. And *the interval
is a floor on the uncertainty, not a ceiling*, because both estimators assume independent draws
while several decisions come from one hand and many hands from one session — the module docstring
says so rather than leaving it implied.

**One defect found by verification and fixed.** The per-100 band used the normal quantile at every
`n`. Checked against Student's *t*, that band is **6.5× too narrow at n = 2** (1.15× at n = 10,
1.04× at n = 30) — an interval six times too confident is not a conservative estimate, it is a
wrong number wearing the uniform of a careful one, which is the exact failure this step exists to
prevent. `MIN_N_MEAN` is now **30**, and below it a per-100 stat gets no interval at all, the same
answer the pool gives under `MIN_N`. A proportion needs no such floor: Wilson's small-sample
coverage is its whole virtue.

**Verified without a database.** Wilson matched an **independently written** implementation across
**444** (p, n, level) combinations to within its own rounding, and the published values for 50/100
`(40.38, 59.62)`, 0/10 `(0, 27.75)` and 0/3 `(0, 56.15)`; bounds never left [0, 100] and never
crossed. The `z` table is asserted against `math.erf` to 5e-13, so a typo fails the suite.
**Injection through a custom `per100` stat was attempted four ways and refused twice over** — the
`CODE` pattern on `Sum.sum`, then the registry dimension check — while a legitimate custom per-100
stat does get its spread and an arithmetic numerator correctly gets none. `net_won_bb` is
`Decimal(18, 4)` and **not Nullable**, so `count()` and `stddevSamp` see the same rows; had it been
nullable the reported `n` and the `n` behind the error would have disagreed silently. Gates:
`make check` green — **1,552 unit tests** (28 this step's), ruff + mypy strict clean, 7
import-linter contracts kept, size check clean; `make web-check` typecheck clean (`vue-tsc` and
`nuxt typecheck`), **113 `poker-ui` tests** (10 this step's), **licence audit unchanged — no new
dependency**, because the `z` table is three constants rather than scipy.

**One thing D.4 must add, deliberately left out.** `web/apps/web/app/stats/api.ts` needs
`interval` on its `Cell` mirror and an `Interval` interface beside it. It is not in this step
because the **D.5 lane was rewriting that same file** while this session ran, and a two-line
addition was not worth the conflict. Nothing is blocked: `MetricValue` takes primitives
(`value`, `low`, `high`, `n`, `unit`, `digits`, `level`, `signed`) and imports nothing from the app.

**Where D.6b stands (2026-09-14):** **done, reviewed, verified in a headless Chrome of its own,
ticked, uncommitted** (ADR-049). Web workspace only. **The audit came first and shrank the step:**
its wording said the client "already types all six routes" — it typed the shapes and bound only the
three reads; the server side (six routes in `api/routers/pool.py`, `cohorts` + `uq_cohorts_user_name`
from `8b2f4c6d1e3a`, the 409 `a cohort named 'X' already exists`, the 400 at create
`cohort rule on 'af_flop': only cached stats can define a cohort`, the 422 list for an eleventh rule)
was measured over HTTP before a line of UI was written and needed nothing. Delivered `stats.ts`'s
`createCohort`/`updateCohort`/`deleteCohort`, **`app/pool/rules.ts`** (the builder's own vocabulary —
`ClauseRow` deliberately not reused; `describeCohortError` reads the 422 *list* that
`describeApiError` cannot), `components/pool/CohortForm.vue` (57 cached stats offered, the 8 uncached
listed greyed, from the registry's `cached` flag) and `pages/pool/cohorts.vue` (New · Edit · **Save as
mine** · Delete, the list re-read after every write). **Verified 37/37** against a throwaway API on
`:8806` over a scratch Postgres migrated to head and the real ClickHouse read-only (tenant 1): the
duplicate shows exactly the server's 409 sentence, a rule forced onto `af_flop` exactly its 400, the
eleventh rule cannot be added, the `/pool` picker lists the saved cohort and runs the report as
`?cohort_id=<uuid>` over 12.4M hands, the copied Regs names 7,711 players, delete asks first and
declining sends nothing. **The adversarial review found two real page defects before the tick** —
an open "Who is in it" panel kept its pre-edit size after an edit (now fetched again: 1,444 → 3,563
as the threshold moved), and a write shared its `try` with the read-back so a failed reload would
have read as a refused save with the form still open — plus three tests a mutation would have passed.
Gate: `make web-check` green over the combined tree (846 / 79).

**Where D.6 stands (2026-09-12):** **done, verified in Chrome, ticked, uncommitted** (ADR-046).
One of four parallel lanes, **web workspace only** — no migration, no Python, no data written, and
`packages/poker-ui/src/{index.ts,glossary.ts}` never opened, because this step added no component to
the library.

**The step was amended before it was built, and the audit is the reason the step is small.** D.6 was
written 2026-09-09, before the Range Lab spec, before phase F was interleaved into phase D, and
before D.5 built the workbench D.6 is meant to consume. Its four clauses turned out to be in three
different states. **The ranges clause was already closed:** `HandMatrix` does not exist — the only
occurrence of the string in the repo is a comment in `RangeMatrix.vue` — and `/ranges/compare`
already draws the pool column through that one grid, so D.6's own acceptance *"the ranges page adds
no new grid code"* was **true before the step began**. Building a pool-ranges page would have
produced exactly the second grid the clause exists to prevent. **The other three were missing in the
web lane only:** `POST /v1/pool/stats`, the whole cohort CRUD and its table (C.7, `8b2f4c6d1e3a`),
the `regs`/`fish` cohort presets and `GET /v1/pool/players` had all shipped in phase C — zero
backend work, zero migration.

**What landed.** `app/pool/stats.ts` (the population/cohort/player client, separate from phase F's
node-shaped `pool/api.ts`), `app/pool/compare.ts` (`align()`), `app/pool/population.ts`
(`lockedToPopulation()`), `components/pool/{CohortPicker,CohortGrids}.vue`, and
`pages/pool/{index,cohorts,players}.vue`, plus one nav line.

**Three decisions worth remembering (ADR-046).** (1) **`StatGrid` is not forked and no D.5 file was
edited.** The page does not mount `ReportWorkbench` — D.5 called it "the shell D.4 and D.6 may
ignore", and it is hero-shaped three ways (one prop, an `openFirstPreset()` that lands on a hero
preset, a `<FilterBar />` carrying the dataset toggle) — so it composes `StatGrid`, `StatPicker`,
`GroupByPicker` and `DefinitionPanel` directly. (2) **The dataset lock is structural rather than a
setting:** instead of writing `population` into the shared Pinia filter on mount — which would leave
the hand list showing pool hands afterwards, and which the URL would silently undo, since a missing
`ds` reads as `hero` — the page wraps the store in a `FilterAccess` whose dataset *is* `population`.
`FilterBar`'s existing `datasets?: boolean` seam, which no caller had ever used, hides the toggle.
(3) **"Regs vs fish" is two runs with no difference drawn between them.** The engine takes one
cohort and refuses a pool baseline, so `align()` puts both answers over the same rows and stops;
subtracting them would have been one line and would have been a *second* comparison with its own
second answer to what "enough" means, in a file the grid does not consult.

**Verified in Chrome against the real pool, read-only** — its own headless Chrome on :9227 and its
own profile, the app on :3003, an API of its own on :8003 over the real ClickHouse with auth in a
throwaway `poker_d6_verify` Postgres; the other lanes' :3000, :8000 and Chrome on :9226 untouched
throughout. **20 of 20 checks, and 0 console errors and 0 failed requests from sign-in onward** (the one 401
before that is the bootstrap asking `/v1/auth/refresh` with no cookie yet — D.2's designed
behaviour, not this page's). **The Done means renders:**
`pool_cbet_by_sizing` run for both shipped cohorts — 17,059,070 regs hands against 1,173,484
recreational ones — five sizing buckets aligned across two grids with **every cell carrying its own
`n`**. Regs fold to a flop c-bet **38.0%** (n 572,450) at small sizing, rising monotonically to
**68.9%** (n 11,637) versus an overbet; recreational players fold **less at every size** — 31.8% and
62.6% — which is the read the page exists to produce. The comparison is a link. **§17 was checked as
a property rather than asserted:** on one pool player's report, both cells under 100 observations
(WTSD 35.3% and WWSF 41.2%, **n 68**) carry `data-thin="true"`, while all five full-sample cells do
not.

**One real defect found, and it was in the server, not the page.** `GET /v1/pool/players` is a
**prefix** match, but every `player_key` in the corpus is namespaced `ggpoker:<name>` — so it
returns nothing for any name a person types, and the page would have answered *"no such player"* to
every real opponent: an assertion of absence that is false, which is the §17 failure in its least
obvious disguise. Measured against the live API: `prefix=A`, `V`, `Vill`, `P` and `1` each returned
**0 rows**, while `player_key LIKE '%mango%'` returned five real names. The search now goes through
the ordinary report path as a `like`, which keeps the site namespace out of the client entirely, and
lower-cases what was typed — **not a guess: of all 94,276 distinct keys, none contains an upper-case
character.** "MANGO" now finds 25 real names. **A backend follow-up is owed on that route** (an
`ilike`/substring mode, or drop the namespace from the match).

**One defect found in this step's own work, and it is the one worth reading.** The dataset lock was
written as *the shared store is never written to* — and it was not true. `reports/model.ts`'s
`applyRequest` does `filter.load({ dataset: request.dataset ?? 'hero', … })`, so **opening a pool
preset stamped `population` onto the store that `/hands` and `/reports` share**: a visit to the pool
silently changed what the hand list answered, in the lane that had just claimed isolation. The lock
is now **bidirectional** — `load` keeps the dataset the store already had, `reportRequest` forces
`population` on the way out — while the clauses and the dates still pass through, because those
*should* follow you between pages. A unit test would not have caught it, because the seam looked
right in isolation; it is now pinned by both a test on `load` and a browser walk of
`/hands` → `/pool` → `/hands`, **6 of 6**: the hand list on "My hands", a pool preset opened, the
pool report still answering over **19,245,503** population hands, and `/hands` and `/reports` both
**still** on "My hands" afterwards.

**A trap avoided worth writing down: the API on :8000 predates E.2.** Its own `openapi.json` has no
`confidence` and no `Interval`, while the committed source has both — and `ReportRequest` is
`extra='forbid'`, so a grid that asked for intervals would have **422'd against the very server the
founder is running**. The grid deliberately does not ask (ADR-042 decided that, and a per-100 band
leaves the daily rollup — a different order of query on 54M hands), so §17 is met per surface:
sample size on every cell always, tier via `PoolDataBadge`, confidence via `MetricValue` on headline
figures. **Restarting :8000 is worth doing before the next browser pass on any page.**

**Gates:** `make web-check` typecheck clean, lint 0 errors, **806 tests / 76 files** (39 this
step's), licence audit unchanged — no new dependency. **No loose ends:** the throwaway auth database
was **dropped** after the browser pass, and nothing was written to the real `poker` Postgres or to
`core.*`/`marts.*`. **D.6b** (cohort create/edit/delete) is split out and unbuilt, because it writes
rows to Postgres and this lane was read-only by instruction — the same split, for the same reason,
as D.7b. File list in `scratchpad/lane-d6.files`.

**Where D.4 stands (2026-09-12):** **done, verified in Chrome, ticked, uncommitted** (ADR-045). One
of four parallel lanes, **web workspace only** — no `make` target beyond `web-check`, no migration,
no data written, and nothing read but ClickHouse.

**The audit was worth doing and it came back the other way.** D.3, D.6 and D.7 were each half-built
before their session started; **D.4 was not**. `pages/index.vue` was still D.1's 45-line health
page, nothing in the app had ever called `/v1/hero/sessions`, there was no chart component anywhere
in the workspace, and `MetricValue` — built by E.2 explicitly for this step — was wired only into
`/dev/components`. What the audit did establish was what *not* to write: `LeakTable` and
`leakDrill` (D.7), `cellView` with its thin/empty/no-delta rules (D.5), the shared filter store
(D.3), `describeApiError`, `useApi` and `useDefinitionsStore` are all reused whole.

**Four calls, not one, and that is a plan correction.** §2.7 names `GET /v1/hero/overview` and the
hero router has never had it. The KPIs are one ungrouped `POST /v1/reports/run` with
`compare_to: 'population'` and `confidence: 95`; leaks, sessions and the curve are their own routes,
loaded independently so a slow pool baseline cannot keep the sessions off the screen.

**The winnings curve is borrowed from a route D.9 was going to delete, deliberately and behind a
boundary.** `POST /v1/reports/run` **cannot** answer a time series: the registry has no `day`
dimension among its eighty, because dates are WHERE-clause scope in `stats/query.py` and never a
group-by. The only series in the API is the v1 adapter `GET /v1/stats/timeline`. So
`heroApi.winnings()` calls it and maps it into the hero module's own `WinningsPoint`; no consumer
above knows a v1 field name, **D.9 changes one function body**, and the obligation is written into
D.9's step rather than left to be found as a 404.

**`/` is no longer public.** It was the one route the global auth middleware did not guard, and a
page of the founder's own hands cannot be that route. D.1's health check survives as the strip at
the foot of the dashboard.

**The chart's palette was computed, not chosen.** Four cumulative lines need four hues that a
colour-blind reader can still separate, and three of the repo's `--pk-*` tokens fail that as a
four-way set — `--pk-good` against `--pk-villain` is a deutan ΔE of **7.0**, under the floor.
Candidates were run through a validator until one cleared every check — lightness band, chroma
floor, CVD separation on **all six pairs**, normal-vision separation and contrast — against the
light surface *and* the dark one: `#2563eb` actual, `#f43f5e` EV, `#a16207` showdown, `#059669`
non-showdown. One palette for both themes is why there is no dark override. Colour is never the
only encoding anyway: each line has its own dash pattern, its own end label, and a legend that
doubles as the on/off control.

**Verified in Chrome against the founder's real hero data, read-only.** Own headless Chrome on
:9226 with its own profile, the app on :3002, and an API of its own on :8002 over the **real**
ClickHouse with auth in a scratch Postgres `poker_d4_verify` — **where the first registered user
*is* tenant 1**. That is the recipe D.7 could not use and recorded as the reason its leak numbers
had to be stubbed; it needs nothing but `CREATE DATABASE` + `alembic upgrade head`, and the
database was **dropped afterwards**. The other lanes' :3000, :8000 and the shared MCP Chrome were
untouched throughout.

Every figure matched the API and the fingerprint in this file exactly: **19,802 hands · −1.37 ±
9.52 bb/100 · +0.28 ± 8.37 EV bb/100 · VPIP 23.0 ± 0.6 · PFR 18.9 ± 0.5 · 3-bet 8.0 ± 0.6 · WTSD
29.9 ± 1.9 · W$SD 56.6 (52.8–60.3, asymmetric, so printed as bounds)**, against a field of
54,443,958 hands. The curve ends **−272 actual, +56 EV, +1,819 showdown, −2,091 non-showdown** —
E.5's EV separation, visible for the first time, and the showdown pair explaining where it went.
**The ±9.52 band is the step's own best argument:** over 19,802 hands the 95% interval on the
winrate still spans −10.9 to +8.1, which is the difference between a losing player and a solid
winner, and the page now says so instead of printing `−1.37` and stopping.

A cold load makes **exactly one call per panel**. Narrowed to the 11-hand first day, all eight
tiles dim to `thin`, **0 deltas are drawn**, the per-100 band disappears entirely (n < 30, E.2's
`MIN_N_MEAN`) while Wilson widens VPIP to **9.7–56.6%**, and that sitting's rate is withheld as
`too few hands` with the reason on the row. A range with no hands at all gives three real empty
states and `—` in every tile. **0 console errors, 0 failed requests.**

**Five defects found and fixed, four of them in the browser.** `MetricValue` printed `19802`
unseparated where its own support line two rows below said `n = 19,802`, and `-1.37` with a hyphen
where the grid, the tables and the axis all use `−`; it also trimmed `22.96` to `23` beside a
`± 0.6` claiming more precision than the number showed. All three are one opt-in `fixed` prop with
7 new tests, every existing caller unchanged. The EV-gap sentence announced *"the cards have paid
about what they were worth"* over **eleven hands**, under eight tiles the same page had just
dimmed — because two equal thin numbers give a gap of exactly 0.00; it is withheld on a thin
sample now, and the rule lives in the tested module rather than the template, **because a sentence
is harder to discount than a number**. The `break-even` caption collided with the end labels and
moved into the prose. And two end labels five viewBox units apart were one smudge, so `spread()`
pushes labels apart without moving the lines they name.

**One thing left alone, deliberately:** the shared header in `app.vue` overflows horizontally below
about 1000px — it now carries twelve links, D.6 added the twelfth while this lane ran. It is
pre-existing chrome, none of the dashboard's own content overflows, and another session was editing
that file. **F.12 should own it.**

Gates: `make web-check` typecheck clean, ESLint clean, **751 tests green excluding `app/pool/`**
(80 of them this step's — the two failures in the whole-workspace run are the D.6 lane's own
in-progress `app/pool/stats.test.ts`, not this step's), `make size-check` clean, licence audit
unchanged — **no new dependency**, the chart is SVG. File list in `scratchpad/lane-d4.files`.

**Where D.5 stands (2026-09-11):** **done, verified, uncommitted, and ticked** (ADR-042). One of four
parallel sessions, **in the web workspace only** — no database written, no `make` target beyond
`web-check` run, and `packages/poker-ui/src/{index.ts,glossary.ts}` never opened, because this step
added nothing to the component library.

**What the step is.** The workbench where any stat is measured for any situation and sliced any way:
rows are a group-by dimension, columns are stats picked by category. It is built **on** D.3 rather
than beside it — the client still holds no vocabulary of its own — and it is built **to be
consumed**, because the plan has D.4 and D.6 using these components rather than this page.

**The rule the step exists to enforce, and why it is one file.** Spec §17 says never fabricate a pool
number, and a stat grid is where a thin sample most easily passes for a real one, because every cell
is the same eight pixels wide. The numbers that forced the design are measured, not imagined: on the
founder's own hands, VPIP in 5-bet pots from the BB is **6.67% against the field's 35.18% — a −28.5
point "leak" drawn from fifteen hands**; flop c-bet decisions split by the flop's high card give
**`raise_cbet_flop = 0.0%` on n = 3**; and `compare_to` will happily report hero's 3,245 hands
against the pool's 9,036,302 as a delta of **−9,033,057**. `ReportRequest` has no `min_n` and the
engine suppresses nothing, so the judgement is the client's — and it is made **once**, in
`app/reports/cell.ts`, tested against those exact rows. Every cell shows its own `n`; under the
threshold the value is shown but dimmed and **its delta withheld**; no observations means a dash even
where the pool has a baseline; a `count` is never compared; and **the threshold travels in the URL**,
because it decides what is greyed and a link that greys a cell for the sender but not the receiver
defeats the point. Direction is coloured only where the registry commits — most stats leave
`higher_is_better` null, and colouring those would invent a judgement the platform has not made.

**What landed.** `app/reports/` — `api.ts`, `library.ts`, `cell.ts`, `columns.ts`, `describe.ts`,
`url.ts`, `model.ts`, each with a test beside it; `composables/useReportUrl.ts` (one composable owns
all nine query keys, because two `router.replace` writers in one tick drop each other's);
`stores/reports.ts` (the library only — the workbench is created per screen, since D.3's whole point
is that two screens share a situation without sharing their columns); `components/reports/` — the
five the step names plus **`GroupByPicker`** (the grid's rows *are* a group-by, so it needs a
control) and **`ReportWorkbench`** (a shell D.4 and D.6 may ignore); `pages/reports/[[id]].vue`.
**`app/filter/node.ts` is the other half and lives in D.3's directory**: D.3 compiled clauses into a
tree and a preset arrives as one, so without the inverse the grid would show a preset's numbers above
a filter bar describing something else. D.7 already builds its drill-through on it.

**Three things worth remembering.** (1) `app/stats/api.ts` was extended **additively** to the full
server shape — it was missing `compare_to`, `cohort`, `custom` and `player_key`, so loading
`preflop_overview` and re-running it would have **silently dropped its baseline**. (2) The
**group-by is the half of D.3's grain trap D.3 could not cover**: `stats/router.py` checks the
grouping exactly as it checks the filter, so `group_by: ['facing']` with `stats: ['hands']` is the
same 400 — the picker narrows on both and names what it dropped. (3) `compare_to` and `cohort` go
**inert rather than being cleared** when the dataset moves under them, so switching to the pool and
back does not silently forget a setting.

**Verified in Chrome against the real pool, read-only** — a headless Chrome of its own on :9224, the
app on **:3002**, and an API of its own on **:8002** because the shared one's CORS allows only :3000;
the other sessions' :3000 and :8000 were left running and untouched. ClickHouse reads only, with auth
and the saved rows in `poker_test` (never a real database), and both test reports deleted afterwards.
The server's own `preflop_overview` preset loaded and ran: **19,802 hands, 6 rows, 48 of 48 cells
carrying `n`**, with `Fold to 3-bet 50.0% n 2` and `3-bet % 0.0% n 2` shown, dimmed and **not**
compared. A hand-built thin report reported *"22 of 26 cells are under 100 observations"* with
`0.0% n 3` marked and **0 thin cells carrying a delta**. **Saving it moved the address to
`/reports/<uuid>`, and a full browser reload reproduced the name, situation, grouping, stats and
baseline and re-ran to the identical `2,219 hands · 13 rows · 2 stats` — served *from cache*, which
is the proof that matters: the cache key hashes the canonical request, so the reopened document is
byte-identical to the one that was stored.** `min=1000` in a pasted link dimmed 12 of 13 cells on
arrival. Grouping by `Facing` dropped *"Hands, VPIP"* by name and disabled Run rather than earning a
400, then ran once a decision-grain stat was chosen. The pool dataset answered over **54,443,958
hands** with the baseline correctly inert. `DefinitionPanel` printed fold-to-c-bet's real definition
out of the registry's own AST — *"of the rows where Street is flop · Facing is bet · Facing a c-bet:
yes — the share where Action is fold"* — with its typical band and its recorded caveat. **0 console
errors, 0 failed requests.**

**Four defects found in the browser and fixed:** saving remounted the page and threw the grid away
(`NuxtPage` keys by path, so the optional-param route was not enough — pinned with
`definePageMeta({ key: 'reports' })`); `toLocaleString()` with no locale rendered `3 245` in Chrome
while the unit tests asserted `3,245`, so the locale is now stated as `PoolDataBadge` already states
it; the duplicate-name guard was suppressed while *Replace* was ticked, which is **exactly** the case
the server answers 409, because `nameTaken` already excludes the report being replaced; and the
preset's own `hands` column was printed twice. Gates: `nuxt typecheck` clean, ESLint **0 errors**,
**691 tests** green over 70 files, licence audit unchanged — **no new dependency**.

**One known follow-up, for the E.2 lane rather than this one:** E.2 adds `ReportRequest.confidence`
and `Cell.interval`, both additive and both uncommitted at the time of writing. D.5 deliberately does
not request intervals — E.2's own docstring says a 40-column grid being scrolled does not want them —
but the workbench carries `player_key`, `custom` and `limit` through a re-save and knows nothing of
`confidence`, so a saved report created by a KPI screen would lose that field if re-saved here.
Adding it to `Carried` in `app/reports/model.ts` is a two-line change and belongs with E.2.

**Where D.7 stands (2026-09-11):** **done, verified, uncommitted, and ticked** (ADR-041). One of four
parallel sessions, in the **web workspace only**. Like D.3 before it, the step was **audited and
amended before a line was written**, and the audit was most of the value: D.7 was written 2026-09-09,
and **two of its three clauses had already shipped**. The replayer is F.7's — the plan's own F.7 entry
is titled *"Hand replayer (absorbs plan **D.7**)"* while D.7 sat `[ ]` and appeared in neither
ordering statement, so it had been half-recorded-as-done and unscheduled for a day. The filter-bound
list is D.3's, from the previous session. What was genuinely missing was the one thing the step is
judged on: **nothing in the app had ever called `/v1/hero/leaks`** (`pages/index.vue` is still D.1's
health page), so "clicking a leak" could not be performed at all.

**The drill-through holds no poker knowledge, and that was the whole design problem.** A `Leak` is a
stat **code** with a value, a baseline and a score — it carries no situation. Writing the thirty-nine
situations out by hand ("flop, facing a bet, the bet was a c-bet") would have been exactly the drift
ADR-037 had just finished deleting from `hands/search.ts`. It is not written anywhere: a built-in
stat's registry entry **is** a filter tree (`countIf(situation AND action) / countIf(situation)`),
`GET /v1/definitions` was already serializing both halves and the client was discarding them, and the
concurrent D.5 session had just landed `nodeToClauses`, the inverse of D.3's compiler. So
`app/hero/leaks.ts` is composition — `stat.situation` → `nodeToClauses` → `toQuery` → `/hands?f=…` —
and it is the **first real caller** of both. A leak offers **two** links because it is two questions:
the situation *and* the action ("the hands where you did it"), and the spot alone, whose size the row
already knows (`Leak.n` is that denominator; the numerator is never printed as `n × value`). The four
leaks that cannot be opened are found **structurally**, by asking `tablesFor` whether `decisions`
survives the clauses — never as a hard-coded list of codes.

**Three defects fixed with it, all inside D.7's own wording.** The hand list **dropped the date
bounds** whenever no clause was set — `filter.active` counts clauses only and the `recent`/`pool`
branch forwarded neither — so the two date boxes FilterBar renders on that page did nothing. A clause
on any of the 13 hand-grain dimensions earned a **raw 400** from the compiler, because a hand search
compiles on `marts.decisions` alone while the builder offers all 80; `app/hands/searchable.ts` now
names the offending condition in its own words and **fires no request**. And `HandState.actor` —
documented as *"the seat about to act"* — was `actions[index].seat` whatever kind it was, so the
acting ring sat on a player through `post_sb`, `post_bb`, `uncalled_return` and `muck`. `actor` was
**not** changed: `toCall` is reckoned for it and a parser-agreement test pins it. A separate `toAct`
was added beside it, gated on the `DECISIONS` set that already sat in `poker-core/src/hand/types.ts`.

**Verified in Chrome** — a headless Chrome of its own over CDP on its own profile (a parallel session
held the shared MCP profile), the app on **:3003**, and a small **CORS-forwarding proxy on :8003**,
because `cors_origins` allows only :3000 and restarting the shared API would have disturbed three
other sessions. :3000 and :8000 were untouched throughout and healthy afterwards. Against the real API
and the real registry: `/leaks` loads, 39 stats set aside under 100 opportunities, 0 console errors.
Nine leaks rendered — **five linked**, each URL the registry's own situation
(`fold_to_cbet_flop` → `?f=street:eq:flop;facing:eq:bet;facing_is_cbet:eq:1;action:eq:fold`;
`steal` → `…;position:in:CO,BTN,SB;action:eq:raise`; and `check_raise_flop` picked up
**`street_line:eq:x`**, a condition written nowhere in this session's code) — and **four refused with
their reason** (VPIP/PFR "measured over every hand dealt in", WWSF/WTSD "counted per hand rather than
per decision (Saw the flop)"). **Clicking the leak landed on `/hands` reading `Street is flop · Facing
is bet · Facing a c-bet: yes · Action is fold`, with the registry's exact AST on the wire and no
400** — the acceptance. A hand-grain dimension pasted into the URL showed the amber sentence and fired
no request; both date branches now carry `date_from`/`date_to`; the back link from a hand reads
`/hands?from=2026-01-01&f=street:eq:flop;…` while the hand's own URL stays `/hands/<uid>?seat=2`. A
pasted seed hand replayed with **the ring absent at both blind posts, the uncalled return and the
muck, and present on UTG, BTN, Hero and BTN at the four decisions checked**.

**What could not be verified, and why it is not a shortcut.** The leak *numbers* are not real. Every
read is scoped `s.user_id = {tenant_id}` (`stats/query.py`) and the pool carries the founder's own
tenant, so a freshly registered account owns no hands — hero **or** pool — and the real endpoint
correctly answered `hands: 0, leaks: 0, skipped: 39`. Earlier sessions got real numbers by registering
into a fresh `poker_test` Postgres, where the first user *is* tenant 1; that needs a database this
lane forbade, and forging a token for the founder's tenant was not on the table. So `/v1/hero/leaks`
**alone** was stubbed at the fetch boundary with nine real stat codes and plausible NL50 figures —
everything downstream of it (the registry, the decompiler, the URL, the search, the API's acceptance)
is real. **Open `/leaks` once on the founder's own account** to see the true ranking.

**`tags/notes` is not built, and is now plan step D.7b.** It exists nowhere in the stack — no table,
no route, no UI — and the repo's own dividing line puts it in Postgres in as many words: *"if a human
edits it, it lives here … A note someone typed is Postgres"* (`api/models_pg.py`). `POKER_DATA_MODEL.md`
already specifies `hand_notes`, `hand_tags` and `player_notes`. That is an Alembic migration, which
this lane forbade while another session owned the database, so it was **recorded and scheduled rather
than half-built in the browser**. Storing notes as step-less rows in the already-migrated `analyses`
table would have needed no migration and was **rejected**: notes would land in `/analyze`'s list beside
real nine-step analyses, and `current_step`/`steps`/`node_key` would be dead columns on every note row.

**Where D.3 stands (2026-09-11):** **done, verified, uncommitted** (ADR-037). Run as one of three
parallel sessions, in the **web workspace only**. The step was **amended before being built**: D.3
was written 2026-09-09, before the Range Lab spec and therefore before phase F was interleaved
into D, and it asks for seven primitives under `app/components/poker/` that F had already built in
`packages/poker-ui/` — `RangeMatrix` even says so in its own docstring ("plan D.3's HandMatrix").
Building the list would have put a second copy of each in a layer that may import the API, and the
first casualty would have been D.3's own "one grid in the repo" test. The amendment is recorded in
the step itself and in ADR-037: `PositionPicker` and `ActionLine` were the two genuinely missing
primitives and went **into `poker-ui`**; `SizeBadge`/`StackBadge` were not built, because one
`clauseLabel()` words every clause uniformly.

What landed: `app/stats/{api,definitions,families}.ts` (the registry, held once per session, and
the app's first real `FilterNode` — `hands/api.ts` had it as `Record<string, unknown>`),
`app/filter/{clause,url,label,model}.ts`, `stores/{definitions,filter}.ts`,
`composables/useFilterUrl.ts`, `components/filter/{FilterBar,SituationBuilder,ClauseRow,ClauseValue}.vue`,
`pages/dev/filter.vue`; `poker-ui` gains `PositionPicker`, `ActionLine`, `line.ts`;
**`app/hands/search.ts` and its test are deleted** and `/hands` now runs on the shared filter —
its four hard-coded vocabularies were a copy of four registry entries and `position` had already
drifted (no `UNKNOWN`, so anonymised seats were unfilterable). Two decisions worth remembering: a
**bucket compiles to `gte low` AND `lt high`, never `between`** (the registry's buckets are
half-open, the compiler's `between` is inclusive SQL, so 40bb would land in two buckets), and the
builder **publishes which tables can answer a situation**, because `stats/router.py` raises before
leaf validation.

**Verified in Chrome against the real pool, read-only** — a Chrome of its own driven over CDP
(another session held the shared MCP profile), the app on **:3001**, an API of its own on **:8001**
with auth in a throwaway `poker_d3` since dropped; the other sessions' :3000 and :8000 untouched:
the registry loads into 12 families; **every one of the 80 dimensions is reachable** (each code
typed into the search box, its button confirmed present, none missing); a situation clicked
together reads `Street is flop · Position is one of UTG, CO, BTN · Effective stack (bb) 75–125`,
compiles to the nested AST with the bucket as its half-open pair, and links as
`?f=street:eq:flop;position:in:UTG,CO,BTN;eff_stack_bb:bucket:75-125`; **pasting that link back
reproduces url, sentence and AST identically**, and `/hands` opened with it shows the same
sentence; **Run report → `767 hands · 1 row · fresh`**; no console errors. Offline against the same
engine: **80/80 dimensions accepted** by `POST /v1/reports/run`, and 10 composite situations —
including phase C's own demo, a multi-street line `r/x-c/`, `''` as a real value and an SPR bucket
— all exact through the URL and all accepted. Three defects found and fixed (`defaultClause`
ignored op arity; `''` on a `line` was worded "not applicable" when the registry means "my first
decision on this street"; the harness offered hand-grain stats under a decision-grain filter and
earned the router's 400). The registry-coverage test earned its keep within the hour: it caught
**`made_hand`**, added by the parallel F.11 session, and it is now classified.

**Do this:**
0. **D.5 is done, verified and uncommitted** — web workspace only, and it ticks itself (both halves
   of its "Done means" were checked in the browser: a saved report reopened from its URL and
   re-ran identically *from cache*, and every cell showed its `n`). The file list is
   `scratchpad/lane-d5.files`; nothing under `platform/` outside `web/` was touched, and
   `packages/poker-ui/` was never opened. The only shared file it modified is
   `apps/web/app/stats/api.ts`, **additively**, and one line of `app.vue`'s nav array (another lane
   added `/leaks` to the same array in the same round — both survived). Commit it separately from
   the other lanes when the founder says so. **`filter/node.ts` is a shared dependency now** — D.7's
   drill-through calls `nodeToClauses`, so the two lanes should be committed together or D.7 first.
1. **D.7 is done, verified and uncommitted** — web only, and it ticks itself (its "Done means" was
   performed in the browser). Commit separately from the other lanes: **new**
   `apps/web/app/hero/{api.ts,leaks.ts,leaks.test.ts}`,
   `apps/web/app/hands/{searchable.ts,searchable.test.ts}`,
   `apps/web/app/components/hero/LeakTable.vue`, `apps/web/app/pages/leaks.vue`; **modified**
   `apps/web/app/pages/hands/index.vue` (dates on every branch, the unsearchable guard, the
   truncation note), `apps/web/app/pages/hands/[id].vue` (the back link carries the situation),
   `apps/web/app/app.vue` (one nav link — **D.5 added its own line to this file in parallel; both
   are present**), `packages/poker-core/src/hand/{types.ts,replay.ts}` (`toAct`),
   `packages/poker-core/test/replay.test.ts` (two tests),
   `packages/poker-ui/src/components/HandReplayer.vue` (one attribute). `poker-ui/src/index.ts` and
   `glossary.ts` were **not** touched. Docs: plan (D.7 amended, ticked, D.7b added, Status, §6),
   this file, ADR-041. The file list is also in `scratchpad/lane-d7.files`.
2. **A throwaway account is left in the real Postgres**: `d7-verify@example.com` (tenant 2), created
   through `POST /v1/auth/register` to sign in for the verification. There is no delete-account
   endpoint, so **it needs removing by hand by whoever next has the database** — it owns no data.
3. **D.7b (tags & notes) is the natural follow-up** and needs one Alembic migration; the schema and
   the two open questions are written into the step in [POKER_PLAN.md](POKER_PLAN.md).
4. **D.3 is done and verified, uncommitted** — commit it when the founder says so, separately from
   the other lanes' work. Web only: `apps/web/app/stats/{api,definitions,families}.ts` +
   `families.test.ts`, `definitions.test.ts`; `apps/web/app/filter/{clause,url,label,model}.ts` +
   a test beside each; `apps/web/app/stores/{definitions,filter}.ts`;
   `apps/web/app/composables/useFilterUrl.ts`;
   `apps/web/app/components/filter/{FilterBar,SituationBuilder,ClauseRow,ClauseValue}.vue`;
   `apps/web/app/pages/dev/filter.vue`; modified `apps/web/app/pages/hands/index.vue` and
   `apps/web/app/hands/api.ts`; **deleted** `apps/web/app/hands/search.ts` + `search.test.ts`;
   `packages/poker-ui/src/components/{PositionPicker,ActionLine}.vue`,
   `packages/poker-ui/src/line.ts`, `packages/poker-ui/test/filter-controls.test.ts`, and four
   appended lines in `packages/poker-ui/src/index.ts`. Docs: plan (D.3 amended + ticked, Status,
   §6), this file, ADR-037. Gates: `make web-check` lint 0 errors, **551 tests** (90 new), licence
   audit unchanged; `nuxt typecheck` clean for every file of this step (the 4 errors it reports are
   the F.11 session's `app/heuristics/*` and `app/train/*` — one of them, `HeuristicBody` not
   assignable to `Record<string, unknown>`, is the same interface-vs-type-alias trap `stats/api.ts`
   hit and solved).
5. **F.10 is committed** (`775bc60`) — the paragraphs above describing it as uncommitted are
   stale. Backend: `analysis/pool/{node_query,reconstruct,realization}.py` (new),
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
6. Nothing on `feat/range-lab` is pushed yet; **after a push, when the CI `web` job is green,
   tick F.1** (it is the one step held open purely on a CI run).
7. **D.4, D.5 and D.6 now have their filter.** The workbench is the next thing that should use it:
   `filter.reportRequest({ stats, group_by })` is the whole call, `useFilterUrl()` is the whole URL
   story, and `pages/dev/filter.vue` is a working reference for both. D.5 owns the stat and
   group-by selection — they are deliberately **not** in the shared filter, so two screens can
   share a situation without sharing the columns they measure it with.
8. **F.11 Training modes** (plan F.11, spec §16). Concretely: the six modes, the scoring store,
   `/progress`, spaced repetition, and the **heuristic log with its 14-day review prompt** —
   which is a query over `analyses.heuristic`, the column F.9 deliberately kept out of the steps
   JSON for exactly this. `/v1/heuristics` follows the same shape as `/v1/analyses`.
   `PredictionGate`, `scorePrediction` and the step definitions in `analyze/steps.ts` are the
   reusable pieces — the nine questions, tolerances and units are already data, not code.
   **Done means** acceptance 11.
9. Carried over, unchanged: **B.5b**'s `core.*` rebuild; the phase-E performance note; the real
   Postgres `users` table still holds old `e2e-*`/`iso-*` test accounts; on a comma-decimal
   locale `PotOddsPanel`'s number inputs display `2,5` for 2.5 (recorded for F.12).
10. **New for F.12's §13 checklist, from D.3:** `facing_size_pct` and `size_pct` are labelled
   "(% of pot)" but stored as fractions, so the builder shows `0.75` under a label that says
   percent. The value is deliberately **not** scaled — the number typed and the number sent must
   agree — but the pair reads badly and wants either a relabelled registry entry or a percent
   control like `NodeKeyEditor`'s. Also noted in passing, not fixed (it is D.5/D.6's):
   `components/hands/HandStudy.vue` links to `/ranges/compare?hero=…&street=…`, but
   `pages/ranges/compare.vue` reads only `?range`, so both parameters are silently dropped and the
   page opens on its hard-coded UTG default.

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
**Exit criteria:** upload a real file → stats in the browser with no manual steps *(met through the UI on 2026-09-15, D.8 / ADR-051 — before that only the API route existed)* ·
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
- [x] F-309 All-in EV adjustment — **done 2026-09-11 (plan E.5, ADR-039).** Exact enumeration
      at parse time through `phevaluator`; EV redistributes the awarded pot per side-pot
      layer. Hero EV bb/100 **+0.28** against an actual **−1.37**. `ev_won_bb` still falls
      back to the result where there was no gamble — no all-in, no cards shown, or the
      **27,088** hands GGPoker settled without dealing a runout
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
| F-309 | All-in EV adjustment | ✅ done | exact enumeration at parse time; per-side-pot; hero EV +0.28 vs −1.37 actual |
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
   **The shard half is now designed** — [POKER_SCALE.md](POKER_SCALE.md) + ADR-036 (plan E.4, done
   2026-09-11): the key is `cityHash64(user_id)` with a **reserved tenant id for the pool** (the
   pool is not a user today), the population gets *threads, not shards*, and the cost table says
   2 / 9 / 44 four-GB shards at 10M / 50M / 250M hands. Nothing is built; E.1–E.3 come first.
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
| 2026-09-15 (session 20, **the round-5 merge** — no lane work of its own) | D.9a `5c68433`, D.8 `00b6f8a`, F.12a `58d368a` committed; **D.9a ticked** (the merge did its `git rm`s; its isolation and rate-limit probes green by name in the full run). Three gate runs: a heuristic-log clock bug (`confirmed_at` from the API's clock, `created_at` from the database's; fixed `1d8be0e`), then the unit test that fix broke — and two background notifications that said exit 0 over logs that said `EXIT 2`. Final: `make check` 1,675 · `make web-check` 1,015 · `make test-all` **1,783 passed, 6 skipped**. **Fourteen real opponents' screen names found in the public history**; tree scrubbed `785ec83`. D.9a's doc rows had been lost to a concurrent rewrite; rebuilt. | **The founder's history decision**; `make pg-migrate`; round 6 (D.9b · D.9c · F.12b · F.12c · F.12d) |
| 2026-09-15 (round 5, **lane B — D.9a**, ADR-052; row rebuilt at the merge) | `GET /v1/hero/winnings` replaces the v1 timeline (identical on all 18 days of real hero data); v1 routes and the static dashboard deleted; every `/v1/stats*` probe re-pointed, none deleted; found the worker's cache drop missing `report:` keys. Integration files left unrun, deletions left to the merge. | the merge |
| 2026-09-15 (round 5, **lane C — F.12a**, ADR-053; web workspace + `dimensions.yaml`, no stack) | F.12a split out of F.12 in the plan, then done: `NumberInput` for all 28 numeric inputs (reads `2,5` and `2.5`, refuses what it cannot read, writes a dot), "(fraction of pot)" labels, `?node=<canonical key>` from the replayer to the compare page, bound pot-odds panels with a way back, step 4 graded by and locked to the definition on screen, step 1 naming (and only loading) your own chart, provenance line, `MetricLabel`s, the developer sentence, the two deletes, the header wrap. Found in the browser: every "Loading…" was unreachable behind an awaited `useAsyncData`; now lazy. A five-agent workflow lost three implementers to the session limit mid-edit — finished by hand. Adversarial review: 31 findings, 4 refuted, the rest fixed with tests. Browser 113/113 (`ru-RU` Chrome, scratch Postgres dropped). `make web-check` 1,015/99 · `make check` 1,676. | Round-5 merge; ADR-053's follow-ups (persist step 4's nut definition; unwrap `useAsyncData` errors in `auth/api.ts`); F.12 proper, solo. |
| 2026-09-15 (round 5, **lane A — D.8 upload & accounts**, ADR-051; owned the stack and the Alembic head) | Audited first (six auditors + a critic): the ingestion routes existed and nothing in the web app called them; five silent defects between drop and report (no retry for a failed upload; a cache drop that deleted nothing; empty files `completed`; raw exceptions in `error_text`; unattributed hero hands invisible). Amended D.8, built the backend fixes, migration `a8b9c0d1e2f3`, poker-account DELETE and the `/upload` page; reviewed adversarially (30 findings, 21 fixed); browser 29/29 on `TEST_ENV` with `make worker` — drop → My game 2 hands, no dbt. `make check` 1,676 · `make web-check` 1,013 · `make seed && make test-all` 1,783 passed, 6 skipped. Nothing written to the real databases. | Round-5 merge; `make pg-migrate` on the real Postgres; D.9b, D.10 |
| 2026-09-15 (round 5, **lane D — F.1 make CI real**, ADR-054) | The workflow was moved to the repository root with `git mv`, and its jobs now call `make check` / `make web-check` / `make seed` + `make test-all` instead of restating them. It runs on every branch push, PRs into `main`, and by hand. `make install` = `uv sync --frozen` and `UV := uv run --frozen`; dbt is a prerequisite of the targets that run it; `.nvmrc` 24 and `.python-version` 3.12. Fresh-worktree gate green: `make check` (1,621) and `make web-check` (846) on Node 24.21.0 and 23.11.0. Integration job checked by reading and statically only. Then, at the founder's request: committed `7e4cfeb` (lane D's code only) and pushed. Run 34955622749 was red at `make up` (`minio-init` under `up --wait`); fixed in `3a4b2ea`; **run 34957886151 green in all three jobs → F.1 ticked**. Local Node switched to 24.21.0. | The round-5 merge commits ADR-054 and the docs with the other lanes; its push runs CI over the combined tree. The empty `platform/.github/workflows/` directories are still on disk (`rmdir` was denied). |
| 2026-09-15 (session 19, **the round-4 merge** — no lane work of its own) | **Four lanes committed:** E.1b `1b11db0`, D.7b `ac1be5e`, D.6b `3cd1c2a`, F.12 audit `7f3e2bf`. **D.7b ticked**: its never-run `test_hand_notes.py` was green on the first run, confirmed by name and verbose (14/14 with `test_hot_path.py` and `test_mv_reconciliation.py`) beside `make test-all` **1,715 passed, 6 skipped**; `make check` and `make web-check` (846 / 79) green. **Found:** the real Postgres is at `8b2f4c6d1e3a`, four create-only migrations behind head, so the range library, the analyzer, the heuristic log and notes would fail on the founder's own database — not applied, flagged. ADR-047 gained the exact `built_by` upgrade recipe; `test_quotas.py`'s stale NOT YET RUN corrected; ADR bodies re-ordered, index 49/49. Then, same session: **`make migrate`** on the real stack after a `pg_dump` (Postgres to head `f7a8b9c0d1e2`, ClickHouse nothing pending); found CI has never run — the workflow sits under `platform/.github/`. | **Round 5**: D.8 · D.9a · F.12a · F.1 (see Next action) |
| 2026-09-15 (**E.1b** — owned the stack; three other lanes in the tree) | **E.1b done, E.1 ticked with it** (ADR-047). Provenance guards the swap race (`built_by`, the rollup on dbt's rows only, a second gate clause); the union is in the query builder below the router (one rollup per (tenant, dataset, day), a once-computed scalar and `has()`); the hot path is the dbt models rendered again by Jinja, keyed by the batch stamp, idempotent by anti-join, off for bulk paths; 0012 gives the view target an aggregate-max watermark. Legacy analyzer for the decisions statement (3.2 s → 0.18 s to plan, same rows). Real database migrated, altered, backfilled in 100 s and verified **0 / 0 over 160 day-partitions**; hero fingerprint 19,802 hands, VPIP 22.96, PFR 18.85, WTSD 29.92 (n 2,239), −1.374 bb/100 — identical to the read-only check taken before any write. `make check` 1,621 · `make seed && make test-all` **1,715 passed, 6 skipped**. | **D.8** |
| 2026-09-14 (**D.7b** — lane B: `api/` notes and tags, the round's one migration, `app/hands/**`) | **Hand notes and tags, built and verified, left `[ ]`** (ADR-048). Migration `f7a8b9c0d1e2` (`hand_notes`, `hand_tags`) from head `e6f7a8b9c0d1`; `owned_hand` asks `core.hands` and 404s like the hand itself; one `normalize_tag` everywhere; **no registry dimension — `?tag=` is an id-list intersection**; 500 distinct tags per user; blank note deletes; `HandNotes.vue` under the replayer with a tested autosave, tags column and "Tagged" select on `/hands`. **Chrome 30/30** on the real hands read-only (scratch `poker_d7b_verify`, dropped). **One bug found in the browser:** `IN arrayMap(unhex…)` refused by ClickHouse — now a subquery, unit test corrected. **One found by the tests:** 500 POSTs hit E.3's 300/min budget — seeded instead. **Four found by the adversarial review and fixed:** a tag with `/` could never be removed (`{tag:path}`), the note's first save was a read-then-insert race (upsert), a NUL byte was a 500 (422 now), a vacuous `extra=forbid` test. `make check` 1,597 on this lane's files (lane A's in-flight files carry lint and size violations of their own) · `make web-check` 846 · `tests/postgres/` 12. | **`make seed && make test-all`** to run `tests/integration/test_hand_notes.py` (6, unrun), then tick D.7b. |
| 2026-09-14 (**D.6b** — web workspace only, one of three parallel lanes) | **D.6b done and ticked** (ADR-049), amended first: the backend was complete (six routes, `cohorts` table, the 409/400/422 sentences measured over HTTP) and the client bound only the reads, so the step became `stats.ts`'s write half + `app/pool/rules.ts` (the builder's vocabulary, 21 tests) + `CohortForm.vue` (cached stats offered, uncached greyed, from the registry) + `cohorts.vue` (New · Edit · Save as mine · Delete). Reviewed adversarially before the tick — two real page defects fixed (stale open panel after an edit; write and read-back sharing one `try`), three tautological tests pinned, one follow-up recorded (the 422-list reader belongs in `auth/api.ts`). Verified 37/37 in a headless Chrome of its own against a scratch Postgres (dropped) and the real pool read-only. Gate: `make web-check` green over the combined tree (846 tests / 79 files). | **E.1b** unchanged |
| 2026-09-14 (**F.12 audit lane** — docs only) | **[POKER_UX_AUDIT.md](POKER_UX_AUDIT.md) written**: spec §13 as a checklist with each line's state and file (2 met · 9 partial · 2 missing), the glossary coverage audit, the three recorded issues confirmed and mapped (plus the finding that `lang="en"` is already set and does not stop Chrome rendering `0,6` on this `ru_RU` machine), acceptance 13 met / 12 partial, and an inventory of what a tour and Examples would be built from. No product code, no page edited, nothing seeded or tested, no account touched; the public pages rendered read-only in a scratch headless Chrome. Five agent passes completed before the agent pool hit its session limit; the remaining slices were read by hand. F.12 itself unstarted, `[ ]`; ADR-050 deliberately unused. Files in `scratchpad/lane-f12-audit.files`. | **E.1b** as before; F.12 starts from the audit's §7 when it has the tree to itself |
| 2026-09-12 (38, **the round-3 merge**) | **Four parallel lanes reconciled, gated and committed** — E.3 `9d72503`, E.1 `0247f2d`, D.6 `61dff34`, D.4 `fcff2af`. **E.3 ticked after three runs of `make test-all`, the first of which found a real bug**: a connection-cache miss re-tiered the tenant it was connecting to, so any budget other than `STANDARD` survived only until the next reconnect, and all four quota assertions failed on it. The second run left one failure that was the test's own — a ClickHouse quota does not charge a query that reads no table, so a `SELECT 1` exhaustion loop is free. Both written up at the end of ADR-043. **E.1 stays `[ ]`** by its lane's own judgement: the views reconcile, but `stats/router.py` still reads `stats_daily` alone, so nothing is fresher yet. Also repaired the ADR index (nine bodies unlisted, two dead anchors — now 46/46) and gitignored `scratchpad/` and `.claude/`. | **E.1b** — union the view into `stats/router.py`. Then D.8 and D.10. F.12, D.9 and B.5b each need the tree to themselves. |
| 2026-09-12 (37, **D.6** — web only) | **Plan D.6 done — the pool, and one clause struck because phase F had already built it** (ADR-046). Audited before building, as D.3, D.5 and D.7 all needed. **The ranges clause was already closed:** `HandMatrix` does not exist (the grid is `RangeMatrix`, and `/ranges/compare` already draws the pool column through it), so *"the ranges page adds no new grid code"* was true before the step started and a pool-ranges page would have made the second grid the clause forbids. **The other three were missing in the web lane only** — `POST /v1/pool/stats`, the cohort CRUD and its table, the `regs`/`fish` presets and `GET /v1/pool/players` all shipped in phase C, so this step wrote no Python and no migration. Built `app/pool/{stats,compare,population}.ts`, `components/pool/{CohortPicker,CohortGrids}.vue`, `pages/pool/{index,cohorts,players}.vue`, one nav line. **`StatGrid` is not forked and no D.5 file was edited:** the page ignores `ReportWorkbench` (hero-shaped three ways) and composes its parts, while the dataset lock is a `FilterAccess` wrapper rather than a write into the shared Pinia filter — which would have left the hand list on the pool afterwards and which a missing `ds` in the URL would have undone. **"Regs vs fish" is two runs joined on the row key with no difference drawn**, because the engine takes one cohort, refuses a pool baseline, and a client-side delta would be a second answer to what "enough" means. **Verified in Chrome against the real pool, read-only, 20/20, 0 console errors and 0 failed requests from sign-in onward** (own Chrome on :9227, app :3003, an API of its own on :8003; the other lanes' :3000/:8000/:9226 untouched): regs fold to a flop c-bet **38.0%** (n 572,450) small through **68.9%** (n 11,637) overbet, recreational players less at every size (31.8% / 62.6%), five buckets aligned across two grids with every cell carrying its `n`; and §17 checked as a property — a player report's two cells at **n 68** carry `data-thin="true"` while five full-sample cells do not. **One real defect, in the server:** `GET /v1/pool/players` prefix-matches a key that is always `ggpoker:<name>`, so it answered "no such player" to every real opponent (`A`, `V`, `Vill`, `P`, `1` → 0 rows); search now goes through the report path as a `like`, lower-cased because **none of the 94,276 distinct keys has an upper-case character**. A backend fix is owed. **Also found: the API on wire :8000 predates E.2** — no `confidence`, no `Interval` — and `ReportRequest` is `extra='forbid'`, so any grid asking for intervals would 422 against the running server; restart it before the next browser pass. `make web-check`: typecheck clean, lint 0 errors, **806 tests / 76 files**, licences unchanged. Throwaway auth database dropped; **no loose ends**. Uncommitted; files in `scratchpad/lane-d6.files`. | **E.3's two integration tests**, then **E.1b**. **D.6b** (cohort create/edit/delete) is specified and unbuilt — it needs a lane allowed to write to Postgres. |
| 2026-09-12 (35, **E.1** — owned the stack) | **The rollup's materialized views, generated from the registry, with the boundary-marker backfill and the reconciliation test** (ADR-044). `scripts/rollup_sql.py` is now the single renderer behind the dbt model, the views and the backfill, so ADR-003's drift is unwritable. Reconciliation **green**: 113 counters × 11 group keys, both directions, traffic in 12 insert blocks, non-vacuity asserted, mutation-proved. **Left `[ ]`**: E.1's "Done means" needs a plain `INSERT` into `marts.*` and dbt uses `REPLACE PARTITION`, which fires no view — verified live. Also found: `SummingMergeTree` does not sum `DateTime64`, and writing to `marts.stats_daily` would make the incremental gate compare a value against itself. Migration `0011` applied on the real database; row counts unchanged, no views there. | **E.1b** (the hot path + its lost-update race). D.7b not taken. |
| 2026-09-11 (34, **E.3** — no stack) | **Per-tenant ClickHouse quotas and the API's request budgets, built and gate-green, `[ ]`** (ADR-043). One of three parallel lanes; touched `stats/`, `api/`, `infra/clickhouse/`, `tests/` and the docs — **no data, no migration, nothing in `core/`, `scripts/`, `dbt/`, `ingestion/`, and no `make` target beyond the CPU-only gates**. The step's own "Done means" says the over-budget query must be refused *by ClickHouse, not by the API*, and that is the design: a **ClickHouse user per tenant**, a per-tier **settings profile** whose ceilings are `CONST`, and its own **hourly quota** — because a check inside `api/` is no limit at all for the parser worker, dbt, the backfill or a SQL prompt, all of which hold the same credential. `stats/budget.py` is pure (19 unit tests assert the DDL with no server); `stats/tenancy.py` owns the connections and the refusal classification; `api/main.py` turns a refusal into 429/400/504 and **never** forwards the server's text, which contains the SQL. The read path needed **no new seam** — `run_report(..., run=)` has been injectable since phase C. F-706: per-route-family address buckets (so a browser's refreshes cannot spend the sign-in budget) plus a **per-tenant** bucket on the five analytics routers; `/v1/auth/refresh` is limited for the first time; `AUTH_RATE_LIMIT_PER_MINUTE` is still the knob the seed path sets. **One real bug found by writing the test:** the fallback caught the connection as well as the DDL, so a spent quota fell back to an *unbudgeted* admin connection. `make check` green, **1,582 unit tests**. | **The two integration tests have never been run** — `make up && make seed && make test-all`, confirm `test_quotas.py` and `test_rate_limits.py` by collection, then tick E.3. Uncommitted; `scratchpad/lane-e3.files` |
| 2026-09-11 (33, merge) | **Committed the second parallel round and closed phase F.** Six commits on `feat/range-lab`: `d2abcac` the E.5 enrichment fix, `202a38b` E.2, `72ecf4d` D.5, `0048fc0` D.7, on top of the first round's four. **The fix came first deliberately** — `c316fd0` shipped a bug that moved 2,264,407 rows three hours earlier and duplicated every month-crosser, by round-tripping a `DateTime64(3,'UTC')` through Python; the committed tip must never be the version that corrupts data. Verified the E.5 session's claims by query rather than by report: `core.hand_players FINAL` exactly 54,562,770, decisions and player-hands unchanged, hero fingerprint bit-identical. Ran the gates nobody had run over the **combined** tree — `make check` 1,552, `make web-check` 691/70, and `make seed && make test-all` **1,612 passed, 6 skipped** — which closed **F.11** and **E.2**, whose integration tests had never met a database. Confirmed both files by `--collect-only` rather than inferring them from the total, because the total was unchanged from the E.5 session's own run and that alone proves nothing. The per-lane `scratchpad/lane-*.files` manifests made the commit split mechanical; keep that rule. | **D.4** and **D.6** in parallel (both unblocked by D.5), **E.1** as the sole stack owner, **E.3** as a no-stack lane. Then the solo-only steps: **F.12**, **D.9**, **B.5b**. |
| 2026-09-11 (32, web only) | **Plan D.5 done — the reports workbench, and one file that decides whether a number is worth reading** (ADR-042). Rows are a group-by, columns are stats picked by category, and **every cell carries its own `n`** — the row's hand count cannot stand in for it, because a row of 2,219 flops carries cells of n = 3. The rule the step exists for is spec §17's *never fabricate a pool number*, and the numbers that forced its shape are the founder's own: **VPIP in 5-bet pots from the BB is 6.67% against the field's 35.18% — a −28.5 point "leak" from fifteen hands**; `raise_cbet_flop` is `0.0%` on **n = 3**; and `compare_to` reports hero's 3,245 hands against the pool's 9,036,302 as a delta of **−9,033,057**. `ReportRequest` has no `min_n` and the engine suppresses nothing, so the judgement is the client's and is made once, in `app/reports/cell.ts`: under the threshold a cell is dimmed and **its delta withheld**, no observations reads as a dash even where the pool has a baseline, a `count` is never compared, and **the threshold travels in the link** because it decides what is greyed. Delivered `app/reports/{api,library,cell,columns,describe,url,model}.ts` (a test beside each), `useReportUrl.ts` (one composable owns all nine query keys — two `router.replace` writers in a tick drop each other's), `stores/reports.ts`, `components/reports/` (the five named, plus `GroupByPicker` and a `ReportWorkbench` shell D.4/D.6 may ignore), `pages/reports/[[id]].vue`, and **`filter/node.ts`** — the inverse of D.3's compiler, without which a preset's numbers would sit above a filter bar describing something else; D.7 already depends on it. `stats/api.ts` extended **additively**, because it lacked `compare_to`/`cohort`/`custom`/`player_key` and a preset would have quietly lost its baseline. Also closes **the group-by half of D.3's grain trap**. Verified in Chrome on the real pool, read-only (own profile, app :3002, an API of its own on :8002; :3000/:8000 untouched; auth and saved rows in `poker_test`, both test reports deleted after): `preflop_overview` ran with **48 of 48 cells carrying n**, `Fold to 3-bet 50.0% n 2` shown but uncompared; a thin report gave *"22 of 26 cells are under 100 observations"* with **0 thin cells carrying a delta**; **a save moved the address to `/reports/<uuid>` and a full reload reproduced the report and re-ran to identical figures *from cache* — the cache key hashes the canonical request, so the reopened document is byte-identical**; grouping by `Facing` dropped "Hands, VPIP" by name instead of earning a 400; the pool answered over **54.4M hands** with the baseline inert; `DefinitionPanel` printed fold-to-c-bet's definition from the registry's own AST. **0 console errors.** Four browser-found defects fixed: a save remounted the page and lost the grid (`NuxtPage` keys by path); `toLocaleString()` disagreed with the tests about `3,245`; the duplicate-name guard was suppressed in exactly the case the server 409s; the preset's `hands` column printed twice. `make web-check`: typecheck clean, lint 0 errors, **691 tests**, licences unchanged. Uncommitted; files in `scratchpad/lane-d5.files`. | **D.4** — it composes D.7's `LeakTable` and this step's `StatGrid`; audit it against phase F first, as D.3, D.7 and D.5 all needed. **D.6** likewise. When E.2 lands, add its `confidence` to `Carried` in `app/reports/model.ts` so a re-saved KPI report keeps it. |
| 2026-09-11 (31, web only) | **Plan D.7 audited, amended and done — a leak now opens its own hands** (ADR-041). The audit came first and carried the session: **two of D.7's three clauses had already shipped** — the replayer is F.7's (the plan's own F.7 entry says *"absorbs plan D.7"*, while D.7 sat `[ ]` and appeared in neither ordering statement) and the filter-bound list is D.3's. The missing piece was the acceptance itself: **nothing had ever called `/v1/hero/leaks`**, and a `Leak` carries only a stat code. The translation needed no poker in the client — a stat's registry entry *is* a filter tree, `/v1/definitions` was already sending it and the client was throwing it away, and D.5's new `nodeToClauses` inverts D.3's compiler — so `app/hero/leaks.ts` is composition and the first real caller of both. Two links per leak (the spot, and the spot where you did it); four leaks refused **structurally** via `tablesFor`, not by a list of codes. **Three defects fixed inside the step's own wording:** the list dropped the date bounds whenever no clause was set, a hand-grain clause earned a raw 400, and the acting ring sat on a seat through the blinds and the settling (`toAct` added beside `actor`, which a parser-agreement test pins). Verified in Chrome on its own headless profile, app on :3003 behind a CORS proxy on :8003, the other sessions' :3000/:8000 untouched: five leaks linked with the registry's own situations (`check_raise_flop` picked up `street_line:eq:x`, written nowhere in this session), four refused with their reason, **the click landed on `/hands` with the exact AST on the wire and no 400**, the guard fired no request, both date branches carried their bounds, the ring correct at every step of a pasted hand, **0 console errors**. The leak *numbers* alone were stubbed at the fetch boundary — tenancy scopes every read by `user_id`, so a new account owns no hands; everything downstream is the real registry and API. **`tags/notes` split out as new step D.7b, unbuilt**: it needs `hand_notes`/`hand_tags` in Postgres, an Alembic migration this web-only lane forbade. `make web-check` lint clean, **691 tests** (19 new), typecheck clean, licences unchanged. Uncommitted. | **D.7b** (needs the database) · then **D.4**, which composes `LeakTable.vue` into `pages/index.vue`. A throwaway account `d7-verify@example.com` needs deleting from the real Postgres by hand. |
| 2026-09-11 (30, `stats/` + `poker-ui`, no data) | **Plan E.2 built and gate-green — confidence intervals, and deliberately left `[ ]`** (ADR-040). Sequenced ahead of D.4 on purpose: D.4's KPI tiles are the first consumer, so the service and the component exist before them. **The step was amended before it was built:** it says "ratio stats Wilson interval", but this registry's `ratio` is one thing — the aggression factor `(bets + raises) / calls`, two *disjoint* row sets, unbounded above, where Wilson is undefined. The format that gets Wilson is **`percent`** (all 56, the four `afq_*` included, whose row sets still nest); `ratio` and `count` get none, by name. Built `stats/interval.py` (typed `Interval`; Wilson for a proportion; `100 · z · sd / sqrt(n)` for a per-100 mean; `for_cell` as the one place the mapping is written), `ResolvedStat.dispersion`, `plan(..., dispersion=)`, `stat_columns` emitting `stddevSamp(x) AS <code>__sd`, `ReportRequest.confidence`, `Cell.interval`, and `poker-ui`'s **`MetricValue`** — `± band` when the two halves are equal at the precision on screen, the bounds themselves when Wilson leans. **`api/` did not change at all**: the route declares `ReportRequest` in and `ReportResult` out, so a field on each model is the whole wire change. Intervals are **opt-in** because `stats_daily` stores no sum of squares — a per-100 band costs the rollup, a proportion does not. **One defect found by verification and fixed:** the per-100 band used the normal quantile at every `n` and is **6.5× too narrow at n = 2** against Student's *t*, so `MIN_N_MEAN` is now 30 and below it there is no interval — six-times-too-confident is the failure the step exists to prevent. Verified with no database: Wilson matched an independently written implementation over **444** (p, n, level) cases and the published 50/100, 0/10, 0/3; the `z` table is asserted against `math.erf`; injection through a custom `per100` stat was tried four ways and refused twice over. `make check` green, **1,552 unit tests** (28 new), 7 contracts; `make web-check` typecheck clean, **113 `poker-ui` tests** (10 new), licence audit unchanged — no new dependency. | **E.2 uncommitted.** Run `make test-all` for `tests/integration/test_intervals.py`; tick E.2 only when **D.4** renders the tiles. D.4 owes one line: `interval` on the `Cell` mirror in `app/stats/api.ts`, left to it because D.5's lane was rewriting that file in parallel |
| 2026-09-11 (29, merge) | **Committed the four parallel sessions** (25 docs/E.4, 26 D.3, 27 F.11, 28 E.5) as four coherent commits on `feat/range-lab`: `c316fd0` E.5 code half · `4f247a6` F.11 · `47702d7` D.3 · this docs commit. The four ran in **one working tree, not four worktrees**, so there was nothing to merge — and the append-only rule held: `poker-ui/src/index.ts` and `poker-core/src/index.ts` took additions from two different sessions with zero conflict. Gates re-run over the combined tree: **`make check` green**, **`make web-check` 556 tests over 60 files**, licence audit unchanged — which retires session 27's note that `make check` was red, that was session 28's uncommitted work seen mid-flight. Two pieces of debris removed before committing: `poker-core/_eqcheck.ts` (a scratch equity harness) and two stale `eslint-disable` directives in `fixtures/gen_made_hands.ts`. One staging mistake caught and fixed: the deletion of `hands/search.ts` was already in the index before the first commit and was swept into E.5's, making that commit delete a web module unrelated to equity; the three commits were redone from a `--soft` reset so the deletion sits in D.3 where it belongs. | **Finish E.5's data half** — the pool equity backfill was still running at commit time; when it finishes, `scripts/backfill --skip-tests --rebuild-from 2024-01-01` (**not optional**, the gate is data-driven) and check the hero fingerprint. Then `make seed && make test-all` to tick **F.11**. Then **D.5**. |
| 2026-09-11 (28, data + `core/`) | **Plan E.5 done and verified on the real corpus — equity at parse time** (ADR-039). `ev_won_bb` is real and `made_hand` is filled. **The load-bearing check passed: the hero fingerprint is bit-identical** — 19,802 hands, VPIP .229573, PFR .188466, WTSD .033835, **−1.37 bb/100** — while **EV bb/100 moved −1.37 → +0.28**. That is the first time the EV line and the actual line have differed, and it answers the question F-502 exists for: the founder has been running **1.65 bb/100 below EV** over 19,802 hands. Hand `ad730688` is the emblem — A♠A♥ all-in preflop at **81.55%**, lost 101.5 bb, EV +60.78. Row counts unchanged (73,679,949 / 54,562,770); `made_hand` on **7,153,872 of 7,153,872** eligible decisions; **609,837** EV-adjusted decisions. **The licence gate passed without adding anything:** `phevaluator` (Apache-2.0) is the Python binding of the *same* `HenryRLee/PokerHandEvaluator` the Range Lab runs through WebAssembly (ADR-027), declared in `pyproject.toml` since the first platform commit and never imported. The **classifier** is a genuine port of `classify.ts`, pinned to `tests/fixtures/made_hands.json` — 1,024 cases, all 17 classes, generated from the TypeScript reference and asserted by **both** suites. Equity is **exact, never sampled**: 1,712,304 runouts per heads-up preflop all-in at 1.25 s, affordable because `canonical_key` folds suit relabelings and player order together (60,709 → **6,131** distinct match-ups; 69,364 spots cached to a gitignored `.equity-cache.pkl`), and validated to **1e-9** against F.2's independent **treys** fixture. **Two decisions the data forced:** EV redistributes the *actually awarded* pot per side-pot layer instead of taking ADR-018's heads-up-only escape hatch, so `sum(ev_won) == sum(net_won)` per hand exactly; and **no adjustment where the runout never happened** — GGPoker settles an all-in on request without dealing the board, and **27,088 hands (20% of the pool's all-ins, 18 of hero's)** stop with exactly the cards betting stopped on. **Two bugs of my own, caught only by the new dbt assertion, both fixed and written up in plan §5c:** selecting all 33 columns into Python and inserting them back round-tripped `played_at_utc` through an aware `datetime`, moving **2,264,407 rows three hours earlier** on this UTC+3 laptop and duplicating every row that crossed a month boundary (the writer now merges server-side and no timestamp enters Python); and `--resume` skipped **partially** written days, losing 1,154 seats (it now asks what is *missing*, not what is present). Repaired server-side from `core.hands` with no recomputation — `core.hand_players FINAL` is back to exactly **54,562,770** seats. Also: the §5b dead-letter backup was accepted, **exported and checksum-verified restorable**, then dropped. Gates: `make check` **1,552**, `make test-all` **1,612 passed / 6 skipped**, **26 of 26 dbt data tests green**, `poker-core` 195. Uncommitted. | **Commit E.5**; the F/D track continues where sessions 26–28 left it |
| 2026-09-11 (27, web + `/v1/heuristics`) | **Plan F.11 built and browser-verified — the six training modes, and deliberately left unticked** (ADR-038). Spec §17 decided the shape: the trainers must work with **no backend**, so a spot is built from a seed rather than stored, its answer comes from `@poker/core`, and `/train` and `/progress` are public and correct with the API stopped. `@poker/core` gains `training/schedule.ts` (Leitner `[0,1,3,7,16,35]` days, clock injected — a month of review behaviour as a unit test — plus the 14-day heuristic rule). App: `app/train/` (the six modes as data, eight reference charts each labelled *no solver was asked*, seeded generators, the **browser-owned** Dexie scoring store, the run, the `/progress` aggregation), `app/heuristics/` (local-first, `/v1/heuristics` as its sync endpoint), `components/train/`, pages `/train`, `/train/[mode]`, `/progress`. Backend: `heuristics` (Alembic `e6f7a8b9c0d1`) + schemas, store and router, with `GET /candidates` as the bridge ADR-034 promised to `analyses.heuristic`. Verified in a headless Chrome of its own with every `/v1/` call refused: six modes answered, **six pot-odds spots re-derived from the §8 formulas in the harness and matching to a tenth of a point**, the drawing mode reporting *"298 combos of total error against 51 allowed"*, a heuristic written offline and dated *"next asked 2026-09-25"*, `/progress` charting 5 of 14 across 9 buckets, **3 API calls refused, 0 console errors**. One browser-found defect fixed with two regression tests: the reveal guard was never cleared between servings, so a spot that came back for review was answered but never scored. `make web-check` lint clean, 556 tests, 83 of them this step's; the heuristics slice ruff/mypy clean, 12 unit tests, 7 contracts kept. | **Run `make test-all` to close F.11** — its `/v1/heuristics` integration test has never run (the stack was another session's all session) — then commit, then F.12 |
| 2026-09-11 (26, web only) | **Plan D.3 done — one filter, shared by every screen, carried in the URL** (ADR-037). Amended the step first: it predates phase F and asked for seven primitives F had already built in `poker-ui`, so only the two genuinely missing ones (`PositionPicker`, `ActionLine`) were added, and there. Built `app/stats/` (the registry held once per session, families, the app's first typed `FilterNode`), `app/filter/` (clauses as text, the URL codec, the wording, the model), the two stores, `useFilterUrl`, `FilterBar` + `SituationBuilder`, and `/dev/filter`. Moved `/hands` onto it and **deleted `hands/search.ts`** — four hard-coded vocabularies that had already drifted from the registry. Verified in Chrome on the real pool, read-only, with a Chrome and an API of its own (:3001/:8001, throwaway DB since dropped): 80/80 dimensions reachable, the URL reproduces the filter exactly, the report runs (767 hands), no console errors. Three defects found and fixed; the coverage test caught `made_hand` arriving from the parallel F.11 session. `make web-check` lint clean, 551 tests (90 new). | **D.3 uncommitted**; F.11 in another session; D.4–D.6 now unblocked |
| 2026-09-11 (25, docs) | **Plan E.4 done — the scale design, out of order and documentation-only.** Wrote [POKER_SCALE.md](POKER_SCALE.md) (one node → a sharded cluster) and **ADR-036**; touched no code, no data, no containers. It corrects [ADR-025](POKER_DECISIONS.md#adr-025--freshness-and-scale-materialized-views-generated-from-the-registry-then-shard-by-tenant) in two places rather than restating it. **(1) `cityHash64(user_id)` cannot put the population on its own shard as the code stands** — a `--dataset population` import stamps the *importing account's* `tenant_id` on every row, so the founder's 19,802 hero hands and 9,073,994 pool hands hash to the same shard; the pool needs a **reserved tenant id**, and moving it is a replay from object storage, not an `ALTER`, because `user_id` leads the sort key. **(2) Sharding does not fix the query that motivated it** — the pool is one tenant and one dataset, so no hash divides the 1.6 s arbitrary-situation scan; the measured lever is threads (0.53 s → 0.16 s from 2 to 8 on 6.48M rows, +0.98 GiB), so the population becomes **one bigger node** and hero shards stay 4 GB / 2 vCPU. Cost table built only from figures the repo already measured (8.10 decisions/hand, 6.00 player-rows/hand, ~1.29 KB/hand, 91 s rebuild per 1M hands): **12.9 / 64.6 / 323 GB** and **2 / 9 / 44 shards** at 10M / 50M / 250M hands — the shard count from a **labelled extrapolation** of a single latency measurement, with what would have to be measured to replace it stated beside it. Also written down: writes go to the local table (a `Distributed` insert breaks both "one INSERT = one part" and the worker's commit-after-insert), dbt per shard is mandatory because `insert_overwrite` is `REPLACE PARTITION`, `uniqExact` is now a *correctness* constraint not a speed one (the initiator holds every shard's state), and a four-step migration path with rollback and verification at each step. Three doc-drift items recorded, not fixed: `limits.xml:33`'s "~69% of the 8G container" (stale from a 5.5 GB ceiling; the real figure is 58% of 4G), `profiles.yml:22-23` repeating it, and the worst-partition peak recorded as 3.06 GiB in ADR-019 but 3.17 GiB in three config files. Uncommitted. | **F.11** (unchanged — E.4 was off the critical path) |
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
