<script setup lang="ts">
// Step 1 — give every seat still in the hand a range (spec §15.1). The library fills in what is
// already written down for this situation; anything missing is painted here. The reveal is what
// the field actually does at this node, so an opening range is checked against real opens.
import { NodeLabel, useUndoRedo, useUndoShortcuts } from '@poker/ui';
import { computed, ref, watch } from 'vue';

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

/** The name of the chart a seat's range was loaded from; '' when it was painted here. */
function sourceFor(position: string): string {
  return props.ctx.step.work.ranges.find((r) => r.position === position)?.label ?? '';
}

/** One seat's assignment as text, so two lists can be compared without caring about their order. */
function assignmentKey(r: RangeAssignment): string {
  return JSON.stringify([r.position, r.weights, r.label]);
}

/** The same seats with the same ranges, in any order — `setRange` puts the edited seat last. */
function sameAssignments(a: readonly RangeAssignment[], b: readonly RangeAssignment[]): boolean {
  return a.length === b.length && a.map(assignmentKey).sort().join('\n') === b.map(assignmentKey).sort().join('\n');
}

// Undo spans both seats, and every step back or forward is patched and autosaved like any other
// edit (ADR-034). Our own patch coming back — copied or reordered on the way — keeps the history;
// a different list arriving from outside starts it again, since its past is not ours to undo.
const history = useUndoRedo<readonly RangeAssignment[]>(props.ctx.step.work.ranges);
watch(
  () => props.ctx.step.work.ranges,
  (next) => history.sync(next, sameAssignments),
);

function emitRanges(ranges: readonly RangeAssignment[]): void {
  emit('patch', workPatch(props.ctx.step, { ranges: [...ranges] }));
}

function setRange(position: string, weights: string, label = ''): void {
  const others = props.ctx.step.work.ranges.filter((r) => r.position !== position);
  const kept = props.ctx.step.work.ranges.find((r) => r.position === position);
  const assignment: RangeAssignment = { position, weights, label: label === '' ? (kept?.label ?? '') : label };
  history.set([...others, assignment]);
  emitRanges(history.state.value);
}

/** Walk the history — a button or a shortcut — and patch the step only when it actually moved. */
function walk(move: () => void): void {
  const before = history.state.value;
  move();
  if (history.state.value !== before) emitRanges(history.state.value);
}

// The shortcuts go through `walk` too: the history alone would move without saving the step.
useUndoShortcuts(() => ({ onKeydown: (event: KeyboardEvent) => walk(() => history.onKeydown(event)) }));

/** The action the node ends with — the one the field's frequency is quoted for. */
const lastAction = computed(() => props.ctx.node?.action_sequence.at(-1)?.action ?? null);

const actual = computed(() => {
  const pool = props.ctx.pool;
  const action = lastAction.value;
  if (pool === null || !pool.enough || action === null) return null;
  return asPercent(pool.frequencies[action] ?? 0);
});

const unavailable = computed(() => poolGap(props.ctx.pool));

/** Where the last press of "Load my chart" got to, so the button never does nothing silently. */
const lookup = ref<'idle' | 'looking' | 'none' | 'offline' | 'failed'>('idle');

async function loadMyChart(): Promise<void> {
  const key = props.ctx.node;
  if (key === null) return;
  lookup.value = 'looking';
  // `null` is a library that could not be read at all — the API and the offline copy both
  // failed — which is not the same answer as an empty list.
  const found = await library.lookup(key).catch(() => null);
  // "My chart" is an own chart: a solver or pool range stored here is not the reader's to be told is theirs.
  const mine = found?.find((range) => range.source === 'own');
  // An API that did not answer leaves only the offline copy, whose "nothing here" is not the library's.
  const empty = library.status === 'offline' ? 'offline' : 'none';
  lookup.value = found === null ? 'failed' : mine === undefined ? empty : 'idle';
  if (mine !== undefined) setRange(key.hero_position, mine.weights, mine.name);
}
</script>

<template>
  <StepShell :step="ctx.step" :def="definition" :actual="actual" :unavailable="unavailable" @patch="emit('patch', $event)">
    <p v-if="ctx.node" class="text-sm text-zinc-500" data-testid="step1-node">Situation: <NodeLabel :node="ctx.node" /></p>
    <p v-else class="text-sm text-zinc-500">This analysis has no situation yet — set one on the hand it came from.</p>

    <div class="flex flex-wrap items-baseline gap-3">
      <button
        type="button"
        :disabled="lookup === 'looking' || !ctx.node"
        class="rounded border border-zinc-300 px-2 py-1 text-sm disabled:opacity-40 dark:border-zinc-700"
        data-testid="step1-load"
        @click="loadMyChart"
      >
        Load my chart for this spot
      </button>
      <span v-if="lookup === 'looking'" role="status" class="text-sm text-zinc-500" data-testid="step1-loading">Looking in your range library…</span>
      <span v-else-if="lookup === 'none' && ctx.node" role="status" class="text-sm text-zinc-500" data-testid="step1-none">
        No chart of yours is stored for <NodeLabel :node="ctx.node" />.
        <NuxtLink to="/ranges/import" class="underline">Import your charts</NuxtLink>, then press the button again.
      </span>
      <span v-else-if="lookup === 'offline' && ctx.node" role="alert" class="text-sm text-red-600 dark:text-red-400" data-testid="step1-offline">
        {{ library.error }} This browser's offline copy has no chart of yours for <NodeLabel :node="ctx.node" />.
      </span>
      <span v-else-if="lookup === 'failed'" role="alert" class="text-sm text-red-600 dark:text-red-400" data-testid="step1-load-error">
        Your range library could not be read — neither the API nor this browser's offline copy answered.
      </span>
      <span class="ml-auto flex gap-2">
        <button type="button" :disabled="!history.canUndo.value" title="⌘Z" class="rounded border border-zinc-300 px-2 py-1 text-sm disabled:opacity-40 dark:border-zinc-700" data-testid="step1-undo" @click="walk(history.undo)">Undo</button>
        <button type="button" :disabled="!history.canRedo.value" title="⌘⇧Z" class="rounded border border-zinc-300 px-2 py-1 text-sm disabled:opacity-40 dark:border-zinc-700" data-testid="step1-redo" @click="walk(history.redo)">Redo</button>
      </span>
    </div>

    <div class="grid gap-6 lg:grid-cols-2">
      <SeatRange
        v-for="seat in seats"
        :key="seat"
        :label="seat"
        :weights="weightsFor(seat)"
        :source="sourceFor(seat)"
        @update:weights="setRange(seat, $event)"
      />
    </div>
  </StepShell>
</template>
