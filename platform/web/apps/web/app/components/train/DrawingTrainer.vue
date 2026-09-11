<script setup lang="ts">
// The range-drawing trainer (spec §16): draw the chart from memory, then see every cell you got
// wrong.
//
// Two numbers come out of this and they measure different things. The gate compares how *wide*
// your range is with how wide the chart is. The mode's own verdict — the one the review schedule
// believes — is the total absolute weight error, because a range of the right size made of the
// wrong hands is not a range you know. Both are printed, labelled.
import type { WeightedRange } from '@poker/core';
import { createRange, weightedCombos } from '@poker/core';
import { RangeDiffView, RangeMatrix, useUndoRedo } from '@poker/ui';
import { computed, shallowRef, watch } from 'vue';

import { CHART_PROVENANCE } from '~/train/charts';
import { dp } from '~/train/numbers';
import { reference, weightError } from '~/train/spot-drawing';
import type { DrawingSpot } from '~/train/types';

const props = defineProps<{ spot: DrawingSpot; revealed: boolean }>();
const emit = defineEmits<{ 'update:weightError': [error: number] }>();

const BRUSHES = [1, 0.75, 0.5, 0.25];
const brush = shallowRef(1);

const drawing = useUndoRedo<WeightedRange>(createRange(undefined, 'Your range'));

/** A fresh grid for every chart: the last one's shape must not be a head start on this one. */
watch(
  () => props.spot.hash,
  () => drawing.reset(createRange(undefined, 'Your range')),
);

const drawn = computed(() => weightedCombos(drawing.state.value));
const error = computed(() => weightError(drawing.state.value, props.spot));
const known = computed(() => error.value <= props.spot.weightTolerance);
const chart = computed(() => createRange(reference(props.spot).weights, props.spot.chartLabel));

watch(error, (next) => emit('update:weightError', next), { immediate: true });
</script>

<template>
  <div class="space-y-4" @keydown="drawing.onKeydown">
    <div class="flex flex-wrap items-center gap-3">
      <span class="text-sm text-zinc-500">Weight</span>
      <button
        v-for="weight in BRUSHES"
        :key="weight"
        type="button"
        class="rounded border px-2 py-0.5 text-sm"
        :class="
          brush === weight
            ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
            : 'border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900'
        "
        :data-testid="`brush-${weight}`"
        @click="brush = weight"
      >
        {{ Math.round(weight * 100) }}%
      </button>
      <span class="ml-auto text-sm tabular-nums text-zinc-500" data-testid="drawn-combos">
        {{ dp(drawn) }} combos drawn
      </span>
      <button
        type="button"
        class="rounded border border-zinc-300 px-2 py-0.5 text-sm hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-900"
        :disabled="!drawing.canUndo.value"
        data-testid="drawing-undo"
        @click="drawing.undo()"
      >
        Undo
      </button>
      <button
        type="button"
        class="rounded border border-zinc-300 px-2 py-0.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
        data-testid="drawing-clear"
        @click="drawing.set(createRange(undefined, 'Your range'))"
      >
        Clear
      </button>
    </div>

    <RangeMatrix
      v-if="!revealed"
      :range="drawing.state.value"
      mode="edit"
      :brush="brush"
      @update:range="drawing.set($event)"
    />

    <div v-else class="space-y-3">
      <p class="text-sm" data-testid="drawing-verdict">
        <strong :class="known ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'">
          {{ dp(error) }} combos of total error
        </strong>
        against {{ dp(spot.weightTolerance) }} allowed —
        {{ known ? 'you know this chart.' : 'not yet; this one comes back.' }}
        Every hand you drew that is not in the chart counts, and so does every hand you left out.
      </p>
      <RangeDiffView :ranges="[{ label: spot.chartLabel, range: chart }, { label: 'Your range', range: drawing.state.value }]" />
      <p class="text-xs text-zinc-500">{{ CHART_PROVENANCE }}</p>
    </div>
  </div>
</template>
