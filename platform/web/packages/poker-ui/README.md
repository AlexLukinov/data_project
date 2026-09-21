# @poker/ui

Reusable Vue 3 components for the Range Lab (spec §12, ADR-027). Standalone SFCs: props in,
events out, no store, no API calls, no Worker of their own.

The package depends on **`@poker/core` only** — ESLint forbids it importing `@poker/workers`,
`@poker/importers` or anything under `apps/` — so anything that needs a service receives it
through a prop. `vue ^3.5` is a peer dependency.

`@poker/ui/theme.css` defines the `--pk-*` light/dark tokens. Every component reads them with a
literal fallback, so the components render without the file; import it once to give an app the
same look everywhere, or set the tokens yourself on any ancestor.

```ts
import { EquityCalculator, RangeMatrix, createLocalEquityService } from '@poker/ui';
import '@poker/ui/theme.css';
```

---

## Using it in another app

### One import, no app-specific wiring

```vue
<script setup lang="ts">
import { parseCards, parseRange } from '@poker/core';
import { EquityCalculator, RangeMatrix, createLocalEquityService } from '@poker/ui';
import '@poker/ui/theme.css';
import { ref, shallowRef } from 'vue';

const hero = ref(parseRange('AA,KK,AKs').range);
const villain = shallowRef(parseRange('QQ-JJ,AQs').range);
const board = shallowRef(parseCards('Kh 7d 2c 9s'));
const service = createLocalEquityService();
</script>

<template>
  <RangeMatrix :range="hero" :blocked-cards="board" @update:range="hero = $event" />
  <EquityCalculator :ranges="[hero, villain]" :board="board" :service="service" />
</template>
```

### Bundler settings a Vite or Nuxt consumer needs

The package's `exports` field points at `src/index.ts`: the packages are published as
**TypeScript and `.vue` source**, never as a build. The consumer's bundler therefore has to
compile them rather than pre-bundle them as a dependency.

- `@vitejs/plugin-vue` (Nuxt has it) — something must compile the SFCs.
- Keep the workspace packages out of dependency pre-bundling, which does not handle `.vue`:

  ```ts
  // vite.config.ts, or nuxt.config.ts under `vite:` — this is what apps/web does.
  optimizeDeps: { exclude: ['@poker/core', '@poker/ui', '@poker/workers', '@poker/importers'] },
  worker: { format: 'es' },
  ```

- `worker.format: 'es'` is only needed if you also use `@poker/workers`, which starts its Worker
  as `new Worker(new URL('./equity.worker.ts', import.meta.url), { type: 'module' })`.

### The equity service, two ways

`EquityCalculator` requires a `service` prop of type `EquityServiceLike`
(`compute(request, options?, jobId?, onProgress?)` and `cancel(jobId)`). There are two ways to get
one, and the package ships the first.

**In-process, one line.** Runs on the calling thread, so a big exact enumeration blocks the page
while it runs. Right for tests, scripts, small ranges and a page whose bundler is not set up for
Workers.

```ts
import { createLocalEquityService } from '@poker/ui';

const service = createLocalEquityService();
```

**In a Worker, three lines.** `@poker/workers` owns the Worker; `comlink` carries the calls
across, and a callback has to cross as a `proxy`. Terminate it when the page goes away.

```ts
import type { EquityServiceLike } from '@poker/ui';
import { createEquityClient, createEquityWorker } from '@poker/workers';
import { proxy } from 'comlink';

const worker = createEquityWorker();
const client = createEquityClient(worker);
const service: EquityServiceLike = {
  compute: (request, options, jobId, onProgress) => client.compute(request, options, jobId, onProgress === undefined ? undefined : proxy(onProgress)),
  cancel: (jobId) => client.cancel(jobId),
};
// on unmount: worker.terminate();
```

Both supersede a job started again under the same `jobId` and reject a cancelled job with
`EquityCancelled` — which is what `EquityCalculator` relies on while inputs are still changing.

---

## Components

Props marked `?` are optional. `v-model:x` means the prop `x` with an `update:x` event.

