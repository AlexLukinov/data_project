<script setup lang="ts">
/**
 * The hand list (plan F.7), bound to the shared filter (plan D.3).
 *
 * The four hard-coded selects this page used to carry were a copy of four registry entries; it
 * now asks the one filter store, so any of the 79 dimensions can narrow the list and the URL it
 * produces opens the same situation in any other screen.
 *
 * The tag filter (plan D.7b) is the one narrowing that is **not** a clause: tags live in
 * Postgres, so the API intersects the list with the tag's hands rather than compiling a
 * condition (ADR-048). It therefore travels as its own `?tag=` beside the filter's `?f=`, which
 * `useFilterUrl` leaves alone, and every row shows its tags.
 */
import { computed } from 'vue';

import { describeApiError } from '~/auth/api';
import { useDefinitionsStore } from '~/stores/definitions';
import { useFilterStore } from '~/stores/filter';
import FilterBar from '~/components/filter/FilterBar.vue';
import { createHandNotesApi } from '~/hands/notes';
import { unsearchableReason } from '~/hands/searchable';

const api = useHands();
const notesApi = createHandNotesApi(useApi());
const definitions = useDefinitionsStore();
const filter = useFilterStore();
const route = useRoute();
const router = useRouter();
const limit = 100;

useFilterUrl();
await useAsyncData('definitions', () => definitions.load(), { server: false });

/** The tag this list is narrowed to, straight from the URL; '' for none. */
const tag = computed(() => (typeof route.query.tag === 'string' ? route.query.tag : ''));
const { data: vocabulary } = await useAsyncData('hand-tag-vocabulary', () => notesApi.vocabulary(), { server: false, default: () => [] });
/** The tags to offer: everything in use, plus the URL's own if it names one no hand carries. */
const tagChoices = computed(() => {
  const known = vocabulary.value.map((entry) => entry.tag);
  return tag.value !== '' && !known.includes(tag.value) ? [tag.value, ...known] : known;
});

function setTag(event: Event): void {
  const next = (event.target as HTMLSelectElement).value;
  void router.replace({ query: { ...route.query, tag: next === '' ? undefined : next } });
}

/** Why this situation cannot be asked of a hand list, if it cannot (plan D.7). */
const unsearchable = computed(() => unsearchableReason(filter.clauses, definitions.byCode));

const { data, error, status } = await useAsyncData(
  'hands-list',
  () => {
    const dataset = filter.dataset;
    // A situation the decisions mart cannot answer is refused here rather than at the compiler,
    // which would answer a click with `dimension 'saw_flop' is not available for …`.
    if (unsearchable.value !== null) return Promise.resolve([]);
    // The date bounds belong to every branch: they are not clauses, so `filter.active` does not
    // count them, and forwarding them only on the search path left the two date boxes FilterBar
    // renders doing nothing whenever no condition was set.
    const bounds = {
      ...(filter.dateFrom === '' ? {} : { date_from: filter.dateFrom }),
      ...(filter.dateTo === '' ? {} : { date_to: filter.dateTo }),
      ...(tag.value === '' ? {} : { tag: tag.value }),
    };
    // No condition means no search document: the plain list endpoints are cheaper, and the pool
    // one is the only way to browse hands nobody filtered.
    if (!filter.active) return dataset === 'hero' ? api.recent({ ...bounds, limit }) : api.pool({ ...bounds, limit });
    const { tag: chosen, ...dates } = bounds;
    return api.search({ dataset, hero_only: dataset === 'hero', filter: filter.node, ...dates, limit }, chosen);
  },
  {
    server: false,
    watch: [() => filter.node, () => filter.dataset, () => filter.dateFrom, () => filter.dateTo, unsearchable, tag],
    default: () => [],
  },
);

const rows = computed(() => data.value ?? []);
/** The endpoints answer with a bare array, so a full page is the only sign there are more. */
const truncated = computed(() => rows.value.length === limit);

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

    <label v-if="tagChoices.length > 0" class="flex items-center gap-2 text-sm">
      <span class="text-zinc-500">Tagged</span>
      <select :value="tag" data-testid="hands-tag-filter" class="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700" @change="setTag">
        <option value="">any</option>
        <option v-for="choice in tagChoices" :key="choice" :value="choice">{{ choice }}</option>
      </select>
    </label>

    <p class="text-sm text-zinc-500" data-testid="hands-count">
      {{ rows.length }} hand{{ rows.length === 1 ? '' : 's' }}<span v-if="tag"> tagged “{{ tag }}”</span><span v-if="truncated">, the most recent — refine the situation to see fewer</span>
    </p>

    <p v-if="unsearchable" role="status" data-testid="hands-unsearchable" class="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">{{ unsearchable }}</p>
    <p v-else-if="error" role="alert" data-testid="hands-error" class="text-sm text-red-600 dark:text-red-400">{{ describeApiError(error) }}</p>
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
            <th class="p-2">tags</th>
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
            <td class="p-2" :data-testid="`hand-tags-${row.hand_uid}`">
              <span v-for="t in row.tags" :key="t" class="mr-1 inline-block rounded-full border border-zinc-300 px-2 text-xs dark:border-zinc-700">{{ t }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
