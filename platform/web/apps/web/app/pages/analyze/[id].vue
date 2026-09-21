<script setup lang="ts">
// The 9-step analyzer (spec §15). The rail on the left, one step at a time on the right, and an
// autosave that keeps the work in the browser the moment it is typed and on the server shortly
// after. Each step is its own component; this page owns the state they all read.
import type { NodeKey } from '@poker/core';
import { StepperNav } from '@poker/ui';
import { computed, onBeforeUnmount, ref, watch } from 'vue';

import type { AnalysisStep } from '~/analyze/api';
import type { StepContext } from '~/analyze/context';
import { completedSteps, stepOf } from '~/analyze/session';
import { facingNode } from '~/analyze/facing';
import { NO_SITUATION, analyzeFacingProblem, analyzePoolProblem } from '~/analyze/problems';
import { spotFrom } from '~/analyze/spot';
import { FIRST_STEP, LAST_STEP, STEP_LABELS } from '~/analyze/steps';
import { describeApiError } from '~/auth/api';
import Step1Ranges from '~/components/analyze/Step1Ranges.vue';
import Step2Subtract from '~/components/analyze/Step2Subtract.vue';
import Step3Buckets from '~/components/analyze/Step3Buckets.vue';
import Step4Nuts from '~/components/analyze/Step4Nuts.vue';
import Step5Blockers from '~/components/analyze/Step5Blockers.vue';
import Step6Decision from '~/components/analyze/Step6Decision.vue';
import Step7Placement from '~/components/analyze/Step7Placement.vue';
import Step8ValueBluffs from '~/components/analyze/Step8ValueBluffs.vue';
import Step9Deviation from '~/components/analyze/Step9Deviation.vue';
import type { NodeFrequencies } from '~/pool/api';
import { createPoolApi } from '~/pool/api';
import { useAnalysisStore } from '~/stores/analysis';

const STEP_COMPONENTS = [
  Step1Ranges,
  Step2Subtract,
  Step3Buckets,
  Step4Nuts,
  Step5Blockers,
  Step6Decision,
  Step7Placement,
  Step8ValueBluffs,
  Step9Deviation,
];

const SAVE_WORDS: Record<string, string> = {
  idle: '',
  saving: 'saving…',
  saved: 'saved',
  offline: 'saved in this browser only — the server did not answer',
};

const route = useRoute();
const store = useAnalysisStore();
const poolApi = createPoolApi(useApi());

const id = route.params.id as string;
const failure = ref<unknown>(null);
const pool = ref<NodeFrequencies | null>(null);
const poolFacing = ref<NodeFrequencies | null>(null);
/** Why each of the two pool answers is not here — empty while its request is still in flight. */
const poolMissing = ref('');
const poolFacingMissing = ref('');

/**
 * Not awaited, so the page — and its "Opening the analysis…" — renders while the request runs; an
 * awaited open held the whole app blank until it answered. The store still holds the analysis
 * opened before this one, so nothing reads it until this id's open has finished.
 */
const opened = ref(false);
void store
  .open(id)
  .catch((error: unknown) => (failure.value = error))
  .finally(() => (opened.value = true));

const analysis = computed(() => (opened.value ? store.analysis : null));
const current = computed(() => analysis.value?.current_step ?? FIRST_STEP);
const step = computed(() => stepOf(analysis.value, current.value));
const node = computed(() => analysis.value?.node_key ?? null);
const spot = computed(() => spotFrom(analysis.value?.steps ?? [], node.value));
const done = computed(() => completedSteps(analysis.value));

/**
 * One object, read through getters, so a step always sees the *current* analysis.
 *
 * Not a fresh object per render: props only reach a child on the next render, so two changes in
 * one tick would both be built from the same stale snapshot and the first would be lost. The
 * getters are still tracked by the child's render, so it updates exactly as before.
 */
const context: StepContext = {
  get step() {
    return step.value;
  },
  get steps() {
    return analysis.value?.steps ?? [];
  },
  get node() {
    return node.value;
  },
  get spot() {
    return spot.value;
  },
  get pool() {
    return pool.value;
  },
  get poolFacing() {
    return poolFacing.value;
  },
  // With no situation there is no request to make, so nothing can fail and nothing can arrive:
  // the reason has to come from the page rather than from a catch (ADR-061).
  get poolMissing() {
    return node.value === null ? NO_SITUATION : poolMissing.value;
  },
  get poolFacingMissing() {
    return node.value === null ? NO_SITUATION : poolFacingMissing.value;
  },
  get heuristic() {
    return analysis.value?.heuristic ?? '';
  },
};

