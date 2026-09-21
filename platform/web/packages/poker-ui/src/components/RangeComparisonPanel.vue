<script setup lang="ts">
/**
 * Two ranges against each other (spec §8): mean and median equity with the range advantage,
 * the nut advantage with its split made prominent (it drives bet sizing), the equity buckets
 * opposed and the distribution graph. The nut threshold definition is the one advanced control.
 *
 * `v-model:nutOptions` shares that definition with a parent that grades a number against it (the
 * analyzer's step 4), so the Advanced fold changes the graded figure too; unbound, the panel
 * keeps its own copy. Units are core's: `cutoff` a fraction, `topPercent` a percent.
 * `nutLockedReason` shuts the definition once a number has been graded by it, and says why;
 * `nutHiddenReason` withholds the nut figures until then, for a parent whose whole question is
 * what they are.
 */
import type { NutMode, NutOptions, WeightedRange } from '@poker/core';
import { DEFAULT_NUT_CUTOFF, DEFAULT_NUT_TOP_PERCENT, equityBuckets, nutAdvantage, rangeAdvantage } from '@poker/core';
import { computed } from 'vue';

import { explainNutAdvantage, explainRangeAdvantage } from '../explain';
import { percent } from '../format';
import EquityBucketBars from './EquityBucketBars.vue';
import EquityDistributionChart from './EquityDistributionChart.vue';
import MetricLabel from './MetricLabel.vue';
import NumberInput from './NumberInput.vue';

const props = withDefaults(
  defineProps<{
    hero: WeightedRange;
    villain: WeightedRange;
    /** Per-combo equities from the equity engine; `null` until it has answered. */
    heroEquities?: Float32Array | null;
    villainEquities?: Float32Array | null;
    /** Whether the equities are exact or Monte Carlo, for the provenance line; `null` says nothing. */
    exact?: boolean | null;
    /** Why the nut definition cannot be changed right now (a number was graded by it); '' leaves it open. */
    nutLockedReason?: string;
    /**
     * Why the nut figures themselves are withheld — a reader is about to be asked for them
     * (the analyzer's step 4, ADR-061). Hidden: the split, the two shares, the threshold and the
     * sentence that names them — **and the equity bands**, whose top band is the nutted set at the
     * default definition and whose per-side tooltip gives the weighted combos in it, so the two of
     * them together are the split itself. The equities, the range advantage and the distribution
     * stay. The Advanced fold stays open too, because the definition is chosen *before* the answer;
     * `nutLockedReason` is what shuts it afterwards. '' shows everything.
     */
    nutHiddenReason?: string;
  }>(),
  { heroEquities: null, villainEquities: null, exact: null, nutLockedReason: '', nutHiddenReason: '' },
);
const nutOptions = defineModel<Required<NutOptions>>('nutOptions', { default: () => ({ mode: 'cutoff', cutoff: DEFAULT_NUT_CUTOFF, topPercent: DEFAULT_NUT_TOP_PERCENT }) });

const PERCENT = 100;
const MIN_TOP_PERCENT = 0.1;
const TOP_PERCENT_STEP = 0.5;

/** Every change is a new object, so a bound parent's value is never mutated under it. */
function patchNut(change: Partial<Required<NutOptions>>): void {
  nutOptions.value = { ...nutOptions.value, ...change };
}
const mode = computed({ get: () => nutOptions.value.mode, set: (next: NutMode) => patchNut({ mode: next }) });

const heroLabel = computed(() => props.hero.label ?? 'Hero');
const villainLabel = computed(() => props.villain.label ?? 'Villain');
const sides = computed(() => {
  if (props.heroEquities === null || props.villainEquities === null) return null;
  return { hero: { equities: props.heroEquities, weights: props.hero.weights }, villain: { equities: props.villainEquities, weights: props.villain.weights } };
});
const advantage = computed(() => (sides.value === null ? null : rangeAdvantage(sides.value.hero, sides.value.villain)));
const nut = computed(() => (sides.value === null ? null : nutAdvantage(sides.value.hero, sides.value.villain, nutOptions.value)));
const buckets = computed(() => (sides.value === null ? null : { hero: equityBuckets(sides.value.hero), villain: equityBuckets(sides.value.villain) }));

function signed(difference: number): string {
  if (!Number.isFinite(difference)) return '—';
  return `${difference >= 0 ? '+' : '−'}${Math.abs(PERCENT * difference).toFixed(1)} pp`;
}
</script>

