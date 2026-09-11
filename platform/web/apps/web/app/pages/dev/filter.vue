<script setup lang="ts">
/**
 * The filter model with its workings showing (plan D.3).
 *
 * `/dev/components` is the fixture page for components; this is the fixture page for the filter:
 * the situation you built, the AST it compiles to, the link that reproduces it, and — the part
 * that matters — a real `POST /v1/reports/run` with that AST, so "the builder emits something
 * the engine accepts" is checked against the engine rather than against a snapshot of it.
 *
 * The reports workbench proper is plan D.5; this page is deliberately plain.
 */
import { computed, ref, watch } from 'vue';

import { describeApiError } from '~/auth/api';
import type { ReportResult } from '~/stats/api';
import { createStatsApi } from '~/stats/api';
import { useDefinitionsStore } from '~/stores/definitions';
import { useFilterStore } from '~/stores/filter';
import FilterBar from '~/components/filter/FilterBar.vue';

const definitions = useDefinitionsStore();
const filter = useFilterStore();
const api = createStatsApi(useApi());

useFilterUrl();
await useAsyncData('definitions', () => definitions.load(), { server: false });

const stats = ref<string[]>(['hands']);
const groupBy = ref<string>('');
const result = ref<ReportResult | null>(null);
const failure = ref<string>('');
const busy = ref(false);

const body = computed(() =>
  filter.reportRequest({
    stats: stats.value,
    ...(groupBy.value === '' ? {} : { group_by: [groupBy.value] }),
  }),
);

const groupable = computed(() => definitions.dimensions.filter((dim) => dim.group_by));

/**
 * A stat can only be measured on a table that holds every filtered column. The router refuses
 * the pair before it validates anything else ("dimension 'street' is not available for
 * hand-grain stat 'hands'"), so an incompatible stat is not offered rather than offered and
 * refused — and one already chosen is dropped when the filter moves under it.
 */
function fits(grain: string): boolean {
  return filter.tables.includes(grain === 'hand' ? 'player_hands' : 'decisions');
}

const usable = computed(() => definitions.stats.filter((stat) => fits(stat.grain)));

watch(
  () => [filter.tables, definitions.stats] as const,
  () => {
    const kept = stats.value.filter((code) => {
      const stat = definitions.stats.find((s) => s.code === code);
      return stat !== undefined && fits(stat.grain);
    });
    const first = usable.value[0]?.code;
    stats.value = kept.length > 0 || first === undefined ? kept : [first];
  },
  { immediate: true, deep: true },
);

const link = computed(() => {
  const query = new URLSearchParams(filter.query).toString();
  return query === '' ? '(no parameters — the default filter)' : `?${query}`;
});

async function run(): Promise<void> {
  busy.value = true;
  failure.value = '';
  try {
    result.value = await api.runReport(body.value);
  } catch (error) {
    result.value = null;
    failure.value = describeApiError(error);
  } finally {
    busy.value = false;
  }
}

function toggleStat(code: string): void {
  stats.value = stats.value.includes(code) ? stats.value.filter((c) => c !== code) : [...stats.value, code];
}

function cell(row: ReportResult['rows'][number], code: string): string {
  const value = row.cells[code];
  if (value === undefined || value.value === null) return '—';
  return `${value.value.toFixed(1)} (n ${value.n.toLocaleString()})`;
}
</script>

<template>
  <section class="space-y-4">
    <h1 class="text-2xl font-semibold">Filter — dev harness</h1>

    <FilterBar />

    <div class="grid gap-4 md:grid-cols-2">
      <div>
        <h2 class="mb-1 text-sm font-medium">The AST it emits</h2>
        <pre data-testid="filter-ast" class="overflow-x-auto rounded-lg border border-zinc-200 p-3 text-xs dark:border-zinc-800">{{ JSON.stringify(filter.node, null, 2) }}</pre>
      </div>
      <div>
        <h2 class="mb-1 text-sm font-medium">The link that reproduces it</h2>
        <p data-testid="filter-url" class="overflow-x-auto rounded-lg border border-zinc-200 p-3 font-mono text-xs break-all dark:border-zinc-800">{{ link }}</p>
        <h2 class="mt-3 mb-1 text-sm font-medium">The tables that can answer it</h2>
        <p data-testid="filter-tables" class="text-xs text-zinc-500">{{ filter.tables.join(', ') || 'none' }}</p>
      </div>
    </div>

    <div class="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div class="flex flex-wrap items-center gap-2 text-sm">
        <label class="text-zinc-500">group by
          <select v-model="groupBy" data-testid="report-groupby" class="ml-1 rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700">
            <option value="">nothing</option>
            <option v-for="dim in groupable" :key="dim.code" :value="dim.code">{{ dim.label }}</option>
          </select>
        </label>
        <button type="button" data-testid="report-run" :disabled="busy" class="ml-auto rounded border border-zinc-300 px-3 py-1 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900" @click="run">
          {{ busy ? 'Running…' : 'Run report' }}
        </button>
      </div>

      <div class="flex flex-wrap gap-1" data-testid="stat-picker">
        <button
          v-for="stat in usable"
          :key="stat.code"
          type="button"
          :title="`${stat.description ?? ''} · ${stat.grain}-grain`"
          :data-testid="`stat-${stat.code}`"
          class="rounded border px-2 py-0.5 text-xs"
          :class="stats.includes(stat.code) ? 'border-zinc-900 font-medium dark:border-zinc-100' : 'border-zinc-300 text-zinc-500 dark:border-zinc-700'"
          @click="toggleStat(stat.code)"
        >
          {{ stat.label }}
        </button>
      </div>
      <p v-if="usable.length < definitions.stats.length" class="text-xs text-zinc-500" data-testid="stat-hidden">
        {{ definitions.stats.length - usable.length }} stats are hidden: this situation is answered on {{ filter.tables.join(', ') || 'no table' }}.
      </p>
    </div>

    <p v-if="failure" role="alert" data-testid="report-error" class="rounded border border-red-300 p-3 text-sm text-red-700 dark:border-red-800 dark:text-red-400">{{ failure }}</p>

    <div v-if="result" class="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <p class="border-b border-zinc-200 p-2 text-xs text-zinc-500 dark:border-zinc-800" data-testid="report-meta">
        {{ result.hands.toLocaleString() }} hands · {{ result.rows.length }} row{{ result.rows.length === 1 ? '' : 's' }} · {{ result.cached ? 'from cache' : 'fresh' }}
      </p>
      <table class="w-full text-sm">
        <thead class="text-left text-xs text-zinc-500">
          <tr>
            <th v-for="key in result.group_by" :key="key" class="p-2">{{ key }}</th>
            <th v-for="meta in result.stats" :key="meta.code" class="p-2">{{ meta.label }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in result.rows" :key="index" class="border-t border-zinc-200 dark:border-zinc-800" data-testid="report-row">
            <td v-for="key in result.group_by" :key="key" class="p-2">{{ row.group[key] ?? '—' }}</td>
            <td v-for="meta in result.stats" :key="meta.code" class="p-2 tabular-nums">{{ cell(row, meta.code) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
