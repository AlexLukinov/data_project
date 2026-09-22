# @poker/web

The one Nuxt 4 app (SPA mode, ADR-024/027): my game, the ranges, the hands, the reports, the pool,
the nine-step analyzer, the worked examples, the trainers and the help. `make web` in `platform/`
serves it on http://localhost:3000; `make api` alongside for the pages that read the database.

Routes, in the order the nav lists them, then the ways in and the developer pages. **Needs
sign-in** is "no" exactly when the page declares `definePageMeta({ public: true })`; everything
else is sent to `/login?next=<path>` by `app/middleware/auth.global.ts`.

| Route | What | Needs sign-in |
|---|---|---|
| `/` | My game (plan D.4): the KPIs with their intervals, the winnings curve, the leaks and the sittings, over the shared dates — with the `GET /health` strip at its foot | yes |
| `/lab` | the Range Lab calculator: ranges, board, equity, distribution, blockers | no (spec §17: pure calculation works without a backend) |
| `/ranges` | the range library (spec §11.1): every stored chart, by name, source and situation | yes |
| `/ranges/:id` | one chart: edit the matrix and its situation, read the versions, revert | yes |
| `/ranges/import` | a folder of range files in, every inferred situation reviewed before anything is saved (spec §11.2) | yes |
| `/ranges/compare` | my chart · a solver's · the pool's, side by side at one situation | yes |
| `/leaks` | where my frequencies stray furthest from the field's (plan D.7); each row drills into its hands | yes |
| `/hands` | the hand list (plan F.7): mine or the pool's, narrowed by the shared filter and by `?tag=` | yes |
| `/hands/:id` | one stored hand, replayed, with every panel bound to the node it is at (spec §9.3); `?seat=` names the seat to watch | yes |
| `/hands/paste` | paste a hand history and replay it — parsed by the API, stored nowhere (ADR-029) | yes |
| `/reports`, `/reports/:id` | the reports workbench (plan D.5): any stat, any situation, grouped any way. One page with an optional parameter, so saving a report does not remount it | yes |
| `/pool` | the same workbench over the field (plan D.6), with the cohort picker locked to the pool | yes |
| `/pool/cohorts` | the cohorts the field cuts into: the shipped ones and the saved ones, as one list | yes |
| `/pool/players` | find one opponent by the name a person types, and read their game (ADR-062) | yes |
| `/analyze` | the analyses I have run, and the two ways to start another (spec §15) | yes |
| `/analyze/:id` | the nine steps over one situation, autosaved and merged by step (spec §15, ADR-034) | yes |
| `/examples` | the three worked spots that ship as data in this bundle (spec §13, ADR-050) | no (an example needs no account, no upload and no API) |
| `/examples/:id` | one of them, opened in the analyzer's own nine steps (ADR-050, amended by ADR-061) | no (ADR-050) |
| `/train` | the six training modes (spec §16) with what each is owed a review on | no (spec §17) |
| `/train/:mode` | one mode: `equity`, `combos`, `drawing`, `blockers`, `advantage`, `potodds` | no (spec §17) |
| `/progress` | accuracy per mode over the last 30 days, the per-class/texture breakdown, and the heuristic log | no — the scores are local; only the log's sync needs the API |
| `/upload` | hand-history files in, and my own screen names named (plan D.8) | yes |
| `/help` | every tool in the app, what it is for and the way in (plan F.13, ADR-059) | no (the catalogue is data in this bundle) |
| `/account` | the signed-in account from `GET /v1/auth/me`, sign out | yes |
| `/login`, `/register` | sign in / create an account | no |
| `/dev/components` | every `@poker/ui` component with fixtures | no |
| `/dev/filter` | the shared filter with its workings showing (plan D.3): the situation, the AST, the link it makes, and a real `POST /v1/reports/run` with it | yes |

Every screen's own explainer — its one-liner, how it works, what it will not tell you — is
`app/help/tools/` (ADR-059), and `app/help/tools/tools.test.ts` checks that catalogue against this
very directory of pages: a route added without an entry fails there. **A route added without a row
in the table above fails there too** (`the README's route table lists every route`), which is what
keeps this file from going stale again.

## Auth (plan D.2)

- **Every route is behind sign-in unless its page says `definePageMeta({ public: true })`.**
  `middleware/auth.global.ts` sends the rest to `/login?next=<path>`; the return path is followed
  only when it is a path on this site (`auth/paths.ts`).
- The access token lives **in memory only** (`stores/auth.ts`, a Pinia setup store) and expires
  in 30 minutes; the refresh token is an HttpOnly cookie on `/v1/auth` that JavaScript never
  sees. A reload resumes the session with one `POST /v1/auth/refresh`.
- `useApi()` returns a `$fetch` for signed-in pages: it adds the bearer header and, on a 401,
  refreshes once and retries. Concurrent 401s share one refresh, because refresh tokens rotate
  and a second exchange with the same cookie would be rejected as a replay.
- The logic is framework-free in `app/auth/{api,session,paths}.ts` and tested with a fake fetcher
  in `app/auth/session.test.ts`; the store, the composable and the middleware only bind it to Nuxt.

## Layout

```
app/app.vue            shell: nav + sign-in state, the help menu, the tour and the page explainer
app/pages/             file-based routes (above)
app/components/        one directory per area: analyze, charts, filter, hands, help, hero, pool,
                       ranges, reports, train, upload
app/auth/              the auth transport and session, framework-free
app/stores/            Pinia: auth, filter, definitions, ranges, reports, analysis, heuristics
app/composables/       useApi, useEquityService, useHands, useFilterUrl, useReportUrl,
                       useEditableOdds
app/middleware/        auth.global.ts
app/analyze/           the nine steps as data, the spot they build, the reveals, the autosave
app/hero/ app/pool/    the two analysis areas, each with its own API client and wording (ADR-026)
app/hands/ app/ranges/ app/reports/ app/upload/
                       each area's client-side model: transport, empty states, failure sentences
app/filter/ app/stats/ the shared situation filter, and the registry's vocabulary on screen
app/help/              the tool catalogue, the page explainers, control help, the tour, the
                       examples and the keyboard-shortcut registry
app/train/             the six modes as data, the seeded spot generators, the scoring store
                       (Dexie `poker-training`), the run, and the /progress aggregation
app/heuristics/        the heuristic log: /v1/heuristics, its browser copy, and the 14-day rule
```

## Training (plan F.11, spec §16)

- **Every trainer works with no backend at all.** A spot is built from a seed and its answer comes
  from `@poker/core`, so `/train` and `/progress` are `public: true` and stay correct with the API
  stopped. Only the heuristic log syncs, and it says on each row whether it has reached the server.
  A trainer that cannot work an answer out therefore says so **in this browser's terms** and never
  blames the API (`train/problems.ts`, ADR-069).
- **The scoring store is browser-owned** (ADR-036), unlike every other Dexie database here, which
  is a cache of something the server holds.
- The review intervals are `@poker/core`'s `training/schedule.ts` — pure, clock-injected and unit
  tested, not a timer inside a component.