| Component | Props | Emits |
|---|---|---|
| `RangeMatrix` | `range`, `mode?` (`edit` \| `view`, default `edit`), `brush?`, `heatmap?`, `heatmapLabel?`, `heatmapSigned?` (the heatmap holds −1..1 differences), `highlightCombos?`, `blockedCards?`, `selectedClass?` | `update:range`, `cellClick`, `cellHover` |
| `RangeTextIO` | `range`, `format?` (default `class`) | `update:range`, `formatChange` |
| `CardPicker` | `selected`, `disabled?`, `label?` | `toggle` |
| `BoardSelector` | `board`, `deadCards` | `update:board`, `update:deadCards` |
| `CardRemovalPanel` | `range`, `deadCards` | `update:deadCards` |
| `EquityCalculator` | `ranges`, `board`, `deadCards?`, `service`, `fastIterations?` (default 50 000), `debounceMs?` (default 150) | `result` |
| `ComboDistributionPanel` | `range`, `board`, `groupBy`, `compareRange?`, `equities?`, `compareEquities?`, `thresholds?` | `groupClick`, `export`, `update:groupBy` |
| `DistributionNode` | `row` (a `GroupComparison`), `depth?`, `compare?` — one recursive row of the distribution tree | `groupClick` |
| `BlockerPanel` | `heroRange`, `villainCall`, `villainFold`, `selectedCombo?`, `board?`, `deadCards?`, `pot?`, `bet?`, `isValue?`, `limit?` | `comboSelect` |
| `CardBlockerHeatmap` | `villainRange`, `board` | `cardHover` |
| `ComboDrilldown` | `handClass`, `range`, `board?` | `update:range` |
| `MetricLabel` | `term` (a `GlossaryKey`), `label?` | — |
| `MetricValue` | `value`, `low?`, `high?`, `n?`, `unit?`, `digits?` (default 2), `level?` (default 95), `signed?`, `fixed?` (fixed decimals, grouped thousands and a real minus sign) | — |
| `PotOddsPanel` | `pot`, `bet`, `call?`, `impliedExtra?`, `rakeConfig?` | `update:pot`, `update:bet`, `update:call`, `update:impliedExtra`, `update:rakeConfig` |
| `MDFPanel` | `pot`, `bet`, `rakeConfig?`, `range?`, `equities?` | `update:pot`, `update:bet`, `defendClick` |
| `EQRPanel` | `equity`, `pot`, `ev?`, `poolEqr?` | `update:ev` |
| `EquityDistributionChart` | `heroEquities`, `villainEquities`, `heroWeights`, `villainWeights`, `heroLabel?`, `villainLabel?`, `threshold?` | — |
| `EquityBucketBars` | `heroBuckets`, `villainBuckets`, `heroLabel?`, `villainLabel?` | — |
| `RangeComparisonPanel` | `hero`, `villain`, `heroEquities?`, `villainEquities?`, `exact?`, `nutLockedReason?`, `v-model:nutOptions` (the Advanced nut definition, shared with a parent that grades against it) | `update:nutOptions` |
| `RangeDiffView` | `ranges: { label, range }[]` (the first is the reference) | `cellClick` |
| `RangeDisagreementTable` | `a`, `b`, `aLabel?`, `bLabel?`, `limit?` (default 12) | `cellClick` |
| `NodeKeyEditor` | `v-model` of a `NodeKey` (spec §10.1), required | `update:modelValue` |
| `PokerTable` | `seats`, `board`, `pot`, `activeSeat`, `lastAction?`, `lastSeat?`, `bigBlind?`, `buttonSeat?`, `handOver?` | `seatClick` |
| `PoolDataBadge` | `tier` (1 \| 2 \| 3), `sampleSize`, `enough?`, `minN?`, `covers?` | — |
| `HandActionLog` | `hand`, `states` (as `replayStates` returns them), `current` | `seek` |
| `HandReplayer` | `hand`, `v-model` (the step, default 0), `v-model:speed` (ms, default 900) | `update:modelValue`, `update:speed`, `nodeChange` |
| `PredictionGate` | `question`, `answerType?` (default `text`), `tolerance?`, `choices?`, `unit?`, `actual?`, `committed?`, `hint?`, `unavailable?` | `submit`, `reveal` |
| `StepperNav` | `steps`, `current`, `completed` | `navigate` |
| `EstimatedRangePanel` | `action`, `observed`, `implied`, `classes`, `measured`, `total`, `minBucketN`, `tolerance?` (default 0.05) | — |
| `PoolRealizationPanel` | `action`, `overall`, `rows`, `covers`, `minBucketN`, `equity?`, `overallEquity?` | — |
| `PositionPicker` | `seats`, `selected`, `multiple?`, `label?`, `disabled?` | `update:selected` |
| `ActionLine` | `line`, `mode?` (default `view`), `streets?`, `label?` | `update:line` |
| `NumberInput` | `modelValue`, `min?`, `max?`, `step?` (default 1), `lazy?` | `update:modelValue`, `clear` |
| `TermLabel` | `entry` (a `TermEntry`), `label?`, `name?`; slots `default({ describedby })` and `tip` | — |
| `NodeLabel` | `node` (a `NodeKey`) | — |
| `VocabularyTable` | `table` (a `VocabularyName` or `tiers`), `caption?` | — |

