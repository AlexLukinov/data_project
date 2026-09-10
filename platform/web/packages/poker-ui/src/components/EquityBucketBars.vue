<script setup lang="ts">
/**
 * Equity buckets as opposed bars (spec §8): hero's share of each band grows to the left,
 * villain's to the right, strongest band on top, so the two shapes read at a glance.
 */
import type { EquityBuckets } from '@poker/core';
import { computed } from 'vue';

import { num, percent } from '../format';

const props = withDefaults(defineProps<{ heroBuckets: EquityBuckets; villainBuckets: EquityBuckets; heroLabel?: string; villainLabel?: string }>(), {
  heroLabel: 'Hero',
  villainLabel: 'Villain',
});

const PERCENT = 100;

const rows = computed(() => {
  const edges = props.heroBuckets.edges;
  const out = [];
  for (let i = edges.length - 2; i >= 0; i--) {
    out.push({
      key: i,
      label: `${Math.round(PERCENT * edges[i]!)}–${Math.round(PERCENT * edges[i + 1]!)}%`,
      hero: props.heroBuckets.shares[i] ?? 0,
      villain: props.villainBuckets.shares[i] ?? 0,
      heroWeight: props.heroBuckets.weights[i] ?? 0,
      villainWeight: props.villainBuckets.weights[i] ?? 0,
    });
  }
  return out;
});
</script>

<template>
  <div class="pk-buckets" role="table" aria-label="equity buckets">
    <div class="pk-row pk-head" role="row">
      <span class="pk-side pk-left">{{ heroLabel }}</span>
      <span class="pk-band">equity</span>
      <span class="pk-side">{{ villainLabel }}</span>
    </div>
    <div v-for="row in rows" :key="row.key" class="pk-row" role="row" :data-testid="`bucket-${row.key}`">
      <span class="pk-side pk-left" :title="`${heroLabel}: ${num(row.heroWeight)} weighted combos`">
        <span class="pk-bar pk-hero" :style="{ width: `${PERCENT * row.hero}%` }" />
        <span class="pk-val">{{ percent(row.hero, 0) }}</span>
      </span>
      <span class="pk-band">{{ row.label }}</span>
      <span class="pk-side" :title="`${villainLabel}: ${num(row.villainWeight)} weighted combos`">
        <span class="pk-bar pk-villain" :style="{ width: `${PERCENT * row.villain}%` }" />
        <span class="pk-val">{{ percent(row.villain, 0) }}</span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.pk-buckets {
  display: grid;
  gap: 0.25rem;
  font-size: 0.8rem;
  color: var(--pk-fg, #18181b);
}
.pk-row {
  display: grid;
  grid-template-columns: 1fr 4.5rem 1fr;
  align-items: center;
  gap: 0.4rem;
}
.pk-head {
  color: var(--pk-muted, #71717a);
  font-size: 0.75rem;
}
.pk-head .pk-left {
  justify-content: flex-end;
}
.pk-side {
  display: flex;
  align-items: center;
  height: 1.1rem;
  min-width: 0;
}
.pk-left {
  flex-direction: row-reverse;
}
.pk-band {
  text-align: center;
  font-variant-numeric: tabular-nums;
  color: var(--pk-muted, #71717a);
}
.pk-bar {
  display: block;
  height: 100%;
  flex: none;
}
.pk-hero {
  background: var(--pk-hero, #2563eb);
}
.pk-villain {
  background: var(--pk-villain, #c2410c);
}
.pk-val {
  margin: 0 0.3rem;
  font-variant-numeric: tabular-nums;
}
</style>
