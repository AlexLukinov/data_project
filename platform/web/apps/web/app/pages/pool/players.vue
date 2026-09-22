<script setup lang="ts">
/**
 * Find one opponent, then read their game (plan D.6: "player search + report").
 *
 * **Why this exists at all, given the spec says it cannot.** `POKER_RANGE_LAB_SPEC.md` line 35 says
 * GG anonymizes opponents "*so per-player reads are impossible*" — and that is true of the founder's
 * **own** hands, where the seats are session-scoped aliases. It is not true of the population
 * corpus, which carries real screen names: `POKER_STATUS.md` records **94,276 distinct ids** over
 * 9.07M pool hands, with cross-session opponent tracking "*possible (not yet built)*". This page is
 * that. It reads the pool only, and there is no hero equivalent — there cannot be.
 *
 * **The search is the purpose-built route, and this page holds none of its rules.** What counts as
 * a match, how short a name is refused, and which of two thousand matches are worth showing first
 * were all measured on the real pool and live in `analysis/pool/service.py` (ADR-062). So there is
 * no minimum spelled here and no Search button disabled below one: a name too short is asked,
 * refused, and the server's own sentence is what appears. A copy of "three" in this file would be
 * a second number to keep in step with a measurement, and it would still be wrong — the server
 * counts the characters of the *name half*, so `ggpoker:ab` is too short and nothing here can tell.
 *
 * **A player report scopes; it never groups.** `player_key` is a `stats_daily`-only dimension, so
 * `group_by: ['player_key']` on a decision-grain report is a 400 by design; the dimension's own
 * description says to set `player_key` on the request instead. That is what `read` does, and it is
 * why this page carries no situation filter: the search and member routes take no filter either.
 */
import { computed, ref } from 'vue';

import DefinitionPanel from '~/components/reports/DefinitionPanel.vue';
import StatGrid from '~/components/reports/StatGrid.vue';
import { describeApiError } from '~/auth/api';
import { MIN_N } from '~/reports/cell';
import type { PlayerMatches } from '~/pool/stats';
import { createPoolStatsApi, playerReport } from '~/pool/stats';
import { PLAYER_NO_ROWS, matchedWords, noPlayerWords, playerIntroWords } from '~/pool/words';
import type { ReportResult } from '~/stats/api';
import { useDefinitionsStore } from '~/stores/definitions';

const definitions = useDefinitionsStore();
const pool = createPoolStatsApi(useApi());

const typed = ref('');
/** What the answer on screen is about. The box goes on being edited; the answer does not follow it. */
const searched = ref('');
const found = ref<PlayerMatches | null>(null);
const report = ref<ReportResult | null>(null);
const chosen = ref('');
const failure = ref('');
const busy = ref(false);
const describing = ref('');

await useAsyncData('definitions', () => definitions.load(), { server: false });

const intro = computed(() => playerIntroWords(found.value?.stats ?? []));
/** Empty whenever every match is already on screen, which is what a typed name usually gets. */
const matched = computed(() =>
  found.value === null ? '' : matchedWords(searched.value, found.value.matched, found.value.rows.length, found.value.matched_capped),
);
const describedStat = computed(() => definitions.stats.find((stat) => stat.code === describing.value));
const describedDim = computed(() => (describedStat.value === undefined ? definitions.byCode.get(describing.value) : undefined));

/**
 * The names containing what was typed. An empty box asks nothing at all.
 *
 * The old answer is cleared **before** the await, not after it: a second search used to leave the
 * previous "no name contains …" on screen, rewritten live to quote text nothing had been asked
 * about yet.
 *
 * A name the route refuses — too short to narrow 94,276 of them — comes back as a 400 whose detail
 * is a sentence, and `describeApiError` shows a 400's detail as it stands. It lands in the same
 * box as any other refusal because it *is* one: the server declining to answer, in its own words.
 */
async function search(): Promise<void> {
  const text = typed.value.trim();
  report.value = null;
  chosen.value = '';
  failure.value = '';
  found.value = null;
  searched.value = text;
  if (text === '') return;
  busy.value = true;
  try {
    found.value = await pool.findPlayers(text);
  } catch (error) {
    found.value = null;
    failure.value = describeApiError(error);
  } finally {
    busy.value = false;
  }
}

/**
 * Ask for the registry again. The store keeps the reason in `definitions.error`, which is the
 * sentence already on screen, so there is nothing here to rethrow into an unhandled rejection.
 */
function retryDefinitions(): void {
  void definitions.load().catch(() => undefined);
}

