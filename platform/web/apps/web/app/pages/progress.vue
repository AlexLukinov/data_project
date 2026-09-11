<script setup lang="ts">
// Progress (spec §16, acceptance 11): accuracy per mode over the last month, the breakdown per
// hand class or texture, and the heuristic log with its fourteen-day prompt.
//
// Everything but the log is read from the browser's own scoring store, so this page is as honest
// with the API down as with it up. The log says for itself which of its rows have reached the
// server.
import { computed, onMounted, shallowRef } from 'vue';

import AccuracyTrend from '~/components/train/AccuracyTrend.vue';
import HeuristicLog from '~/components/train/HeuristicLog.vue';
import { createTrainingCache } from '~/train/cache';
import { MODES, modeDef } from '~/train/modes';
import { TREND_DAYS, accuracyText, progressOf, trend } from '~/train/progress';
import type { ScoreRow } from '~/train/types';
import { useHeuristicsStore } from '~/stores/heuristics';

// spec §17: the scoring store is local, so progress reads with no backend at all.
definePageMeta({ public: true });

const rows = shallowRef<ScoreRow[]>([]);
const loaded = shallowRef(false);
const now = new Date();
const log = useHeuristicsStore();

onMounted(async () => {
  rows.value = await createTrainingCache().scores().catch((): ScoreRow[] => []);
  loaded.value = true;
  // The log needs the API to sync but not to render; a refusal leaves the browser copy on screen.
  await log.load();
});

const overall = computed(() => trend(rows.value, now, TREND_DAYS));
const modes = computed(() =>
  MODES.map((mode) => progressOf(mode.mode, rows.value, now, TREND_DAYS)).filter(
    (progress) => progress.served > 0,
  ),
);
const answered = computed(() => rows.value.length);
const right = computed(() => rows.value.filter((row) => row.correct).length);
</script>

<template>
  <section class="space-y-8">
    <div class="flex flex-wrap items-center gap-3">
      <h1 class="text-2xl font-semibold">Progress</h1>
      <p class="text-sm text-zinc-500">The last {{ TREND_DAYS }} days.</p>
      <NuxtLink
        to="/train"
        class="ml-auto rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
        data-testid="progress-train"
      >
        ← Train
      </NuxtLink>
    </div>

    <p
      v-if="loaded && answered === 0"
      class="rounded border border-dashed border-zinc-300 p-6 text-sm dark:border-zinc-700"
      data-testid="progress-empty"
    >
      Nothing to chart yet.
      <NuxtLink to="/train" class="underline">Train for ten minutes</NuxtLink> and this page starts
      showing where you are reliable and where you are guessing.
    </p>

    <section v-else-if="loaded" class="space-y-3">
      <div class="flex flex-wrap items-baseline gap-x-6">
        <h2 class="text-lg font-semibold">Everything</h2>
        <p class="text-sm tabular-nums text-zinc-500" data-testid="progress-overall">
          {{ right }} of {{ answered }} right — {{ accuracyText(answered === 0 ? null : right / answered) }}
        </p>
      </div>
      <AccuracyTrend :points="overall" />
    </section>

    <section v-for="progress in modes" :key="progress.mode" class="space-y-3">
      <div class="flex flex-wrap items-baseline gap-x-6">
        <h2 class="text-lg font-semibold">{{ modeDef(progress.mode).title }}</h2>
        <p class="text-sm tabular-nums text-zinc-500" :data-testid="`progress-${progress.mode}`">
          {{ progress.right }} of {{ progress.served }} right — {{ accuracyText(progress.accuracy) }}
        </p>
        <NuxtLink
          :to="`/train/${progress.mode}`"
          class="ml-auto text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          Practise →
        </NuxtLink>
      </div>

      <div class="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <AccuracyTrend :points="progress.days" />

        <div v-if="progress.buckets.length > 0" class="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table class="w-full text-sm">
            <thead class="text-left text-xs text-zinc-500">
              <tr>
                <th class="p-2">Where</th>
                <th class="p-2">Answered</th>
                <th class="p-2">Right</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="bucket in progress.buckets"
                :key="bucket.bucket"
                class="border-t border-zinc-200 dark:border-zinc-800"
              >
                <td class="p-2">{{ bucket.bucket }}</td>
                <td class="p-2 tabular-nums">{{ bucket.served }}</td>
                <td
                  class="p-2 tabular-nums"
                  :class="bucket.accuracy >= 0.5 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'"
                >
                  {{ accuracyText(bucket.accuracy) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <HeuristicLog />
  </section>
</template>
