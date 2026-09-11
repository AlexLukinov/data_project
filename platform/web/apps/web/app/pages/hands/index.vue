<script setup lang="ts">
/**
 * The hand list (plan F.7), bound to the shared filter (plan D.3).
 *
 * The four hard-coded selects this page used to carry were a copy of four registry entries; it
 * now asks the one filter store, so any of the 79 dimensions can narrow the list and the URL it
 * produces opens the same situation in any other screen.
 */
import { computed } from 'vue';

import { describeApiError } from '~/auth/api';
import { useDefinitionsStore } from '~/stores/definitions';
import { useFilterStore } from '~/stores/filter';
import FilterBar from '~/components/filter/FilterBar.vue';

const api = useHands();
const definitions = useDefinitionsStore();
const filter = useFilterStore();
const limit = 100;

useFilterUrl();
await useAsyncData('definitions', () => definitions.load(), { server: false });

const { data, error, status } = await useAsyncData(
  'hands-list',
  () => {
    const dataset = filter.dataset;
    // No condition means no search document: the plain list endpoints are cheaper, and the pool
    // one is the only way to browse hands nobody filtered.
    if (!filter.active) return dataset === 'hero' ? api.recent({ limit }) : api.pool({ limit });
    return api.search({
      dataset,
      hero_only: dataset === 'hero',
      filter: filter.node,
      ...(filter.dateFrom === '' ? {} : { date_from: filter.dateFrom }),
      ...(filter.dateTo === '' ? {} : { date_to: filter.dateTo }),
      limit,
    });
  },
  {
    server: false,
    watch: [() => filter.node, () => filter.dataset, () => filter.dateFrom, () => filter.dateTo],
    default: () => [],
  },
);

const rows = computed(() => data.value ?? []);

function day(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ');
}
</script>

<template>
  <section class="space-y-4">
    <div class="flex flex-wrap items-center gap-3">
      <h1 class="text-2xl font-semibold">Hands</h1>
      <NuxtLink to="/hands/paste" data-testid="hands-paste-link" class="ml-auto rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900">Paste a hand</NuxtLink>
    </div>

    <FilterBar />

    <p class="text-sm text-zinc-500" data-testid="hands-count">{{ rows.length }} hand{{ rows.length === 1 ? '' : 's' }}</p>

    <p v-if="error" role="alert" data-testid="hands-error" class="text-sm text-red-600 dark:text-red-400">{{ describeApiError(error) }}</p>
    <p v-else-if="status === 'pending'" class="text-sm text-zinc-500">Loading…</p>
    <p v-else-if="rows.length === 0" class="text-sm text-zinc-500" data-testid="hands-empty">
      No hands match. <span v-if="filter.dataset === 'hero'">Upload some on <NuxtLink to="/account" class="underline">your account</NuxtLink>, or <NuxtLink to="/hands/paste" class="underline">paste one</NuxtLink>.</span>
    </p>

    <div v-else class="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table class="w-full text-sm">
        <thead class="text-left text-xs text-zinc-500">
          <tr>
            <th class="p-2">played</th>
            <th class="p-2">stake</th>
            <th class="p-2">seat</th>
            <th class="p-2">cards</th>
            <th class="p-2">board</th>
            <th class="p-2 text-right">bb</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="`${row.hand_uid}-${row.seat}`" class="border-t border-zinc-200 dark:border-zinc-800" :data-testid="`hand-row-${row.hand_uid}`">
            <td class="p-2 tabular-nums"><NuxtLink :to="`/hands/${row.hand_uid}?seat=${row.seat}`" class="underline-offset-4 hover:underline">{{ day(row.played_at_utc) }}</NuxtLink></td>
            <td class="p-2">{{ row.stake_level }}</td>
            <td class="p-2">{{ row.position }}</td>
            <td class="p-2">{{ row.hole_cards || '—' }}</td>
            <td class="p-2 text-zinc-500">{{ row.board || '—' }}</td>
            <td class="p-2 text-right tabular-nums" :class="row.net_won_bb > 0 ? 'text-emerald-600 dark:text-emerald-400' : row.net_won_bb < 0 ? 'text-red-600 dark:text-red-400' : ''">{{ row.net_won_bb.toFixed(1) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
