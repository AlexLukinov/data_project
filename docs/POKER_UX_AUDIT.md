# Range Lab — UX audit for plan step F.12

**Date:** 2026-09-14 · **Scope:** `platform/web/apps/web` (23 pages, `app.vue`, the app components)
and `platform/web/packages/poker-ui` (32 components, the glossary), read against spec §13 of
[POKER_RANGE_LAB_SPEC.md](POKER_RANGE_LAB_SPEC.md), acceptance 12 and 13 of its §18, and the
three issues [POKER_STATUS.md](POKER_STATUS.md) had already recorded for F.12 ·
**Outcome:** the checklist the solo F.12 session ticks item by item, with the file each item
would change.

> **Read-only.** No product code was changed and no page was edited; nothing was seeded or
> tested. Every finding cites `file:line` as of the working tree on 2026-09-14 (HEAD `2f9a939`,
> plus two other lanes' uncommitted D.6b and D.7b files, which nothing here depends on). Line
> numbers drift as files change — the *finding* is the durable part, as in
> [POKER_AUDIT.md](POKER_AUDIT.md).

---

## 0. How this audit was made, and what it is for

**Method.** Five parallel read-only agents each took one slice (progressive disclosure and
defaults, "explain the number", undo and keyboard, tour and examples, acceptance 12/13) and
returned findings with evidence; the remaining slices (empty states, visible state, modals and
feedback, dark mode and width, actionable errors, the glossary sweep, the three known issues) were
done by hand from the files after the agent pool hit its session limit, so those sections rest on
direct reads and `grep`, not on a second opinion. The public pages were rendered read-only in a
headless Chrome of its own on a scratch profile (the founder's Chrome, `:3000` and `:8000` were
not touched); `/lab` was screenshotted, which is where the locale finding in §4.3 comes from.

**What it is for.** F.12's "Done means" is *every §13 line checked here*. §2 is that checklist
with the current state of each line already established, so the session starts from "what to
change" rather than "what is there". §7 is an order the evidence suggests; it is not a design.

**What it does not do.** It proposes no designs and takes no decisions. Where a line needs a
decision (the two-vocabulary rule for the glossary, where the Examples live, whether the
iteration count is meant to be adjustable), it says so and names the options the code already
supports. ADR-050 was left unused on purpose: an audit records findings; the decisions belong to
the session that implements them.

---

## 1. Verdict in one table

| # | §13 line | State | The short version |
|---|---|---|---|
| 1 | Progressive disclosure | ⚠️ partial | Nut threshold and rake are behind labelled `<details>`; the MC iteration count and the bucket boundaries have **no control at all**; `/lab` has four threshold/amount inputs inline; three pages mount panels whose inputs render editable and change nothing |
| 2 | No unexplained jargon | ⚠️ partial | 28 glossary terms behind `MetricLabel`, the six the spec names present and tested; two other vocabularies (the registry's 65 stats and 80 dimensions; tiers, classes, positions, node shorthand) reach the screen with a `title=` hover at best — §3 |
| 3 | Explain the number | ⚠️ partial | Five templates render in four panels and the prediction sentence in every gate; the Lab's headline equity, the pool EQR, the realization panel and every grid are bare; ten sentences are hand-written inline rather than templated |
| 4 | Teaching empty states | ⚠️ partial | Most empty branches say what and how; `/ranges/compare` columns say what is missing without a way in; `/reports` and `/pool` are blank until *Run*; `/hands` points at an upload control that does not exist; "Try an example" appears nowhere |
| 5 | Sensible defaults | ✅ met | No settings screen exists; every page loads on defaults; the public pages are correct with the API stopped |
| 6 | Visible state | ⚠️ partial | Exact vs Monte Carlo, `PoolDataBadge` tiers and per-cell `n` are consistent where they exist; step 1 never says which chart it loaded, the equity trainer omits the chart provenance the other four trainers print, the realization block has no tier badge |
| 7 | Undo/redo | ⚠️ partial | Complete on `/lab`; scoped to a `<div>` and missing Redo in the drawing trainer; absent on `/ranges/[id]` and in the analyzer's step 1 |
| 8 | Keyboard, discoverable | ❌ missing | Matrix, stepper, replayer and gate are operable; there is no `?` overlay and the only hints are two `title`s, one "(⌘↵)" and one `<kbd>`; a matrix cell cannot be *clicked* from the keyboard |
| 9 | No modal traps | ✅ met | One native `<dialog>` with Esc; two native confirms; everything else inline |
| 10 | First-run tour + Examples | ❌ missing | Nothing tour-, help- or example-shaped exists; §6 inventories what an Examples section would be built from |
| 11 | Fast feedback | ⚠️ partial | The equity engine shows a bar and its status; My game names each wait; five pages say a bare "Loading…"; the replayer's panel rebinds and the compare page's lookups have no indicator, and compare shows a **false empty state while loading** |
| 12 | Dark mode, laptop width | ⚠️ partial | Dark follows the OS through `color-scheme` and tokens, verified in the screenshot; the header overflows below ~1000 px (already handed to F.12) and three matrices sit side by side from 768 px |
| 13 | Errors actionable | ⚠️ partial | The parser's error is the spec's own example, sign-in and library errors are sentences; the generic fallback prints the server's `detail` or a bare status, one page prints a raw `error.message`, and nine `.catch(() => null)` sites turn a failed call into "no data" |
| §18.12 | Import two components elsewhere | ⚠️ partial | One import works in-workspace; the equity service adapter and the bundler settings live only in `apps/web`; no README example per component; nothing outside `apps/web` mounts them |
| §18.13 | `npm run license-check` clean | ✅ met | Exit 0 over 805 packages, no copyleft; three documentation residuals |
| known 1 | `size_pct` "(% of pot)" stored as a fraction | confirmed | Confined to the registry label and the filter's number input; every other consumer already shows percent — §4.1 |
| known 2 | `HandStudy` → `/ranges/compare?hero=…&street=…` | confirmed | The page reads only `?range`; and two parameters cannot name a node anyway — §4.2 |
| known 3 | `2,5` in number inputs | confirmed, wider | Machine locale `ru_RU`; `<html lang="en">` is already set and does not help in Chrome; 28 numeric inputs, 17 of them fractional in normal use — §4.3 |

---

## 2. §13 as a checklist

Each line: what the spec asks, what is there, what is not, and the file that would change.
"Met" lines are included so the session can tick them with the evidence in hand.

### 2.1 Progressive disclosure — ⚠️ partial

**Spec.** One primary job and action per screen; advanced controls (nut threshold definition, MC
iteration count, rake config, bucket boundaries) behind a labelled "Advanced" disclosure with
defaults that work untouched.

**Met.**
- Nut threshold: `packages/poker-ui/src/components/RangeComparisonPanel.vue:98-99` —
  `<details class="pk-advanced"><summary>Advanced: what counts as nutted</summary>`, closed by
  default; defaults `cutoff` 80 % and `topPercent` 5 (lines 33-35, from `poker-core`
  `advantage.ts`); the threshold in use is printed outside the fold at line 96.
- Rake and implied odds: `PotOddsPanel.vue:110-111` — `Advanced: rake and implied odds`, holding
  rake %, cap and the implied extra (113-115); default `NO_RAKE` (26); the rake in use is stated
  at 108.
- Every page has one recognisable job and primary action (`/pool` and `/reports` a primary-styled
  *Run report*, `/ranges/import` *Save N ranges…*, `/hands/paste` *Replay it*, `/ranges/[id]`
  *Save as vN*, the analyzer the gate's *Commit*); `/lab` states its job at
  `apps/web/app/pages/lab.vue:110` and folds its secondary panels at 135 and 179.

**Not met.**
- **MC iteration count has no control.** `EquityCalculator.vue:23-26` takes `fastIterations`
  (default `50_000`) as a prop; no `<details>`, no input, and no caller passes it (`lab.vue:149`,
  `HandStudy.vue:174`, `Step4Nuts.vue:49`, `Step6Decision.vue:70`, `dev/components.vue:87`). The
  spec's "behind Advanced" is vacuous here: nothing is adjustable. *Decision for the session:*
  whether the line means "adjustable, behind Advanced" or "a default that works", which is
  already true.
- **Bucket boundaries have no control.** `ComboDistributionPanel.vue:21-23` takes `thresholds`
  (default `{}` → value ≥ 0.6, bluff-catcher ≥ 0.35) and only *prints* them at line 86;
  `EquityBucketBars.vue:19` draws the edges its caller passes, and `RangeComparisonPanel.vue:49`
  always passes the default `[0, .2, .4, .6, .8, 1]`. Same decision as above.
- **`/lab` keeps four controls inline** that the spec's wording puts behind Advanced:
  `lab.vue:186-189` — *villain continues at ≥ 40 % equity*, *hero value at ≥ 60 %*, and a second
  pot/bet pair duplicating the ones inside `PotOddsPanel`/`MDFPanel` (163, 167).
- **Controls that render editable and do nothing.** `apps/web/app/components/hands/HandStudy.vue:168-169`
  mounts `PotOddsPanel` and `MDFPanel` with no `update:*` handler, so on `/hands/[id]` and
  `/hands/paste` the pot, bet and to-call inputs and everything inside *Advanced: rake and implied
  odds* accept typing and change nothing. `components/train/PotOddsTrainer.vue:37-38` does the
  same, while its own comment (lines 6-8) says the panels "are editable, deliberately".
- **The Advanced setting that does not reach the graded number.** `Step4Nuts.vue:32-36` scores
  the step-4 prediction with `nutAdvantage()` called with no options, so changing the nut
  definition inside the panel's Advanced fold changes the panel and not the number the reader is
  marked against.
- `MDFPanel.vue` has no rake control of its own (19, 25); it reads the rake only when a sibling
  `PotOddsPanel` shares the ref (`lab.vue:163, 167`), and on `/hands/[id]` it has none.

**Would change:** `lab.vue`, `HandStudy.vue`, `PotOddsTrainer.vue`, `Step4Nuts.vue`;
`EquityCalculator.vue`, `ComboDistributionPanel.vue`, `RangeComparisonPanel.vue` only if the
count and the edges are meant to become adjustable.

### 2.2 No unexplained jargon — ⚠️ partial

The full audit is §3. In one paragraph: `packages/poker-ui/src/glossary.ts` holds 28 entries,
each one sentence plus a formula, behind `MetricLabel.vue` (hover, focus or tap; `cursor: help`);
`REQUIRED_TERMS` (line 52) lists the six the spec names and `test/glossary.test.ts:14-15` asserts
each is present. The test scans only `packages/poker-ui/src/components/*.vue` for a static
`term="…"` (lines 25-34) — it cannot see an app component, a bound `:term`, or a `title=`
attribute, which is how the rest of the app "explains" things. The registry's own descriptions
(65 stats, 80 dimensions, every one of them described) reach the screen as `title=` hovers
(`KpiTile.vue:38`, `StatGrid.vue:100`, `StatPicker.vue:67`, `ClauseRow.vue:44`,
`SituationBuilder.vue:97`) and as the click-through `DefinitionPanel.vue` — never as a
`MetricLabel`, never with a formula, and not at all in `LeakTable.vue:78`. Tiers, made-hand and
draw classes, positions, the node shorthand and "the field" have no definition anywhere.

### 2.3 Explain the number — ⚠️ partial

**Met.** `packages/poker-ui/src/explain.ts` holds five templates (`explainPotOdds` 15,
`explainMdf` 20, `explainEqr` 28, `explainRangeAdvantage` 41, `explainNutAdvantage` 53), rendered
by `PotOddsPanel.vue:86`, `MDFPanel.vue:68`, `EQRPanel.vue:63` and `RangeComparisonPanel.vue:88,
97`, each covered by a test (`test/metrics-panels.test.ts:33,62,83`, `test/charts.test.ts:81-88`).
A second template module, `prediction.ts:63-76` `explainPrediction`, is rendered by
`PredictionGate.vue:102` — the reveal sentence of every analyzer step and every trainer. Wherever
those panels are mounted (`/lab`, step 4, step 9, the replayer, the pot-odds and advantage
trainers) the line is met.

**Not met — key outputs with no sentence.**
- `EquityCalculator.vue:117-120`: the Lab's headline equity is two big numbers and a provenance
  label (125). Nothing under `apps/web/app` imports `explain.ts`.
- `EQRPanel.vue:57-60`: the pool EQR prints `num(poolEqr.eqr)` with "empirical, n = …" and no
  sentence, although `explainEqr` documents a `'pool'` source (`explain.ts:27`) that no caller
  ever passes.
- `PoolRealizationPanel.vue:54-63`: realized share, chips and EQR with muted labels; the
  paragraph at 72-76 explains the sampling caveat, not the number.
- `ComboDistributionPanel.vue:93` and `DistributionNode.vue`: counts and shares, no reading of
  them; `Step3Buckets.vue:46-55` puts two of these side by side and its own comment (2-4) says the
  answer "is the comparison", but no comparison sentence is rendered.
- `EquityBucketBars.vue`, `WinningsChart.vue:148` (tooltip values), `LeakTable.vue:82-91`,
  `SessionTable.vue:44-58`, `StatGrid.vue:128-140` (and so `/reports`, `/pool`, `/pool/players`,
  `/pool/cohorts`, `CohortGrids.vue`), `progress.vue:70-72,80-82`, `train/index.vue:83-91`,
  `CombosTrainer.vue:42-47`: bare. `StatGrid.vue:14-16` argues in its docstring that a sentence per
  cell is wrong for a grid, and that argument holds; the grid-level legend at 152-159 is the
  right place if a sentence is wanted.
- Sentences that exist only as a hover: `KpiTile.vue:24-29` builds one (description, notes,
  "Usually X–Y", the thin note) and binds it to `:title` at 38; `SessionTable.vue:54` and
  `StatGrid.vue:124` likewise.

**Hand-written where a template would do.** `pages/index.vue:64-72` (the EV-gap sentence),
`Step2Subtract.vue:101-103`, `Step6Decision.vue:71-74` (a duplicate of `explainRangeAdvantage`
without its verdict or the `EVEN_RANGE_MARGIN` rule — it could import the template),
`Step7Placement.vue:62-66`, `Step8ValueBluffs.vue:47-52, 71-74`, `Step9Deviation.vue:48-54`,
`DrawingTrainer.vue:91-98`, `EstimatedRangePanel.vue:44-51` (a local `verdict` computed),
`BlockerPanel.vue:87-104`, `EquityDistributionChart.vue:65-70`.

**Would change:** `explain.ts` (templates for equity, pool EQR, realization, the step-3
comparison, blockers), `EquityCalculator.vue`, `EQRPanel.vue`, `PoolRealizationPanel.vue`,
`Step3Buckets.vue`, `Step6Decision.vue`, `KpiTile.vue` (render the sentence it already builds).

### 2.4 Teaching empty states — ⚠️ partial

**Teaching (says what it is for and offers a way to start).**
`pages/progress.vue:57-65` ("Nothing to chart yet. Train for ten minutes…"),
`pages/train/index.vue:57-65`, `pages/train/[mode].vue:64-72` (unknown mode names the six),
`pages/analyze/index.vue:46-54` ("An analysis starts at a hand: open one from your hands…"),
`pages/ranges/index.vue:70-72` ("Import a folder of charts to start the library"),
`pages/ranges/import.vue:85-110` (the drop zone lists every accepted format),
`components/hero/LeakTable.vue:59-61` ("play more hands, or widen the dates"),
`components/hands/HandStudy.vue:160-163` ("Import your charts and they will show up here as you
step"), `HandStudy.vue:171`, `Step1Ranges.vue:65`, `Step3Buckets.vue:42-44, 57-59`,
`Step4Nuts.vue:45-47`, `ComboDrilldown.vue:46` ("Click a cell of the matrix to open its combos"),
`RangeComparisonPanel.vue:59`, `lab.vue:172, 195`.

**Plain (says "no X" and stops) or wrong.**
- `pages/ranges/compare.vue:138-140`: "No chart of yours / solver range stored at this situation."
  — no link to `/ranges/import` or to the editor; and the same text shows **while the lookup is
  still running** (`matches` is `undefined` until `useAsyncData` at line 30 resolves, and the
  `v-else` at 138 does not distinguish the two), so the page opens on a false empty state.
- `pages/hands/index.vue:79-81`: "Upload some on **your account**" links to `/account`, which
  has no upload control (`pages/account.vue:22-44`; upload is plan D.8). A pool list with no
  match says only "No hands match."
- `pages/pool/index.vue:206-213` and `ReportWorkbench.vue:244`: before *Run report* the grid is
  absent (`StatGrid.vue:82` is `v-if="result"`), so the area under the pickers is blank with
  nothing saying that a run is the next step. After a run with no rows: `StatGrid.vue:143-146`
  "No rows. Nothing in the database matches this situation." — no suggestion to widen it.
- `components/hero/SessionTable.vue:24-26` "No sittings in this range yet."; `pool/players.vue:112-114`
  "No name in the pool contains …"; `pool/cohorts.vue:166` "No cohorts."; `Step6Decision.vue:76`
  "Both seats need a range first."; `HandStudy.vue:175-177` "No stored range for X, so there is
  nothing to run the equity against yet." — all correct, none offers a next step.
- `HandStudy.vue:179-182` (`realized?.needs_rebuild`): "Empirical EQR needs `invested_bb` on
  `marts.decisions`; the mart gains it on the next chain rebuild (POKER_PLAN.md F.10)." —
  developer wording on a user screen, and stale: F.10's rebuild ran on 2026-09-11.
- "Try an example", the spec's own phrase (§13 line 498), occurs nowhere in `platform/web`.
- Not verified: the My game page on an account with **zero** hands (`pages/index.vue:95-100`
  renders whatever `kpiTiles()` returns; no signed-in browser pass was made — §8).

**Would change:** `compare.vue`, `hands/index.vue`, `pool/index.vue`, `ReportWorkbench.vue`,
`StatGrid.vue`, `HandStudy.vue`, plus wherever the Examples entry point lands (§6).

### 2.5 Sensible defaults everywhere — ✅ met

No page named `settings` exists and no nav entry offers one (`app.vue:6-18`); `grep -rli settings
apps/web/app` returns nothing. Every page loads on defaults: `lab.vue:12-13, 24, 35-36, 39`;
`compare.vue:18` (UTG open, or the `?range=` key); `pool/index.vue:82` and
`ReportWorkbench.vue:76-77` open the first preset; `ranges/import.vue:22-26` detects the importer
per file and versions on conflict; the trainers start on mount (`train/[mode].vue:42-44`). The
Worker is created with no options (`composables/useEquityService.ts:10-20`). The five public pages
(`lab`, `train`, `train/[mode]`, `progress`, `dev/components`) are correct with the API stopped.

### 2.6 Visible state — ⚠️ partial

**Met.**
- Exact vs Monte Carlo: `EquityCalculator.vue:55-59, 125` — "exact · N runouts" or "Monte Carlo ·
  N samples · ±x pp", with "· exact on the way" while the enumeration runs (125); the comparison
  panel receives `:exact` on `/lab` (157), in step 4 (`Step4Nuts.vue:55`) and in the advantage
  trainer (`AdvantageTrainer.vue:69`).
- Pool tier and sample: `PoolDataBadge.vue:40-46` prints `pool · tier N`, the tier's name, `n =`,
  or "insufficient data — N of the M needed"; mounted at `HandStudy.vue:153`, `compare.vue:120-128,
  136`, `Step6Decision.vue:97`, `Step9Deviation.vue:78`. Every grid cell carries `n`
  (`StatGrid.vue:129-131`); every KPI tile carries `n` and its interval (`MetricValue.vue:121-125`).
- Range source: `compare.vue:132` prints "name · vN · tool" under each stored matrix;
  `HandStudy.vue:157` "My chart here: <name>"; the four chart-based trainers print
  `CHART_PROVENANCE` (`AdvantageTrainer.vue:74`, `BlockersTrainer.vue:53`, `DrawingTrainer.vue:100`,
  `CombosTrainer.vue:49` — "A rule-of-thumb reference chart, not a solve — no solver was asked…");
  `Step7Placement.vue:62-66` ends "No solver was asked."; the analyzer's save state is worded
  (`analyze/[id].vue:42-47`, "saved in this browser only — the server did not answer").

**Not met.**
- **Step 1 never says which chart it loaded.** `Step1Ranges.vue:53-59` stores the chart's name in
  `assignment.label` (line 37, 58) but `SeatRange` is mounted with `:label="seat"` (72-78) and
  renders only that (`SeatRange.vue:46`); the stored label is read nowhere. After *Load my chart
  for this spot* the matrix fills and nothing on screen names the source or its version.
- **The equity trainer omits the provenance line.** Its ranges are reference charts
  (`train/spot-equity.ts:27-29` picks from `CHARTS`) but `EquityTrainer.vue` never renders
  `CHART_PROVENANCE`, unlike the four trainers above.
- **The realization block carries no tier.** `HandStudy.vue:183-201` shows `EQRPanel`'s pool slot
  ("empirical, n = N", `EQRPanel.vue:59`) and `PoolRealizationPanel` (n and coverage) with no
  `PoolDataBadge`, so the reader is not told this is a measured tier-1 figure rather than an
  estimate.
- The Blockers section of `/lab` splits villain's range into calls and folds by equity
  (`lab.vue:78-85`) without saying whether the split came from the Monte Carlo or the exact pass;
  the label lives in the Equity section higher up the page.

**Would change:** `Step1Ranges.vue` / `SeatRange.vue`, `EquityTrainer.vue`, `HandStudy.vue`.

### 2.7 Undo/redo — ⚠️ partial

`packages/poker-ui/src/composables/useUndoRedo.ts:57-66` binds Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z and
Ctrl+Y and is tested (`test/useUndoRedo.test.ts:40-52`); it binds nothing itself — each consumer
must call `onKeydown`.

| Surface | State | Evidence |
|---|---|---|
| `/lab` | ✅ | `lab.vue:21-22` two histories, `93-100` window-level keydown that skips inputs, every edit through `setHero`/`setVillain` (68-76), buttons with `title="⌘Z"`/`"⌘⇧Z"` (116-117). Undo applies to whichever side was last edited (23, 96) |
| `/train/drawing` | ⚠️ | `DrawingTrainer.vue:25` history; `42` keydown bound on the wrapper `<div>` only, so ⌘Z works only while focus is inside it (and `RangeMatrix.vue:121` prevents the cell taking focus on pointerdown); an Undo button (63-71) but **no Redo** and no hint |
| `/ranges/[id]` | ❌ | `pages/ranges/[id].vue:84-86` `setRange` overwrites a plain ref; no `useUndoRedo` import (7), no keydown, no buttons. Only the server-side version revert (63-72) exists |
| analyzer step 1 | ❌ | `SeatRange.vue:38-40` → `Step1Ranges.vue:34-39` → `store.patchStep`; every stroke is autosaved (ADR-034) with no way back but repainting |
| `/dev/components` | ❌ | `dev/components.vue:60, 70, 91` edit a plain ref — dev only |

**Would change:** `ranges/[id].vue`, `SeatRange.vue` (or `stores/analysis.ts` if undo should
span the step), `DrawingTrainer.vue`.

### 2.8 Keyboard shortcuts, discoverable — ❌ missing (operability mostly met)

**Operable.** `RangeMatrix.vue:132-150` arrows move a roving tabindex (173) and Enter/Space
toggle a cell (tested `test/RangeMatrix.test.ts:44-49`); `StepperNav.vue:35-42` ←/→ and digits 1–9
(tested `test/analyzer.test.ts:103-105`); `HandReplayer.vue:70-81` ←/→/Space/1–4 on `window`,
typing targets excluded (tested `test/replayer.test.ts:90-95`); `PredictionGate.vue:92` Enter
commits; `RangeTextIO.vue:64` ⌘↵/Ctrl↵ applies; `CardPicker.vue:31-41` and `BoardSelector.vue`
are native buttons and radios (Tab + Enter/Space, no arrow navigation — 52 tab stops per picker).

**Not met.**
- **No `?` overlay, no shortcut listing, no help entry.** `app.vue` (the only layout) has no
  keydown listener and no help link (script 1-31, template 33-54); no component named *Help*,
  *Shortcut* or *Overlay* exists in either package. The complete set of on-screen hints is
  `lab.vue:116-117` (two `title`s), `RangeTextIO.vue:66` "Apply (⌘↵)", and `HandReplayer.vue:110`
  `<kbd>{{ i + 1 }}</kbd>` on the street buttons. The bindings an overlay would list: ⌘Z/⌘⇧Z/Ctrl+Y;
  arrows + Enter/Space on the matrix; ⌘↵ apply; ←/→/1–9 on the stepper; ←/→/Space/1–4 on the
  replayer; Enter to commit.
- **A matrix cell cannot be clicked from the keyboard.** `RangeMatrix.vue:118-119` emits
  `cellClick` only from `onPointerDown`; the keyboard branch (145-149) never does. So the Lab's
  drilldown selection (`lab.vue:125, 130`) and the compare page's ring (`compare.vue:119, 131`)
  are mouse-only, and in `view` mode the keyboard does nothing at all.
- `StepperNav`'s keys fire only while a step button has focus (no tabindex on the nav, no
  page-level binding in `analyze/[id].vue`).

**Would change:** `app.vue` plus a new overlay component; `RangeMatrix.vue` (emit `cellClick`
from the Enter/Space branch and in view mode); `analyze/[id].vue` for a page-level binding.

### 2.9 No modal traps — ✅ met

The one modal is `components/reports/SaveReportDialog.vue`: a native `<dialog>` opened with
`showModal()` (49), which gives Esc-to-close and focus trapping for free; `@close` at 79 tells the
parent. The report being saved is kept; only the typed name is reset to the suggestion on reopen
(46). The two other interruptions are native `window.confirm` calls before a delete
(`ranges/[id].vue:75`, `pool/cohorts.vue:119`). The cohort form (`CohortForm.vue`), the situation
builder, the definition panel and every disclosure are inline.

### 2.10 First-run tour and Examples — ❌ missing

Verified absent, definitively: `grep -rli 'tour\|onboard\|help\|example\|welcome\|getting
started\|first.\?run' apps/web/app` hits only test e-mail addresses, code comments and
`cursor: help` in `MetricLabel.vue:36`. No `localStorage` "seen" flag exists (the only hit is a
comment in `auth/session.ts:3` saying the token is *not* there). `app.vue`'s nav (6-18) has eleven
content links plus account/sign-in and nothing else. `analyze/index.vue:13` lists `api.list()`
— the signed-in user's own rows. §6 inventories what exists to build from.

### 2.11 Fast feedback — ⚠️ partial

**Met.** `EquityCalculator.vue:121-127`: "Computing…", a `<progress>` bar fed by the engine's
callback (68-69), and "exact on the way" during refinement; the flop enumeration is ~180 ms
(F.2's benchmark) and the bar covers it. My game names each wait (`pages/index.vue:101, 116, 129,
136` — "Measuring you against the field…", "Drawing the curve…"); `leaks.vue:60`; the run buttons
say "Running…" (`pool/index.vue:147`, `ReportWorkbench.vue:189`), "Looking…"
(`pool/players.vue:103`), "Counting…" (`pool/cohorts.vue:201`), "Signing in…"/"Creating…"
(`login.vue:47`, `register.vue:59`), "Reading…" (`hands/paste.vue:58`), "Building your first
spot…" (`train/[mode].vue:81`); the gate says "Working out what actually happens here…"
(`PredictionGate.vue:104`); the analyzer reports `saving…`/`saved`/offline (`analyze/[id].vue:42-47`);
the grid says whether a result is `from cache` or `fresh` (`StatGrid.vue:87`).

**Not met.**
- A bare "Loading…" with no *what*: `account.vue:26`, `ranges/[id].vue:147`, `hands/index.vue:78`,
  `hands/[id].vue:41`, `analyze/[id].vue:178`.
- **No indicator at all** while: the replayer rebinds its panels on every step
  (`HandStudy.vue:34-42` awaits the library lookup and two pool calls; the panels simply appear);
  the compare page looks up the three columns and the pool (`compare.vue:30, 34`; the columns show
  the "No chart…" empty text meanwhile — §2.4) and runs the tier-3 estimate (59-65; the section
  appears when done); `ranges/import.vue:35-40` reads a folder; `Step1Ranges.vue:53-59` looks up
  a chart (the button gives no feedback, and nothing happens when there is none);
  `ranges/import.vue:151-153`'s commit button is disabled while busy but keeps its label.
- Report runs on the pool take up to ~1.6 s (phase C's measurement) behind a button label only —
  acceptable, but the spec's "with what's happening" is the label "Running…".

**Would change:** `HandStudy.vue`, `compare.vue`, `ranges/import.vue`, `Step1Ranges.vue`, the
five pages with "Loading…".

### 2.12 Dark mode, readable at laptop width — ⚠️ partial

**Dark — met.** `apps/web/nuxt.config.ts:28` sets `<meta name="color-scheme" content="light dark">`,
`app/assets/css/main.css:5` `color-scheme: light dark`, `packages/poker-ui/src/theme.css:33-55`
redefines every token under `prefers-color-scheme: dark`, and every Tailwind class in the app
carries its `dark:` variant (a grep for `bg-white`/`text-black` without `dark:` finds nothing;
`bg-white` appears only on the sign-in and registration inputs and the dialog, each with a `dark:`
pair). There is no
in-app toggle; the app follows the OS. Verified: the headless Chrome on this machine rendered
`/lab` dark (screenshot in the lane's scratchpad).

**Laptop width — not verified in a browser, and two known risks.**
- `app.vue:36`: `<nav class="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">` with eleven
  links and no `flex-wrap` or `overflow-x-auto` — [POKER_STATUS.md](POKER_STATUS.md) (D.4's notes)
  records it overflowing below about 1000 px and hands it to F.12.
- `compare.vue:112`: `md:grid-cols-3` puts three 13×13 matrices side by side from 768 px, each
  about 230 px wide at that breakpoint — 17 px cells with `clamp(8px, 1.1vw, 12px)` labels
  (`RangeMatrix.vue:208`). The Lab (`lg:grid-cols-2`, `lab.vue:122`), the replayer (collapses at
  60 rem, `HandReplayer.vue:133-137`), the table (container query at 34 rem, `PokerTable.vue:272`)
  and every wide table (`overflow-x-auto` wrappers) degrade sensibly.

**Would change:** `app.vue`, `compare.vue`; then a measured pass at ~700 px (§7).

### 2.13 Errors are actionable — ⚠️ partial

**Met.**
- The spec's own example is implemented: `packages/poker-core/src/formats/errors.ts:14-15` —
  ``Couldn't parse range at entry N: `X` reason. Did you mean Y?`` — surfaced by
  `RangeTextIO.vue:36-38, 71`.
- Sign-in: `auth/api.ts:85-100` maps 401/403/409/422/429 to sentences; "The API did not answer.
  Start it with `make api` in platform/ and try again." when nothing answered (93);
  `register.vue:54-57` adds *Sign in instead* on a 409.
- `hands/paste.vue:27` a screen-specific silent-API sentence; `hands/searchable.ts:41-46` a
  sentence naming the offending chip and what to remove; `filter/label.ts:76-92` a problem per
  clause; `FilterBar.vue:28-34` the grain note; `ReportWorkbench.vue:93` a missing saved report;
  `SaveReportDialog.vue:109-112` the taken name with the way round; `ranges/import.vue` per-row
  `row.error` and a report; `pool/rules.ts:110-113` joins the server's validation messages;
  `ranges/index.vue:32` the backup's need for the API.

**Not met.**
- **The generic fallback.** `auth/api.ts:106-111` `describeApiError` prints the server's `detail`
  verbatim, else "The API answered with status N." A 400 from the report compiler therefore reads
  "dimension 'saw_flop' is not available for …" (which D.7 called "true and useless"), and a 500
  reads a bare status with no next step. Every page's `role="alert"` goes through it.
- **A raw message.** `account.vue:27` prints `Could not load the account: {{ error.message }}` —
  the fetch library's own text. `EquityCalculator.vue:75, 124` prints the Worker's raw `e.message`.
- **Failures that read as "no data".** `.catch(() => null)` or `=> []` sites where a stopped API
  or a 500 leaves a panel silently empty or, worse, wrongly worded:
  `HandStudy.vue:58, 61` (pool frequencies and realization — the block disappears);
  `compare.vue:34` (a failed showdown-range call renders "Insufficient data: the pool has not shown
  down enough hands" at 135, which is false); `compare.vue:26` (an unknown `?range=` id is
  swallowed and the page opens on UTG); `pool/estimate.ts:93` (tier 3 absent);
  `analyze/[id].vue:107, 118, 120` (the hand and the pool); `Step1Ranges.vue:56` (the load button
  does nothing); `ranges/[id].vue:17` (history empty); `pool/index.vue:92` and
  `pool/cohorts.vue:57` (saved cohorts vanish from the picker). The local caches
  (`progress.vue:27`, `train/index.vue:19, 23`) are fine to swallow.
- **No handler at all.** `analyze/index.vue:21-24` `remove()` and `ReportWorkbench.vue:155-160`
  `remove()` have no `catch`; a failed delete is an unhandled rejection with nothing on screen.
- `HandStudy.vue:179-182` (see §2.4): developer text on a user screen.

**Would change:** `auth/api.ts` (a second-level fallback with a next step), `account.vue`,
`EquityCalculator.vue`, `HandStudy.vue`, `compare.vue`, `analyze/index.vue`, `ReportWorkbench.vue`,
`Step1Ranges.vue`, `pool/index.vue`, `pool/cohorts.vue`.

---

## 3. Glossary coverage audit

### 3.1 What exists

- `packages/poker-ui/src/glossary.ts`: **28 entries** (lines 17-44): potOdds, requiredEquity, mdf,
  alpha, bluffBreakeven, bluffsPerValue, impliedOdds, rake, equity, ev, eqr, rangeAdvantage,
  meanEquity, medianEquity, equityBuckets, equityDistribution, nutAdvantage, nutThreshold, nutShare,
  defendingSet, blockerScore, valueScore, reconstructedRange, likelihoodRatio, poolRealization,
  exact, monteCarlo, confidenceInterval. `REQUIRED_TERMS` (52) = the six the spec names; all present.
- `MetricLabel.vue`: a dotted-underlined term with a tooltip on hover, focus or tap (24-25),
  `term` typed `GlossaryKey` so an unknown term does not compile. Used by ten `poker-ui` components
  (`PotOddsPanel`, `MDFPanel`, `EQRPanel`, `RangeComparisonPanel`, `EquityDistributionChart`,
  `BlockerPanel`, `EstimatedRangePanel`, `PoolRealizationPanel`, `MetricValue`) and by no app
  component except the fixture page.
- `test/glossary.test.ts:25-34` scans `poker-ui/src/components/*.vue` for static `term="…"`.
  It cannot see `apps/web`, a bound `:term`, or a `title=` — so the app side has no guard.
- **The second vocabulary:** the stat registry. All 65 stats and all 80 dimensions carry a
  one-sentence `description` (`stats/registry/stats/*.yaml`, `dimensions.yaml`), served by
  `/v1/definitions`. On screen it appears as a `title=` hover (`KpiTile.vue:38` with notes and the
  typical band; `StatGrid.vue:100` "… — what it counts"; `StatPicker.vue:67`; `ClauseRow.vue:44`;
  `SituationBuilder.vue:97`) and as `DefinitionPanel.vue` on click from a grid header or picker
  (the situation and action decompiled from the registry's own AST, `reports/describe.ts`). No
  formula, no `MetricLabel`, no tap on a touch device.

### 3.2 Terms on screen with no entry anywhere

Grouped by where the definition would have to come from. Each is rendered as plain text at the
location given.

**Pool tiers and sampling (would be glossary entries):**
- "pool · tier 1/2/3", "observed frequencies", "showdown range", "reconstructed range",
  "insufficient data", "n = …" — `PoolDataBadge.vue:25-29, 41-45`. `reconstructedRange` exists but
  the badge does not use it; tiers 1 and 2 have no entry.
- "shown down", "% of the decisions here were shown down", "turned over", `covers` —
  `PoolDataBadge.vue:35`, `PoolRealizationPanel.vue:73`.
- "observed (tier 1)", "gap", "moves" (the last has `likelihoodRatio`) — `EstimatedRangePanel.vue:62,
  66, 91`.
- "n" on every cell and tile, "thin" — `StatGrid.vue:130`, `KpiTile.vue:40`, `MetricValue.vue:124`;
  the grid legend (`StatGrid.vue:152-159`) explains dimming in prose, the tile's "thin" only in a
  `title`.
- "the field", "population", "cohort", "regs", "fish" — the baseline name on every comparison
  (`KpiTile.vue:57`, `LeakTable.vue:69`, `StatGrid.vue:137`); `pool/cohorts.vue:148-151` defines a
  cohort in prose; nothing says which hands "the field" is.

**Metric words with an entry, rendered plain instead of through `MetricLabel`:**
- "exact · N runouts" / "Monte Carlo · N samples" — `EquityCalculator.vue:57-58, 125`
  (`exact`, `monteCarlo` exist).
- "after rake" — `MDFPanel.vue:60, 65` (`rake` exists; used only in `PotOddsPanel`).
- "Mean equity … range advantage" — `Step6Decision.vue:72-73`; "bluffs per value combo" —
  `Step8ValueBluffs.vue:71`; "MDF" / "Theory folds" — `Step9Deviation.vue:52-53` (the panels beside
  carry the labels; the sentences do not).
- "EQR" as a table header — `PoolRealizationPanel.vue:85`; "Δ" — `RangeComparisonPanel.vue:70`.

**The classifier's vocabulary (no entry; would be a table, not sentences):**
- Made-hand and draw class names ("top pair", "overpair", "flush draw", "gutshot", …) —
  `DistributionNode.vue:26-32`, `ComboDrilldown.vue:63`, `Step7Placement.vue:62-66` ("made-hand
  class", "semi-bluff", "value").
- "Category" (the strategic axis: value / bluff-catcher / bluff), "Structure", "bluff-catcher ≥
  35 %" — `ComboDistributionPanel.vue:27, 53`.
- "weighted" / "combos (weighted)" / "weight 75 %" — `CardRemovalPanel.vue:46-51`,
  `DistributionNode.vue:26-27`, `RangeDiffView.vue:71`, `SeatRange.vue:47`, `RangeMatrix.vue:156`.

**Table vocabulary (positions, nodes, filter values):**
- Position abbreviations UTG, UTG1, UTG2, MP, MP1, HJ, CO, BTN, SB, BB — `NodeKeyEditor.vue:69-77`,
  `PositionPicker.vue`, `hands/index.vue:99`, every `nodeKeyLabel`. No legend anywhere.
- The node shorthand ("BB call vs CO 2.5bb · 40bb · NL10", "UTG RFI") —
  `poker-core/src/node.ts` `nodeKeyLabel`, shown at `HandStudy.vue:140`, `compare.vue:107`,
  `ranges/index.vue:89`, `analyze/index.vue:39`, `Step1Ranges.vue:64`.
- Registry enum values shown as codes: `pot_type` (srp, 3bet, limped, 5bet+), `facing` (none,
  limp, bet, raise, 3bet…), `hand_shape`, flop texture values — `ClauseValue.vue:72, 76`,
  `FilterBar.vue:59, 63` via `filter/label.ts:35-38` (only `_plus` → `+`); action lines are worded
  by `lineWords`. `DefinitionPanel` explains a dimension only when asked from a picker.

**Registry stats rendered with no description at all:**
- `LeakTable.vue:78` prints the stat label (fold to c-bet, 3-bet %, WTSD, …) with no `title`, no
  click-through and no `MetricLabel`; the same table's headers "you / the field / gap / spots"
  (67-72) and "usually X–Y %" (80) are plain.
- `SessionTable.vue:33-39` "bb", "EV bb", "bb/100"; `pages/index.vue:68-71, 110-112` "all-in EV",
  "all-in adjusted", "break-even"; `WinningsChart` series names (actual, EV, showdown,
  non-showdown). Note the mismatch: the glossary's `ev` (line 26) is a solver EV
  ("equity × EQR × pot") while the dashboard's EV is the all-in adjusted result
  (`ev_bb_per_100`'s description) — two meanings under one word.
- `FilterBar.vue:32` "hand-grain stats (VPIP, PFR…)"; `CohortForm.vue:106-108` stat labels in a
  `<select>`.

### 3.3 The gap in one sentence, and the decision it needs

The six terms the spec names are covered and tested; the metric panels are consistent; **the
app-side vocabulary (stats, dimensions, tiers, classes, positions, nodes) has one-line
descriptions in the registry that reach the screen only as `title=` hovers or on a click, and
some surfaces (`LeakTable`, the dashboard prose, the badge, the filter's enum values) not at all.**
The session has to decide the rule for the two vocabularies before adding entries — whether the
registry's descriptions are surfaced through the same `MetricLabel` affordance (a `term`/`entry`
prop rather than a `GlossaryKey`), whether tiers/classes/positions become glossary entries or a
reference table, and whether `ev` is split into two terms. Whatever the rule, the test in
`glossary.test.ts` should be extended to the app components, because today nothing fails when a
page prints a bare term.

---

## 4. The three known issues, confirmed and mapped

### 4.1 `facing_size_pct` / `size_pct` — "(% of pot)" but stored as a fraction — confirmed

**Where it is.** `platform/stats/registry/dimensions.yaml:369-374` and `552-557`: labels *Bet
faced (% of pot)* and *Bet size (% of pot)*; buckets `small [0, 0.37] · mid [0.37, 0.60] · large
[0.60, 0.85] · pot [0.85, 1.10] · overbet [1.10, ∞)`; descriptions say "as a fraction of the pot".
The value is a fraction end to end (`poker-core/src/hand/node.ts:55` computes
`amount / potBefore`; the buckets prove the mart's scale).

**Who shows the label or the raw number.**
- `components/filter/ClauseRow.vue:44` (label, description as `title`); `ClauseValue.vue:89-91,
  96` — the `between` and scalar branches are `type="number"` inputs, so the reader types **0.75**
  under a label that says percent; the `bucket` branch (54-55) offers the bucket *names* and is
  unaffected.
- `FilterBar.vue:59, 63` chips and sentence via `filter/label.ts:49-58` → "Bet size (% of pot)
  ≥ 0.75"; `SituationBuilder.vue:97`; `GroupByPicker`/`StatGrid.vue:93` as a group column header
  over bucket-name rows (fine); `DefinitionPanel` title; `reports/describe.ts:117-118` the bucket
  line; the two presets grouping by it (`analysis/hero/presets.yaml:81`, `analysis/pool/presets.yaml:31`)
  render bucket names (fine). No stat's situation uses either dimension, so the leak drill-through
  never carries a raw value.

**Everything else already shows percent**, which is why the pair "reads badly": `NodeKeyEditor.vue:106`
(`Math.round(size_pct * 100)` in, `/ PERCENT` out, placeholder "% pot"), `Step6Decision.vue:86-87`
("% of pot", × 100 in, ÷ 100 out), `PoolRealizationPanel.vue:54`, `nodeKeyLabel`
(`node.ts:190`). The mismatch is confined to the registry label and the filter's number input.

**The two options STATUS recorded, with their files.**
- *Relabel the registry entries* (e.g. "…(fraction of pot)" or "(× pot)"): `dimensions.yaml` only.
  The label is served at runtime by `/v1/definitions`; `scripts/gen_stats.py:46, 86` writes only
  **stat** labels into `seeds/stat_definitions.csv`, so `make gen-check` is unaffected — run it
  anyway, and grep the Python and TypeScript tests for the label string first.
- *A percent control in the filter*: `ClauseValue.vue` picks its control from the dimension's
  `type` and vocabulary and refuses to key on a code (its docstring, 2-10), so this needs the
  registry to say "fraction shown as percent": a field on the dimension model
  (`stats/definitions.py` + `checks.py`), through `/v1/definitions`, `apps/web/app/stats/api.ts`'s
  `Dimension` type, then a branch in `ClauseValue.vue` and the wording in `filter/label.ts`. The
  typed number and the number sent still agree, which STATUS says must hold.

### 4.2 `HandStudy` links to `/ranges/compare?hero=…&street=…` — confirmed

- The link: `apps/web/app/components/hands/HandStudy.vue:141`.
- The page reads only `?range=` — `pages/ranges/compare.vue:24-28` — and otherwise opens on
  `nodeKey('UTG', { action_sequence: [step('UTG', 'raise')] })` (18). Both parameters are dropped.
- The other links in: `pages/ranges/[id].vue:98` `?range=${id}` (works — the stored range's
  `node_key` becomes the situation); `pages/pool/index.vue:139` no query (default; fine).
- **Two parameters cannot name a node anyway.** A `NodeKey` is hero, villain, street, the action
  sequence, stack, table size, stake and texture (`poker-core/src/node.ts`); `hero` + `street`
  alone would not identify the situation the replayer was on even if read. There is no convention
  for a situation in a URL today: `useFilterUrl` encodes filter *clauses* (`?f=`), analyses store
  `node_key` server-side, and `canonicalNodeKey` (`node.ts`, used for identity at
  `HandStudy.vue:55`) is canonical JSON, not a URL form. What the page already has:
  `NodeKeyEditor v-model="key"` (102), `store.lookup(key)` (30) for any key, and
  `poolApi.showdownRange(key)`.
- Adjacent: `compare.vue:26` swallows an unknown `?range=` id (`.catch(() => null)`) and opens on
  the default without saying so.

**Would change:** `HandStudy.vue:141` (send the whole key, or nothing) and `compare.vue:24-28`
(accept it), in one convention.

### 4.3 `2,5` in the number inputs — confirmed, and wider than `PotOddsPanel`

- **Mechanism, verified on this machine.** The system locale is `ru_RU` (`defaults read -g
  AppleLocale`). Chrome renders `<input type="number">` values in the browser's UI locale, so a
  bound `2.5` displays as `2,5`. The document already carries `htmlAttrs: { lang: 'en' }`
  (`apps/web/nuxt.config.ts:27`), and the headless Chrome screenshot of `/lab` taken for this
  audit shows the custom-brush input (`lab.vue:115`) as **`0,6`** under that attribute — so the
  `lang` route does not work in Chrome. Every *output* number is written with a dot (`toFixed`,
  `toLocaleString('en-US')` at `MetricValue.vue:75`, `PoolDataBadge.vue:33`, `reports/cell.ts`),
  so only the inputs disagree with the page.
- **Input is not verified to be affected.** A number input's DOM `value` is normalised to the dot
  form whatever the display, so `Number(value)` (`PotOddsPanel.vue:65-67`, `NodeKeyEditor.vue:18-23`)
  should be unaffected; the session should type both `2,5` and `2.5` and check.
- **Extent: 28 numeric inputs** (26 static `type="number"`, plus `ClauseValue.vue:96` and
  `PredictionGate.vue:87` bound by `:type`). The **17** that carry fractions in normal use:
  `PotOddsPanel.vue:80-82, 113-115` (pot, bet, to call, rake %, cap, extra); `MDFPanel.vue:51-52`;
  `EQRPanel.vue:51` (solver EV); `NodeKeyEditor.vue:105` (raise-to in bb, 2.5 is the common
  case; 106 is rounded and safe); `ComboDrilldown.vue:59` (a weight 0–1, always fractional);
  `lab.vue:115` (custom brush, seen); `ClauseValue.vue:89, 91, 96` (any number — SPR 3.5, effective
  stack 87.5); `CohortForm.vue:121-129` (VPIP 25.5; it already adds `inputmode="decimal"`, a
  mobile-keyboard hint that does not change formatting); `PredictionGate.vue:85-93` (a 45.5 %
  answer). Integer by usage: `lab.vue:186-189`, `NodeKeyEditor.vue:85, 88`,
  `RangeComparisonPanel.vue:101-102`, `Step6Decision.vue:81, 86`.
- **Patterns in the repo.** No `type="text" inputmode="decimal"` input exists anywhere; the two
  poker-ui helpers `number(event)` centralise parsing for `PotOddsPanel` and `NodeKeyEditor` only.
- The evidence rules out `lang` on the element for Chrome (it honours only the UI locale; Firefox
  honours `lang`). The remaining options are a text input with `inputmode="decimal"` and a parser
  that accepts both separators, or accepting the display and saying so in the glossary — the
  session's call.

---

## 5. Acceptance 12 and 13

### 5.1 Acceptance 12 — import `EquityCalculator` and `RangeMatrix` elsewhere — ⚠️ partial

**Met.** `packages/poker-ui/package.json` names `@poker/ui`, exports `./src/index.ts` and
`./theme.css`, depends on `@poker/core` only, peers on `vue ^3.5`; `src/index.ts:7, 12` export both
components, so `import { EquityCalculator, RangeMatrix } from '@poker/ui'` is one import — which is
exactly what `apps/web/app/pages/lab.vue:7` and `dev/components.vue:5` do. Neither component
imports Tailwind, Nuxt auto-imports or anything under `apps/`; ESLint forbids `poker-ui` importing
`@poker/workers`, `@poker/importers` or `apps/**` (`eslint.config.js:41-55`); styles are scoped with
`var(--pk-*, fallback)` so `theme.css` is optional (its own header says so). A README exists with
one combined import snippet (8-11), a props table (13-35) and a pointer to `/dev/components`.

**Not met.**
- **The `service` prop is required** (`EquityCalculator.vue:21`) and the only thing that
  satisfies it in a browser is app-specific: `apps/web/app/composables/useEquityService.ts:10-20`
  creates the Worker, wraps the Comlink client, wraps `onProgress` in `proxy()` and terminates on
  unmount. `@poker/workers` exports `EquityService` (in-process), `createEquityWorker`,
  `createEquityClient`, `startEquityJob` — but no object satisfying `EquityServiceLike`. A sibling
  app copies those lines or runs in-process.
- **Bundler settings live only in `apps/web`:** `nuxt.config.ts:22-25` (`optimizeDeps.exclude`
  for the four packages, `worker.format: 'es'`), needed because the packages are consumed as
  TypeScript/`.vue` source and the Worker is `new Worker(new URL(...), { type: 'module' })`
  (`poker-workers/src/client.ts:22`).
- **No per-component usage example** in `README.md` (spec §12: "each with a usage example in the
  package README and a demo page"); the table omits `RangeMatrix`'s `heatmapSigned` and eleven
  of the 32 exports.
- **Nothing outside `apps/web` mounts them through the package entry.** `apps/` contains only
  `web`; `packages/poker-ui/test/*.test.ts` import `../src/components/*.vue` directly.

**What a tick needs, as facts:** an importer that is not `apps/web` — a second workspace app or
a bare `mount()` test importing from `'@poker/ui'` — an `EquityServiceLike` obtainable from a
package (or documented as three lines), and the README example.

### 5.2 Acceptance 13 — `npm run license-check` clean — ✅ met

Run read-only by the audit's agent on 2026-09-14 (Node 23.11, `node_modules` present): exit 0;
MIT 607 · ISC 93 · Apache-2.0 45 · BSD-2 19 · BlueOak-1.0.0 15 · BSD-3 11 · CC0 4 · MPL-2.0 4 ·
four dual/compound expressions, over 805 non-private packages; no GPL/AGPL/LGPL/SSPL/BUSL anywhere.
The four MPL-2.0 hits are the `lightningcss` prebuilt binaries `LICENSES.md:23` flags; `node-forge`
(BSD-3 or GPL-2, used under BSD-3), `spdx-ranges`, `spdx-exceptions` and `caniuse-lite` are each
still present and still justified in `LICENSES.md`. No dependency has changed since the file was
last committed (`951107a`).

**Residuals, documentation-level:**
- `platform/web/package.json:20` puts `MPL-2.0` in `--onlyAllow` unconditionally, so a *new*
  MPL package would pass silently; ADR-027 and spec §3.1 say "only unmodified and flagged", which
  only `LICENSES.md`'s process note enforces.
- `LICENSES.md:23` says `lightningcss` arrives via "vitest → vite (dev only)"; a second copy
  (1.32.0) sits under `node_modules/@tailwindcss/node/`, i.e. also via `tailwindcss`.
- ADR-027's allowlist omits `BlueOak-1.0.0` and `Python-2.0`, which `package.json:20` and
  `LICENSES.md:12-13` include.

---

## 6. First-run tour and Examples — what exists to build from

Facts only; where they live is the session's decision (and the one place an ADR would be earned).

- **Entry points.** `app.vue:6-18` the nav array, `41-47` the right-hand span (account / sign in).
  `pages/analyze/index.vue` is the analyses list and lists `api.list()` — the signed-in user's
  own rows only. The middleware (`middleware/auth.global.ts:10`) sends everything but the public
  pages to `/login`; an Examples section under `/analyze` is behind sign-in as the code stands,
  while `/lab`, `/train`, `/train/[mode]`, `/progress` and `/dev/components` are public.
- **Per-step guidance already written as data.** `analyze/steps.ts:29-129`: nine `StepDef`s with
  `title`, `purpose` ("one line under the title"), `question` and `hint` ("never a hint at the
  answer"), rendered by `StepShell.vue:59-60` and `PredictionGate.vue:75`; `train/modes.ts` the
  six modes' `title`, `purpose`, `blurb`. A tour would reuse these strings; nothing else is
  tour-shaped.
- **The analyses API.** `POST /v1/analyses` (`platform/api/schemas_analyses.py:124-151`) accepts
  `source: 'stored'` + `hand_uid`, `'pasted'` + `hand_text`, or `'manual'` + `node_key` — so an
  analysis can exist with **no stored hand**. `create_analysis` (`api/analysis_store.py:49-65`)
  always opens at step 1 with empty steps; a *pre-filled* example needs a second `PUT` with
  `steps` (merge by step number, ADR-034). Rows are strictly per user; there is no shared or
  global analysis. **A `pasted` analysis reopens with `hand === null`**: `pages/analyze/[id].vue:104-109`
  fetches by `hand_uid` only and never re-parses `hand_text`, so an example built from pasted
  text would have no replayer context until that is changed.
- **Hands.** The committed seed corpus is four files / nine hands under `platform/seeds/hands/`
  (`ggpoker/observed_nl25.txt`, `ggpoker/rush_nl50.txt`, `pokerstars/cash_6max_nl50.txt`,
  `pokerstars/edge_cases.txt`); `scripts/seed.py:40-44` loads eight of them **into the test
  databases only** (`make seed` runs under `TEST_ENV`), for `demo@example.com`. Per `CLAUDE.md`,
  only real hands go into the real `core.*`/`marts.*`, so an example hand cannot be a stored hand
  in the founder's tenant unless it is one of the founder's own. The only `ReplayHand` fixture in
  the JavaScript workspace is `GG_HAND` in `packages/poker-core/test/fixtures/hand.ts:24-57`
  (the first hand of `rush_nl50.txt`, hero SB QhQs 3-bets BTN), which `dev/components.vue:8`
  reaches by a relative import into a *test* directory; `hands/paste.vue:54`'s placeholder shows
  its first two lines but nothing loads it.
- **Ranges and spots.** Eight reference charts in `train/charts.ts:18-67` (UTG/HJ/CO/BTN/SB RFI,
  BB call vs BTN, BTN 3-bet vs CO, BB 3-bet vs BTN) with `CHART_PROVENANCE` (79-80), consumed by
  the trainers only and reachable from neither `/ranges` nor `/lab`; 35 equity spots with expected
  equities in `packages/poker-core/fixtures/equity_spots.json`; importer fixtures
  `packages/poker-importers/test/fixtures/{UTG_RFI_100bb.txt,library.json}`; the shared `NodeKey`
  fixture `platform/tests/fixtures/nodes.json`. `lab.vue:12-13, 24, 35-36` opens on one
  hard-coded, unlabelled spot.
- **Already "pre-loaded" things, which are reports, not analyses:** the hero and pool presets
  (`analysis/hero/presets.yaml`, `analysis/pool/presets.yaml`), surfaced as buttons on `/pool`
  (`pool/index.vue:156-169`) and in `PresetMenu.vue`.
- **Backlog cross-reference.** [POKER_FEATURES.md](POKER_FEATURES.md) lines 175-176 call the
  first upload "*the* onboarding moment" — a D.8 concern, not this one.

---

## 7. An order the evidence suggests

Sizes are rough (S = under an hour, M = a few hours, L = a session). Not a design; each line
points at the section with the files.

1. **S — the mechanical fixes with known files:** the three known issues (§4); step 1 naming the
   loaded chart (§2.6); the equity trainer's provenance line (§2.6); `MDFPanel`'s "after rake"
   and `EquityCalculator`'s exact/MC label through `MetricLabel` (§3.2); the stale developer text
   in `HandStudy.vue:179-182` (§2.4); `account.vue`'s raw message and the two delete handlers
   with no `catch` (§2.13); the five "Loading…" sentences (§2.11); the inert panels on the
   replayer and the pot-odds trainer, bound or made read-only (§2.1); step 4's nut definition
   reaching the graded number (§2.1); the compare page's false empty state and its "insufficient
   data" on a failed call (§2.4, §2.13); the header overflow (§2.12).
2. **M — the glossary rule, then the entries (§3.3):** decide how the registry descriptions are
   surfaced and whether tiers/classes/positions are entries or a table; add the entries; extend
   `glossary.test.ts` to `apps/web`; give `LeakTable` and the dashboard prose their hovers.
3. **M — undo and keyboard (§2.7, §2.8):** `ranges/[id]`, step 1, the drawing trainer's window
   binding and Redo; `RangeMatrix`'s keyboard `cellClick`; the `?` overlay in `app.vue`.
4. **M — explain the number for the headline outputs (§2.3):** equity, pool EQR, realization,
   the step-3 comparison, the visible KPI sentence; retire the inline duplicate in step 6.
5. **L — empty states, Examples and the tour (§2.4, §2.10, §6):** this is where a decision is
   taken (where examples live, what an example *is* given the real-hands rule) and where ADR-050
   would be written.
6. **S–M — acceptance 12 (§5.1):** the README examples, an `EquityServiceLike` from a package or
   three documented lines, and one mount through `'@poker/ui'` from outside `apps/web`.
7. **The verification pass this audit could not make (§8):** a signed-in Chrome walk at 1280 px
   and at ~700 px, light and dark, on the `ru_RU` locale typing `2,5` and `2.5`, with the API
   stopped once; a zero-hand account for the dashboard's empty state; `make web-check` green.

---

## 8. What this audit did not verify

- **No signed-in browser pass.** The real Postgres holds the founder's data and `make seed` was
  out of scope for this lane, so no account was created and no page behind sign-in was rendered.
  Those pages were audited from their source. The public pages were rendered headless.
- **Laptop-width rendering** was reasoned from the CSS (§2.12), not measured.
- **Chrome's handling of a typed comma** in a number input was not tested (§4.3).
- **The dashboard on an empty account** (§2.4) was not seen.
- **Agent coverage.** Five of the twelve planned agent passes completed (progressive disclosure,
  explain-the-number, undo/keyboard, tour/examples, acceptance 12/13); the empty-state,
  visible-state, feedback, dark/width, error, glossary and known-issue slices, the adversarial
  verification round and the completeness critic did not run and were replaced by direct reads
  of every page and the components named. Two-reader verification therefore covers only the
  five agent slices, where each claim was re-read against the file while writing this document.
- Line numbers are as of 2026-09-14 and will drift; the working tree also carries two other
  lanes' uncommitted D.6b (`CohortForm.vue`, `pool/rules.ts`) and D.7b (`hands/notes.ts`, the
  hand-notes API) files, which were read where they appear but are not this audit's to judge.
