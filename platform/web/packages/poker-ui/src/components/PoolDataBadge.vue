<script setup lang="ts">
/**
 * How much pool data is behind a number (spec §10.5, §12): which tier it came from, how many
 * observations, and — when there are too few — that there is no number at all.
 *
 * The badge is the promise the product makes: **never a fabricated number**. A node under the
 * server's `minN` shows the count and the word "insufficient", never a percentage.
 *
 * Every word on it is explained where it stands (audit §3.2): the tier chip by that tier's
 * glossary entry, "n" and "insufficient data" by the sample size, "shown down" by the coverage.
 */
import { computed } from 'vue';

import { TIER_TERMS } from '../glossary';
import MetricLabel from './MetricLabel.vue';

const props = withDefaults(
  defineProps<{
    /** 1 = action frequencies, 2 = showdown range, 3 = reconstructed (F.10). */
    tier: 1 | 2 | 3;
    sampleSize: number;
    /** Whether the server was willing to put numbers on it. */
    enough?: boolean;
    minN?: number;
    /** Tier 2 only: the share of the node's decisions whose cards were revealed. */
    covers?: number | null;
  }>(),
  { enough: true, minN: 0, covers: null },
);

const TIER_NAMES: Record<number, string> = {
  1: 'observed frequencies',
  2: 'showdown range',
  3: 'reconstructed range',
};
const PERCENT = 100;

const label = computed(() => TIER_NAMES[props.tier] ?? `tier ${props.tier}`);
const count = computed(() => props.sampleSize.toLocaleString('en-US'));
const covered = computed(() => (props.covers === null ? '' : `${(props.covers * PERCENT).toFixed(props.covers < 0.1 ? 1 : 0)}%`));
</script>

<template>
  <p class="pk-badge" :class="enough ? 'pk-ok' : 'pk-thin'" data-testid="pool-badge">
    <span class="pk-tier"><MetricLabel :term="TIER_TERMS[tier]" :label="`pool · tier ${tier}`" /></span>
    <span class="pk-what">{{ label }}</span>
    <span v-if="enough" class="pk-n" data-testid="pool-badge-n"><MetricLabel term="sampleSize" label="n" /> = {{ count }}</span>
    <span v-else class="pk-n" data-testid="pool-badge-thin"><MetricLabel term="sampleSize" label="insufficient data" /> — {{ count }} of the {{ minN.toLocaleString('en-US') }} needed</span>
    <span v-if="enough && covered" class="pk-covers" data-testid="pool-badge-covers">{{ covered }} of the decisions here were <MetricLabel term="showdownCoverage" label="shown down" /></span>
  </p>
</template>

<style scoped>
.pk-badge {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.4rem;
  margin: 0;
  font-size: 0.75rem;
  color: var(--pk-muted, #71717a);
}
.pk-tier {
  padding: 0.05rem 0.35rem;
  border-radius: 0.6rem;
  font-weight: 600;
  background: var(--pk-surface, #f4f4f5);
  color: var(--pk-fg, #18181b);
}
.pk-thin .pk-tier {
  background: var(--pk-highlight, #f59e0b);
  color: #18181b;
}
.pk-n {
  font-variant-numeric: tabular-nums;
}
.pk-thin .pk-n {
  color: var(--pk-fg, #18181b);
  font-weight: 600;
}
</style>
