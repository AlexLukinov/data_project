<script setup lang="ts">
// One stored hand, replayed (spec §9.4). `?seat=` names the seat to watch, which is how a pool
// hand — having no hero — still opens on somebody in particular.
import { computed } from 'vue';

import { describeApiError } from '~/auth/api';
import HandNotes from '~/components/hands/HandNotes.vue';
import HandStudy from '~/components/hands/HandStudy.vue';
import RegistryTerm from '~/components/reports/RegistryTerm.vue';
import { createHandNotesApi } from '~/hands/notes';
import { toReplayHand } from '~/hands/replay';
import type { TermEntry } from '~/stats/vocabulary';
import { dimensionEntry, valueWords } from '~/stats/vocabulary';
import { useDefinitionsStore } from '~/stores/definitions';
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

// The header prints two registry columns as the database stores them — `NL10` and `ggpoker` —
// and neither says what it is. The registry does, so it is loaded beside the hand rather than
// ahead of it: the replay is what this page is for and must not wait on a vocabulary (ADR-057).
const definitions = useDefinitionsStore();
await useAsyncData('definitions', () => definitions.load(), { server: false, lazy: true });

interface Word {
  readonly text: string;
  /** `null` until the registry has answered: a tip saying a column is unknown must be true. */
  readonly entry: TermEntry | null;
}

function word(code: string, value: string): Word {
  const dim = definitions.byCode.get(code);
  return { text: valueWords(dim, value), entry: dim === undefined ? null : dimensionEntry(dim, code) };
}

const stake = computed(() => word('stake_level', data.value?.stake_level ?? ''));
const site = computed(() => word('site', data.value?.site ?? ''));

/** When the hand was played, as `YYYY-MM-DD HH:MM`; blank until the hand itself has answered. */
const playedAt = computed(() => (data.value?.played_at_utc ?? '').slice(0, 16).replace('T', ' '));

/**
 * Ask for the registry again. The store turns the failure back into `definitions.error`, which is
 * the sentence already on screen, so there is nothing here to rethrow into an unhandled rejection.
 */
function retryDefinitions(): void {
  void definitions.load().catch(() => undefined);
}
</script>

<template>
  <section class="space-y-4">
    <div class="flex flex-wrap items-baseline gap-3">
      <NuxtLink :to="{ path: '/hands', query: filter.query }" data-testid="hand-back" class="text-sm text-zinc-500 hover:underline">← hands</NuxtLink>
      <h1 class="text-xl font-semibold">
        <template v-if="data">
          <!-- The testid stays on the words the reader sees: inside a RegistryTerm's trigger slot
               the tip is a sibling of this span, so the title's own text is the title alone. -->
          <RegistryTerm v-if="stake.entry" :entry="stake.entry">
            <template #default="{ describedby }">
              <span data-testid="hand-title">
                <span class="underline decoration-dotted underline-offset-2" tabindex="0" :aria-describedby="describedby">{{ stake.text }}</span>
                · {{ playedAt }}
              </span>
            </template>
          </RegistryTerm>
          <span v-else data-testid="hand-title">{{ stake.text }} · {{ playedAt }}</span>
        </template>
        <span v-else data-testid="hand-title">Hand</span>
      </h1>
      <span v-if="data" class="text-sm text-zinc-500">
        <RegistryTerm v-if="site.entry" :entry="site.entry" :label="site.text" /><span v-else>{{ site.text }}</span>
        · {{ data.site_hand_id }}
      </span>
    </div>

    <!-- The registry is what turns `NL10` and `ggpoker` into words; when it does not answer, the
         header silently degrades to those codes, so the page says why rather than looking curt. -->
    <p v-if="definitions.status === 'error'" role="alert" data-testid="definitions-error" class="rounded border border-red-300 p-3 text-sm text-red-700 dark:border-red-800 dark:text-red-400">
      {{ definitions.error }}
      <button type="button" class="ml-2 underline" data-testid="definitions-retry" @click="retryDefinitions">Try again</button>
    </p>

    <p v-if="error" role="alert" data-testid="hand-error" class="text-sm text-red-600 dark:text-red-400">{{ describeApiError(error) }}</p>
    <template v-else-if="hand">
      <HandStudy :hand="hand" :watch-seat="seat" />
      <HandNotes :hand-uid="handUid" :api="notesApi" />
    </template>
    <p v-else class="text-sm text-zinc-500" data-testid="hand-loading">Opening the hand…</p>
  </section>
</template>
