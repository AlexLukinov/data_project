<script setup lang="ts">
/**
 * MDF and alpha for a bet (spec §8), with the defending set when the range that faces the bet
 * and its equities are given: the strongest combos that add up to the MDF and the equity where
 * they stop. "Show on the matrix" hands those combos to the app to highlight.
 */
import type { ComboIndex, DefendingSet, PotOddsFigures, RakeConfig, WeightedRange } from '@poker/core';
import { NO_RAKE, defendingSet, potOdds } from '@poker/core';
import { computed } from 'vue';

import { explainMdf } from '../explain';
import { num, percent } from '../format';
import MetricLabel from './MetricLabel.vue';

const props = withDefaults(
  defineProps<{
    pot: number;
    bet: number;
    rakeConfig?: RakeConfig;
    /** The range that faces the bet. */
    range?: WeightedRange | null;
    /** Its per-combo equities against the betting range (NaN where absent). */
    equities?: Float32Array | null;
  }>(),
  { rakeConfig: () => NO_RAKE, range: null, equities: null },
);
const emit = defineEmits<{ 'update:pot': [pot: number]; 'update:bet': [bet: number]; defendClick: [combos: ComboIndex[]] }>();

const outcome = computed<{ figures: { raw: PotOddsFigures; rakeAdjusted: PotOddsFigures } | null; error: string | null }>(() => {
  try {
    return { figures: potOdds(props.pot, props.bet, props.bet, props.rakeConfig), error: null };
  } catch (e) {
    return { figures: null, error: e instanceof Error ? e.message : String(e) };
  }
});

/** The top of the defending range by equity that adds up to the raw MDF. */
const defend = computed<DefendingSet | null>(() => {
  if (props.range === null || props.equities === null || outcome.value.figures === null) return null;
  return defendingSet({ equities: props.equities, weights: props.range.weights }, outcome.value.figures.raw.mdf);
});

function number(event: Event): number {
  return Number((event.target as HTMLInputElement).value);
}
</script>

<template>
  <div class="pk-mdf">
    <div class="pk-inputs">
      <label>pot <input type="number" min="0" step="any" :value="pot" @input="emit('update:pot', number($event))" /></label>
      <label>bet <input type="number" min="0" step="any" :value="bet" @input="emit('update:bet', number($event))" /></label>
    </div>
    <p v-if="outcome.error" class="pk-error" role="alert">{{ outcome.error }}</p>
    <template v-else-if="outcome.figures">
      <div class="pk-figures">
        <div class="pk-figure" data-testid="mdf-value">
          <span class="pk-name"><MetricLabel term="mdf" /></span>
          <span class="pk-big">{{ percent(outcome.figures.raw.mdf) }}</span>
          <span class="pk-muted">{{ percent(outcome.figures.rakeAdjusted.mdf) }} after rake</span>
        </div>
        <div class="pk-figure" data-testid="alpha-value">
          <span class="pk-name"><MetricLabel term="alpha" /></span>
          <span class="pk-big">{{ percent(outcome.figures.raw.alpha) }}</span>
          <span class="pk-muted">{{ percent(outcome.figures.rakeAdjusted.alpha) }} after rake</span>
        </div>
      </div>
      <p class="pk-explain" data-testid="mdf-explain">{{ explainMdf(outcome.figures.raw, defend) }}</p>
      <p v-if="defend && defend.combos.length > 0" class="pk-defend">
        <MetricLabel term="defendingSet" />: {{ defend.combos.length }} combos, {{ num(defend.weight) }} of {{ num(defend.totalWeight) }} weighted, equity ≥ {{ percent(defend.cutoffEquity) }}
        <button type="button" class="pk-btn" data-testid="mdf-show" @click="emit('defendClick', defend.combos)">Show on the matrix</button>
      </p>
      <p v-else-if="range && !equities" class="pk-muted">The defending set appears when the equities have been computed.</p>
    </template>
  </div>
</template>

<style scoped>
.pk-mdf {
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
.pk-figures {
  display: flex;
  flex-wrap: wrap;
  gap: 1.5rem;
}
.pk-figure {
  display: grid;
}
.pk-name {
  font-size: 0.8rem;
}
.pk-big {
  font-size: 1.75rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.pk-explain,
.pk-defend {
  margin: 0;
  font-size: 0.9rem;
}
.pk-btn {
  margin-left: 0.4rem;
  font: inherit;
  font-size: 0.8rem;
  padding: 0.15rem 0.5rem;
  border: 1px solid var(--pk-border, #d4d4d8);
  border-radius: 4px;
  background: var(--pk-surface, #f4f4f5);
  color: inherit;
  cursor: pointer;
}
.pk-muted {
  margin: 0;
  font-size: 0.8rem;
  color: var(--pk-muted, #71717a);
}
.pk-error {
  margin: 0;
  font-size: 0.85rem;
  color: var(--pk-heart, #dc2626);
}
</style>
