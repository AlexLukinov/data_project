<script setup lang="ts">
/**
 * What an example has already set up, said before any step asks anything (spec §13 "visible
 * state"): the situation, where the spot comes from, which reference chart each seat holds and
 * that it is not a solve, the bet size step 8 balances against — and what an example leaves out.
 */
import { nodeKeyLabel, parseCards } from '@poker/core';
import { computed } from 'vue';

import SeatRange from '~/components/analyze/SeatRange.vue';
import type { Example } from '~/help/examples';
import { CHART_PROVENANCE, chartById } from '~/train/charts';

const props = defineProps<{ example: Example }>();

const PERCENT = 100;

const seats = computed(() => [
  { position: props.example.node.hero_position, chart: chartById(props.example.heroChart) },
  { position: props.example.node.villain_position ?? '', chart: chartById(props.example.villainChart) },
]);
const board = computed(() => parseCards(props.example.board));
const size = computed(() => Math.round(props.example.sizePct * PERCENT));
</script>

<template>
  <div class="space-y-3 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800" data-testid="example-spot">
    <p>{{ example.story }}</p>
    <p class="text-zinc-500">
      <span data-testid="example-node">{{ nodeKeyLabel(example.node) }}</span> · <span data-testid="example-source">{{ example.source }}</span>
    </p>
    <p data-testid="example-charts">
      <template v-for="(seat, i) in seats" :key="seat.position">
        <span v-if="i > 0"> · </span><span class="font-medium">{{ seat.position }}</span> holds “{{ seat.chart.label }}”
      </template>
    </p>
    <p class="text-zinc-500" data-testid="example-provenance">{{ CHART_PROVENANCE }}</p>
    <p data-testid="example-size">The bet is {{ size }}% of the pot — step 8 balances bluffs against this size.</p>

    <details>
      <summary class="cursor-pointer text-zinc-600 dark:text-zinc-400">The two ranges</summary>
      <div class="mt-3 grid gap-6 lg:grid-cols-2">
        <SeatRange v-for="seat in seats" :key="seat.position" :label="seat.position" :weights="seat.chart.text" :blocked-cards="board" read-only />
      </div>
    </details>

    <p class="text-zinc-500" data-testid="example-left-out">
      Nothing here is saved: leave or reload and the example starts again. Steps 1, 2, 6 and 9 are not in an example — they
      check your answer against what your pool does, and an example has no pool; the ranges and the bet size they would
      have given are set up above. For all nine,
      <NuxtLink to="/hands" class="underline">open one of your own hands</NuxtLink> and press <em>Analyze this node</em>.
    </p>
  </div>
</template>