### Usage

Every example below assumes the imports at the top of this file and `@poker/core` for the
fixtures (`parseRange`, `parseCards`, `nodeKey`, `replayStates`, `equityBuckets`, …).

**RangeMatrix** — the 13×13 grid. Weighted cells render as a partial fill; a drag paints with
`brush`, shift-drag erases, and the whole stroke arrives as one `update:range` when the pointer
lifts.

```vue
<RangeMatrix
  :range="hero"
  :blocked-cards="board"
  :heatmap="result?.perComboEquity ?? null"
  heatmap-label="equity"
  :selected-class="cls"
  @update:range="hero = $event"
  @cell-click="cls = $event"
/>
<!-- read-only, with a signed heatmap of (mine − solver) -->
<RangeMatrix :range="villain" mode="view" :heatmap="difference" heatmap-signed heatmap-label="my chart − solver" />
```

**RangeTextIO** — paste a range in either notation, copy it back in either.

```vue
<RangeTextIO :range="hero" @update:range="hero = $event" @format-change="format = $event" />
```

**CardPicker** — the 4×13 card grid; it toggles one card at a time and owns no state.

```vue
<CardPicker :selected="picked" :disabled="board" label="dead cards" @toggle="toggle($event)" />
```

**BoardSelector / CardRemovalPanel** — the board and the dead cards, and what they remove.

```vue
<BoardSelector :board="board" :dead-cards="dead" @update:board="board = $event" @update:dead-cards="dead = $event" />
<CardRemovalPanel :range="hero" :dead-cards="dead" @update:dead-cards="dead = $event" />
```

**EquityCalculator** — a Monte Carlo pass answers at once and the exact enumeration replaces it;
the label always says which is on screen.

```vue
<EquityCalculator :ranges="[hero, villain]" :board="board" :dead-cards="dead" :service="service" @result="result = $event" />
```

**ComboDistributionPanel / DistributionNode** — what is actually in a range, grouped.
`DistributionNode` is the recursive row and is normally rendered by the panel; mount it directly
only to build a different tree.

```vue
<ComboDistributionPanel
  v-model:group-by="axes"
  :range="hero"
  :board="board"
  :compare-range="villain"
  :equities="result?.perComboEquity ?? null"
  @group-click="highlight($event.combos)"
  @export="download($event)"
/>
<DistributionNode :row="row" :depth="0" compare @group-click="highlight($event.combos)" />
```

**BlockerPanel / CardBlockerHeatmap / ComboDrilldown**

