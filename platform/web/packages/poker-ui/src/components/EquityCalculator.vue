<script setup lang="ts">
/**
 * Range-vs-range equity with progressive refinement (spec §5.3): a Monte Carlo pass answers
 * at once, the exact enumeration replaces it when it lands, and the label always says which
 * is shown. Inputs are debounced and superseded jobs are cancelled. The service (a Worker
 * client or an in-process EquityService) comes in through a prop: this package depends on
 * poker-core only.
 */
import type { Card, EquityRequest, EquityResult, WeightedRange } from '@poker/core';
import { EquityCancelled, equityKey, isExactlySolvable } from '@poker/core';
import { computed, onBeforeUnmount, ref, toRaw, watch } from 'vue';

import { explainEquity } from '../explain';
import { percent } from '../format';
import type { EquityServiceLike } from '../service';
import MetricLabel from './MetricLabel.vue';

const props = withDefaults(
  defineProps<{
    ranges: readonly WeightedRange[];
    board: readonly Card[];
    deadCards?: readonly Card[];
    service: EquityServiceLike;
    /** Monte Carlo samples for the fast pass. */
    fastIterations?: number;
    debounceMs?: number;
  }>(),
  { deadCards: () => [], fastIterations: 50_000, debounceMs: 150 },
);
const emit = defineEmits<{ result: [result: EquityResult] }>();

const result = ref<EquityResult | null>(null);
const progress = ref(0);
const status = ref<'idle' | 'running' | 'done' | 'error'>('idle');
const error = ref<string | null>(null);

let generation = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
const jobs: string[] = [];

/** Plain copies: a request crosses into a Worker by structured clone, which refuses Vue's reactive proxies. */
const request = computed<EquityRequest>(() => ({
  ranges: props.ranges.map((r) => {
    const raw = toRaw(r);
    return raw.label === undefined ? { weights: raw.weights } : { weights: raw.weights, label: raw.label };
  }),
  board: [...props.board],
  deadCards: [...props.deadCards],
}));
/**
 * What the inputs are, not which objects carry them: a parent that re-renders (because a
 * result arrived) passes a fresh `ranges` array, and restarting on that would cancel the exact
 * job and loop forever. Only a change in the ranges, the board or the dead cards recomputes.
 */
const key = computed(() => equityKey(request.value));
const exactPossible = computed(() => isExactlySolvable(request.value));
/** What stands behind the numbers, after the method's name: `1,176 runouts` or `2,000 samples · ±0.21 pp`. */
const work = computed(() => {
  if (result.value === null) return '';
  if (result.value.exact) return `${result.value.work.toLocaleString('en-US')} runouts`;
  return `${result.value.iterations?.toLocaleString('en-US')} samples · ±${result.value.confidence95?.toFixed(2)} pp`;
});

function nameOf(player: number): string {
  return props.ranges[player]?.label ?? (player === 0 ? 'Hero' : player === 1 ? 'Villain' : `Player ${player + 1}`);
}
/** The names above the numbers, which the sentence under them uses too. */
const names = computed(() => (result.value?.equities ?? []).map((_, player) => nameOf(player)));
/** Built from the result on screen, so it moves from the Monte Carlo pass to the exact one with the numbers. */
const explanation = computed(() => (result.value === null ? '' : explainEquity(result.value, names.value)));

function cancelAll(): void {
  for (const id of jobs.splice(0)) void props.service.cancel(id);
}

async function runJob(gen: number, id: string, options: Parameters<EquityServiceLike['compute']>[1]): Promise<EquityResult | null> {
  jobs.push(id);
  try {
    const r = await props.service.compute(request.value, options, id, (done, total) => {
      if (gen === generation) progress.value = total === 0 ? 1 : done / total;
    });
    return gen === generation ? r : null;
  } catch (e) {
    if (!(e instanceof EquityCancelled) && gen === generation) {
      status.value = 'error';
      error.value = e instanceof Error ? e.message : String(e);
    }
    return null;
  }
}

async function compute(): Promise<void> {
  const gen = ++generation;
  cancelAll();
  status.value = 'running';
  error.value = null;
  progress.value = 0;
  const fast = await runJob(gen, `fast-${gen}`, { mode: 'monte-carlo', iterations: props.fastIterations });
  if (fast !== null) {
    result.value = fast;
    emit('result', fast);
  }
  if (exactPossible.value) {
    const exact = await runJob(gen, `exact-${gen}`, { mode: 'exact' });
    if (exact !== null) {
      result.value = exact;
      emit('result', exact);
    }
  }
  if (gen === generation && status.value === 'running') status.value = 'done';
}

function schedule(): void {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => void compute(), props.debounceMs);
}

watch(key, schedule, { immediate: true });
onBeforeUnmount(() => {
  if (timer !== null) clearTimeout(timer);
  cancelAll();
});
</script>

<template>
  <div class="pk-equity" aria-live="polite">
    <div class="pk-numbers">
      <div v-for="(eq, i) in result?.equities ?? []" :key="i" class="pk-player">
        <span class="pk-name">{{ names[i] }}</span>
        <span class="pk-value" :data-testid="`equity-${i}`">{{ percent(eq) }}</span>
      </div>
      <p v-if="result === null && status === 'running'" class="pk-muted">Computing…</p>
    </div>
    <p class="pk-status">
      <span v-if="status === 'error'" class="pk-error" role="alert">{{ error }}</span>
      <span v-else-if="result" data-testid="equity-label"><MetricLabel :term="result.exact ? 'exact' : 'monteCarlo'" :label="result.exact ? 'exact' : 'Monte Carlo'" /> · <span data-testid="equity-work">{{ work }}</span><span v-if="status === 'running' && !result.exact && exactPossible"> · exact on the way</span></span>
    </p>
    <p v-if="result" class="pk-explain" data-testid="equity-explain">{{ explanation }}</p>
    <progress v-if="status === 'running'" class="pk-progress" :value="progress" max="1" />
  </div>
</template>

<style scoped>
.pk-equity {
  display: grid;
  gap: 0.4rem;
  color: var(--pk-fg, #18181b);
}
.pk-numbers {
  display: flex;
  flex-wrap: wrap;
  gap: 1.5rem;
}
.pk-player {
  display: grid;
}
.pk-name {
  font-size: 0.8rem;
  color: var(--pk-muted, #71717a);
}
.pk-value {
  font-size: 1.75rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.pk-status {
  margin: 0;
  font-size: 0.8rem;
  color: var(--pk-muted, #71717a);
  min-height: 1.2em;
}
.pk-error {
  color: var(--pk-heart, #dc2626);
}
.pk-explain {
  margin: 0;
  font-size: 0.9rem;
}
.pk-progress {
  width: 100%;
  height: 4px;
}
.pk-muted {
  margin: 0;
  color: var(--pk-muted, #71717a);
}
</style>
