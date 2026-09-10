<script setup lang="ts">
// Step 1 — give every seat still in the hand a range (spec §15.1). The library fills in what is
// already written down for this situation; anything missing is painted here. The reveal is what
// the field actually does at this node, so an opening range is checked against real opens.
import { nodeKeyLabel } from '@poker/core';
import { computed } from 'vue';

import type { AnalysisStep, RangeAssignment } from '~/analyze/api';
import type { StepContext } from '~/analyze/context';
import { poolGap, workPatch } from '~/analyze/context';
import { asPercent } from '~/analyze/reveals';
import { stepDef } from '~/analyze/steps';
import SeatRange from '~/components/analyze/SeatRange.vue';
import StepShell from '~/components/analyze/StepShell.vue';
import { useRangesStore } from '~/stores/ranges';

const props = defineProps<{ ctx: StepContext }>();
const emit = defineEmits<{ patch: [patch: Partial<AnalysisStep>] }>();

const library = useRangesStore();
const definition = stepDef(1);

const seats = computed(() => {
  const key = props.ctx.node;
  if (key === null) return [];
  const villain = key.villain_position;
  return villain === null || villain === key.hero_position ? [key.hero_position] : [key.hero_position, villain];
});

function weightsFor(position: string): string {
  return props.ctx.step.work.ranges.find((r) => r.position === position)?.weights ?? '';
}

function setRange(position: string, weights: string, label = ''): void {
  const others = props.ctx.step.work.ranges.filter((r) => r.position !== position);
  const kept = props.ctx.step.work.ranges.find((r) => r.position === position);
  const assignment: RangeAssignment = { position, weights, label: label === '' ? (kept?.label ?? '') : label };
  emit('patch', workPatch(props.ctx.step, { ranges: [...others, assignment] }));
}

/** The action the node ends with — the one the field's frequency is quoted for. */
const lastAction = computed(() => props.ctx.node?.action_sequence.at(-1)?.action ?? null);

const actual = computed(() => {
  const pool = props.ctx.pool;
  const action = lastAction.value;
  if (pool === null || !pool.enough || action === null) return null;
  return asPercent(pool.frequencies[action] ?? 0);
});

const unavailable = computed(() => poolGap(props.ctx.pool));

async function loadMyChart(): Promise<void> {
  const key = props.ctx.node;
  if (key === null) return;
  const found = await library.lookup(key).catch(() => []);
  const mine = found[0];
  if (mine !== undefined) setRange(key.hero_position, mine.weights, mine.name);
}
</script>

<template>
  <StepShell :step="ctx.step" :def="definition" :actual="actual" :unavailable="unavailable" @patch="emit('patch', $event)">
    <p v-if="ctx.node" class="text-sm text-zinc-500" data-testid="step1-node">Situation: {{ nodeKeyLabel(ctx.node) }}</p>
    <p v-else class="text-sm text-zinc-500">This analysis has no situation yet — set one on the hand it came from.</p>

    <button type="button" class="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700" data-testid="step1-load" @click="loadMyChart">
      Load my chart for this spot
    </button>

    <div class="grid gap-6 lg:grid-cols-2">
      <SeatRange
        v-for="seat in seats"
        :key="seat"
        :label="seat"
        :weights="weightsFor(seat)"
        @update:weights="setRange(seat, $event)"
      />
    </div>
  </StepShell>
</template>