```vue
<BlockerPanel
  :hero-range="hero"
  :villain-call="calls"
  :villain-fold="folds"
  :board="board"
  :pot="100"
  :bet="75"
  :selected-combo="combo"
  @combo-select="combo = $event"
/>
<CardBlockerHeatmap :villain-range="villain" :board="board" @card-hover="hovered = $event" />
<ComboDrilldown :hand-class="cls" :range="hero" :board="board" @update:range="hero = $event" />
```

**PotOddsPanel / MDFPanel / EQRPanel** — the three number panels; all of them are `v-model`-driven.

```vue
<PotOddsPanel v-model:pot="pot" v-model:bet="bet" v-model:call="call" v-model:implied-extra="extra" v-model:rake-config="rake" />
<MDFPanel v-model:pot="pot" v-model:bet="bet" :rake-config="rake" :range="villain" :equities="villainEquities" @defend-click="highlight($event)" />
<EQRPanel v-model:ev="ev" :equity="0.45" :pot="pot" :pool-eqr="{ eqr: 0.91, sampleSize: 1200 }" />
```

**RangeComparisonPanel / EquityDistributionChart / EquityBucketBars** — the comparison panel
already contains the two charts; mount them on their own for a different layout. Both are plain
SVG and CSS, so they read the theme tokens and need no chart library.

```vue
<RangeComparisonPanel
  v-model:nut-options="nutOptions"
  :hero="hero"
  :villain="villain"
  :hero-equities="result?.perComboEquity ?? null"
  :villain-equities="result?.perComboEquityVillain ?? null"
  :exact="result?.exact ?? null"
/>
<EquityDistributionChart
  :hero-equities="result.perComboEquity"
  :villain-equities="result.perComboEquityVillain"
  :hero-weights="hero.weights"
  :villain-weights="villain.weights"
  :threshold="0.8"
/>
<EquityBucketBars
  :hero-buckets="equityBuckets({ equities: result.perComboEquity, weights: hero.weights })"
  :villain-buckets="equityBuckets({ equities: result.perComboEquityVillain, weights: villain.weights })"
/>
```

**RangeDiffView / RangeDisagreementTable** — three-way comparison; the first range is the
reference.

```vue
<RangeDiffView :ranges="[{ label: 'Mine', range: hero }, { label: 'Solver', range: solver }]" @cell-click="cls = $event" />
<RangeDisagreementTable :a="hero" :b="solver" a-label="Mine" b-label="Solver" @cell-click="cls = $event" />
```

**NodeKeyEditor / NodeLabel** — edit a situation, or print one with every word explained.

```vue
<NodeKeyEditor v-model="situation" />
<NodeLabel :node="situation" />
```

```ts
const situation = ref<NodeKey>(nodeKey('BB', { villain_position: 'CO', action_sequence: [step('CO', 'raise', { size_bb: 2.5 }), step('BB', 'call')] }));
```

**PokerTable / HandActionLog / HandReplayer** — `HandReplayer` contains the table and the log;
mount them directly for a static picture of one step.

```vue
<HandReplayer v-model="stepIndex" v-model:speed="speed" :hand="hand" @node-change="(node) => (current = node)" />

<PokerTable
  :seats="tableSeats(hand, states[10]!)"
  :board="states[10]!.board"
  :pot="states[10]!.pot"
  :active-seat="states[10]!.actor"
  :big-blind="hand.bigBlind"
  last-action="folds"
  :last-seat="1"
  @seat-click="seat = $event"
/>
<HandActionLog :hand="hand" :states="states" :current="stepIndex" @seek="stepIndex = $event" />
```

```ts
const states = replayStates(hand); // hand: ReplayHand, from @poker/core
```

**PredictionGate / StepperNav** — the analyzer's two controls. The gate never sees the answer
until one has been committed: hand `actual` in only after `submit`.

```vue
<StepperNav :steps="steps" :current="step" :completed="[1, 2]" @navigate="step = $event" />
<PredictionGate
  question="How often does your pool fold to this bet?"
  answer-type="percent"
  :tolerance="5"
  hint="MDF is the baseline against a balanced opponent. Your pool is not one."
  :committed="guess"
  :actual="guess === null ? null : '62'"
  @submit="guess = $event"
  @reveal="onReveal($event)"
/>
```

