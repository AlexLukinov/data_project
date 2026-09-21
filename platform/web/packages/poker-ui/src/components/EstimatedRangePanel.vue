<script setup lang="ts">
/**
 * Tier 3 with its own error attached (spec §10.3, plan F.10).
 *
 * A reconstructed range is the one pool number that is not a direct measurement, so this panel
 * leads with the check rather than the answer: what the reweighting *implies* the field's
 * frequency should be, against what tier 1 *observed*, which is unbiased. The two agree when the
 * prior matches the class mix the field shows here, so the gap is a reading on the prior — and
 * a big gap is a reason to distrust the picture beside it.
 *
 * Classes the pool barely showed are listed as "kept" rather than given a number: under the
 * bucket threshold the prior is left exactly alone (spec §10.3).
 */
import { computed } from 'vue';

import type { EstimatedClass } from '../estimate';
import MetricLabel from './MetricLabel.vue';

const props = withDefaults(
  defineProps<{
    action: string;
    observed: number | null;
    implied: number | null;
    /** Classes to list, already picked and ordered by the caller. */
    classes: readonly EstimatedClass[];
    /** How many classes of the prior the pool could measure, and how many there were. */
    measured: number;
    total: number;
    minBucketN: number;
    /** Gaps beyond this many points are called out rather than passed over. */
    tolerance?: number;
  }>(),
  { tolerance: 0.05 },
);

const PERCENT = 100;
const PLACES = 1;

const gap = computed(() => (props.observed === null || props.implied === null ? null : props.implied - props.observed));
const off = computed(() => gap.value !== null && Math.abs(gap.value) > props.tolerance);
const pct = (value: number): string => `${(value * PERCENT).toFixed(PLACES)}%`;

/** The sentence under the two figures. It names the direction, never just "they disagree". */
const verdict = computed(() => {
  if (gap.value === null) return 'The pool has not played this situation often enough to reconstruct anything.';
  const points = `${Math.abs(gap.value * PERCENT).toFixed(PLACES)} points`;
  if (!off.value) return `The range you gave implies the field would ${props.action} about as often as it really does — within ${points}.`;
  return gap.value > 0
    ? `The range you gave is ${points} too heavy on hands that ${props.action} here: it implies more ${props.action}s than the field makes.`
    : `The range you gave is ${points} too heavy on hands that do not ${props.action} here: it implies fewer ${props.action}s than the field makes.`;
});
</script>

<template>
  <div class="pk-tier3">
    <dl class="pk-figures">
      <div>
        <dt><MetricLabel term="reconstructedRange" label="implied by this range" /></dt>
        <dd data-testid="tier3-implied">{{ implied === null ? '—' : pct(implied) }}</dd>
      </div>
      <div>
        <dt><MetricLabel term="observedFrequencies" label="observed (tier 1)" /></dt>
        <dd data-testid="tier3-observed">{{ observed === null ? '—' : pct(observed) }}</dd>
      </div>
      <div>
        <dt>gap</dt>
        <dd :class="off ? 'pk-off' : 'pk-near'" data-testid="tier3-gap">
          {{ gap === null ? '—' : `${gap > 0 ? '+' : ''}${(gap * PERCENT).toFixed(PLACES)} pts` }}
        </dd>
      </div>
    </dl>
    <p class="pk-verdict" data-testid="tier3-verdict">{{ verdict }}</p>

    <p class="pk-coverage" data-testid="tier3-coverage">
      <template v-if="measured === total">
        Reweighted every one of the {{ total }} classes in the range — each was shown at least
        {{ minBucketN }} times here.
      </template>
      <template v-else>
        Reweighted {{ measured }} of the {{ total }} classes in the range; the other
        {{ total - measured }} were shown fewer than {{ minBucketN }} times here and were left
        exactly as you drew them.
      </template>
    </p>

    <table v-if="classes.length" class="pk-classes" data-testid="tier3-classes">
      <thead>
        <tr>
          <th scope="col">hand</th>
          <th scope="col">shown</th>
          <th scope="col"><MetricLabel term="likelihoodRatio" label="moves" /></th>
          <th scope="col">yours</th>
          <th scope="col">after</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in classes" :key="row.hand_class" :class="{ 'pk-kept': row.fallback }" :data-testid="`tier3-row-${row.hand_class}`">
          <th scope="row">{{ row.hand_class }}</th>
          <td>{{ row.sample_size.toLocaleString('en-US') }}</td>
          <td>{{ row.fallback ? 'kept' : `${(row.likelihood).toFixed(2)}×` }}</td>
          <td>{{ pct(row.prior) }}</td>
          <td>{{ pct(row.posterior) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.pk-tier3 {
  display: grid;
  gap: 0.6rem;
  color: var(--pk-fg, #18181b);
}
.pk-figures {
  display: flex;
  flex-wrap: wrap;
  gap: 1.25rem;
  margin: 0;
}
.pk-figures div {
  display: grid;
  gap: 0.1rem;
}
.pk-figures dt {
  font-size: 0.8rem;
}
.pk-figures dd {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.pk-near {
  color: var(--pk-good, #15803d);
}
.pk-off {
  color: var(--pk-bad, #b91c1c);
}
.pk-verdict {
  margin: 0;
  font-size: 0.9rem;
}
.pk-coverage {
  margin: 0;
  font-size: 0.75rem;
  color: var(--pk-muted, #71717a);
}
.pk-classes {
  border-collapse: collapse;
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
}
.pk-classes th,
.pk-classes td {
  padding: 0.15rem 0.5rem 0.15rem 0;
  text-align: right;
}
.pk-classes thead th {
  font-weight: 500;
  color: var(--pk-muted, #71717a);
}
.pk-classes tbody th {
  text-align: left;
  font-weight: 600;
}
.pk-kept {
  color: var(--pk-muted, #71717a);
}
</style>
