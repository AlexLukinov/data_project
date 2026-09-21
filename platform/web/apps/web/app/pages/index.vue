<script setup lang="ts">
/**
 * **My game** (plan D.4, §2.8, ADR-026) — the founder's own play, on one page: the headline
 * numbers with their confidence intervals, the winnings curve, the leaks, and the sittings.
 *
 * **Why `/` is no longer public.** D.1 left this page a `/health` check, and it was the one
 * route the global auth middleware did not guard. A page that reads the founder's own hands
 * cannot be that route, so `definePageMeta({ public: true })` is gone and a signed-out visitor
 * is sent to `/login`. D.1's check is not lost — it is the strip at the foot of this page,
 * where a dashboard full of numbers is exactly where "is the database answering?" belongs.
 *
 * **Why there is no filter bar, only dates.** Of the four panels, `/v1/hero/leaks` and
 * `/v1/hero/sessions` accept dates and a cohort, and `/v1/hero/winnings` accepts dates only
 * (ADR-052). A situation filter whose clauses three of the four silently ignored is
 * what `pages/leaks.vue` calls "a worse lie than no filter bar". The dates come from the shared
 * store (plan D.3), so they travel into the drill-through links `LeakTable` builds and a leak
 * and its hands always answer over the same months.
 *
 * **Four requests, not one.** There is no hero overview endpoint; §2.7 names one and the router
 * has never had it. The KPIs are `POST /v1/reports/run` (ungrouped, compared against the field,
 * `confidence: 95`), and the other three are their own routes. They load independently and each
 * panel owns its own failure, so a slow pool baseline cannot keep the sessions off the screen.
 *
 * **What the page says when it has nothing** (F.12c). Four requests in flight, a registry that did
 * not load, and an account with no hands at all used to look like one another: a screen of dashes
 * with nothing written on it. Each now says which of the three it is — the four pending lines are
 * selectable, the registry failure is a line with a Try again, and a report that read every hand
 * and counted none is a first run rather than an error, so it names the Upload page. The prose
 * itself is `hero/words.ts`, tested as text, and it has **one** name for the all-in adjusted
 * winrate where this page once had three.
 */
import { computed } from 'vue';

import { describeApiError } from '~/auth/api';
import WinningsChart from '~/components/charts/WinningsChart.vue';
import KpiTile from '~/components/hero/KpiTile.vue';
import LeakTable from '~/components/hero/LeakTable.vue';
import SessionTable from '~/components/hero/SessionTable.vue';
import EmptyState from '~/components/reports/EmptyState.vue';
import { createHeroApi } from '~/hero/api';
import { KPI_RESULT_COUNT, kpiRequest, kpiTiles } from '~/hero/kpis';
import { heroEmptyView, luckWords, winningsCaption } from '~/hero/words';
import { createStatsApi } from '~/stats/api';
import { useDefinitionsStore } from '~/stores/definitions';
import { useFilterStore } from '~/stores/filter';

/** How many leaks the dashboard shows before sending the reader to the full list. */
const TOP_LEAKS = 6;

const hero = createHeroApi(useApi());
const stats = createStatsApi(useApi());
const definitions = useDefinitionsStore();
const filter = useFilterStore();

const dates = computed(() => ({ from: filter.dateFrom, to: filter.dateTo }));
const watching = [() => filter.dateFrom, () => filter.dateTo];

await useAsyncData('definitions', () => definitions.load(), { server: false });

const kpis = await useAsyncData('hero-kpis', () => stats.runReport(kpiRequest(dates.value)), { server: false, watch: watching });
const winnings = await useAsyncData('hero-winnings', () => hero.winnings({ ...(filter.dateFrom ? { date_from: filter.dateFrom } : {}), ...(filter.dateTo ? { date_to: filter.dateTo } : {}) }), { server: false, watch: watching });
const leaks = await useAsyncData('hero-dashboard-leaks', () => hero.leaks({ ...(filter.dateFrom ? { date_from: filter.dateFrom } : {}), ...(filter.dateTo ? { date_to: filter.dateTo } : {}) }), { server: false, watch: watching });
const sessions = await useAsyncData('hero-sessions', () => hero.sessions({ ...(filter.dateFrom ? { date_from: filter.dateFrom } : {}), ...(filter.dateTo ? { date_to: filter.dateTo } : {}) }), { server: false, watch: watching });

const tiles = computed(() => kpiTiles(kpis.data.value ?? null, definitions.stats));
const result = computed(() => tiles.value.slice(0, KPI_RESULT_COUNT));
const style = computed(() => tiles.value.slice(KPI_RESULT_COUNT));
const topLeaks = computed(() => (leaks.data.value?.leaks ?? []).slice(0, TOP_LEAKS));

/** The one sentence the page exists to say, and the sentence it says when there is nothing yet. */
const luck = computed(() => luckWords(tiles.value));
const empty = computed(() => heroEmptyView(kpis.data.value?.hands ?? null, dates.value));
const caption = winningsCaption();

/**
 * Ask for the registry again. The store turns the failure back into `definitions.error`, which is
 * the sentence already on screen, so there is nothing here to rethrow into an unhandled rejection.
 */
function retryDefinitions(): void {
  void definitions.load().catch(() => undefined);
}

