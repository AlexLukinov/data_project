<script setup lang="ts">
// The heuristic log (spec §16): the lessons, what they were about, and the fourteen-day "still
// true?" prompt.
//
// It reads and writes with the API away — the browser copy is enough to add a lesson and to
// answer a prompt, and the row simply says it has not reached the server yet.
import { computed, ref } from 'vue';

import type { LocalHeuristic } from '~/heuristics/cache';
import { dueAt, isDue } from '~/heuristics/log';
import { useHeuristicsStore } from '~/stores/heuristics';

const log = useHeuristicsStore();
const now = new Date();

const draft = ref('');
const street = ref('');
const position = ref('');
const texture = ref('');

const STREETS = ['', 'preflop', 'flop', 'turn', 'river'];
const items = computed<LocalHeuristic[]>(() => log.items);
const due = computed(() => items.value.filter((row) => isDue(row, now)));

async function write(): Promise<void> {
  if (draft.value.trim() === '') return;
  await log.add({
    text: draft.value,
    street: street.value,
    position: position.value,
    texture: texture.value,
  });
  draft.value = '';
}

function shortDate(iso: string): string {
  return iso.slice(0, 10);
}
</script>

<template>
  <section class="space-y-4">
    <div class="flex flex-wrap items-center gap-3">
      <h2 class="text-lg font-semibold">Heuristics</h2>
      <span v-if="due.length > 0" class="rounded border border-amber-300 px-2 py-0.5 text-xs text-amber-700 dark:border-amber-700 dark:text-amber-400" data-testid="heuristics-due">
        {{ due.length }} to re-examine
      </span>
      <span class="ml-auto text-sm text-zinc-500" data-testid="heuristics-status">
        {{ log.status === 'offline' ? 'saved in this browser only' : '' }}
      </span>
    </div>

    <form class="space-y-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800" @submit.prevent="write">
      <label class="block space-y-1">
        <span class="text-sm font-medium">What did you decide?</span>
        <textarea
          v-model="draft"
          rows="2"
          class="w-full rounded border border-zinc-300 bg-transparent p-2 text-sm dark:border-zinc-700"
          placeholder="One line that should change a future decision — not a description of a hand."
          data-testid="heuristic-text"
        />
      </label>
      <div class="flex flex-wrap items-center gap-2">
        <select v-model="street" class="rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700" data-testid="heuristic-street">
          <option v-for="option in STREETS" :key="option" :value="option">{{ option === '' ? 'any street' : option }}</option>
        </select>
        <input v-model="position" placeholder="position" class="w-28 rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700" data-testid="heuristic-position" />
        <input v-model="texture" placeholder="texture" class="w-36 rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700" data-testid="heuristic-texture" />
        <button type="submit" class="rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-900" :disabled="draft.trim() === ''" data-testid="heuristic-save">
          Write it down
        </button>
      </div>
    </form>

    <div v-if="log.candidates.length > 0" class="space-y-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h3 class="text-sm font-medium">From your analyses, not yet in the log</h3>
      <ul class="space-y-2">
        <li v-for="candidate in log.candidates" :key="candidate.analysis_id" class="flex flex-wrap items-center gap-2 text-sm">
          <span>{{ candidate.heuristic }}</span>
          <span class="text-xs text-zinc-500">{{ candidate.title }}</span>
          <button type="button" class="ml-auto rounded border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900" :data-testid="`adopt-${candidate.analysis_id}`" @click="log.adopt(candidate)">
            Add
          </button>
        </li>
      </ul>
    </div>

    <!--
      ADR-057 decision 7: the way in has to be a route, not a noun. "Finish an analysis" named one
      and linked nowhere. It is `/analyze`, never an example — nothing an example does is saved,
      so its ninth step cannot put a line here (ADR-073).
    -->
    <p v-if="items.length === 0" class="rounded border border-dashed border-zinc-300 p-6 text-sm dark:border-zinc-700" data-testid="heuristics-empty">
      Nothing written down yet. The ninth step of an analysis ends in one line worth keeping — write
      it here, or finish <NuxtLink to="/analyze" class="underline" data-testid="heuristics-empty-analyze">an analysis</NuxtLink>
      and adopt it from the list above. Fourteen days later this page asks whether it is still true.
    </p>

    <ul v-else class="space-y-2">
      <li
        v-for="row in items"
        :key="row.local_id"
        class="rounded-lg border p-3 text-sm"
        :class="isDue(row, now) ? 'border-amber-300 dark:border-amber-700' : 'border-zinc-200 dark:border-zinc-800'"
        data-testid="heuristic-row"
        :data-heuristic="row.local_id"
      >
        <p :class="row.status === 'retired' ? 'line-through opacity-60' : ''">{{ row.text }}</p>
        <p class="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          <span v-for="tag in [row.street, row.position, row.texture].filter(Boolean)" :key="tag" class="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-900">{{ tag }}</span>
          <span>written {{ shortDate(row.created_at) }}</span>
          <span v-if="row.status !== 'open'">· {{ row.status }}</span>
          <span v-if="row.unsaved" class="text-amber-700 dark:text-amber-400">· in this browser only</span>
          <span v-if="!isDue(row, now)">· next asked {{ shortDate(dueAt(row)) }}</span>
        </p>

        <div v-if="isDue(row, now)" class="mt-2 flex flex-wrap items-center gap-2">
          <span class="text-xs font-medium">Still true?</span>
          <button type="button" class="rounded border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900" :data-testid="`confirm-${row.local_id}`" @click="log.answer(row.local_id, 'confirmed')">
            Still true
          </button>
          <button type="button" class="rounded border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900" :data-testid="`retire-${row.local_id}`" @click="log.answer(row.local_id, 'retired')">
            No longer
          </button>
          <button type="button" class="ml-auto rounded border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900" :data-testid="`delete-${row.local_id}`" @click="log.remove(row.local_id)">
            Delete
          </button>
        </div>
      </li>
    </ul>
  </section>
</template>
