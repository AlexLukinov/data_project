<script setup lang="ts">
// The analyses you have run, and the two ways to start another (spec §15). An analysis normally
// begins at a hand — "Analyze this node" on the replayer — so the empty state points there rather
// than at a blank form.
import { nodeKeyLabel } from '@poker/core';
import { computed } from 'vue';

import { createAnalysesApi } from '~/analyze/api';
import { LAST_STEP } from '~/analyze/steps';
import { describeApiError } from '~/auth/api';

const api = createAnalysesApi(useApi());
const { data, error, refresh } = await useAsyncData('analyses', () => api.list(), { server: false });

const rows = computed(() => data.value ?? []);

function day(iso: string): string {
  return iso.slice(0, 10);
}

async function remove(id: string): Promise<void> {
  await api.remove(id);
  await refresh();
}
</script>

<template>
  <section class="space-y-4">
    <div class="flex flex-wrap items-baseline gap-3">
      <h1 class="text-xl font-semibold">Analyses</h1>
      <span class="text-sm text-zinc-500">nine steps over one situation, each ending in a heuristic</span>
    </div>

    <p v-if="error" role="alert" class="text-sm text-red-600 dark:text-red-400" data-testid="analyses-error">{{ describeApiError(error) }}</p>

    <ul v-else-if="rows.length" class="divide-y divide-zinc-200 dark:divide-zinc-800" data-testid="analyses-list">
      <li v-for="row in rows" :key="row.id" class="flex flex-wrap items-baseline gap-3 py-2">
        <NuxtLink :to="`/analyze/${row.id}`" class="font-medium underline">{{ row.title }}</NuxtLink>
        <span v-if="row.node_key" class="text-sm text-zinc-500">{{ nodeKeyLabel(row.node_key) }}</span>
        <span class="text-sm text-zinc-500 tabular-nums">{{ row.completed_steps.length }} of {{ LAST_STEP }} · {{ day(row.updated_at) }}</span>
        <span v-if="row.heuristic" class="w-full text-sm">{{ row.heuristic }}</span>
        <button type="button" class="ml-auto text-sm text-zinc-500 hover:underline" :data-testid="`analyses-delete-${row.id}`" @click="remove(row.id)">delete</button>
      </li>
    </ul>

    <div v-else class="space-y-2 rounded border border-dashed border-zinc-300 p-6 text-sm dark:border-zinc-700" data-testid="analyses-empty">
      <p class="font-medium">No analyses yet.</p>
      <p class="text-zinc-500">
        An analysis starts at a hand: open one from
        <NuxtLink to="/hands" class="underline">your hands</NuxtLink>, step to the decision you want to understand, and press
        <em>Analyze this node</em>. You can also
        <NuxtLink to="/hands/paste" class="underline">paste a hand</NuxtLink> you played somewhere else.
      </p>
    </div>
  </section>
</template>
