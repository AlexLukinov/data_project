<script setup lang="ts">
// The blocker trainer (spec §16): four candidates, one of them blocks their calls without
// blocking their folds. The reveal is the full `BlockerPanel` ranking, so the answer is not a
// verdict handed down but the table you could have read yourself.
import { BlockerPanel, RangeMatrix } from '@poker/ui';
import { computed } from 'vue';

import { CHART_PROVENANCE } from '~/train/charts';
import { CONTINUE_RULE, split } from '~/train/spot-blockers';
import type { BlockersSpot } from '~/train/types';
import { boardOf, rangeOf } from '~/train/view';

const props = defineProps<{ spot: BlockersSpot; revealed: boolean }>();

const board = computed(() => boardOf(props.spot.boardText));
const hero = computed(() => rangeOf(props.spot.heroText, 'Your betting range'));
const villain = computed(() => rangeOf(props.spot.villainText, props.spot.villainLabel));
const parts = computed(() => split(villain.value, board.value));
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-3">
      <span class="font-mono text-lg" data-testid="blockers-board">{{ spot.boardText }}</span>
      <span class="text-sm text-zinc-500">
        You bet {{ spot.betBB }}bb into {{ spot.potBB }}bb against {{ spot.villainLabel }}.
      </span>
    </div>

    <p class="text-xs text-zinc-500" data-testid="continue-rule">{{ CONTINUE_RULE }}</p>

    <div class="grid gap-6 lg:grid-cols-2">
      <div class="space-y-2">
        <h3 class="text-sm font-medium">Your range</h3>
        <RangeMatrix :range="hero" mode="view" :blocked-cards="board" />
      </div>
      <div class="space-y-2">
        <h3 class="text-sm font-medium">What continues against your bet</h3>
        <RangeMatrix :range="parts.call" mode="view" :blocked-cards="board" />
      </div>
    </div>

    <div v-if="revealed" class="space-y-2">
      <h3 class="text-sm font-medium">Every candidate, ranked</h3>
      <BlockerPanel
        :hero-range="hero"
        :villain-call="parts.call"
        :villain-fold="parts.fold"
        :board="board"
        :pot="spot.potBB"
        :bet="spot.betBB"
      />
      <p class="text-xs text-zinc-500">{{ CHART_PROVENANCE }}</p>
    </div>
  </div>
</template>
