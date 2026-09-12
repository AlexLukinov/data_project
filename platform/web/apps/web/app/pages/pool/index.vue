<script setup lang="ts">
/**
 * The population workbench (plan D.6): what the field does, sliced any way, for any slice of
 * players.
 *
 * It is the reports workbench asked of the pool, and it is deliberately **not** `ReportWorkbench`
 * mounted with a flag. That component's only prop is `savedId`, its `openFirstPreset()` takes
 * `library.presets[0]` — which is a *hero* preset — and its `<FilterBar />` offers the hero/pool
 * toggle this page must not. D.5 wrote it down as "the shell D.4 and D.6 may ignore" and built the
 * parts to be composed instead; this page composes exactly those parts, forks none of them, and
 * adds only what the pool needs: the dataset lock and the cohorts.
 *
 * Spec §17 binds hardest here, because this is the page showing other people's data. Every number
 * on it arrives through `StatGrid`, so every cell carries its own `n` and a thin one is dimmed and
 * left uncompared by `reports/cell.ts` — one rule, in one file, for hero and pool alike. Nothing
 * is fabricated to fill a gap: a bucket a cohort never reached renders as a dash, not a zero.
 */
import { computed, ref, watch } from 'vue';

import CohortGrids from '~/components/pool/CohortGrids.vue';
import CohortPicker from '~/components/pool/CohortPicker.vue';
import FilterBar from '~/components/filter/FilterBar.vue';
import DefinitionPanel from '~/components/reports/DefinitionPanel.vue';
import GroupByPicker from '~/components/reports/GroupByPicker.vue';
import StatPicker from '~/components/reports/StatPicker.vue';
import { describeApiError } from '~/auth/api';
import { createReportsApi } from '~/reports/api';
import type { Preset } from '~/reports/api';
import { MIN_N_CHOICES } from '~/reports/cell';
import { createColumnsModel } from '~/reports/model';
import { align, sameShape } from '~/pool/compare';
import { lockedToPopulation } from '~/pool/population';
import type { CohortChoice } from '~/pool/stats';
import { cohortChoices, createPoolStatsApi } from '~/pool/stats';
import type { ReportResult } from '~/stats/api';
import { useDefinitionsStore } from '~/stores/definitions';
import { useFilterStore } from '~/stores/filter';

const definitions = useDefinitionsStore();
const filter = useFilterStore();
const pool = createPoolStatsApi(useApi());
const reports = createReportsApi(useApi());

const columns = createColumnsModel(
  computed(() => definitions.byCode),
  computed(() => definitions.stats),
  lockedToPopulation(filter),
);

const presets = ref<Preset[]>([]);
const choices = ref<CohortChoice[]>([]);
const primary = ref<string | null>(null);
const against = ref<string | null>(null);
const left = ref<ReportResult | null>(null);
const right = ref<ReportResult | null>(null);
const failure = ref('');
const busy = ref(false);
const stale = ref(false);
const describing = ref('');

/* Before the awaits: `useRoute`/`useRouter` need the component's own instance context. */
useReportUrl(columns);
const route = useRoute();
const router = useRouter();

/* The two cohorts live in the URL beside the report, so "regs vs fish by sizing" is a link. They
   are this page's own keys; `useReportUrl` owns the other eight and leaves anything else alone. */
primary.value = single(route.query.cohort);
against.value = single(route.query.against);
watch([primary, against], ([one, two]) => {
  const query = { ...route.query, cohort: one ?? undefined, against: two ?? undefined };
  void router.replace({ query });
});