```ts
const steps: StepLabel[] = [{ step: 1, title: 'The situation' }, { step: 2, title: 'Ranges' }];
```

**PoolDataBadge / EstimatedRangePanel / PoolRealizationPanel** — the pool's three tiers, each
carrying how much data is behind it.

```vue
<PoolDataBadge :tier="1" :sample-size="8786" :min-n="100" />
<PoolDataBadge :tier="3" :sample-size="1354266" :min-n="100" :covers="0.018" />
<EstimatedRangePanel action="bet" :observed="0.1413" :implied="0.1319" :classes="classes" :measured="35" :total="51" :min-bucket-n="200" />
<PoolRealizationPanel action="bet" :overall="overall" :rows="rows" :covers="0.018" :min-bucket-n="200" :equity="{ AA: 0.72 }" :overall-equity="0.25" />
```

**PositionPicker / ActionLine** — the two filter controls. `PositionPicker` takes its seats as a
prop because the registry's vocabulary is wider than `NodeKey`'s ten seats.

```vue
<PositionPicker :seats="['UTG', 'MP', 'CO', 'BTN', 'SB', 'BB']" :selected="seats" multiple @update:selected="seats = $event" />
<ActionLine :line="line" mode="edit" streets @update:line="line = $event" />
```

**NumberInput** — every numeric box in the package. It reads `2.5` and `2,5` alike, writes the
value back with a dot, and never emits a number it could not read. Emptying the box emits `clear`
rather than `null`; any other attribute (`class`, `aria-label`, `placeholder`, `data-testid`) lands
on the input.

```vue
<NumberInput v-model="pot" :min="0" :step="0.5" aria-label="pot" />
<NumberInput :model-value="call" :min="0" lazy placeholder="same as the bet" @update:model-value="call = $event" @clear="call = null" />
```

**MetricLabel / TermLabel / VocabularyTable** — the vocabulary affordances.

```vue
<MetricLabel term="mdf" />
<MetricLabel term="nutAdvantage" label="nuts" />

<!-- a plain word -->
<TermLabel :entry="POSITION_WORDS.CO" />
<!-- the word is already a control: keep the control, bind describedby -->
<TermLabel :entry="AXIS_WORDS.made">
  <template #default="{ describedby }">
    <button :aria-describedby="describedby" @click="toggle('made')">made hand</button>
  </template>
</TermLabel>
<!-- a tooltip body that is not one sentence and a formula -->
<TermLabel :entry="NODE_SHORTHAND">
  <template #tip><p>Every word of this situation, one per line.</p></template>
</TermLabel>

<VocabularyTable table="positions" caption="Seats" />
<VocabularyTable table="tiers" />
```

---

## Composables

`useUndoRedo(initial, limit = 200)` → `{ state, canUndo, canRedo, set, undo, redo, reset, sync, onKeydown }`.
The value must be **replaced, never mutated** — `WeightedRange` operations already work that way,
so undo is free.

```ts
const history = useUndoRedo(parseRange('AA,KK').range);
history.set(nextRange);      // push an edit
history.undo();              // walk back
history.reset(loadedRange);  // start again, forgetting the history
```

