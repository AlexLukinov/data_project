<script setup lang="ts">
// Paste a hand history and replay it (spec §9.4). The text goes to the server's parser and
// comes back as the same payload a stored hand has, and nothing is stored (ADR-029) — so this
// works for a hand from any table, whether or not it is in the database.
import { computed, ref } from 'vue';

import { describeApiError } from '~/auth/api';
import HandStudy from '~/components/hands/HandStudy.vue';
import type { HandDetail } from '~/hands/api';
import { toReplayHand } from '~/hands/replay';

const api = useHands();
const text = ref('');
const detail = ref<HandDetail | null>(null);
const problem = ref<string | null>(null);
const busy = ref(false);

const hand = computed(() => (detail.value === null ? null : toReplayHand(detail.value)));

async function parse(): Promise<void> {
  problem.value = null;
  busy.value = true;
  try {
    detail.value = await api.parse(text.value);
  } catch (e) {
    detail.value = null;
    problem.value = describeApiError(e, 'The API did not answer; pasting a hand needs it (ADR-029). Start it with `make api` in platform/.');
  } finally {
    busy.value = false;
  }
}

function clear(): void {
  text.value = '';
  detail.value = null;
  problem.value = null;
}
</script>

<template>
  <section class="space-y-4">
    <div class="flex flex-wrap items-baseline gap-3">
      <NuxtLink to="/hands" class="text-sm text-zinc-500 hover:underline">← hands</NuxtLink>
      <h1 class="text-xl font-semibold">Paste a hand</h1>
      <span class="text-sm text-zinc-500">GGPoker or PokerStars, one hand at a time. Nothing is saved.</span>
    </div>

    <form class="space-y-2" @submit.prevent="parse">
      <textarea
        v-model="text"
        rows="8"
        spellcheck="false"
        data-testid="paste-text"
        placeholder="Poker Hand #RC1851234567: Hold'em No Limit ($0.25/$0.50) - 2026/01/16 14:22:31&#10;Table 'RushAndCash2847561' 6-max Seat #1 is the button&#10;…"
        class="w-full rounded border border-zinc-300 bg-transparent p-2 font-mono text-xs dark:border-zinc-700"
      ></textarea>
      <div class="flex items-center gap-2 text-sm">
        <button type="submit" data-testid="paste-submit" :disabled="busy || text.trim() === ''" class="rounded bg-zinc-900 px-3 py-1 text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">{{ busy ? 'Reading…' : 'Replay it' }}</button>
        <button v-if="text !== ''" type="button" data-testid="paste-clear" class="text-zinc-500 underline" @click="clear">clear</button>
      </div>
    </form>

    <p v-if="problem" role="alert" data-testid="paste-error" class="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-200">{{ problem }}</p>

    <HandStudy v-if="hand" :hand="hand" :watch-seat="null" :hand-text="text" />
  </section>
</template>