<template>
  <div class="pk-compare">
    <p v-if="!sides" class="pk-muted pk-wide" data-testid="compare-empty">Set two ranges and a board; the comparison appears when the equity calculation has answered.</p>
    <template v-else-if="advantage && nut && buckets">
      <p v-if="exact !== null" class="pk-muted pk-wide"><MetricLabel :term="exact ? 'exact' : 'monteCarlo'" :label="exact ? 'from exact equities' : 'from Monte Carlo equities'" /></p>
      <section class="pk-block">
        <h4><MetricLabel term="rangeAdvantage" /></h4>
        <table class="pk-table">
          <thead>
            <tr>
              <th></th>
              <th class="pk-num">{{ heroLabel }}</th>
              <th class="pk-num">{{ villainLabel }}</th>
              <th class="pk-num">Δ</th>
            </tr>
          </thead>
          <tbody>
            <tr data-testid="compare-mean">
              <th><MetricLabel term="meanEquity" /></th>
              <td class="pk-num">{{ percent(advantage.heroMean) }}</td>
              <td class="pk-num">{{ percent(advantage.villainMean) }}</td>
              <td class="pk-num">{{ signed(advantage.difference) }}</td>
            </tr>
            <tr data-testid="compare-median">
              <th><MetricLabel term="medianEquity" /></th>
              <td class="pk-num">{{ percent(advantage.heroMedian) }}</td>
              <td class="pk-num">{{ percent(advantage.villainMedian) }}</td>
              <td class="pk-num">{{ signed(advantage.heroMedian - advantage.villainMedian) }}</td>
            </tr>
          </tbody>
        </table>
        <p class="pk-explain" data-testid="compare-range-explain">{{ explainRangeAdvantage(advantage, heroLabel, villainLabel) }}</p>
      </section>
      <section class="pk-block">
        <h4><MetricLabel term="nutAdvantage" /></h4>
        <p v-if="nutHiddenReason" class="pk-muted" data-testid="compare-nut-hidden">{{ nutHiddenReason }}</p>
        <template v-else>
          <div class="pk-split" data-testid="compare-nut-split" role="img" :aria-label="`nut share split: ${heroLabel} ${percent(nut.split.hero, 0)}, ${villainLabel} ${percent(nut.split.villain, 0)}`">
            <span class="pk-split-hero" :style="{ width: `${PERCENT * nut.split.hero}%` }">{{ heroLabel }} {{ percent(nut.split.hero, 0) }}</span>
            <span class="pk-split-villain" :style="{ width: `${PERCENT * nut.split.villain}%` }">{{ villainLabel }} {{ percent(nut.split.villain, 0) }}</span>
          </div>
          <p class="pk-muted"><MetricLabel term="nutShare" />: {{ heroLabel }} {{ percent(nut.hero.share) }} · {{ villainLabel }} {{ percent(nut.villain.share) }} · <MetricLabel term="nutThreshold" /> <span data-testid="compare-nut-threshold">{{ percent(nut.threshold) }}</span></p>
          <p class="pk-explain" data-testid="compare-nut-explain">{{ explainNutAdvantage(nut, heroLabel, villainLabel) }}</p>
        </template>
        <details class="pk-advanced">
          <summary>Advanced: what counts as nutted</summary>
          <div class="pk-inputs">
            <label><input v-model="mode" type="radio" value="cutoff" :disabled="nutLockedReason !== ''" /> equity at or above <NumberInput :model-value="PERCENT * nutOptions.cutoff" :min="0" :max="PERCENT" :disabled="nutLockedReason !== ''" aria-label="nut cutoff, percent" @update:model-value="patchNut({ cutoff: $event / PERCENT })" /> %</label>
            <label><input v-model="mode" type="radio" value="topPercent" :disabled="nutLockedReason !== ''" /> the top <NumberInput :model-value="nutOptions.topPercent" :min="MIN_TOP_PERCENT" :max="PERCENT" :step="TOP_PERCENT_STEP" :disabled="nutLockedReason !== ''" aria-label="top percent of both ranges" @update:model-value="patchNut({ topPercent: $event })" /> % of both ranges together</label>
            <p v-if="nutLockedReason" class="pk-muted" data-testid="compare-nut-locked">{{ nutLockedReason }}</p>
          </div>
        </details>
      </section>
      <section v-if="!nutHiddenReason" class="pk-block">
        <h4><MetricLabel term="equityBuckets" /></h4>
        <EquityBucketBars :hero-buckets="buckets.hero" :villain-buckets="buckets.villain" :hero-label="heroLabel" :villain-label="villainLabel" />
      </section>
      <section class="pk-block">
        <EquityDistributionChart :hero-equities="sides.hero.equities" :villain-equities="sides.villain.equities" :hero-weights="hero.weights" :villain-weights="villain.weights" :hero-label="heroLabel" :villain-label="villainLabel" :threshold="nut.threshold" />
      </section>
    </template>
  </div>
</template>

<style scoped>
.pk-compare {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(19rem, 1fr));
  gap: 1rem 1.5rem;
  color: var(--pk-fg, #18181b);
}
.pk-wide {
  grid-column: 1 / -1;
}
.pk-block {
  display: grid;
  gap: 0.5rem;
  align-content: start;
}
.pk-block h4 {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 600;
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
.pk-split {
  display: flex;
  height: 1.6rem;
  overflow: hidden;
  border-radius: 4px;
  font-size: 0.8rem;
  font-weight: 600;
  color: #ffffff;
}
.pk-split-hero,
.pk-split-villain {
  display: flex;
  align-items: center;
  padding: 0 0.4rem;
  overflow: hidden;
  white-space: nowrap;
  transition: width 0.2s;
}
.pk-split-hero {
  background: var(--pk-hero, #2563eb);
}
.pk-split-villain {
  justify-content: flex-end;
  background: var(--pk-villain, #c2410c);
}
.pk-explain {
  margin: 0;
  font-size: 0.9rem;
}
.pk-muted {
  margin: 0;
  font-size: 0.8rem;
  color: var(--pk-muted, #71717a);
}
.pk-advanced summary {
  cursor: pointer;
  font-size: 0.8rem;
  color: var(--pk-muted, #71717a);
}
.pk-inputs {
  display: grid;
  gap: 0.3rem;
  margin-top: 0.4rem;
  font-size: 0.85rem;
}
.pk-inputs input[inputmode='decimal'] {
  width: 4rem;
  font: inherit;
  padding: 0.1rem 0.3rem;
  border: 1px solid var(--pk-border, #d4d4d8);
  border-radius: 4px;
  background: var(--pk-bg, #ffffff);
  color: inherit;
}
</style>