`sync(next, same)` follows a value that changed **outside** the history — a load, a save coming
back, an autosaved copy. When `same(state, next)` is true the history is kept and the state left
alone (it already says the same thing, so the reader's undo still means something); otherwise the
history restarts at `next`.

```ts
watch(loaded, (range) => history.sync(range, (a, b) => sameRange(a, b)));
```

`useUndoShortcuts(target)` binds ⌘Z / ⌘⇧Z / Ctrl+Y to the **window** for as long as the calling
component is mounted. `target` is a function read on every press, so a page can point it at
whichever history was edited last, or at `null` while there is nothing to edit. Presses inside an
`input`, `textarea`, `select` or a `contenteditable` are left to the box, as is a press something
nearer the focus has already handled.

```ts
useUndoShortcuts(() => (editing.value === 'hero' ? heroHistory : villainHistory));
```

## Functions and tables

**Explain-the-number templates** (`explain.ts`) — one plain sentence generated from the computed
values, so the words and the numbers can never disagree. Each takes figures from `@poker/core`'s
metrics and returns a `string`.

| Function | Takes |
|---|---|
| `explainPotOdds(figures)` | a `PotOddsFigures` |
| `explainMdf(figures, defend)` | a `PotOddsFigures` and a `DefendingSet \| null` |
| `explainEqr(equity, pot, ev, source)` | `ev` may be `null`; `source` names where the EV came from |
| `explainRangeAdvantage(adv, hero, villain)` | a `RangeAdvantage` and the two names |
| `explainNutAdvantage(nut, hero, villain)` | a `NutAdvantage` and the two names |
| `explainEquity(result, names)` | an `EquityFigures` (an `EquityResult` is one) and one name per player |
| `explainPoolEqr(pool, entered)` | `{ eqr, sampleSize }` and the EV-derived EQR, or `null` |
| `explainRealization(action, overall, eqr)` | a `RealizationRow` and its EQR, or `null` |
| `explainHitShares(heroShare, villainShare, hero, villain)` | two top-pair-or-better shares and the two names |
| `explainOddsInputs(pot, bet, call = bet)` | returns `null` when the inputs are usable, else what is wrong |
| `explainOddsFailure(error)` | turns a thrown error into one sentence |

```ts
const line = explainEquity(result, ['Hero', 'Villain']);
const problem = explainOddsInputs(pot, bet, call); // null when there is nothing to say
```

Their thresholds are exported so a caller can grade by the same rule the sentence uses:
`EVEN_RANGE_MARGIN` (0.03), `NUT_EDGE` (0.6), `EVEN_EQR_MARGIN` (0.05), `EVEN_HIT_MARGIN` (0.03).

**Glossary** (`glossary.ts`) — `GLOSSARY` is the table of metric terms (one sentence and the
formula each); `GLOSSARY_KEYS` lists its keys, `REQUIRED_TERMS` the terms spec §13 names outright,
`POOL_TERMS` the pool's five in reading order, and `TIER_TERMS` maps tier 1/2/3 to its key.
`MetricLabel` takes a `GlossaryKey`, so a label without an entry does not typecheck.

```ts
const entry: GlossaryEntry = GLOSSARY.mdf; // { term: 'MDF', definition: '…', formula: 'pot / (pot + bet)' }
```

**Vocabulary** (`vocabulary.ts`, `nodeWords.ts`) — a `TermEntry` is `{ term, definition, formula? }`:
the shape of every tooltip and every reference row. A word that names **how a number was obtained**
is a glossary entry; a word that names a **category** is a vocabulary row (ADR-056). Both reach the
screen through `TermLabel`.

- Tables: `POSITION_WORDS`, `MADE_HAND_WORDS`, `DRAW_WORDS`, `CATEGORY_WORDS`, `AXIS_WORDS`,
  `NODE_WORDS`, and `VOCABULARY` which holds all six under the names `positions`, `madeHands`,
  `draws`, `categories`, `axes`, `nodes` (a `VocabularyName` — what `VocabularyTable` renders).
- `POSITION_NAMING` explains the seat-naming convention; `REAL_DRAW` is the "real draw" row.
- `groupWord(axis, key)` gives the row that explains a distribution group, or `null` for the axes
  whose groups are numeric bands.
- `isPosition(seat)` narrows a string to `@poker/core`'s `Position`.
- `nodeLabelParts(key)` takes a `NodeKey` apart into `{ text, entry }` pieces — what `NodeLabel`
  renders, one explained word per line; `partWord(part)` is the word alone, and `NODE_SHORTHAND`
  is the entry for the shorthand as a whole.

**Formatting** (`format.ts`, `number.ts`)

```ts
const spade = parseCards('As')[0]!;

percent(0.6667);        // '66.7%'   — digits defaults to 1; '—' for NaN
num(2.4);               // '2.4'     — digits defaults to 2, trailing zeros trimmed; '—' for NaN
cardLabel(spade);       // 'A♠'      — `As` stays the text form
suitName(spade);        // 'spade'

parseDecimal('2,5');    // 2.5 — null when the text is not a number
formatDecimal(2.5);     // '2.5' — always a dot
cleanDecimal(0.1 + 0.2);// 0.3 — rounds off binary float noise
sameDecimal(a, b);      // equal once cleaned
```

**Pool estimates** (`estimate.ts`) — `poolEqr(realized, equity)` returns the pool's EQR, or `null`
when either half is missing: a realized share on its own is never shown as an EQR. `EstimatedClass`
and `RealizationRow` are the row shapes the two pool panels take.

**Predictions** (`prediction.ts`)

```ts
isNumeric('percent');                              // true
const outcome = scorePrediction('58', '62', 'percent', 5);  // { answer, actual, error: -4, withinTolerance: true }
explainPrediction(outcome, 'percent');             // the sentence shown at the reveal
```

**Tables and lines** (`table.ts`, `line.ts`, `stepper.ts`)

```ts
const seats: TableSeat[] = tableSeats(hand, states[10]!);   // what PokerTable draws
actionText(action, (v) => `${v.toFixed(2)}`);               // 'raises to 6.00'
shownCard('As');                                            // { text, rank, suit, suitName } | null
shownCards(['As', 'Kd']);

parseLine('r/x-c/');        // [['r'], ['x', 'c'], []] — streets of actions
formatLine([['r'], ['x', 'c']]);
lineWords('r/x-c/');        // 'raise / check-call / …' — a street with no actions yet is '…'
isActionLine('r/x-c/');     // whether every character is one the registry uses
```

`ACTION_LETTERS` is the alphabet (`f x l c b r`), `ActionLetter` one of its letters, and
`ACTION_WORDS` maps each to its word. `StepLabel` is `{ step, title }` — what `StepperNav` takes.

**Exported types** — everything the props and the functions above are typed with:
`EquityServiceLike` and `EquityServiceOptions` (the equity service contract), `EquityFigures`,
`GlossaryEntry`, `GlossaryKey`, `TermEntry`, `VocabularyName`, `NodeWord`, `NodeLabelPart`,
`EstimatedClass`, `RealizationRow`, `AnswerType`, `PredictionOutcome`, `TableSeat`, `ShownCard`,
`ActionLetter`, `StepLabel`, `UndoRedo<T>`.

---

## Keyboard

| Where | Keys |
|---|---|
| `RangeMatrix` | Tab into the grid; arrows move the focused cell; Enter or Space emits `cellClick` in both modes and, in edit mode, toggles the cell between the brush weight and empty. A key press is not a stroke: it emits its own `update:range` at once. |
| `RangeMatrix` (pointer) | Drag paints with `brush`, shift-drag erases. **One drag is one edit**: the stroke is painted into a local draft and a single `update:range` carries the whole stroke on pointer up (or pointer cancel), so an undo takes back the stroke rather than the last cell it crossed. A stroke that changed no weight emits nothing. |
| `HandReplayer` | Bound to the window while it is mounted: ← and → step, Space plays and pauses, and 1–4 jump to the streets the hand actually played (preflop, flop, turn, river), in that order. Ignored while typing in an `input`, `textarea`, `select` or `contenteditable`. |
| `StepperNav` | Bound to the rail: ← and → walk it, the digits 1–9 jump straight to a step. |
| `PredictionGate` | Enter in the answer box commits the answer (number and text answers; a choice answer is a button). |
| `RangeTextIO` | ⌘↵ or Ctrl+↵ in the text area applies what is typed, same as the Apply button. |
| Undo | ⌘Z undo, ⌘⇧Z or Ctrl+Y redo. Bound by `useUndoShortcuts` to the window, not by any component, and ignored while typing in an `input`, `textarea`, `select` or `contenteditable`. |

---

## Demo page

`/dev/components` in `apps/web` mounts the components with fixture props and reports the last
event each one emitted (ADR-024: reviewed on a fixture page).
