<script setup lang="ts">
/**
 * Pot odds for a node (spec §8, acceptance 6): pot, bet and call in; every figure raw and
 * rake-adjusted side by side; implied odds as a labelled estimate; the rake behind "Advanced".
 * Amounts are in one unit (big blinds or chips) and the panel does not care which. An empty "to
 * call" box means the call is the bet, which it shows as its placeholder: showing the bet as the
 * box's value would write it back under the cursor of a reader who has just emptied it.
 */
import type { PotOddsFigures, RakeConfig } from '@poker/core';
import { NO_RAKE, impliedOddsEquity, potOdds } from '@poker/core';
import { computed } from 'vue';

import { explainPotOdds } from '../explain';
import { num, percent } from '../format';
import type { GlossaryKey } from '../glossary';
import MetricLabel from './MetricLabel.vue';
import NumberInput from './NumberInput.vue';

const props = withDefaults(
  defineProps<{
    pot: number;
    bet: number;
    /** The amount to call; `null` means it equals the bet. */
    call?: number | null;
    /** Expected extra winnings on later streets after hitting; 0 turns implied odds off. */
    impliedExtra?: number;
    rakeConfig?: RakeConfig;
  }>(),
  { call: null, impliedExtra: 0, rakeConfig: () => NO_RAKE },
);
const emit = defineEmits<{
  'update:pot': [pot: number];
  'update:bet': [bet: number];
  'update:call': [call: number | null];
  'update:impliedExtra': [extra: number];
  'update:rakeConfig': [rake: RakeConfig];
}>();

const PERCENT = 100;
const RAKE_STEP = 0.5;

interface Row {
  key: GlossaryKey;
  value: (f: PotOddsFigures) => string;
}
const ROWS: Row[] = [
  { key: 'potOdds', value: (f) => f.odds.text },
  { key: 'requiredEquity', value: (f) => percent(f.requiredEquity) },
  { key: 'mdf', value: (f) => percent(f.mdf) },
  { key: 'alpha', value: (f) => percent(f.alpha) },
  { key: 'bluffBreakeven', value: (f) => percent(f.bluffBreakeven) },
  { key: 'bluffsPerValue', value: (f) => num(f.bluffsPerValue) },
];

const callAmount = computed(() => props.call ?? props.bet);

/** The figures, or the reason there are none (a pot of zero). */
const outcome = computed<{ figures: { raw: PotOddsFigures; rakeAdjusted: PotOddsFigures } | null; error: string | null }>(() => {
  try {
    return { figures: potOdds(props.pot, props.bet, callAmount.value, props.rakeConfig), error: null };
  } catch (e) {
    return { figures: null, error: e instanceof Error ? e.message : String(e) };
  }
});

const implied = computed(() => (props.impliedExtra > 0 && outcome.value.figures !== null ? impliedOddsEquity(callAmount.value, props.pot, props.bet, props.impliedExtra) : null));
const rakeText = computed(() => `${num(PERCENT * props.rakeConfig.rakePct)}%${props.rakeConfig.rakeCapBB === null ? ', no cap' : `, capped at ${num(props.rakeConfig.rakeCapBB)}`}`);

function setRakePct(percentage: number): void {
  emit('update:rakeConfig', { ...props.rakeConfig, rakePct: percentage / PERCENT });
}
/** An emptied cap box means no cap. */
function setRakeCap(cap: number | null): void {
  emit('update:rakeConfig', { ...props.rakeConfig, rakeCapBB: cap });
}
</script>

<template>
  <div class="pk-odds">
    <div class="pk-inputs">
      <label>pot <NumberInput :model-value="pot" :min="0" @update:model-value="emit('update:pot', $event)" /></label>
      <label>bet <NumberInput :model-value="bet" :min="0" @update:model-value="emit('update:bet', $event)" /></label>
      <label>to call <NumberInput :model-value="call" :min="0" :placeholder="num(bet)" @update:model-value="emit('update:call', $event)" @clear="emit('update:call', null)" /></label>
    </div>
    <p v-if="outcome.error" class="pk-error" role="alert">{{ outcome.error }}</p>
    <template v-else-if="outcome.figures">
      <p class="pk-explain" data-testid="odds-explain">{{ explainPotOdds(outcome.figures.raw) }}</p>
      <table class="pk-table">
        <thead>
          <tr>
            <th></th>
            <th class="pk-num">raw</th>
            <th class="pk-num"><MetricLabel term="rake" label="after rake" /></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in ROWS" :key="row.key" :data-testid="`odds-${row.key}`">
            <th><MetricLabel :term="row.key" /></th>
            <td class="pk-num">{{ row.value(outcome.figures.raw) }}</td>
            <td class="pk-num">{{ row.value(outcome.figures.rakeAdjusted) }}</td>
          </tr>
          <tr v-if="implied !== null" data-testid="odds-implied">
            <th><MetricLabel term="impliedOdds" /> <span class="pk-muted">estimate: +{{ num(impliedExtra) }} won later</span></th>
            <td class="pk-num">{{ percent(implied) }}</td>
            <td class="pk-num pk-muted">before rake</td>
          </tr>
        </tbody>
      </table>
      <p class="pk-muted">Rake {{ rakeText }}: the second column takes it out of the pot you would win.</p>
    </template>
    <details class="pk-advanced">
      <summary>Advanced: rake and implied odds</summary>
      <div class="pk-inputs">
        <label>rake % <NumberInput :model-value="PERCENT * rakeConfig.rakePct" :min="0" :max="PERCENT" :step="RAKE_STEP" @update:model-value="setRakePct" /></label>
        <label>cap <NumberInput :model-value="rakeConfig.rakeCapBB" :min="0" placeholder="none" @update:model-value="setRakeCap" @clear="setRakeCap(null)" /></label>
        <label>extra won after hitting <NumberInput :model-value="impliedExtra" :min="0" @update:model-value="emit('update:impliedExtra', $event)" /></label>
      </div>
    </details>
  </div>
</template>

<style scoped>
.pk-odds {
  display: grid;
  gap: 0.6rem;
  color: var(--pk-fg, #18181b);
}
.pk-inputs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  font-size: 0.85rem;
}
.pk-inputs label {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}
.pk-inputs input {
  width: 5.5rem;
  font: inherit;
  padding: 0.1rem 0.3rem;
  border: 1px solid var(--pk-border, #d4d4d8);
  border-radius: 4px;
  background: var(--pk-bg, #ffffff);
  color: inherit;
}
.pk-explain {
  margin: 0;
  font-size: 0.9rem;
}
.pk-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}
.pk-table th,
.pk-table td {
  padding: 0.2rem 0.4rem;
  border-bottom: 1px solid var(--pk-border, #d4d4d8);
  text-align: left;
  font-weight: 500;
}
.pk-table thead th {
  font-size: 0.75rem;
  font-weight: 400;
  color: var(--pk-muted, #71717a);
}
.pk-num {
  text-align: right !important;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.pk-muted {
  margin: 0;
  font-size: 0.8rem;
  font-weight: 400;
  color: var(--pk-muted, #71717a);
}
.pk-error {
  margin: 0;
  font-size: 0.85rem;
  color: var(--pk-heart, #dc2626);
}
.pk-advanced summary {
  cursor: pointer;
  font-size: 0.8rem;
  color: var(--pk-muted, #71717a);
}
.pk-advanced .pk-inputs {
  margin-top: 0.4rem;
}
</style>
