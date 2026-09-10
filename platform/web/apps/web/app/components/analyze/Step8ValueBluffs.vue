<script setup lang="ts">
// Step 8 — mark your own value and your own bluffs, and see the ratio you are actually playing
// against the one the size balances at (spec §15.8). Then the bluffs you should be picking,
// ranked by blocker score.
import type { WeightedRange } from '@poker/core';
import { alpha, createRange, parseRange } from '@poker/core';
import { BlockerPanel } from '@poker/ui';
import { computed } from 'vue';

import type { AnalysisStep } from '~/analyze/api';
import type { StepContext } from '~/analyze/context';
import { workOf, workPatch } from '~/analyze/context';
import { bluffToValue } from '~/analyze/reveals';
import { stepDef } from '~/analyze/steps';
import SeatRange from '~/components/analyze/SeatRange.vue';
import StepShell from '~/components/analyze/StepShell.vue';

const props = defineProps<{ ctx: StepContext }>();
const emit = defineEmits<{ patch: [patch: Partial<AnalysisStep>] }>();

const definition = stepDef(8);
const RATIO_PLACES = 2;
const DEFAULT_SIZE_PCT = 1;
const SIZE_FROM_STEP = 6;
const NOTHING = createRange(undefined, 'folds');

function parse(weights: string, label: string): WeightedRange | null {
  if (weights === '') return null;
  try {
    return { ...parseRange(weights).range, label };
  } catch {
    return null;
  }
}

const value = computed(() => parse(props.ctx.step.work.value_weights, 'value'));
const bluffs = computed(() => parse(props.ctx.step.work.bluff_weights, 'bluffs'));

/** The size committed at step 6, as a share of the pot; pot-sized when none was given there. */
const sizePct = computed(() => workOf(props.ctx.steps, SIZE_FROM_STEP)?.size_pct ?? DEFAULT_SIZE_PCT);
/** A bet of `s` pots balances at `s / (1 + s)` bluffs per value combo — that is alpha (ADR of F.3). */
const balanced = computed(() => alpha(1, sizePct.value));

const ratio = computed(() => bluffToValue(value.value, bluffs.value));
const actual = computed(() => (ratio.value === null ? null : ratio.value.toFixed(RATIO_PLACES)));

const verdict = computed(() => {
  if (ratio.value === null) return '';
  const gap = ratio.value - balanced.value;
  if (Math.abs(gap) < 0.05) return 'that is balanced for this size';
  return gap > 0 ? 'you are bluffing more often than the size supports' : 'you are bluffing less often than the size allows';
});

function setValue(weights: string): void {
  emit('patch', workPatch(props.ctx.step, { value_weights: weights }));
}

function setBluffs(weights: string): void {
  emit('patch', workPatch(props.ctx.step, { bluff_weights: weights }));
}
const unavailable = computed(() => (ratio.value === null ? 'Mark the value half of your range above and the ratio can be counted.' : ''));
</script>

<template>
  <StepShell :step="ctx.step" :def="definition" :actual="actual" :unavailable="unavailable" @patch="emit('patch', $event)">
    <div class="grid gap-6 lg:grid-cols-2">
      <SeatRange label="value" :weights="ctx.step.work.value_weights" :blocked-cards="ctx.spot.board" @update:weights="setValue" />
      <SeatRange label="bluffs" :weights="ctx.step.work.bluff_weights" :blocked-cards="ctx.spot.board" @update:weights="setBluffs" />
    </div>

    <p v-if="ratio !== null" class="text-sm" data-testid="step8-ratio">
      You are playing {{ ratio.toFixed(RATIO_PLACES) }} bluffs per value combo; a
      {{ (sizePct * 100).toFixed(0) }}% pot bet balances at {{ balanced.toFixed(RATIO_PLACES) }} — {{ verdict }}.
    </p>

    <div v-if="ctx.spot.hero && ctx.spot.villain">
      <p class="mb-1 text-sm font-medium">Which bluffs to pick</p>
      <BlockerPanel :hero-range="ctx.spot.hero" :villain-call="ctx.spot.villain" :villain-fold="NOTHING" :board="ctx.spot.board" />
    </div>
  </StepShell>
</template>
