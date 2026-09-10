<script setup lang="ts">
/** One row of the distribution tree, recursive; a click on the label emits the group. */
import type { DistributionGroup, GroupComparison } from '@poker/core';
import { computed } from 'vue';

import { num, percent } from '../format';

const props = withDefaults(defineProps<{ row: GroupComparison; depth?: number; compare?: boolean }>(), { depth: 0, compare: false });
const emit = defineEmits<{ groupClick: [group: DistributionGroup] }>();

const a = computed(() => props.row.a);
const b = computed(() => props.row.b);
const open = computed(() => props.depth === 0);

function click(): void {
  const group = a.value ?? b.value;
  if (group !== null) emit('groupClick', group);
}
</script>

<template>
  <details :open="open" class="pk-node" :style="{ '--depth': depth }">
    <summary class="pk-summary">
      <button type="button" class="pk-name" @click.stop="click">{{ row.label }}</button>
      <span class="pk-cells">
        <span class="pk-cell" :title="a ? `${a.combos} combos, ${num(a.weight)} weighted` : 'none'">
          <template v-if="a">{{ a.combos }} · {{ num(a.weight) }} · {{ percent(a.share) }}</template>
          <template v-else>—</template>
        </span>
        <template v-if="compare">
          <span class="pk-cell" :title="b ? `${b.combos} combos, ${num(b.weight)} weighted` : 'none'">
            <template v-if="b">{{ b.combos }} · {{ num(b.weight) }} · {{ percent(b.share) }}</template>
            <template v-else>—</template>
          </span>
          <span class="pk-cell pk-delta" :class="{ 'pk-up': row.deltaShare > 0, 'pk-down': row.deltaShare < 0 }">{{ row.deltaShare > 0 ? '+' : '' }}{{ (100 * row.deltaShare).toFixed(1) }} pp</span>
        </template>
      </span>
    </summary>
    <DistributionNode v-for="child in row.children" :key="child.key" :row="child" :depth="depth + 1" :compare="compare" @group-click="emit('groupClick', $event)" />
  </details>
</template>

<style scoped>
.pk-node {
  padding-left: calc(var(--depth) * 0.75rem);
}
.pk-summary {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  cursor: pointer;
  font-size: 0.85rem;
  padding: 0.15rem 0;
}
.pk-name {
  font: inherit;
  border: 0;
  padding: 0;
  background: none;
  color: inherit;
  text-align: left;
  cursor: pointer;
  text-decoration: underline dotted;
  text-underline-offset: 3px;
}
.pk-cells {
  display: grid;
  grid-auto-flow: column;
  gap: 1rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.pk-cell {
  min-width: 9rem;
  text-align: right;
}
.pk-delta {
  min-width: 5rem;
  color: var(--pk-muted, #71717a);
}
.pk-up {
  color: var(--pk-fill-strong, #16a34a);
}
.pk-down {
  color: var(--pk-heart, #dc2626);
}
</style>
