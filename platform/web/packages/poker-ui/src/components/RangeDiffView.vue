<script setup lang="ts">
/**
 * Ranges compared cell by cell (spec §12; the three-way view of F.6). The first range is the
 * reference; every other range gets one matrix of their union, tinted per class by
 * `reference − other`: one hue where the reference holds more, another where it holds less.
 * The combos only one side holds are counted underneath. Reuses RangeMatrix — no second grid.
 */
import type { HandClass, WeightedRange } from '@poker/core';
import { COMBO_COUNT, diff, union } from '@poker/core';
import { computed } from 'vue';

import { num } from '../format';
import RangeMatrix from './RangeMatrix.vue';

const props = defineProps<{ ranges: readonly { label: string; range: WeightedRange }[] }>();
const emit = defineEmits<{ cellClick: [cls: HandClass] }>();

interface Overlap {
  both: number;
  onlyA: number;
  onlyAWeight: number;
  onlyB: number;
  onlyBWeight: number;
}

function overlap(a: WeightedRange, b: WeightedRange): Overlap {
  const out: Overlap = { both: 0, onlyA: 0, onlyAWeight: 0, onlyB: 0, onlyBWeight: 0 };
  for (let i = 0; i < COMBO_COUNT; i++) {
    const wa = a.weights[i]!;
    const wb = b.weights[i]!;
    if (wa > 0 && wb > 0) out.both++;
    else if (wa > 0) {
      out.onlyA++;
      out.onlyAWeight += wa;
    } else if (wb > 0) {
      out.onlyB++;
      out.onlyBWeight += wb;
    }
  }
  return out;
}

const baseLabel = computed(() => props.ranges[0]?.label ?? '');

const pairs = computed(() => {
  const base = props.ranges[0];
  if (base === undefined) return [];
  return props.ranges.slice(1).map((other, i) => {
    const d = diff(base.range, other.range);
    return {
      key: i,
      otherLabel: other.label,
      union: { weights: union(base.range, other.range).weights, label: `${base.label} vs ${other.label}` },
      heat: d.perCombo,
      moved: d.totalAbsolute,
      ...overlap(base.range, other.range),
    };
  });
});
</script>

<template>
  <div class="pk-diff">
    <p v-if="pairs.length === 0" class="pk-muted">Give two or more ranges to compare; the first is the reference.</p>
    <div v-for="pair in pairs" :key="pair.key" class="pk-pair">
      <p class="pk-title">
        <strong>{{ baseLabel }} − {{ pair.otherLabel }}</strong>
        <span class="pk-key"><span class="pk-swatch pk-more" /> more in {{ baseLabel }} <span class="pk-swatch pk-less" /> more in {{ pair.otherLabel }}</span>
      </p>
      <RangeMatrix :range="pair.union" mode="view" :heatmap="pair.heat" heatmap-label="difference" heatmap-signed @cell-click="emit('cellClick', $event)" />
      <p class="pk-muted" :data-testid="`diff-summary-${pair.key}`">{{ pair.both }} combos in both · only in {{ baseLabel }}: {{ pair.onlyA }} ({{ num(pair.onlyAWeight) }} weighted) · only in {{ pair.otherLabel }}: {{ pair.onlyB }} ({{ num(pair.onlyBWeight) }} weighted) · weight moved {{ num(pair.moved) }}</p>
    </div>
  </div>
</template>

<style scoped>
.pk-diff {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  gap: 1rem;
  color: var(--pk-fg, #18181b);
}
.pk-pair {
  display: grid;
  gap: 0.4rem;
}
.pk-title {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.85rem;
}
.pk-key {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.75rem;
  color: var(--pk-muted, #71717a);
}
.pk-swatch {
  display: inline-block;
  width: 0.8rem;
  height: 0.8rem;
  border-radius: 2px;
}
.pk-more {
  background: hsl(var(--pk-diff-more, 160 60% 38%));
}
.pk-less {
  background: hsl(var(--pk-diff-less, 330 70% 48%));
}
.pk-muted {
  margin: 0;
  font-size: 0.8rem;
  color: var(--pk-muted, #71717a);
}
</style>
