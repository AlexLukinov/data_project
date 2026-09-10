<script setup lang="ts">
// Hands to replay (spec §9.4): my own, the pool's, or a situation search across either. Pasting
// a hand has its own page. The situation selects are registry dimensions, so the filter here is
// the same document the Reports workbench will produce (ADR-022).
import { computed, ref } from 'vue';

import type { Dataset } from '~/hands/api';
import { ACTIONS, FACING, POSITIONS, STREETS, situationFilter, situationLabel } from '~/hands/search';
import { describeApiError } from '~/auth/api';

const api = useHands();
const dataset = ref<Dataset>('hero');
const situation = ref({ street: '', position: '', facing: '', action: '' });
const stake = ref('');
const limit = 100;

const chosen = computed(() => situationFilter(situation.value));
const label = computed(() => situationLabel(situation.value));

const { data, error, status } = await useAsyncData(
  'hands-list',
  () => {
    const filter = chosen.value;
    if (filter !== null) return api.search({ dataset: dataset.value, hero_only: dataset.value === 'hero', filter, limit });
    return dataset.value === 'hero' ? api.recent({ limit }) : api.pool({ limit, stake_level: stake.value || undefined });
  },
  { server: false, watch: [dataset, chosen, stake], default: () => [] },
);

const rows = computed(() => data.value ?? []);

function clear(): void {
  situation.value = { street: '', position: '', facing: '', action: '' };
}

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

    <div class="flex gap-2 text-sm">
      <button type="button" data-testid="hands-tab-hero" :class="dataset === 'hero' ? 'border-zinc-900 font-medium dark:border-zinc-100' : 'border-transparent text-zinc-500'" class="border-b-2 px-1 py-1" @click="dataset = 'hero'">My hands</button>
      <button type="button" data-testid="hands-tab-pool" :class="dataset === 'population' ? 'border-zinc-900 font-medium dark:border-zinc-100' : 'border-transparent text-zinc-500'" class="border-b-2 px-1 py-1" @click="dataset = 'population'">Pool</button>
    </div>

    <form class="flex flex-wrap items-center gap-2 text-sm" @submit.prevent>
      <select v-model="situation.street" aria-label="street" data-testid="hands-street" class="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700">
        <option value="">any street</option>
        <option v-for="s in STREETS" :key="s" :value="s">{{ s }}</option>
      </select>
      <select v-model="situation.position" aria-label="position" data-testid="hands-position" class="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700">
        <option value="">any position</option>
        <option v-for="p in POSITIONS" :key="p" :value="p">{{ p }}</option>
      </select>
      <select v-model="situation.facing" aria-label="facing" data-testid="hands-facing" class="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700">
        <option value="">facing anything</option>
        <option v-for="f in FACING" :key="f" :value="f">facing {{ f.replace('_plus', '+') }}</option>
      </select>
      <select v-model="situation.action" aria-label="action" data-testid="hands-action" class="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700">
        <option value="">any action</option>
        <option v-for="a in ACTIONS" :key="a" :value="a">{{ a }}</option>
      </select>
      <input v-if="dataset === 'population'" v-model.lazy="stake" type="search" placeholder="stake, e.g. NL50" aria-label="stake" class="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700" />
      <button v-if="chosen" type="button" data-testid="hands-clear" class="text-zinc-500 underline" @click="clear">clear</button>
      <span class="text-zinc-500" data-testid="hands-count">{{ rows.length }} hand{{ rows.length === 1 ? '' : 's' }} · {{ label }}</span>
    </form>

    <p v-if="error" role="alert" data-testid="hands-error" class="text-sm text-red-600 dark:text-red-400">{{ describeApiError(error) }}</p>
    <p v-else-if="status === 'pending'" class="text-sm text-zinc-500">Loading…</p>
    <p v-else-if="rows.length === 0" class="text-sm text-zinc-500" data-testid="hands-empty">
      No hands match. <span v-if="dataset === 'hero'">Upload some on <NuxtLink to="/account" class="underline">your account</NuxtLink>, or <NuxtLink to="/hands/paste" class="underline">paste one</NuxtLink>.</span>
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
