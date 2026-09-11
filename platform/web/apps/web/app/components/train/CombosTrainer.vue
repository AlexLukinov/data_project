<script setup lang="ts">
// The combo-counting trainer (spec §16). The range and the board are both on screen from the
// start; once the answer is in, the combos that were being counted are ringed on the grid, which
// is the part that makes the number stick.
import type { ComboIndex } from '@poker/core';
import { HAND_CLASS_COMBOS, combosIn, handClassOfName, removeCards } from '@poker/core';
import { RangeMatrix } from '@poker/ui';
import { computed } from 'vue';

import { CHART_PROVENANCE } from '~/train/charts';
import type { CombosSpot } from '~/train/types';
import { boardOf, rangeOf } from '~/train/view';

const props = defineProps<{ spot: CombosSpot; revealed: boolean }>();

const range = computed(() => rangeOf(props.spot.rangeText, props.spot.rangeLabel));
const board = computed(() => boardOf(props.spot.boardText));

/** The combos the question was about, ringed on the grid at the reveal. */
const counted = computed<ComboIndex[] | null>(() => {
  if (!props.revealed || props.spot.ask !== 'class') return null;
  const live = removeCards(range.value, board.value);
  try {
    const wanted = new Set(HAND_CLASS_COMBOS[handClassOfName(props.spot.target)] ?? []);
    return combosIn(live).filter((combo) => wanted.has(combo));
  } catch {
    return null;
  }
});
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-3">
      <span class="text-sm font-medium">{{ spot.rangeLabel }}</span>
      <template v-if="spot.boardText !== ''">
        <span class="text-sm text-zinc-500">on</span>
        <span class="font-mono text-lg" data-testid="combos-board">{{ spot.boardText }}</span>
      </template>
    </div>

    <RangeMatrix
      :range="range"
      mode="view"
      :blocked-cards="board"
      :highlight-combos="counted"
    />

    <p class="text-xs text-zinc-500">{{ CHART_PROVENANCE }}</p>
  </div>
</template>
