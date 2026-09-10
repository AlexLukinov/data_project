<script setup lang="ts">
/**
 * The biggest per-cell disagreements between two ranges (spec §11.1's three-way view): each
 * hand class with the share of its combos each range holds and the difference, largest first.
 * Clicking a class reports it so the matrices can ring it.
 */
import type { HandClass, WeightedRange } from '@poker/core';
import { HAND_CLASS_COMBOS, HAND_CLASS_COUNT, handClassName } from '@poker/core';
import { computed } from 'vue';

import { percent } from '../format';

const props = withDefaults(
  defineProps<{
    a: WeightedRange;
    b: WeightedRange;
    aLabel?: string;
    bLabel?: string;
    /** How many rows to show. */
    limit?: number;
  }>(),
  { aLabel: 'A', bLabel: 'B', limit: 12 },
);
const emit = defineEmits<{ cellClick: [cls: HandClass] }>();

/** Below this the two ranges agree on the class. */
const SAME = 0.005;

interface Row {
  cls: HandClass;
  name: string;
  a: number;
  b: number;
  difference: number;
}

function share(range: WeightedRange, cls: HandClass): number {
  const combos = HAND_CLASS_COMBOS[cls]!;
  let sum = 0;
  for (const c of combos) sum += range.weights[c]!;
  return sum / combos.length;
}

const rows = computed<Row[]>(() => {
  const out: Row[] = [];
  for (let cls = 0; cls < HAND_CLASS_COUNT; cls++) {
    const a = share(props.a, cls);
    const b = share(props.b, cls);
    if (Math.abs(a - b) >= SAME) out.push({ cls, name: handClassName(cls), a, b, difference: a - b });
  }
  return out.sort((x, y) => Math.abs(y.difference) - Math.abs(x.difference)).slice(0, props.limit);
});

function signed(d: number): string {
  return `${d > 0 ? '+' : ''}${(d * 100).toFixed(1)} pp`;
}
</script>

<template>
  <div class="pk-disagree">
    <p v-if="rows.length === 0" class="pk-muted" data-testid="disagree-empty">The two ranges agree on every hand class.</p>
    <table v-else>
      <thead>
        <tr>
          <th>hand</th>
          <th>{{ aLabel }}</th>
          <th>{{ bLabel }}</th>
          <th>difference</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.cls" :data-testid="`disagree-${row.name}`">
          <td><button type="button" @click="emit('cellClick', row.cls)">{{ row.name }}</button></td>
          <td>{{ percent(row.a, 0) }}</td>
          <td>{{ percent(row.b, 0) }}</td>
          <td :class="row.difference > 0 ? 'pk-more' : 'pk-less'">{{ signed(row.difference) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.pk-disagree {
  color: var(--pk-fg, #18181b);
  font-size: 0.85rem;
}
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  padding: 0.2rem 0.5rem;
  text-align: right;
  font-variant-numeric: tabular-nums;
  border-bottom: 1px solid var(--pk-border, #d4d4d8);
}
th:first-child,
td:first-child {
  text-align: left;
}
th {
  font-weight: 500;
  color: var(--pk-muted, #71717a);
}
td button {
  font: inherit;
  font-weight: 600;
  background: none;
  border: 0;
  padding: 0;
  color: inherit;
  cursor: pointer;
}
.pk-more {
  color: hsl(var(--pk-diff-more, 160 60% 38%));
}
.pk-less {
  color: hsl(var(--pk-diff-less, 330 70% 48%));
}
.pk-muted {
  margin: 0;
  color: var(--pk-muted, #71717a);
}
</style>
