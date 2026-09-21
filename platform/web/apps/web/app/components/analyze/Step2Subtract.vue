<script setup lang="ts">
// Step 2 — split the range that faced an action into fold, call and raise (spec §15.2). What is
// left is what arrives on the flop, and every later step reads that rather than the range that
// was dealt. The diff below the matrices makes the subtraction visible: a call removes from the
// top as well as the bottom.
import type { WeightedRange } from '@poker/core';
import { createRange, parseRange, subtract, union, weightedCombos } from '@poker/core';
import { RangeDiffView } from '@poker/ui';
import { computed } from 'vue';

import type { AnalysisStep, RangeSplit } from '~/analyze/api';
import type { StepContext } from '~/analyze/context';
import { poolGap, workPatch } from '~/analyze/context';
import { asPercent } from '~/analyze/reveals';
import { stepDef } from '~/analyze/steps';
import SeatRange from '~/components/analyze/SeatRange.vue';
import StepShell from '~/components/analyze/StepShell.vue';

const props = defineProps<{ ctx: StepContext }>();
const emit = defineEmits<{ patch: [patch: Partial<AnalysisStep>] }>();

const definition = stepDef(2);
const BRANCHES = ['fold', 'call', 'raise'] as const;

/** The seat being split: the one that faced the action, which is hero at this node. */
const seat = computed(() => props.ctx.node?.hero_position ?? '');

function empty(label: string): WeightedRange {
  return { ...createRange(), label };
}

function parse(weights: string, label: string): WeightedRange {
  if (weights === '') return empty(label);
  try {
    return { ...parseRange(weights).range, label };
  } catch {
    return empty(label);
  }
}

function weightsFor(action: string): string {
  return props.ctx.step.work.splits.find((s) => s.position === seat.value && s.action === action)?.weights ?? '';
}

function setSplit(action: string, weights: string): void {
  const others = props.ctx.step.work.splits.filter((s) => !(s.position === seat.value && s.action === action));
  const split: RangeSplit = { position: seat.value, action, weights };
  emit('patch', workPatch(props.ctx.step, { splits: [...others, split] }));
}

/** The range as step 1 left it, before anything was taken out of it. */
const dealt = computed(() => {
  const found = props.ctx.spot.hero;
  return found === null ? empty(seat.value) : found;
});

const folded = computed(() => parse(weightsFor('fold'), 'folds'));
const carried = computed<WeightedRange>(() => {
  // Painted continues win; with none painted, the folds are simply taken out of the range.
  const kept = [weightsFor('call'), weightsFor('raise')].filter((w) => w !== '').map((w) => parse(w, 'continues'));
  if (kept.length === 0) return { ...subtract(dealt.value, folded.value), label: 'continues' };
  return kept.reduce((all, part) => ({ ...union(all, part), label: 'continues' }));
});

const continuing = computed(() => {
  const total = weightedCombos(dealt.value);
  return total === 0 ? null : weightedCombos(carried.value) / total;
});

const actual = computed(() => {
  const pool = props.ctx.pool;
  if (pool === null || !pool.enough) return null;
  return asPercent(1 - (pool.frequencies.fold ?? 0));
});

const unavailable = computed(() => poolGap(props.ctx.pool, props.ctx.poolMissing));

const sides = computed(() => [
  { label: 'dealt', range: dealt.value },
  { label: 'continues', range: carried.value },
]);
</script>

<template>
  <StepShell :step="ctx.step" :def="definition" :actual="actual" :unavailable="unavailable" @patch="emit('patch', $event)">
    <p class="text-sm text-zinc-500" data-testid="step2-seat">
      Splitting {{ seat }}'s range. Paint each branch; what is not folded is what reaches the next street.
    </p>

    <div class="grid gap-6 lg:grid-cols-3">
      <SeatRange
        v-for="branch in BRANCHES"
        :key="branch"
        :label="branch"
        :weights="weightsFor(branch)"
        :blocked-cards="ctx.spot.board"
        @update:weights="setSplit(branch, $event)"
      />
    </div>

    <p v-if="continuing !== null" class="text-sm" data-testid="step2-continues">
      {{ weightedCombos(carried).toFixed(0) }} of {{ weightedCombos(dealt).toFixed(0) }} combos continue — {{ asPercent(continuing) }}% of the range.
    </p>

    <div>
      <p class="mb-1 text-sm font-medium">What the split removed</p>
      <RangeDiffView :ranges="sides" />
    </div>
  </StepShell>
</template>
