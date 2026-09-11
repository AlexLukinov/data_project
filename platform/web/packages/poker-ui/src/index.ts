/**
 * @poker/ui — reusable Vue 3 components for the Range Lab (spec §12, ADR-027).
 * Props in, events out; no store, no API, no Worker: the app passes services through props.
 * Import `@poker/ui/theme.css` once for the light/dark tokens.
 */

export { default as RangeMatrix } from './components/RangeMatrix.vue';
export { default as RangeTextIO } from './components/RangeTextIO.vue';
export { default as CardPicker } from './components/CardPicker.vue';
export { default as BoardSelector } from './components/BoardSelector.vue';
export { default as CardRemovalPanel } from './components/CardRemovalPanel.vue';
export { default as EquityCalculator } from './components/EquityCalculator.vue';
export { default as ComboDistributionPanel } from './components/ComboDistributionPanel.vue';
export { default as DistributionNode } from './components/DistributionNode.vue';
export { default as BlockerPanel } from './components/BlockerPanel.vue';
export { default as CardBlockerHeatmap } from './components/CardBlockerHeatmap.vue';
export { default as ComboDrilldown } from './components/ComboDrilldown.vue';
export { default as MetricLabel } from './components/MetricLabel.vue';
export { default as PotOddsPanel } from './components/PotOddsPanel.vue';
export { default as MDFPanel } from './components/MDFPanel.vue';
export { default as EQRPanel } from './components/EQRPanel.vue';
export { default as EquityDistributionChart } from './components/EquityDistributionChart.vue';
export { default as EquityBucketBars } from './components/EquityBucketBars.vue';
export { default as RangeComparisonPanel } from './components/RangeComparisonPanel.vue';
export { default as RangeDiffView } from './components/RangeDiffView.vue';
export { default as RangeDisagreementTable } from './components/RangeDisagreementTable.vue';
export { default as NodeKeyEditor } from './components/NodeKeyEditor.vue';
export { default as PokerTable } from './components/PokerTable.vue';
export { default as PoolDataBadge } from './components/PoolDataBadge.vue';
export { default as HandActionLog } from './components/HandActionLog.vue';
export { default as HandReplayer } from './components/HandReplayer.vue';
export { default as PredictionGate } from './components/PredictionGate.vue';
export { default as StepperNav } from './components/StepperNav.vue';
export { default as EstimatedRangePanel } from './components/EstimatedRangePanel.vue';
export { default as PoolRealizationPanel } from './components/PoolRealizationPanel.vue';
export { poolEqr } from './estimate';
export type { EstimatedClass, RealizationRow } from './estimate';
export type { StepLabel } from './stepper';
export { explainPrediction, isNumeric, scorePrediction } from './prediction';
export type { AnswerType, PredictionOutcome } from './prediction';
export { actionText, shownCard, shownCards, tableSeats } from './table';
export type { ShownCard, TableSeat } from './table';
export { useUndoRedo } from './composables/useUndoRedo';
export type { UndoRedo } from './composables/useUndoRedo';
export type { EquityServiceLike, EquityServiceOptions } from './service';
export { cardLabel, num, percent, suitName } from './format';
export { GLOSSARY, GLOSSARY_KEYS, REQUIRED_TERMS } from './glossary';
export type { GlossaryEntry, GlossaryKey } from './glossary';
export { EVEN_RANGE_MARGIN, NUT_EDGE, explainEqr, explainMdf, explainNutAdvantage, explainPotOdds, explainRangeAdvantage } from './explain';
export { default as PositionPicker } from './components/PositionPicker.vue';
export { default as ActionLine } from './components/ActionLine.vue';
export { ACTION_LETTERS, ACTION_WORDS, formatLine, isActionLine, lineWords, parseLine } from './line';
export type { ActionLetter } from './line';
