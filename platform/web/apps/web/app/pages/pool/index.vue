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
import EmptyState from '~/components/reports/EmptyState.vue';
import GroupByPicker from '~/components/reports/GroupByPicker.vue';
import PresetButton from '~/components/reports/PresetButton.vue';
import ReadingThreshold from '~/components/reports/ReadingThreshold.vue';
import StatPicker from '~/components/reports/StatPicker.vue';
import { describeApiError } from '~/auth/api';
import { createReportsApi } from '~/reports/api';
import type { EmptyStateView } from '~/reports/emptyState';
import { poolEmptyView, poolIdleView } from '~/reports/emptyState';
import { createColumnsModel } from '~/reports/model';
import { align, sameShape } from '~/pool/compare';
import { lockedToPopulation } from '~/pool/population';
import { createPoolScope } from '~/pool/scope';
import { createPoolStatsApi, describeRules } from '~/pool/stats';
import { gridHeading, unknownCohortWords } from '~/pool/words';
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

const scope = createPoolScope({
  reports,
  pool,
  stats: computed(() => definitions.stats),
  open: columns.apply,
});

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

/*
 * `lazy: true` on both (plan F.12, spec §13 "fast feedback"): awaited without it, `<Suspense>`
 * holds the whole app — nav included — until the registry *and* the pool's cohorts have answered,
 * so a slow or stopped API gives a blank screen with nothing to read and nothing to do. This is
 * the trap F.12a documented for `pages/ranges/compare.vue`; /pool was holding it twice.
 */
await useAsyncData('definitions', () => definitions.load(), { server: false, lazy: true });
await useAsyncData('pool-scope', () => scope.load(), { server: false, lazy: true });

/*
 * Which makes opening the first standard report a *reaction* to the cohorts arriving rather than
 * a line that runs after an await. `immediate` covers the warm store on a second visit, and the
 * guard is the same one the awaited version carried: a question already in the URL wins, and a
 * reader who has started choosing stats is never overwritten.
 */
watch(
  scope.presets,
  (presets) => {
    if (columns.stats.value.length === 0 && presets[0] !== undefined) scope.apply(presets[0]);
  },
  { immediate: true },
);

const describedStat = computed(() => definitions.stats.find((stat) => stat.code === describing.value));
const describedDim = computed(() => (describedStat.value === undefined ? definitions.byCode.get(describing.value) : undefined));

/**
 * A cohort in the link that is not on offer. Blocking the run is the point: the key resolved to
 * `null`, and `null` is also how "the whole field" is spelled, so the report would have measured
 * every player in the pool under the missing cohort's name.
 */
const unresolved = computed(() => [primary.value, against.value].find((key) => key !== null && scope.cohortOf(key) === null) ?? null);
/* Either half of the picker can be the one that failed: `?cohort=preset:regs` is the link the
   cohorts page writes for a *shipped* cohort, and those arrive with the presets. */
const listFailed = computed(() => scope.savedProblem.value !== '' || scope.problem.value !== '');
const cohortProblem = computed(() => (unresolved.value === null ? '' : unknownCohortWords(unresolved.value, listFailed.value)));
const canRun = computed(() => columns.problems.value.length === 0 && filter.problems.length === 0 && cohortProblem.value === '');

/** True while the report's *own* cohort is what scopes it — the picker's choice always wins. */
const storedRule = computed(() => primary.value === null && columns.cohortOn.value && columns.cohort.value !== null);
const labelOf = (key: string | null): string => gridHeading(scope.cohortOf(key)?.label ?? null, storedRule.value);

const idleView = computed(() =>
  poolIdleView({
    reportName: scope.openPreset.value?.label ?? null,
    hasStat: columns.stats.value.length > 0,
    canRun: canRun.value,
    cohortLabel: scope.cohortOf(primary.value)?.label ?? null,
    storedRule: storedRule.value,
  }),
);

/** Why one grid came back with no rows — worded for the cohort *that* grid asked about. */
function emptyView(side: 'left' | 'right'): EmptyStateView {
  return poolEmptyView({
    sentence: filter.sentence,
    hasClauses: filter.active,
    dateFrom: filter.dateFrom,
    dateTo: filter.dateTo,
    rawFilter: !columns.editable.value,
    cohortLabel: scope.cohortOf(side === 'left' ? primary.value : against.value)?.label ?? null,
    storedRule: storedRule.value,
    canRun: canRun.value,
    side,
  });
}

/**
 * Ask for the registry again. The store turns the failure back into `definitions.error`, which is
 * the sentence already on screen, so there is nothing here to rethrow into an unhandled rejection.
 */
function retryDefinitions(): void {
  void definitions.load().catch(() => undefined);
}

/**
 * The ways out an empty state offers: only this page can clear its own filter or run its report.
 * The side matters for one of them — "Measure the whole field" clears the *left* grid's cohort, and
 * the picker has no whole field for the right-hand one, so that grid does not offer it and the side
 * is passed here so it cannot arrive from there anyway.
 */
function widen(key: string, side: 'left' | 'right' = 'left'): void {
  if (key === 'clear-situation') filter.clear();
  if (key === 'clear-dates') {
    filter.dateFrom = '';
    filter.dateTo = '';
  }
  if (key === 'whole-field' && side === 'left') primary.value = null;
  if (key === 'run') void run();
}

