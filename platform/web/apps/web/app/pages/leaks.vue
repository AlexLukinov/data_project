<script setup lang="ts">
/**
 * My game → leaks (plan D.7, §2.8): where the hero's frequencies stray furthest from the field,
 * each one a link into the hands behind it.
 *
 * The dates are the **shared filter's** (plan D.3), not a second set: narrowing here narrows the
 * hand list the drill opens, so a leak and its hands are always answering over the same months.
 * The situation clauses deliberately do *not* appear — `/v1/hero/leaks` is scoped by dates and a
 * cohort only, and a filter bar that silently ignored its own chips would be a worse lie than no
 * filter bar. The situation comes *out* of a leak here; it does not go in.
 */
import { computed } from 'vue';

import { describeApiError } from '~/auth/api';
import LeakTable from '~/components/hero/LeakTable.vue';
import { createHeroApi } from '~/hero/api';
import { useDefinitionsStore } from '~/stores/definitions';
import { useFilterStore } from '~/stores/filter';

const api = createHeroApi(useApi());
const definitions = useDefinitionsStore();
const filter = useFilterStore();

await useAsyncData('definitions', () => definitions.load(), { server: false });

const { data, error, status } = await useAsyncData(
  'hero-leaks',
  () =>
    api.leaks({
      ...(filter.dateFrom === '' ? {} : { date_from: filter.dateFrom }),
      ...(filter.dateTo === '' ? {} : { date_to: filter.dateTo }),
    }),
  { server: false, watch: [() => filter.dateFrom, () => filter.dateTo] },
);

const dates = computed(() => ({ from: filter.dateFrom, to: filter.dateTo }));
const leaks = computed(() => data.value?.leaks ?? []);

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
      <h1 class="text-2xl font-semibold">Leaks</h1>
      <p v-if="data" class="text-sm text-zinc-500" data-testid="leaks-hands">over {{ data.hands.toLocaleString('en-US') }} of your hands, against the pool</p>
    </div>

    <div class="flex flex-wrap items-end gap-3">
      <label class="text-xs text-zinc-500">
        from
        <input v-model="filter.dateFrom" type="date" data-testid="leaks-from" class="block rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900">
      </label>
      <label class="text-xs text-zinc-500">
        to
        <input v-model="filter.dateTo" type="date" data-testid="leaks-to" class="block rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900">
      </label>
      <p class="text-xs text-zinc-500">These dates travel with the link into the hands.</p>
    </div>

    <p v-if="definitions.status === 'error'" role="alert" data-testid="definitions-error" class="rounded border border-red-300 p-3 text-sm text-red-700 dark:border-red-800 dark:text-red-400">
      {{ definitions.error }}
      <button type="button" class="ml-2 underline" data-testid="definitions-retry" @click="retryDefinitions">Try again</button>
    </p>

    <p v-if="error" role="alert" data-testid="leaks-error" class="text-sm text-red-600 dark:text-red-400">{{ describeApiError(error) }}</p>
    <p v-else-if="status === 'pending'" role="status" data-testid="leaks-loading" class="text-sm text-zinc-500">Comparing you with the field…</p>
    <template v-else>
      <LeakTable :leaks="leaks" :dates="dates" />
      <p v-if="data" class="text-sm text-zinc-500" data-testid="leaks-floor">
        Ranked by how far the gap is from the field, weighted by how often the spot came up.
        <template v-if="data.skipped.length > 0">
          {{ data.skipped.length }} stat{{ data.skipped.length === 1 ? '' : 's' }} set aside under {{ data.min_n }} opportunities — noise, not a leak.
        </template>
      </p>
    </template>
  </section>
</template>
