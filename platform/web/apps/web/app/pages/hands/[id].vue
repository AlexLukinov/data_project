<script setup lang="ts">
// One stored hand, replayed (spec §9.4). `?seat=` names the seat to watch, which is how a pool
// hand — having no hero — still opens on somebody in particular.
import { computed } from 'vue';

import { describeApiError } from '~/auth/api';
import HandStudy from '~/components/hands/HandStudy.vue';
import { toReplayHand } from '~/hands/replay';

const api = useHands();
const route = useRoute();
const handUid = route.params.id as string;
const seat = computed(() => {
  const asked = Number(route.query.seat);
  return Number.isInteger(asked) ? asked : null;
});

const { data, error } = await useAsyncData(`hand-${handUid}`, () => api.get(handUid), { server: false });
const hand = computed(() => (data.value === undefined ? null : toReplayHand(data.value)));

function day(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ');
}
</script>

<template>
  <section class="space-y-4">
    <div class="flex flex-wrap items-baseline gap-3">
      <NuxtLink to="/hands" class="text-sm text-zinc-500 hover:underline">← hands</NuxtLink>
      <h1 class="text-xl font-semibold" data-testid="hand-title">{{ data ? `${data.stake_level} · ${day(data.played_at_utc)}` : 'Hand' }}</h1>
      <span v-if="data" class="text-sm text-zinc-500">{{ data.site }} · {{ data.site_hand_id }}</span>
    </div>

    <p v-if="error" role="alert" data-testid="hand-error" class="text-sm text-red-600 dark:text-red-400">{{ describeApiError(error) }}</p>
    <HandStudy v-else-if="hand" :hand="hand" :watch-seat="seat" />
    <p v-else class="text-sm text-zinc-500">Loading…</p>
  </section>
</template>
