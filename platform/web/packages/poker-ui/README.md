# @poker/ui

Reusable Vue 3 components for the Range Lab (spec §12, ADR-027). Standalone SFCs: props in,
events out, no store, no API, no Worker. They depend on `@poker/core` only; anything that needs
a service (the equity Worker) receives it through a prop. Import `@poker/ui/theme.css` once for
the light/dark tokens, or set the `--pk-*` custom properties yourself.

```ts
import { RangeMatrix, RangeTextIO, EquityCalculator, useUndoRedo } from '@poker/ui';
import '@poker/ui/theme.css';
```

| Component | Props | Emits |
|---|---|---|
| `RangeMatrix` | `range`, `mode` (`edit` \| `view`), `brush`, `heatmap`, `heatmapLabel`, `highlightCombos`, `blockedCards`, `selectedClass` | `update:range`, `cellClick`, `cellHover` |
| `RangeTextIO` | `range`, `format` | `update:range`, `formatChange` |
| `CardPicker` | `selected`, `disabled`, `label` | `toggle` |
| `BoardSelector` | `board`, `deadCards` | `update:board`, `update:deadCards` |
| `CardRemovalPanel` | `range`, `deadCards` | `update:deadCards` |
| `EquityCalculator` | `ranges`, `board`, `deadCards`, `service`, `fastIterations`, `debounceMs` | `result` |
| `ComboDistributionPanel` | `range`, `board`, `groupBy`, `compareRange`, `equities`, `compareEquities`, `thresholds` | `groupClick`, `export`, `update:groupBy` |
| `BlockerPanel` | `heroRange`, `villainCall`, `villainFold`, `selectedCombo`, `board`, `deadCards`, `pot`, `bet`, `isValue`, `limit` | `comboSelect` |
| `CardBlockerHeatmap` | `villainRange`, `board` | `cardHover` |
| `ComboDrilldown` | `handClass`, `range`, `board` | `update:range` |
| `MetricLabel` | `term` (a `GlossaryKey`), `label` | — |
| `PotOddsPanel` | `pot`, `bet`, `call`, `impliedExtra`, `rakeConfig` | `update:pot`, `update:bet`, `update:call`, `update:impliedExtra`, `update:rakeConfig` |
| `MDFPanel` | `pot`, `bet`, `rakeConfig`, `range`, `equities` | `update:pot`, `update:bet`, `defendClick` |
| `EQRPanel` | `equity`, `pot`, `ev`, `poolEqr` | `update:ev` |
| `EquityDistributionChart` | `heroEquities`, `villainEquities`, `heroWeights`, `villainWeights`, `heroLabel`, `villainLabel`, `threshold` | — |
| `EquityBucketBars` | `heroBuckets`, `villainBuckets`, `heroLabel`, `villainLabel` | — |
| `RangeComparisonPanel` | `hero`, `villain`, `heroEquities`, `villainEquities`, `exact` | — |
| `RangeDiffView` | `ranges: { label, range }[]` (the first is the reference) | `cellClick` |

Every metric label goes through `MetricLabel`, which reads `glossary.ts` (spec §13: one sentence
and the formula per term, in one place); `explain.ts` holds the "explain the number" templates.
The charts are plain SVG and CSS — no chart library — so they read the theme tokens and test
under happy-dom.

`useUndoRedo(initial)` gives `state`, `set`, `undo`, `redo`, `canUndo`, `canRedo` and an
`onKeydown` for ⌘Z / ⌘⇧Z (Ctrl+Z / Ctrl+Y). Ranges are immutable values, so every edit is a
new `WeightedRange` and undo is free.

`RangeMatrix` keyboard: Tab into the grid, arrows move, Enter or Space toggles the focused cell
between the brush weight and empty. Mouse: drag paints with the brush, shift-drag erases.

The fixture page `/dev/components` in the app shows every component in isolation.
