# Third-party licences — `platform/web/`

Every dependency in this workspace must be free for use in commercial, closed-source software
(spec §3.1, ADR-027). Allowed: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, Unlicense,
CC0-1.0, 0BSD, Zlib, BlueOak-1.0.0, Python-2.0. MPL-2.0 is acceptable only for an unmodified
dependency and must be listed here with a note. Forbidden: GPL, AGPL, LGPL, SSPL, BUSL, Elastic,
Commons Clause, CC-BY-NC, any source-available licence.

`npm run license-check` (`license-checker-rseidelsohn --onlyAllow …`) fails the build on any
package, direct or transitive, outside the allowlist. It runs in `make web-check` and in the
CI `web` job. This file lists the **direct** dependencies and why each is acceptable; the
transitive tree is what the audit enforces. The allowlist also carries `BlueOak-1.0.0` and
`Python-2.0` (both permissive, OSI-approved; they appear deep in the ESLint tree).

## MPL-2.0 packages (allowed unmodified only — flagged for the founder's review)

MPL-2.0 is file-level copyleft: using an unmodified package is fine for closed-source software;
modifying one of its files would require publishing that file. None of these is modified, none
is shipped to the browser, and the audit would still fail on a *forbidden* licence.

| Package | Where it comes from | Note |
|---|---|---|
| `lightningcss`, `lightningcss-<platform>` (e.g. `lightningcss-darwin-arm64`) | `vitest` → `vite` (dev only; the CSS minifier) | Unmodified prebuilt binary. Flagged 2026-09-10. |

## Named exceptions (transitive, reviewed one by one)

| Package | Licence | Where it comes from | Why it is excluded by name rather than allowed by licence |
|---|---|---|---|
| `spdx-exceptions@2.5.0` | CC-BY-3.0 | `license-checker-rseidelsohn` → `spdx-expression-parse` (dev only) | A JSON list of SPDX exception identifiers, used by the audit tool itself; attribution-only, not copyleft, never shipped. CC-BY-3.0 stays off the general allowlist so a *code* dependency under it would still fail the build. Flagged to the founder 2026-09-10. |
| `spdx-ranges@2.1.1` | (MIT AND CC-BY-3.0) | `license-checker-rseidelsohn` (dev only) | Same SPDX data family (code MIT, data CC-BY-3.0). The audit tool accepts the compound expression because its MIT half is allowed; listed here so the CC-BY half is on record. |
| `node-forge` | (BSD-3-Clause OR GPL-2.0) | `nuxt` dev tooling (self-signed dev certificates) | Dual-licensed: we use it under BSD-3-Clause, which the audit accepts from the OR expression. Dev only, never shipped. |
| `caniuse-lite` | CC-BY-4.0 | `nuxt` → `browserslist` (build tooling) | The browser-support data table; attribution-only, never modified, not shipped as code. Excluded by name (`--excludePackagesStartingWith`), so a CC-BY *code* dependency would still fail the build. Flagged 2026-09-10. |

## Runtime dependencies

| Package | Licence | Used for | Why acceptable |
|---|---|---|---|
| `poker-hand-evaluator-wasm` | Apache-2.0 | WebAssembly build of PokerHandEvaluator (7-card ranks); used as an agreement check, the engine runs on our own table-driven evaluator | Permissive; attribution kept in `node_modules` and here. Upstream: HenryRLee/PokerHandEvaluator, Apache-2.0 |
| `comlink` | Apache-2.0 | Worker RPC for the equity service | permissive |
| `nuxt` | MIT | the app shell (SPA mode) | permissive |
| `vue`, `vue-router` | MIT | the component framework and router (Nuxt's) | permissive |
| `pinia`, `@pinia/nuxt` | MIT | app state | permissive |
| `tailwindcss`, `@tailwindcss/vite` | MIT | the app's utility CSS (poker-ui components use plain scoped CSS) | permissive |

## Development dependencies

| Package | Licence | Used for | Why acceptable |
|---|---|---|---|
| `typescript` | Apache-2.0 | compiler / typecheck | permissive |
| `vitest` | MIT | unit tests | permissive |
| `eslint`, `@eslint/js` | MIT | lint | permissive |
| `typescript-eslint` | MIT | TypeScript lint rules | permissive |
| `@types/node` | MIT | Node typings for tests | permissive |
| `tsx` | MIT | runs the benchmark scripts (`npm run bench`) | permissive (bundles esbuild, MIT) |
| `@vitejs/plugin-vue` | MIT | compiles `.vue` files for Vitest | permissive |
| `@vue/test-utils`, `happy-dom` | MIT | component tests | permissive |
| `eslint-plugin-vue`, `vue-eslint-parser` | MIT | lint for `.vue` files | permissive |
| `vue-tsc` | MIT | typecheck of `.vue` files (`nuxt typecheck` uses it too) | permissive |
| `license-checker-rseidelsohn` | BSD-3-Clause | the licence audit itself | permissive (declares `node >= 24`; runs on 23 with a warning) |

## Explicitly not used

- **wasm-postflop** (AGPL-3.0): not used, not vendored, not read as a source. Only the published
  web app may serve as a behavioural UX reference.

## Adding a dependency

1. `npm view <pkg> license` and read its `LICENSE` file; check transitive licences with
   `npm run license-check` after installing.
2. Add a row above with the reason.
3. If the licence is MPL-2.0, flag it to the founder before merging.
