<script setup lang="ts">
// Step 9 — theory first, then your own pool (spec §15.9). MDF says what a balanced opponent must
// defend; the field says what it actually does. The gap between the two is the heuristic, and it
// is the one thing the whole analysis was for.
import { MDFPanel, PoolDataBadge, PotOddsPanel } from '@poker/ui';
import { computed } from 'vue';

import type { AnalysisStep } from '~/analyze/api';
import type { StepContext } from '~/analyze/context';
import { poolGap, workPatch } from '~/analyze/context';
import { facingNode } from '~/analyze/facing';
import { asPercent } from '~/analyze/reveals';
import { stepDef } from '~/analyze/steps';
import StepShell from '~/components/analyze/StepShell.vue';

const props = defineProps<{ ctx: StepContext }>();
const emit = defineEmits<{ patch: [patch: Partial<AnalysisStep>]; heuristic: [text: string] }>();

const definition = stepDef(9);
const DEFAULT_POT = 10;
const DEFAULT_BET = 6.6;
const PERCENT = 100;

const pot = computed(() => props.ctx.step.work.pot_bb ?? DEFAULT_POT);
const bet = computed(() => props.ctx.step.work.bet_bb ?? DEFAULT_BET);
const mdf = computed(() => pot.value / (pot.value + bet.value));
const committed = computed(() => props.ctx.step.prediction !== null);

// The fold frequency belongs to the seat facing the bet, never to the seat making it: this
// node exists only when hero's last action was one somebody has to answer.
const facingKey = computed(() => facingNode(props.ctx.node));
const facing = computed(() => props.ctx.poolFacing);
const poolFold = computed(() => {
  const pool = facing.value;
  return pool === null || !pool.enough ? null : (pool.frequencies.fold ?? 0);
});
const actual = computed(() => (poolFold.value === null ? null : asPercent(poolFold.value)));

/** Theory says defend `mdf`, so it folds `1 − mdf`; the pool's own fold rate sits beside it. */
const deviation = computed(() => (poolFold.value === null ? null : poolFold.value - (1 - mdf.value)));

/**
 * "Nobody is facing a bet here" is only true when there *is* a node and nobody faces a bet at it.
 * With no situation at all, `facingNode` also answers null, and the context's own reason is the
 * one that fits (ADR-061).
 */
const unavailable = computed(() => {
  if (props.ctx.node !== null && facingKey.value === null) {
    return 'Nobody is facing a bet at this node, so there is no fold frequency to compare against.';
  }
  return poolGap(facing.value, props.ctx.poolFacingMissing);
});

const sentence = computed(() => {
  const gap = deviation.value;
  if (gap === null) return '';
  const points = Math.abs(gap * PERCENT).toFixed(1);
  if (gap > 0) return `Theory folds ${asPercent(1 - mdf.value)}%; your pool folds ${points} points more — bluff here more often.`;
  return `Theory folds ${asPercent(1 - mdf.value)}%; your pool folds ${points} points less — bluff here less often and value bet thinner.`;
});
</script>

<template>
  <StepShell :step="ctx.step" :def="definition" :actual="actual" :unavailable="unavailable" @patch="emit('patch', $event)">
    <div class="grid gap-6 lg:grid-cols-2">
      <PotOddsPanel
        :pot="pot"
        :bet="bet"
        :call="bet"
        @update:pot="emit('patch', workPatch(ctx.step, { pot_bb: $event }))"
        @update:bet="emit('patch', workPatch(ctx.step, { bet_bb: $event }))"
      />
      <MDFPanel
        :pot="pot"
        :bet="bet"
        :range="ctx.spot.villain"
        @update:pot="emit('patch', workPatch(ctx.step, { pot_bb: $event }))"
        @update:bet="emit('patch', workPatch(ctx.step, { bet_bb: $event }))"
      />
    </div>

    <div v-if="committed && facing" class="space-y-1" data-testid="step9-deviation">
      <p v-if="sentence" class="text-sm font-medium">{{ sentence }}</p>
      <PoolDataBadge :tier="1" :sample-size="facing.sample_size" :enough="facing.enough" :min-n="facing.min_n" />
    </div>

    <label v-if="committed" class="block space-y-1">
      <span class="text-sm font-medium">The heuristic this analysis leaves you with</span>
      <textarea
        :value="ctx.heuristic"
        rows="2"
        class="w-full rounded border border-zinc-300 bg-transparent p-2 text-sm dark:border-zinc-700"
        placeholder="One rule you will actually use at the table."
        data-testid="step9-heuristic"
        @input="emit('heuristic', ($event.target as HTMLTextAreaElement).value)"
      />
    </label>
  </StepShell>
</template>