/**
 * The field's answer at this node — fetched only once a prediction has been committed, so it
 * cannot be read off the page before the gate is closed.
 *
 * The two questions settle independently and each refusal becomes a sentence the gate shows
 * instead of waiting for ever (ADR-061): one can be answered while the other is refused, and a
 * refusal under load is the common case — this asks twice at once, and ClickHouse answers only a
 * few of an account's queries at a time (plan E.3). An answer already held is not asked again;
 * one that failed is, the next time the reader moves between committed steps.
 */
/** One run at a time: two commits in quick succession would otherwise double the load that refuses. */
let asking = false;

async function loadPool(): Promise<void> {
  const key = node.value;
  if (key === null || asking) return;
  asking = true;
  try {
    await askPool(key);
  } finally {
    asking = false;
  }
}

async function askPool(key: NodeKey): Promise<void> {
  if (pool.value === null) {
    poolMissing.value = '';
    pool.value = await poolApi.frequencies(key).catch((error: unknown) => {
      poolMissing.value = analyzePoolProblem(error);
      return null;
    });
  }
  const facing = facingNode(key);
  if (facing === null || poolFacing.value !== null) return;
  poolFacingMissing.value = '';
  poolFacing.value = await poolApi.frequencies(facing).catch((error: unknown) => {
    poolFacingMissing.value = analyzeFacingProblem(error);
    return null;
  });
}

// The step number is watched as well as the commit, so a refused question is asked again when the
// reader moves on — without it, `committed` stays true across steps and the watcher never fires.
watch(
  () => [current.value, step.value.prediction !== null] as const,
  ([, committed]) => {
    if (committed) void loadPool();
  },
  { immediate: true },
);

function onPatch(patch: Partial<AnalysisStep>): void {
  store.patchStep(current.value, patch);
}

function goTo(next: number): void {
  store.goTo(Math.min(Math.max(next, FIRST_STEP), LAST_STEP));
}

onBeforeUnmount(() => void store.flush());
</script>

<template>
  <section class="space-y-4">
    <div class="flex flex-wrap items-baseline gap-3">
      <NuxtLink to="/analyze" class="text-sm text-zinc-500 hover:underline">← analyses</NuxtLink>
      <h1 class="text-xl font-semibold" data-testid="analysis-title">{{ analysis?.title ?? 'Analysis' }}</h1>
      <span class="ml-auto text-sm text-zinc-500" data-testid="analysis-save-status">{{ SAVE_WORDS[store.status] }}</span>
    </div>

    <p v-if="failure" role="alert" class="text-sm text-red-600 dark:text-red-400" data-testid="analysis-error">{{ describeApiError(failure) }}</p>

    <div v-else-if="analysis" class="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <aside class="space-y-3">
        <StepperNav :steps="STEP_LABELS" :current="current" :completed="done" @navigate="goTo" />
        <p v-if="analysis.heuristic" class="rounded border border-zinc-200 p-2 text-sm dark:border-zinc-800" data-testid="analysis-heuristic">
          <span class="block text-xs uppercase tracking-wide text-zinc-500">heuristic</span>{{ analysis.heuristic }}
        </p>
      </aside>

      <div class="space-y-4">
        <component
          :is="STEP_COMPONENTS[current - 1]"
          :ctx="context"
          @patch="onPatch"
          @heuristic="store.setHeuristic($event)"
        />

        <nav class="flex items-center gap-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <button type="button" class="rounded border border-zinc-300 px-3 py-1 text-sm disabled:opacity-40 dark:border-zinc-700" :disabled="current === FIRST_STEP" data-testid="analysis-prev" @click="goTo(current - 1)">← previous</button>
          <button type="button" class="rounded border border-zinc-300 px-3 py-1 text-sm disabled:opacity-40 dark:border-zinc-700" :disabled="current === LAST_STEP" data-testid="analysis-next" @click="goTo(current + 1)">next step →</button>
          <span class="text-sm text-zinc-500">{{ done.length }} of {{ LAST_STEP }} predictions committed</span>
        </nav>
      </div>
    </div>

    <p v-else class="text-sm text-zinc-500" data-testid="analysis-loading">Opening the analysis…</p>
  </section>
</template>