/**
 * Run the report once per cohort asked about.
 *
 * Two requests, because the engine takes one cohort and refuses a pool baseline; `align` then puts
 * them over the same rows so the pair can be read across. `sameShape` is a guard against a report
 * that changed between the two calls, not a formality.
 */
async function run(): Promise<void> {
  /* Not only the button's `disabled`: an empty state offers Run report too, and a question this
     page has already said it cannot ask must not be answered by a different one. */
  if (!canRun.value) return;
  busy.value = true;
  failure.value = '';
  try {
    const request = columns.request();
    const first = await pool.run(request, scope.cohortOf(primary.value));
    const second = against.value === null ? null : await pool.run(request, scope.cohortOf(against.value));
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
      <!-- The page now paints before the cohorts land, so the count line has to say which of the
           two it is: still being read, or read and this many. -->
      <p v-if="scope.loading.value" role="status" class="text-sm text-zinc-500" data-testid="pool-scope-loading">the population — reading the cohorts on offer…</p>
      <p v-else class="text-sm text-zinc-500" data-testid="pool-scope">the population — {{ scope.choices.value.length }} cohorts available</p>
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

    <div v-if="definitions.status === 'error'" role="alert" data-testid="definitions-error" class="rounded border border-red-300 p-3 text-sm text-red-700 dark:border-red-800 dark:text-red-400">
      {{ definitions.error }}
      <button type="button" class="ml-2 underline underline-offset-2" @click="retryDefinitions">Try again</button>
    </div>

    <div v-if="scope.problem.value" role="alert" data-testid="pool-scope-error" class="rounded border border-red-300 p-3 text-sm text-red-700 dark:border-red-800 dark:text-red-400">
      {{ scope.problem.value }}
      <button type="button" class="ml-2 underline underline-offset-2" @click="scope.load()">Try again</button>
    </div>

    <div v-if="scope.savedProblem.value" role="alert" data-testid="pool-cohorts-error" class="rounded border border-amber-300 p-3 text-sm text-amber-900 dark:border-amber-700 dark:text-amber-100">
      {{ scope.savedProblem.value }}
      <button type="button" class="ml-2 underline underline-offset-2" @click="scope.load()">Try again</button>
    </div>

    <p class="text-xs text-zinc-500" data-testid="dataset-locked">
      Every report on this page reads the population. The dataset is not a choice here — for your
      own hands, use <NuxtLink to="/reports" class="underline underline-offset-2">Reports</NuxtLink>.
    </p>

    <div class="flex flex-wrap gap-2">
      <PresetButton v-for="preset in scope.presets.value" :key="preset.code" :preset="preset" :disabled="busy" :testid="`pool-preset-${preset.code}`" size="md" @open="scope.apply(preset)" />
    </div>

    <FilterBar :datasets="false" />

    <p v-if="!columns.editable.value" role="alert" data-testid="raw-filter" class="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
      This report's situation uses a condition the builder cannot show (an “any” or a “not”). It is
      sent exactly as it was stored, so the filter bar above is not what is being asked.
    </p>

    <div class="grid gap-4 md:grid-cols-2">
      <GroupByPicker :dimensions="definitions.dimensions" :selected="columns.groupBy.value" :by-code="definitions.byCode" @change="columns.setGroupBy" @describe="describing = $event" />
      <CohortPicker :choices="scope.choices.value" :primary="primary" :against="against" :busy="busy" @update:primary="primary = $event" @update:against="against = $event" />
    </div>

    <!-- F.12: the same folded control /reports has, instead of this page's own bare copy of it. -->
    <ReadingThreshold v-model="columns.minN.value" />

    <p v-if="storedRule && columns.cohort.value" class="text-xs text-zinc-500" data-testid="cohort-note">
      This standard report carries a rule of its own, so it is not measuring the whole field: only
      players whose {{ describeRules(columns.cohort.value, definitions.stats) }}. Choosing a cohort
      under “Which players” replaces it.
    </p>

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
    <p v-if="cohortProblem" role="alert" data-testid="cohort-unknown" class="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">{{ cohortProblem }}</p>
    <p v-if="failure" role="alert" data-testid="report-error" class="rounded border border-red-300 p-3 text-sm text-red-700 dark:border-red-800 dark:text-red-400">{{ failure }}</p>
    <p v-if="stale && left" class="text-xs text-amber-700 dark:text-amber-400" data-testid="report-stale">The question has changed since this ran. Run again to refresh it.</p>

    <EmptyState v-if="left === null && !busy && !failure" :view="idleView" testid="pool-idle" @act="widen" />
    <p v-else-if="busy && left === null" role="status" class="text-sm text-zinc-500" data-testid="pool-running">Running the report over the pool…</p>

    <CohortGrids
      :left="{ label: labelOf(primary), result: left }"
      :right="against === null ? null : { label: labelOf(against), result: right }"
      :stats="definitions.stats"
      :dimensions="definitions.byCode"
      :min-n="columns.minN.value"
      @describe="describing = $event"
    >
      <template #empty="{ side }">
        <EmptyState :view="emptyView(side)" :testid="`pool-empty-${side}`" @act="(key: string) => widen(key, side)" />
      </template>
    </CohortGrids>
  </section>
</template>