/** The empty state's only button: the dates are this page's, so this page clears them. */
function widen(key: string): void {
  if (key !== 'clear-dates') return;
  filter.dateFrom = '';
  filter.dateTo = '';
}

const health = await useFetch<{ status: string; clickhouse?: string }>(`${useRuntimeConfig().public.apiBase}/health`, { server: false, lazy: true });
</script>

<template>
  <section class="space-y-8">
    <div class="flex flex-wrap items-end gap-3">
      <h1 class="mr-auto text-2xl font-semibold">My game</h1>
      <label class="text-xs text-zinc-500">
        from
        <input v-model="filter.dateFrom" type="date" data-testid="hero-from" class="block rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900">
      </label>
      <label class="text-xs text-zinc-500">
        to
        <input v-model="filter.dateTo" type="date" data-testid="hero-to" class="block rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900">
      </label>
    </div>

    <p v-if="definitions.status === 'error'" role="alert" data-testid="definitions-error" class="rounded border border-red-300 p-3 text-sm text-red-700 dark:border-red-800 dark:text-red-400">
      {{ definitions.error }}
      <button type="button" class="ml-2 underline" data-testid="definitions-retry" @click="retryDefinitions">Try again</button>
    </p>

    <!-- The result, then the play behind it. -->
    <div class="space-y-3">
      <p v-if="kpis.error.value" role="alert" data-testid="kpis-error" class="text-sm text-red-600 dark:text-red-400">{{ describeApiError(kpis.error.value) }}</p>
      <template v-else>
        <div class="grid gap-3 sm:grid-cols-3" data-testid="kpi-result">
          <KpiTile v-for="tile in result" :key="tile.code" :tile="tile" />
        </div>
        <div class="grid gap-3 sm:grid-cols-3 lg:grid-cols-5" data-testid="kpi-style">
          <KpiTile v-for="tile in style" :key="tile.code" :tile="tile" />
        </div>
        <p v-if="kpis.status.value === 'pending'" role="status" data-testid="kpis-loading" class="text-sm text-zinc-500">Measuring you against the field…</p>
        <EmptyState v-else-if="empty" :view="empty" testid="hero-empty" @act="widen" />
        <p v-else-if="luck !== ''" class="text-sm text-zinc-600 dark:text-zinc-400" data-testid="hero-luck">{{ luck }}</p>
      </template>
    </div>

    <section class="space-y-2">
      <div class="flex flex-wrap items-baseline gap-3">
        <h2 class="font-medium">Winnings</h2>
        <p class="text-sm text-zinc-500" data-testid="winnings-caption">{{ caption }}</p>
      </div>
      <p v-if="winnings.error.value" role="alert" data-testid="winnings-error" class="text-sm text-red-600 dark:text-red-400">{{ describeApiError(winnings.error.value) }}</p>
      <p v-else-if="winnings.status.value === 'pending'" role="status" data-testid="winnings-loading" class="text-sm text-zinc-500">Drawing the curve…</p>
      <WinningsChart v-else :points="winnings.data.value?.points ?? []" />
    </section>

    <section class="space-y-2">
      <div class="flex flex-wrap items-baseline gap-3">
        <h2 class="font-medium">Leaks</h2>
        <p v-if="leaks.data.value" class="text-sm text-zinc-500" data-testid="hero-leaks-count">
          the {{ topLeaks.length }} widest gaps from the field over {{ leaks.data.value.hands.toLocaleString('en-US') }} hands ·
          <NuxtLink to="/leaks" class="underline underline-offset-4 hover:no-underline">all {{ leaks.data.value.leaks.length }}</NuxtLink>
        </p>
      </div>
      <p v-if="leaks.error.value" role="alert" data-testid="hero-leaks-error" class="text-sm text-red-600 dark:text-red-400">{{ describeApiError(leaks.error.value) }}</p>
      <p v-else-if="leaks.status.value === 'pending'" role="status" data-testid="hero-leaks-loading" class="text-sm text-zinc-500">Comparing you with the field…</p>
      <LeakTable v-else :leaks="topLeaks" :dates="dates" />
    </section>

    <section class="space-y-2">
      <h2 class="font-medium">Sessions</h2>
      <p v-if="sessions.error.value" role="alert" data-testid="sessions-error" class="text-sm text-red-600 dark:text-red-400">{{ describeApiError(sessions.error.value) }}</p>
      <p v-else-if="sessions.status.value === 'pending'" role="status" data-testid="sessions-loading" class="text-sm text-zinc-500">Splitting the hands into sittings…</p>
      <SessionTable v-else-if="sessions.data.value" :result="sessions.data.value" />
    </section>

    <p class="border-t border-zinc-200 pt-3 text-xs text-zinc-500 dark:border-zinc-800" data-testid="health-strip">
      API
      <span :class="health.data.value?.status === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600'" data-testid="health-status">{{ health.data.value?.status ?? (health.error.value ? 'unreachable' : '…') }}</span>
      · ClickHouse
      <span data-testid="health-clickhouse">{{ health.data.value?.clickhouse ?? '—' }}</span>
      · the <NuxtLink to="/lab" class="underline">Range Lab</NuxtLink> works with the API down.
    </p>
  </section>
</template>
