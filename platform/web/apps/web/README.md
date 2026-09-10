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
```