function single(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

await useAsyncData('definitions', () => definitions.load(), { server: false });
await useAsyncData('pool-scope', loadScope, { server: false });

if (columns.stats.value.length === 0 && presets.value[0] !== undefined) columns.apply(presets.value[0].request);

const cohortOf = (key: string | null): CohortChoice | null => choices.value.find((choice) => choice.key === key) ?? null;
const describedStat = computed(() => definitions.stats.find((stat) => stat.code === describing.value));
const describedDim = computed(() => (describedStat.value === undefined ? definitions.byCode.get(describing.value) : undefined));
const canRun = computed(() => columns.problems.value.length === 0 && filter.problems.length === 0);
const labelOf = (key: string | null): string => cohortOf(key)?.label ?? 'The whole field';

/** The pool's own presets and the cohorts it can be sliced by — both from the server, neither authored here. */
async function loadScope(): Promise<void> {
  const [shipped, saved] = await Promise.all([reports.poolPresets(), pool.cohorts().catch(() => [])]);
  presets.value = shipped.reports;
  choices.value = cohortChoices(shipped.cohorts, saved);
}

/**
 * Run the report once per cohort asked about.
 *
 * Two requests, because the engine takes one cohort and refuses a pool baseline; `align` then puts
 * them over the same rows so the pair can be read across. `sameShape` is a guard against a report
 * that changed between the two calls, not a formality.
 */
async function run(): Promise<void> {
  busy.value = true;
  failure.value = '';
  try {
    const request = columns.request();
    const first = await pool.run(request, cohortOf(primary.value));
    const second = against.value === null ? null : await pool.run(request, cohortOf(against.value));
    [left.value, right.value] = second !== null && sameShape(first, second) ? align(first, second) : [first, second];
    stale.value = false;
  } catch (error) {
    left.value = null;
    right.value = null;
    failure.value = describeApiError(error);
  } finally {
    busy.value = false;
  }
}

/* A result on screen is about the question that was asked, not the one now in the boxes. */
watch(
  () => [columns.state.value, filter.state, primary.value, against.value] as const,
  () => {
    if (left.value !== null) stale.value = true;
  },
  { deep: true },
);
</script>

<template>
  <section class="space-y-4">
    <div class="flex flex-wrap items-baseline gap-3">
      <h1 class="text-2xl font-semibold">The pool</h1>
      <p class="text-sm text-zinc-500" data-testid="pool-scope">the population — {{ choices.length }} cohorts available</p>
      <NuxtLink to="/pool/players" class="text-sm underline underline-offset-2">Find a player</NuxtLink>
      <NuxtLink to="/pool/cohorts" class="text-sm underline underline-offset-2">Cohorts</NuxtLink>
      <NuxtLink to="/ranges/compare" class="text-sm underline underline-offset-2">Pool ranges</NuxtLink>
      <button
        type="button"
        :disabled="busy || !canRun"
        data-testid="run-report"
        class="ml-auto rounded bg-zinc-900 px-3 py-1 text-sm text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
        @click="run"
      >
        {{ busy ? 'Running…' : stale ? 'Run again' : 'Run report' }}
      </button>
    </div>

    <p class="text-xs text-zinc-500" data-testid="dataset-locked">
      Every report on this page reads the population. The dataset is not a choice here — for your
      own hands, use <NuxtLink to="/reports" class="underline underline-offset-2">Reports</NuxtLink>.
    </p>

    <div class="flex flex-wrap gap-2">
      <button
        v-for="preset in presets"
        :key="preset.code"
        type="button"
        :disabled="busy"
        :data-testid="`pool-preset-${preset.code}`"
        :title="preset.description"
        class="rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-900"
        @click="columns.apply(preset.request)"
      >
        {{ preset.label }}
      </button>
    </div>

    <FilterBar :datasets="false" />

    <p v-if="!columns.editable.value" role="alert" data-testid="raw-filter" class="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
      This report's situation uses a condition the builder cannot show (an “any” or a “not”). It is
      sent exactly as it was stored, so the filter bar above is not what is being asked.
    </p>

    <div class="grid gap-4 md:grid-cols-2">
      <GroupByPicker :dimensions="definitions.dimensions" :selected="columns.groupBy.value" :by-code="definitions.byCode" @change="columns.setGroupBy" @describe="describing = $event" />
      <CohortPicker :choices="choices" :primary="primary" :against="against" :busy="busy" @update:primary="primary = $event" @update:against="against = $event" />
    </div>

    <label class="flex items-center gap-2 text-sm">
      <span class="text-zinc-500">grey a cell under</span>
      <select v-model.number="columns.minN.value" data-testid="minn-select" class="rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700">
        <option v-for="choice in MIN_N_CHOICES" :key="choice" :value="choice">{{ choice === 0 ? 'never — show every number' : `${choice} observations` }}</option>
      </select>
    </label>

    <StatPicker
      :usable="columns.usable.value"
      :all="definitions.stats"
      :selected="columns.stats.value"
      :dropped="columns.dropped.value"
      :tables="columns.tables.value"
      @toggle="columns.toggleStat"
      @describe="describing = $event"
    />

    <DefinitionPanel v-if="describing" :stat="describedStat" :dimension="describedDim" :dimensions="definitions.byCode" @close="describing = ''" />

    <p v-for="problem in columns.problems.value" :key="problem" role="alert" data-testid="column-problem" class="text-xs text-amber-700 dark:text-amber-400">{{ problem }}</p>
    <p v-if="failure" role="alert" data-testid="report-error" class="rounded border border-red-300 p-3 text-sm text-red-700 dark:border-red-800 dark:text-red-400">{{ failure }}</p>
    <p v-if="stale && left" class="text-xs text-amber-700 dark:text-amber-400" data-testid="report-stale">The question has changed since this ran. Run again to refresh it.</p>

    <CohortGrids
      :left="{ label: labelOf(primary), result: left }"
      :right="against === null ? null : { label: labelOf(against), result: right }"
      :stats="definitions.stats"
      :dimensions="definitions.byCode"
      :min-n="columns.minN.value"
      @describe="describing = $event"
    />
  </section>
</template>
