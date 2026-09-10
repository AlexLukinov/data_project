<script setup lang="ts">
// The range library (spec §11.1): browse, search and filter the stored ranges; open one; import
// a folder; compare at a situation; download the backup. Signed-in only: the library lives on
// the server, with the Dexie copy answering when the API is away.
import { POSITIONS, nodeKeyLabel } from '@poker/core';
import { computed, ref } from 'vue';

import type { RangeSource } from '~/ranges/api';
import { useRangesStore } from '~/stores/ranges';

const store = useRangesStore();
const q = ref('');
const source = ref<'' | RangeSource>('');
const position = ref('');
const filters = computed(() => ({ q: q.value || undefined, source: source.value || undefined, hero_position: position.value || undefined }));
const { refresh } = await useAsyncData('ranges', () => store.load(filters.value), { server: false, watch: [filters] });

const backupError = ref<string | null>(null);

/** The library as our own JSON, saved through a temporary link; `poker-importers` reads it back. */
async function backup(): Promise<void> {
  backupError.value = null;
  try {
    const doc = await store.exportAll();
    const url = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `poker-ranges-${doc.exported_at.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    backupError.value = 'The backup needs the API: start it with `make api` in platform/.';
  }
}

function day(iso: string): string {
  return iso.slice(0, 10);
}
</script>

<template>
  <section class="space-y-4">
    <div class="flex flex-wrap items-center gap-3">
      <h1 class="text-2xl font-semibold">Range library</h1>
      <span class="ml-auto flex gap-2 text-sm">
        <NuxtLink to="/ranges/import" data-testid="ranges-import" class="rounded border border-zinc-300 px-3 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900">Import a folder</NuxtLink>
        <NuxtLink to="/ranges/compare" data-testid="ranges-compare" class="rounded border border-zinc-300 px-3 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900">Compare</NuxtLink>
        <button type="button" data-testid="ranges-backup" class="rounded border border-zinc-300 px-3 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900" @click="backup">Download backup</button>
      </span>
    </div>

    <p v-if="store.error" role="status" data-testid="ranges-offline" class="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">{{ store.error }}</p>
    <p v-if="backupError" role="alert" class="text-sm text-red-600 dark:text-red-400">{{ backupError }}</p>

    <form class="flex flex-wrap gap-2 text-sm" @submit.prevent="refresh()">
      <input v-model.lazy="q" type="search" placeholder="search names" aria-label="search names" class="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700" />
      <select v-model="source" aria-label="source" class="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700">
        <option value="">any source</option>
        <option value="own">my charts</option>
        <option value="solver">solver</option>
        <option value="pool">pool</option>
      </select>
      <select v-model="position" aria-label="hero position" class="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700">
        <option value="">any position</option>
        <option v-for="p in POSITIONS" :key="p" :value="p">{{ p }}</option>
      </select>
      <span class="self-center text-zinc-500" data-testid="ranges-count">{{ store.items.length }} range{{ store.items.length === 1 ? '' : 's' }}</span>
    </form>

    <p v-if="store.status === 'ready' && store.items.length === 0" class="text-sm text-zinc-500" data-testid="ranges-empty">
      No ranges yet. <NuxtLink to="/ranges/import" class="underline">Import a folder of charts</NuxtLink> to start the library.
    </p>

    <div v-else class="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table class="w-full text-sm">
        <thead class="text-left text-xs text-zinc-500">
          <tr>
            <th class="p-2">name</th>
            <th class="p-2">situation</th>
            <th class="p-2">source</th>
            <th class="p-2">tags</th>
            <th class="p-2">version</th>
            <th class="p-2">updated</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in store.items" :key="r.id" class="border-t border-zinc-200 dark:border-zinc-800" :data-testid="`range-row-${r.id}`">
            <td class="p-2"><NuxtLink :to="`/ranges/${r.id}`" class="font-medium underline-offset-4 hover:underline">{{ r.name }}</NuxtLink></td>
            <td class="p-2">{{ nodeKeyLabel(r.node_key) }}</td>
            <td class="p-2">{{ r.source }}<span v-if="r.source_tool" class="text-zinc-500"> · {{ r.source_tool }}</span></td>
            <td class="p-2 text-zinc-500">{{ r.tags.join(', ') }}</td>
            <td class="p-2 tabular-nums">v{{ r.version }}</td>
            <td class="p-2 tabular-nums text-zinc-500">{{ day(r.updated_at) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
