<script setup lang="ts">
// One seat's range, painted or pasted. The analysis stores combo text (the same notation the
// range library stores, so anything drawn here can be saved as a chart), and this component is
// the only place that converts between that text and the matrix.
import type { Card, WeightedRange } from '@poker/core';
import { createRange, parseRange, serializeRange, weightedCombos } from '@poker/core';
import { RangeMatrix, RangeTextIO } from '@poker/ui';
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    label: string;
    /** Combo text, as stored on the step. */
    weights: string;
    blockedCards?: readonly Card[];
    readOnly?: boolean;
    /** The name of the chart this range was loaded from; '' when it was painted here. */
    source?: string;
  }>(),
  { blockedCards: () => [], readOnly: false, source: '' },
);

const emit = defineEmits<{ 'update:weights': [weights: string] }>();

const TOTAL_COMBOS = 1326;
const PERCENT = 100;

const range = computed<WeightedRange>(() => {
  if (props.weights === '') return { ...createRange(), label: props.label };
  try {
    return { ...parseRange(props.weights).range, label: props.label };
  } catch {
    return { ...createRange(), label: props.label };
  }
});

const combos = computed(() => weightedCombos(range.value));
const share = computed(() => ((combos.value / TOTAL_COMBOS) * PERCENT).toFixed(1));

function onEdit(next: WeightedRange): void {
  emit('update:weights', serializeRange(next, 'combo'));
}
</script>

<template>
  <div class="space-y-2">
    <p class="flex flex-wrap items-baseline gap-2 text-sm">
      <span class="font-medium">{{ label }}</span>
      <span v-if="source" class="text-zinc-500" :data-testid="`seat-source-${label}`">started from your chart “{{ source }}”</span>
      <span class="text-zinc-500 tabular-nums" :data-testid="`seat-combos-${label}`">{{ combos.toFixed(0) }} combos · {{ share }}% of hands</span>
    </p>
    <RangeMatrix :range="range" :mode="readOnly ? 'view' : 'edit'" :blocked-cards="blockedCards" @update:range="onEdit" />
    <RangeTextIO v-if="!readOnly" :range="range" @update:range="onEdit" />
  </div>
</template>
