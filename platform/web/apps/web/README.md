# @poker/web

The one Nuxt 4 app (SPA mode, ADR-024/027): the dashboard and the Range Lab. `make web` in
`platform/` serves it on http://localhost:3000; `make api` alongside for the API pages.

| Route | What | Needs sign-in |
|---|---|---|
| `/` | API health (`GET /health`) | no |
| `/lab` | the Range Lab calculator: ranges, board, equity, distribution, blockers | no (spec §17: pure calculation works without a backend) |
| `/dev/components` | every `@poker/ui` component with fixtures | no |
| `/login`, `/register` | sign in / create an account | no |
| `/account` | the signed-in account from `GET /v1/auth/me`, sign out | yes |
| `/train` | the six training modes (spec §16) with what each is owed a review on | no (spec §17) |
| `/train/:mode` | one mode: `equity`, `combos`, `drawing`, `blockers`, `advantage`, `potodds` | no (spec §17) |
| `/progress` | accuracy per mode over the last 30 days, the per-class/texture breakdown, and the heuristic log | no — the scores are local; only the log's sync needs the API |

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
app/app.vue            shell: nav + sign-in state
app/pages/             file-based routes (above)
app/auth/              the auth transport and session, framework-free
app/stores/auth.ts     the Pinia store around the session
app/composables/       useApi (authorized $fetch), useEquityService (the equity Worker)
app/middleware/        auth.global.ts
app/train/             the six modes as data, the seeded spot generators, the scoring store
                       (Dexie `poker-training`), the run, and the /progress aggregation
app/heuristics/        the heuristic log: /v1/heuristics, its browser copy, and the 14-day rule
```

## Training (plan F.11, spec §16)

- **Every trainer works with no backend at all.** A spot is built from a seed and its answer comes
  from `@poker/core`, so `/train` and `/progress` are `public: true` and stay correct with the API
  stopped. Only the heuristic log syncs, and it says on each row whether it has reached the server.
- **The scoring store is browser-owned** (ADR-036), unlike every other Dexie database here, which
  is a cache of something the server holds.
- The review intervals are `@poker/core`'s `training/schedule.ts` — pure, clock-injected and unit
  tested, not a timer inside a component.
