<script setup lang="ts">
// The range and nut advantage trainer (spec §16). Both ranges and the board are on screen before
// you answer; the reveal is `RangeComparisonPanel`, the same panel the Range Lab uses, so the
// numbers you are scored against are the ones you would have looked at anyway.
//
// The equity run here is the one the answer already paid for: the service caches on the request
// and the seed, so asking again after the reveal costs nothing.
import type { WeightedEquities } from '@poker/core';
import { RangeComparisonPanel, RangeMatrix } from '@poker/ui';
import { computed, shallowRef, watch } from 'vue';

import { CHART_PROVENANCE } from '~/train/charts';
import { sides } from '~/train/spot-advantage';
import type { AdvantageSpot } from '~/train/types';
import { boardOf, rangeOf } from '~/train/view';

const props = defineProps<{ spot: AdvantageSpot; revealed: boolean }>();

const { service } = useEquityService();

const hero = computed(() => rangeOf(props.spot.heroText, props.spot.heroLabel));
const villain = computed(() => rangeOf(props.spot.villainText, props.spot.villainLabel));
const board = computed(() => boardOf(props.spot.boardText));

const equities = shallowRef<{ hero: WeightedEquities; villain: WeightedEquities; exact: boolean } | null>(null);

/**
 * Only fetched once the answer has been revealed — before that there is nothing here to find,
 * which is the same rule the analyzer keeps (ADR-034).
 */
watch(
  () => [props.revealed, props.spot.hash] as const,
  async ([revealed]) => {
    equities.value = null;
    if (!revealed) return;
    const spot = props.spot;
    const both = await sides(spot, service).catch(() => null);
    if (props.spot.hash === spot.hash) equities.value = both;
  },
  { immediate: true },
);
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center gap-2">
      <span class="text-sm text-zinc-500">Flop</span>
      <span class="font-mono text-lg" data-testid="advantage-board">{{ spot.boardText }}</span>
    </div>

    <div class="grid gap-6 lg:grid-cols-2">
      <div class="space-y-2">
        <h3 class="text-sm font-medium">Hero — {{ spot.heroLabel }}</h3>
        <RangeMatrix :range="hero" mode="view" :blocked-cards="board" />
      </div>
      <div class="space-y-2">
        <h3 class="text-sm font-medium">Villain — {{ spot.villainLabel }}</h3>
        <RangeMatrix :range="villain" mode="view" :blocked-cards="board" />
      </div>
    </div>

    <div v-if="revealed" class="space-y-2">
      <RangeComparisonPanel
        v-if="equities"
        :hero="hero"
        :villain="villain"
        :hero-equities="equities.hero.equities"
        :villain-equities="equities.villain.equities"
        :exact="equities.exact"
      />
      <p v-else class="text-sm text-zinc-500" data-testid="advantage-working">
        Working out both ranges' equities…
      </p>
      <p class="text-xs text-zinc-500">{{ CHART_PROVENANCE }}</p>
    </div>
  </div>
</template>
