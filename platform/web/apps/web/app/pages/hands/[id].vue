<script setup lang="ts">
// One stored hand, replayed (spec §9.4). `?seat=` names the seat to watch, which is how a pool
// hand — having no hero — still opens on somebody in particular.
import { computed } from 'vue';

import { describeApiError } from '~/auth/api';
import HandNotes from '~/components/hands/HandNotes.vue';
import HandStudy from '~/components/hands/HandStudy.vue';
import { createHandNotesApi } from '~/hands/notes';
import { toReplayHand } from '~/hands/replay';
import { useFilterStore } from '~/stores/filter';

const api = useHands();
// The note and the tags (plan D.7b) are only for a *stored* hand: a pasted one has no uid and
// nothing on the server to hang them on, which is why the panel lives on this page, not in
// `HandStudy`.
const notesApi = createHandNotesApi(useApi());
const route = useRoute();
// The way back carries the situation, so opening a hand in a new tab and going back still lands
// on the set it came from. This page does not call `useFilterUrl()` — a hand's own link stays a
// hand's link — so the query is read off the shared store rather than out of this URL.
const filter = useFilterStore();
const handUid = route.params.id as string;
const seat = computed(() => {
  const asked = Number(route.query.seat);
  return Number.isInteger(asked) ? asked : null;
});

const { data, error } = await useAsyncData(`hand-${handUid}`, () => api.get(handUid), { server: false, lazy: true });
const hand = computed(() => (data.value === undefined ? null : toReplayHand(data.value)));

function day(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ');
}
</script>

<template>
  <section class="space-y-4">
    <div class="flex flex-wrap items-baseline gap-3">
      <NuxtLink :to="{ path: '/hands', query: filter.query }" data-testid="hand-back" class="text-sm text-zinc-500 hover:underline">← hands</NuxtLink>
      <h1 class="text-xl font-semibold" data-testid="hand-title">{{ data ? `${data.stake_level} · ${day(data.played_at_utc)}` : 'Hand' }}</h1>
      <span v-if="data" class="text-sm text-zinc-500">{{ data.site }} · {{ data.site_hand_id }}</span>
    </div>

    <p v-if="error" role="alert" data-testid="hand-error" class="text-sm text-red-600 dark:text-red-400">{{ describeApiError(error) }}</p>
    <template v-else-if="hand">
      <HandStudy :hand="hand" :watch-seat="seat" />
      <HandNotes :hand-uid="handUid" :api="notesApi" />
    </template>
    <p v-else class="text-sm text-zinc-500" data-testid="hand-loading">Opening the hand…</p>
  </section>
</template>
