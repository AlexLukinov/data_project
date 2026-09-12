<script setup lang="ts">
/**
 * The cohorts the field can be cut into (plan D.6).
 *
 * A cohort is **a rule, not a list**: `analysis/pool/cohorts.py` evaluates its thresholds against
 * the cached per-player stats every time a report runs, so "regulars" means whoever is playing like
 * one this month, not whoever was in the group when it was made. That is why this page shows a
 * cohort's size as a figure it fetched just now rather than a stored count.
 *
 * Two sources, deliberately shown as one list with its origin named: the `regs` and `fish` the pool
 * area **ships** (`GET /v1/pool/presets`), and the cohorts the founder has **saved**. Neither is
 * authored in the client — the shipped rules are the server's, and retyping a VPIP threshold here
 * is the thing `reports/api.ts` forbids in as many words.
 *
 * Creating, editing and deleting a saved cohort are **plan D.6b**: they write rows to Postgres, and
 * the lane that built this page was read-only against the live API by instruction. The six routes
 * already exist (`api/routers/pool.py`), so that step is a form over a client this file already has.
 */
import { ref } from 'vue';

import StatGrid from '~/components/reports/StatGrid.vue';
import { describeApiError } from '~/auth/api';
import { createReportsApi } from '~/reports/api';
import { MIN_N } from '~/reports/cell';
import type { CohortChoice } from '~/pool/stats';
import { MEMBER_LIMIT, cohortChoices, createPoolStatsApi } from '~/pool/stats';
import type { ReportResult } from '~/stats/api';
import { useDefinitionsStore } from '~/stores/definitions';

const MEMBERS_SHOWN = 100;

const definitions = useDefinitionsStore();
const pool = createPoolStatsApi(useApi());
const reports = createReportsApi(useApi());

const choices = ref<CohortChoice[]>([]);
const openKey = ref<string | null>(null);
const size = ref<number | null>(null);
const members = ref<ReportResult | null>(null);
const failure = ref('');
const busy = ref(false);

await useAsyncData('definitions', () => definitions.load(), { server: false });
await useAsyncData('pool-cohorts', load, { server: false });

async function load(): Promise<void> {
  const [shipped, saved] = await Promise.all([reports.poolPresets(), pool.cohorts().catch(() => [])]);
  choices.value = cohortChoices(shipped.cohorts, saved);
}

/**
 * Open one cohort: its live size and the players in it.
 *
 * Only a **saved** cohort has an id, and `GET /v1/pool/cohorts/{id}/members` is the only route that
 * lists members, so a shipped preset shows its rules and its link and says plainly that it has no
 * membership list — rather than inventing one from a report the engine was never asked.
 */
async function show(choice: CohortChoice): Promise<void> {
  openKey.value = choice.key;
  size.value = null;
  members.value = null;
  failure.value = '';
  if (choice.id === null) return;
  busy.value = true;
  try {
    const [detail, rows] = await Promise.all([pool.cohort(choice.id), pool.members(choice.id, MEMBERS_SHOWN)]);
    size.value = detail.players;
    members.value = rows;
  } catch (error) {
    failure.value = describeApiError(error);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="space-y-4">
    <div class="flex flex-wrap items-baseline gap-3">
      <h1 class="text-2xl font-semibold">Cohorts</h1>
      <NuxtLink to="/pool" class="text-sm underline underline-offset-2">The pool</NuxtLink>
    </div>

    <p class="text-sm text-zinc-500">
      A cohort is a rule about how someone plays, applied when a report runs — not a saved list of
      names. Measuring the field with one scopes every number to the players who match it today.
    </p>

    <p v-if="choices.length === 0" class="text-sm text-zinc-500" data-testid="no-cohorts">No cohorts.</p>

    <ul class="space-y-2" data-testid="cohort-list">
      <li
        v-for="choice in choices"
        :key="choice.key"
        class="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
        :data-testid="`cohort-${choice.key}`"
      >
        <div class="flex flex-wrap items-baseline gap-2">
          <h2 class="text-sm font-medium">{{ choice.label }}</h2>
          <span class="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            {{ choice.id === null ? 'shipped' : 'saved' }}
          </span>
          <p class="text-xs text-zinc-500">{{ choice.description }}</p>
          <NuxtLink :to="{ path: '/pool', query: { cohort: choice.key } }" class="ml-auto text-sm underline underline-offset-2">
            Measure the field with this
          </NuxtLink>
          <button type="button" class="text-sm underline underline-offset-2" :data-testid="`open-${choice.key}`" @click="show(choice)">
            {{ openKey === choice.key ? 'Showing' : 'Who is in it' }}
          </button>
        </div>

        <div v-if="openKey === choice.key" class="mt-3 space-y-2">
          <p v-if="choice.id === null" class="text-xs text-zinc-500" data-testid="shipped-no-members">
            A shipped cohort has no stored membership list — it is only the rule above. Save it as a
            cohort of your own to list the players it names.
          </p>
          <template v-else>
            <p v-if="busy" class="text-xs text-zinc-500">Counting…</p>
            <p v-else-if="size !== null" class="text-xs text-zinc-500" data-testid="cohort-size">
              <strong class="tabular-nums">{{ size.toLocaleString('en-US') }}</strong> players match right now;
              showing the first {{ Math.min(MEMBERS_SHOWN, MEMBER_LIMIT) }}.
            </p>
            <p v-if="failure" role="alert" data-testid="cohort-error" class="text-sm text-red-600 dark:text-red-400">{{ failure }}</p>
            <StatGrid :result="members" :stats="definitions.stats" :dimensions="definitions.byCode" :min-n="MIN_N" />
          </template>
        </div>
      </li>
    </ul>
  </section>
</template>
