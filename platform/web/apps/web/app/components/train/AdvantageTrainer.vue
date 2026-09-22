<script setup lang="ts">
// The range and nut advantage trainer (spec §16). Both ranges and the board are on screen before
// you answer; the reveal is `RangeComparisonPanel`, the same panel the Range Lab uses, so the
// numbers you are scored against are the ones you would have looked at anyway.
//
// The equity run here is the one the answer already paid for: the service caches on the request
// and the seed, so asking again after the reveal costs nothing.
import type { WeightedEquities } from '@poker/core';
import { RangeComparisonPanel, RangeMatrix } from '@poker/ui';
import { computed, ref, shallowRef, watch } from 'vue';

import { CHART_PROVENANCE } from '~/train/charts';
import { NO_COMPARISON, localProblem } from '~/train/problems';
import { sides } from '~/train/spot-advantage';
import type { AdvantageSpot } from '~/train/types';
import { boardOf, rangeOf } from '~/train/view';

const props = defineProps<{ spot: AdvantageSpot; revealed: boolean }>();

const { service } = useEquityService();

const hero = computed(() => rangeOf(props.spot.heroText, props.spot.heroLabel));
const villain = computed(() => rangeOf(props.spot.villainText, props.spot.villainLabel));
const board = computed(() => boardOf(props.spot.boardText));

const equities = shallowRef<{ hero: WeightedEquities; villain: WeightedEquities; exact: boolean } | null>(null);
/** Why the comparison is not here. A failure used to leave "Working out…" on screen for good. */
const problem = ref('');

/**
 * The reveal's own numbers. Only asked for once the answer has been revealed — before that there
 * is nothing here to find, which is the same rule the analyzer keeps (ADR-034).
 *
 * The run is the one the answer already paid for, so it is normally free; when it throws, the
 * panel says so and offers the run again rather than waiting (ADR-061). The trainer's own gate
 * says the *answer* is missing; this says the *comparison* is, which is a different sentence.
 */
async function load(): Promise<void> {
  const spot = props.spot;
  equities.value = null;
  problem.value = '';
  if (!props.revealed) return;
  try {
    const both = await sides(spot, service);
    if (props.spot.hash === spot.hash) equities.value = both;
  } catch (error) {
    // Worded as the browser-local failure it is (ADR-069): no class name, and no mention of an
    // API this page never calls. Try again follows the sentence on the same line.
    if (props.spot.hash === spot.hash) problem.value = localProblem(NO_COMPARISON, error);
  }
}

watch(() => [props.revealed, props.spot.hash] as const, () => void load(), { immediate: true });
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
      <p v-else-if="problem" role="alert" class="text-sm text-red-600 dark:text-red-400" data-testid="advantage-error">
        {{ problem }}
        <button type="button" class="underline" data-testid="advantage-retry" @click="load">Try again</button>
      </p>
      <p v-else class="text-sm text-zinc-500" data-testid="advantage-working">
        Working out both ranges' equities…
      </p>
      <p class="text-xs text-zinc-500">{{ CHART_PROVENANCE }}</p>
    </div>
  </div>
</template>