/**
 * One player's game, scoped by `player_key` on the request rather than grouped by it — and asking
 * for the stats the row that was clicked is already showing. The lookup sends their metadata back
 * with the match, so nothing on this page decides which seven a player is read by.
 *
 * **An answer that is no longer the question is dropped**, which on this page is not a nicety.
 * `/v1/pool/stats` is cached per tenant, so a player read earlier this session comes back in
 * milliseconds while a cold one waits for the rollup — two clicks in the wrong order and the
 * slower response lands last, over the faster one. A player report is `group_by: []`, so the grid
 * is a single `All` row with no column naming who it belongs to: the heading would say one
 * opponent and every number under it would be another's, with nothing on screen to tell. That is
 * the one failure this product cannot have (spec §17), and it is silent, so the guard is the
 * comparison rather than a spinner — `chosen` is what the reader asked for last, and anything
 * that comes back for a different key has been superseded.
 *
 * `search()` has had the same guard from the start, in `searched`; this is that guard for the
 * other call.
 */
async function read(key: string): Promise<void> {
  /* Narrows `found.value` so `answer.stats` type-checks; rows only exist when it is non-null. */
  const answer = found.value;
  if (answer === null) return;
  chosen.value = key;
  report.value = null;
  failure.value = '';
  busy.value = true;
  try {
    const own = await pool.run(playerReport(key, answer.stats));
    if (chosen.value === key) report.value = own;
  } catch (error) {
    if (chosen.value === key) failure.value = describeApiError(error);
  } finally {
    if (chosen.value === key) busy.value = false;
  }
}

/** The screen name a search row stands for — the value of the one column it was grouped by. */
function nameOf(group: Record<string, string | number | null>): string {
  const value = group.player_key;
  return typeof value === 'string' ? value : String(value ?? '');
}
</script>

<template>
  <section class="space-y-4">
    <div class="flex flex-wrap items-baseline gap-3">
      <h1 class="text-2xl font-semibold">Find a player</h1>
      <NuxtLink to="/pool" class="text-sm underline underline-offset-2">The pool</NuxtLink>
    </div>

    <p class="max-w-2xl text-sm text-zinc-500" data-testid="player-intro">{{ intro }}</p>

    <div v-if="definitions.status === 'error'" role="alert" data-testid="definitions-error" class="rounded border border-red-300 p-3 text-sm text-red-700 dark:border-red-800 dark:text-red-400">
      {{ definitions.error }}
      <button type="button" class="ml-2 underline underline-offset-2" @click="retryDefinitions">Try again</button>
    </div>

    <form class="flex flex-wrap items-center gap-2" @submit.prevent="search">
      <input
        v-model="typed"
        type="search"
        data-testid="player-name"
        placeholder="Part of a name…"
        class="rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700"
      />
      <button type="submit" :disabled="busy || typed.trim() === ''" data-testid="player-search" class="rounded bg-zinc-900 px-3 py-1 text-sm text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">
        {{ busy ? 'Looking…' : 'Search' }}
      </button>
      <!-- No claim about the site here: the empty state is where that matters, and it is the one
           sentence that has to hold for a pasted key too (the site before the colon is matched
           exactly then). This note's job is the two things that shape what you get back. -->
      <p class="text-xs text-zinc-500" data-testid="player-search-note">
        Any part of a screen name, in any case. The name typed in full comes first, then whoever
        has the most hands.
      </p>
    </form>

    <p v-if="failure" role="alert" data-testid="player-error" class="rounded border border-red-300 p-3 text-sm text-red-700 dark:border-red-800 dark:text-red-400">{{ failure }}</p>

    <p v-if="found && found.rows.length === 0" class="max-w-2xl text-sm text-zinc-500" data-testid="player-none">
      {{ noPlayerWords(searched) }}
    </p>

    <p v-if="matched" class="max-w-2xl text-sm text-zinc-500" data-testid="player-matched">{{ matched }}</p>

    <ul v-if="found && found.rows.length > 0" class="flex flex-wrap gap-2" data-testid="player-results">
      <li v-for="row in found.rows" :key="nameOf(row.group)">
        <button
          type="button"
          class="rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          :class="chosen === nameOf(row.group) ? 'bg-zinc-100 dark:bg-zinc-900' : ''"
          :data-testid="`player-${nameOf(row.group)}`"
          @click="read(nameOf(row.group))"
        >
          {{ nameOf(row.group) }}
          <span class="text-xs text-zinc-500 tabular-nums">{{ row.hands.toLocaleString('en-US') }} hands</span>
        </button>
      </li>
    </ul>

    <section v-if="chosen" class="space-y-2">
      <h2 class="text-sm font-medium" data-testid="player-chosen">{{ chosen }}</h2>
      <p v-if="busy && report === null" role="status" class="text-sm text-zinc-500" data-testid="player-loading">Reading {{ chosen }}'s game…</p>
      <StatGrid :result="report" :stats="definitions.stats" :dimensions="definitions.byCode" :min-n="MIN_N" @describe="describing = $event">
        <template #empty>{{ PLAYER_NO_ROWS }}</template>
      </StatGrid>
      <DefinitionPanel v-if="describing" :stat="describedStat" :dimension="describedDim" :dimensions="definitions.byCode" @close="describing = ''" />
    </section>
  </section>
</template>
