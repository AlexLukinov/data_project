<script setup lang="ts">
// The equity trainer (spec §16): both ranges and the board in front of you, and nothing else —
// the point is to read the shapes, not to be given a number to round off.
import { RangeMatrix } from '@poker/ui';
import { computed } from 'vue';

import { CHART_PROVENANCE } from '~/train/charts';
import type { EquitySpot } from '~/train/types';
import { boardOf, rangeOf } from '~/train/view';

const props = defineProps<{ spot: EquitySpot }>();

const hero = computed(() => rangeOf(props.spot.heroText, props.spot.heroLabel));
const villain = computed(() => rangeOf(props.spot.villainText, props.spot.villainLabel));
const board = computed(() => boardOf(props.spot.boardText));
const isOneHand = computed(() => props.spot.tier === 'hand');

const TIERS: Readonly<Record<EquitySpot['tier'], string>> = {
  hand: 'Your hand against a whole range.',
  preflop: 'Two ranges, before any card is dealt.',
  flop: 'Two ranges, on this flop.',
};
</script>

<template>
  <div class="space-y-4">
    <p class="text-sm text-zinc-500" data-testid="equity-tier">{{ TIERS[spot.tier] }}</p>

    <div v-if="board.length > 0" class="flex items-center gap-2">
      <span class="text-sm text-zinc-500">Board</span>
      <span class="font-mono text-lg" data-testid="equity-board">{{ spot.boardText }}</span>
    </div>

    <div class="grid gap-6 lg:grid-cols-2">
      <div class="space-y-2">
        <h3 class="text-sm font-medium">{{ isOneHand ? 'Your hand' : spot.heroLabel }}</h3>
        <p v-if="isOneHand" class="font-mono text-2xl" data-testid="equity-hand">{{ spot.heroText }}</p>
        <RangeMatrix v-else :range="hero" mode="view" :blocked-cards="board" />
      </div>
      <div class="space-y-2">
        <h3 class="text-sm font-medium">{{ spot.villainLabel }}</h3>
        <RangeMatrix :range="villain" mode="view" :blocked-cards="board" />
      </div>
    </div>

    <p class="text-xs text-zinc-500" data-testid="equity-provenance">{{ CHART_PROVENANCE }}</p>
  </div>
</template>
