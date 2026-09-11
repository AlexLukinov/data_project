<script setup lang="ts">
/**
 * One measured number with the uncertainty around it (plan E.2, spec §17): the value, the
 * confidence interval, and the sample size the two rest on.
 *
 * The product's promise is that no number is shown as more certain than it is. -1.37 bb/100
 * over 19,802 hands and -1.37 bb/100 over 200 hands are the same point estimate and not the
 * same claim, and the second line here is the difference.
 *
 * **Why it sometimes prints `± band` and sometimes a range.** A mean's interval is symmetric
 * by construction, so one number says everything: `-1.37 ± 1.25`. A proportion's Wilson
 * interval is not — it leans away from 0 and 100, which is the whole reason it is used
 * instead of Wald — so collapsing it to a `±` would throw away the asymmetry that matters
 * most exactly where the sample is thin. The rule is therefore mechanical and needs no
 * tolerance: print `±` when the two halves are equal *at the precision on screen*, and the
 * bounds themselves when they are not.
 *
 * Presentational only: the interval is computed server-side by `stats/interval.py`, and this
 * component neither derives nor second-guesses it. Props in, nothing out.
 */
import { computed } from 'vue';

import { num } from '../format';
import MetricLabel from './MetricLabel.vue';

const props = withDefaults(
  defineProps<{
    /** The point estimate in its own units, or `null` when there is no number. */
    value: number | null;
    /** The interval's bounds, in the same units as `value`. Both or neither. */
    low?: number | null;
    high?: number | null;
    /** The sample size behind the value. The server sends it with every cell. */
    n?: number | null;
    /** What the value is measured in: `%`, `bb/100`, or nothing. */
    unit?: string;
    /** Decimals on the value and on the band; they are always shown to the same precision. */
    digits?: number;
    /** The confidence level, as a whole percent, for the label beside the interval. */
    level?: number;
    /** Print a leading `+` on a positive value. A winrate reads better signed. */
    signed?: boolean;
  }>(),
  { low: null, high: null, n: null, unit: '', digits: 2, level: 95, signed: false },
);

/** `—` is the package's "no number" sentinel, from `format.num`. */
const NO_VALUE = '—';

const shown = computed(() => {
  if (props.value === null) return NO_VALUE;
  const text = num(props.value, props.digits);
  return props.signed && props.value > 0 ? `+${text}` : text;
});

/** The two half-widths, or null when there is no interval to describe. */
const halves = computed(() => {
  const { value, low, high } = props;
  if (value === null || low === null || high === null) return null;
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  return { below: value - low, above: high - value };
});

/** Equal at the precision on screen: then, and only then, one number tells the whole story. */
const band = computed(() => {
  const pair = halves.value;
  if (pair === null) return null;
  const below = num(pair.below, props.digits);
  const above = num(pair.above, props.digits);
  return below === above ? above : null;
});

const bounds = computed(() =>
  halves.value === null || band.value !== null
    ? null
    : `${num(props.low as number, props.digits)} – ${num(props.high as number, props.digits)}`,
);

const count = computed(() => (props.n === null ? '' : props.n.toLocaleString('en-US')));
</script>

<template>
  <p class="pk-metric" data-testid="metric-value">
    <span class="pk-figure">
      <span class="pk-number" data-testid="metric-number">{{ shown }}</span>
      <span v-if="band !== null" class="pk-band" data-testid="metric-band">± {{ band }}</span>
      <span v-if="unit" class="pk-unit" data-testid="metric-unit">{{ unit }}</span>
    </span>
    <span v-if="bounds !== null || count" class="pk-support">
      <MetricLabel v-if="halves !== null" term="confidenceInterval" :label="`${level}% CI`" />
      <span v-if="bounds !== null" class="pk-bounds" data-testid="metric-bounds">{{ bounds }}</span>
      <span v-if="count" class="pk-n" data-testid="metric-n">n = {{ count }}</span>
    </span>
  </p>
</template>

<style scoped>
.pk-metric {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  margin: 0;
}
.pk-figure {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.3rem;
  color: var(--pk-fg, #18181b);
  font-variant-numeric: tabular-nums;
}
.pk-number {
  font-size: 1.5rem;
  font-weight: 600;
  line-height: 1.1;
}
.pk-band {
  font-size: 0.9rem;
  color: var(--pk-muted, #71717a);
}
.pk-unit {
  font-size: 0.8rem;
  color: var(--pk-muted, #71717a);
}
.pk-support {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.4rem;
  font-size: 0.75rem;
  color: var(--pk-muted, #71717a);
  font-variant-numeric: tabular-nums;
}
</style>
