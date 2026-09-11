<script setup lang="ts">
// The six training modes (spec §16), with what each one is owed a review on.
import { computed, onMounted, shallowRef } from 'vue';

import { MODES } from '~/train/modes';
import { createTrainingCache } from '~/train/cache';
import { accuracyText } from '~/train/progress';
import type { ScoreRow, TrainMode } from '~/train/types';
import { dueFirst } from '@poker/core';

// spec §17: every trainer is pure calculation and works with no backend, so the page is public.
definePageMeta({ public: true });

const scores = shallowRef<ScoreRow[]>([]);
const owed = shallowRef<Record<string, number>>({});

onMounted(async () => {
  const cache = createTrainingCache();
  scores.value = await cache.scores().catch((): ScoreRow[] => []);
  const now = new Date();
  const counts: Record<string, number> = {};
  for (const mode of MODES) {
    counts[mode.mode] = dueFirst(await cache.reviews(mode.mode).catch(() => []), now).length;
  }
  owed.value = counts;
});

function accuracyOf(mode: TrainMode): string {
  const rows = scores.value.filter((row) => row.mode === mode);
  if (rows.length === 0) return '—';
  return accuracyText(rows.filter((row) => row.correct).length / rows.length);
}

function servedOf(mode: TrainMode): number {
  return scores.value.filter((row) => row.mode === mode).length;
}

const total = computed(() => scores.value.length);
</script>

<template>
  <section class="space-y-4">
    <div class="flex flex-wrap items-center gap-3">
      <h1 class="text-2xl font-semibold">Train</h1>
      <p class="text-sm text-zinc-500">
        Commit an answer before you see the truth. Ten minutes is a session.
      </p>
      <NuxtLink
        to="/progress"
        class="ml-auto rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
        data-testid="train-progress"
      >
        Progress →
      </NuxtLink>
    </div>

    <p
      v-if="total === 0"
      class="rounded border border-dashed border-zinc-300 p-6 text-sm dark:border-zinc-700"
      data-testid="train-empty"
    >
      Nothing practised yet. Every mode below works with no internet and no backend — pick one and
      answer a handful of spots. Whatever you get wrong comes back tomorrow, then in three days,
      then in a week.
    </p>

    <ul class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <li
        v-for="mode in MODES"
        :key="mode.mode"
        class="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
      >
        <NuxtLink :to="`/train/${mode.mode}`" class="block space-y-2" :data-testid="`mode-${mode.mode}`">
          <div class="flex items-center gap-2">
            <h2 class="font-medium">{{ mode.title }}</h2>
            <span
              v-if="(owed[mode.mode] ?? 0) > 0"
              class="rounded border border-amber-300 px-2 py-0.5 text-xs text-amber-700 dark:border-amber-700 dark:text-amber-400"
              :data-testid="`due-${mode.mode}`"
            >
              {{ owed[mode.mode] }} owed
            </span>
            <span class="ml-auto text-sm tabular-nums text-zinc-500" :data-testid="`accuracy-${mode.mode}`">
              {{ accuracyOf(mode.mode) }}
            </span>
          </div>
          <p class="text-sm text-zinc-600 dark:text-zinc-400">{{ mode.purpose }}</p>
          <p class="text-xs text-zinc-500">{{ mode.blurb }}</p>
          <p class="text-xs text-zinc-500 tabular-nums">
            {{ servedOf(mode.mode) === 0 ? 'Not started' : `${servedOf(mode.mode)} answered` }}
          </p>
        </NuxtLink>
      </li>
    </ul>
  </section>
</template>
