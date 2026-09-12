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
 * **The search does not use `GET /v1/pool/players`, and that is a finding, not a preference.**
 * That route matches the **start** of a `player_key`, and every key in the corpus is namespaced
 * `ggpoker:<name>` — so it answers "no such player" to every real opponent typed by name. The
 * search here is a substring over the same dimension through the ordinary report path; the
 * measurement and the reasoning are in `pool/stats.ts#searchPlayers`.
 *
 * **A player report scopes; it never groups.** `player_key` is a `stats_daily`-only dimension, so
 * `group_by: ['player_key']` on a decision-grain report is a 400 by design; the dimension's own
 * description says to set `player_key` on the request instead. That is what `read` does, and it is
 * why this page carries no situation filter: the search and member routes take no filter either.
 */
import { ref } from 'vue';

import StatGrid from '~/components/reports/StatGrid.vue';
import { describeApiError } from '~/auth/api';
import { MIN_N } from '~/reports/cell';
import { PLAYER_LIMIT, createPoolStatsApi, playerReport, searchPlayers } from '~/pool/stats';
import type { ReportResult } from '~/stats/api';
import { useDefinitionsStore } from '~/stores/definitions';

const definitions = useDefinitionsStore();
const pool = createPoolStatsApi(useApi());

const typed = ref('');
const found = ref<ReportResult | null>(null);
const report = ref<ReportResult | null>(null);
const chosen = ref('');
const failure = ref('');
const busy = ref(false);

await useAsyncData('definitions', () => definitions.load(), { server: false });

/** The names containing what was typed. An empty box asks nothing at all. */
async function search(): Promise<void> {
  const text = typed.value.trim();
  report.value = null;
  chosen.value = '';
  failure.value = '';
  if (text === '') {
    found.value = null;
    return;
  }
  busy.value = true;
  try {
    found.value = await pool.run(searchPlayers(text));
  } catch (error) {
    found.value = null;
    failure.value = describeApiError(error);
  } finally {
    busy.value = false;
  }
}

/** One player's game, scoped by `player_key` on the request rather than grouped by it. */
async function read(key: string): Promise<void> {
  chosen.value = key;
  report.value = null;
  failure.value = '';
  busy.value = true;
  try {
    report.value = await pool.run(playerReport(key));
  } catch (error) {
    failure.value = describeApiError(error);
  } finally {
    busy.value = false;
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

    <form class="flex flex-wrap items-center gap-2" @submit.prevent="search">
      <input
        v-model="typed"
        type="search"
        data-testid="player-prefix"
        placeholder="Part of a name…"
        class="rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700"
      />
      <button type="submit" :disabled="busy || typed.trim() === ''" data-testid="player-search" class="rounded bg-zinc-900 px-3 py-1 text-sm text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">
        {{ busy ? 'Looking…' : 'Search' }}
      </button>
      <p class="text-xs text-zinc-500" data-testid="player-search-note">
        Matches any part of a name, in any case. At most {{ PLAYER_LIMIT }} are shown.
      </p>
    </form>

    <p v-if="failure" role="alert" data-testid="player-error" class="rounded border border-red-300 p-3 text-sm text-red-700 dark:border-red-800 dark:text-red-400">{{ failure }}</p>

    <p v-if="found && found.rows.length === 0" class="text-sm text-zinc-500" data-testid="player-none">
      No name in the pool contains “{{ typed.trim() }}”.
    </p>

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
      <h2 class="text-sm font-medium" data-testid="player-name">{{ chosen }}</h2>
      <StatGrid :result="report" :stats="definitions.stats" :dimensions="definitions.byCode" :min-n="MIN_N" />
    </section>
  </section>
</template>
