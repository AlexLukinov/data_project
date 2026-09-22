<script setup lang="ts">
/**
 * The reports workbench (plan D.5): any stat, for any situation, sliced any way.
 *
 * It composes the pieces and owns none of the rules. The situation is D.3's shared `FilterBar`, so
 * a link from the hand list opens the same question here. The columns are `reports/model.ts`. The
 * grid, the pickers, the definition panel, the preset menu and the save dialog are components of
 * their own, because plan D.4 (My game) and D.6 (Pool) are written to consume them rather than
 * this page.
 *
 * The `savedId` prop is the whole difference between `/reports` and `/reports/<id>`, and it is a
 * prop rather than a `useRoute()` read so that D.4 and D.6 can mount this with an id of their own.
 * Running is always explicit: a report over 73M decisions is not a keystroke.
 *
 * Both moments before a number exists — nothing run yet, and run with nothing to show — are taught
 * rather than left blank (audit §2.4), and every failure this page could otherwise hide behind an
 * empty list says so in its own line: "no saved reports" and "your saved reports could not be read"
 * look identical on screen and mean opposite things.
 */
import { computed, ref, watch } from 'vue';

import FilterBar from '~/components/filter/FilterBar.vue';
import DefinitionPanel from './DefinitionPanel.vue';
import EmptyState from './EmptyState.vue';
import GroupByPicker from './GroupByPicker.vue';
import PresetMenu from './PresetMenu.vue';
import ReadingOptions from './ReadingOptions.vue';
import SaveReportDialog from './SaveReportDialog.vue';
import StatGrid from './StatGrid.vue';
import StatPicker from './StatPicker.vue';
import { describeApiError } from '~/auth/api';
import type { Module, SavedReport } from '~/reports/api';
import { reportEmptyView, reportIdleView } from '~/reports/emptyState';
import type { ModulePreset } from '~/reports/library';
import { nameTaken } from '~/reports/library';
import { createColumnsModel } from '~/reports/model';
import { widenFilter } from '~/reports/widen';
import type { ReportRequest, ReportResult } from '~/stats/api';
import { createStatsApi } from '~/stats/api';
import { useDefinitionsStore } from '~/stores/definitions';
import { useFilterStore } from '~/stores/filter';
import { useReportsStore } from '~/stores/reports';

const props = defineProps<{ savedId: string | null }>();

const definitions = useDefinitionsStore();
const filter = useFilterStore();
const library = useReportsStore();
const api = createStatsApi(useApi());
const route = useRoute();
const router = useRouter();

const columns = createColumnsModel(
  computed(() => definitions.byCode),
  computed(() => definitions.stats),
  {
    tables: computed(() => filter.tables),
    dataset: computed(() => filter.dataset),
    load: (state) => filter.load(state),
    reportRequest: (extra) => filter.reportRequest(extra),
  },
);

const result = ref<ReportResult | null>(null);
const failure = ref('');
const busy = ref(false);
const stale = ref(false);
const describing = ref('');
const dialogOpen = ref(false);
const saving = ref(false);
const saveFailure = ref('');
const deleteFailure = ref('');
const savingName = ref('');
const openId = ref<string | null>(props.savedId);

/* Before the awaits: `useRoute`/`useRouter` need the component's own instance context, which a
   resumed setup no longer has. The URL decoding itself is registry-free, so it is safe this early. */
useReportUrl(columns);

await useAsyncData('definitions', () => definitions.load(), { server: false });
await useAsyncData('report-library', () => library.load(), { server: false });

openLinked();

const describedStat = computed(() => definitions.stats.find((stat) => stat.code === describing.value));
const describedDim = computed(() => (describedStat.value === undefined ? definitions.byCode.get(describing.value) : undefined));
const openReport = computed(() => (openId.value === null ? null : (library.savedReport(openId.value) ?? null)));
const taken = computed(() => nameTaken(library.saved, savingName.value, openId.value));
const canRun = computed(() => columns.problems.value.length === 0 && filter.problems.length === 0);

/* `canRun` travels into both views because an empty state must not offer a Run door the disabled
   button above it has already refused: `run()` returns early, and a button that answers a click
   with nothing is worse than no button. */
const idleView = computed(() => reportIdleView({ reportName: openReport.value?.name ?? null, hasStat: columns.stats.value.length > 0, canRun: canRun.value }));

/** Why this report came back with no rows, worded from the question that was actually sent. */
const emptyView = computed(() => reportEmptyView({ dataset: filter.dataset, sentence: filter.sentence, hasClauses: filter.active, dateFrom: filter.dateFrom, dateTo: filter.dateTo, rawFilter: !columns.editable.value, canRun: canRun.value }));

/* What a link opens: a saved report named in the path wins; otherwise the URL's own columns; and
   failing both, the first standard report — the server's idea of where to start, not the client's.
   A library retry runs it again, because until the library is read `openSaved` refuses: otherwise
   the header names a saved report whose columns this page never loaded, and Run runs the URL's. */
function openLinked(): void {
  const first = library.presets[0];
  if (props.savedId !== null) openSaved(props.savedId);
  else if (columns.stats.value.length === 0 && first !== undefined) apply(first.request, null);
}

/* A library that failed to load has no saved report in it, so "it may have been deleted" would be
   this page inventing a cause; `library-error` already says the true one. */
function openSaved(id: string): void {
  if (library.status === 'error') return;
  const report = library.savedReport(id);
  if (report === undefined) {
    failure.value = 'That saved report is not in your library — it may have been deleted.';
    return;
  }
  apply(report.definition, report.id);
}

/* Each store turns its own failure back into the sentence already on screen, so a second failure
   replaces that line rather than becoming an unhandled rejection; a library that reads on the
   second try then opens what the link named, which the failed first try could not. */
function retry(what: 'definitions' | 'library'): void {
  void (what === 'definitions' ? definitions.load() : library.load().then(openLinked)).catch(() => undefined);
}

/** The ways out an empty state offers. `widenFilter` owns the filter's; running is this page's. */
function widen(key: string): void {
  if (!widenFilter(key, filter) && key === 'run') void run();
}

/** Load a document and remember which stored thing, if any, is on screen. */
function apply(request: ReportRequest, id: string | null): void {
  columns.apply(request);
  openId.value = id;
  result.value = null;
  failure.value = '';
  stale.value = false;
}

/** The path a report lives at, keeping the query the filter and the columns have written into it. */
function goTo(id: string | null): Promise<unknown> {
  const path = id === null ? '/reports' : `/reports/${id}`;
  return path === route.path ? Promise.resolve() : router.replace({ path, query: { ...route.query } });
}

async function run(): Promise<void> {
  /* Not only the button's `disabled`: an empty state offers Run report as a second door. */
  if (!canRun.value) return;
  busy.value = true;
  failure.value = '';
  try {
    const asked = questionKey();
    result.value = await api.runReport(columns.request());
    /* See `pages/pool/index.vue#run`: the boxes can be edited while the report runs, and clearing
       the flag unconditionally would present that answer as the one now on screen. */
    stale.value = questionKey() !== asked;
  } catch (error) {
    result.value = null;
    failure.value = describeApiError(error);
  } finally {
    busy.value = false;
  }
}

async function save(payload: { name: string; module: Module; replace: boolean }): Promise<void> {
  saving.value = true;
  saveFailure.value = '';
  const body = { name: payload.name, module: payload.module, definition: columns.request() };
  try {
    const existing = openReport.value;
    const row = payload.replace && existing !== null ? await library.update(existing.id, body) : await library.save(body);
    openId.value = row.id;
    dialogOpen.value = false;
    await goTo(row.id);
  } catch (error) {
    saveFailure.value = describeApiError(error);
  } finally {
    saving.value = false;
  }
}

async function openStored(report: SavedReport): Promise<void> {
  openSaved(report.id);
  await goTo(report.id);
}

async function openPreset(preset: ModulePreset): Promise<void> {
  apply(preset.request, null);
  await goTo(null);
}

/** A refused delete is said and changes nothing; a delete that happened but whose list did not reload says that. */
async function remove(report: SavedReport): Promise<void> {
  deleteFailure.value = '';
  try {
    await library.remove(report.id);
  } catch (error) {
    const deleted = library.savedReport(report.id) === undefined;
    deleteFailure.value = deleted
      ? `“${report.name}” was deleted, but the list could not be read back: ${describeApiError(error)}`
      : `Could not delete “${report.name}”: ${describeApiError(error)}`;
    if (!deleted) return;
  }
  if (openId.value !== report.id) return;
  openId.value = null;
  await goTo(null);
}

/* The browser's Back button moves between `/reports/<a>` and `/reports/<b>` without remounting. */
watch(
  () => props.savedId,
  (id) => {
    if (id !== null && id !== openId.value) openSaved(id);
  },
);

/** What "the same question" means here: the columns and the situation, as the watcher below reads them. */
function questionKey(): string {
  return JSON.stringify([columns.state.value, filter.state]);
}

/* A result on screen is about the question that was asked, not the one now in the boxes. */
watch(
  () => [columns.state.value, filter.state] as const,
  () => {
    if (result.value !== null) stale.value = true;
  },
  { deep: true },
);
</script>

<template>
  <section class="space-y-4">
    <div class="flex flex-wrap items-baseline gap-3">
      <h1 class="text-2xl font-semibold">Reports</h1>
      <p v-if="openReport" class="text-sm text-zinc-500" data-testid="open-name">showing “{{ openReport.name }}”</p>
      <button type="button" data-testid="open-save" class="ml-auto rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900" @click="dialogOpen = true">
        Save report…
      </button>
      <button type="button" :disabled="busy || !canRun" data-testid="run-report" class="rounded bg-zinc-900 px-3 py-1 text-sm text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900" @click="run">
        {{ busy ? 'Running…' : stale ? 'Run again' : 'Run report' }}
      </button>
    </div>

    <div v-if="definitions.status === 'error'" role="alert" data-testid="definitions-error" class="rounded border border-red-300 p-3 text-sm text-red-700 dark:border-red-800 dark:text-red-400">
      {{ definitions.error }}
      <button type="button" class="ml-2 underline underline-offset-2" @click="retry('definitions')">Try again</button>
    </div>

    <div v-if="library.status === 'error'" role="alert" data-testid="library-error" class="rounded border border-red-300 p-3 text-sm text-red-700 dark:border-red-800 dark:text-red-400">
      {{ library.error }}
      <button type="button" class="ml-2 underline underline-offset-2" @click="retry('library')">Try again</button>
    </div>

    <p v-if="deleteFailure" role="alert" data-testid="report-delete-error" class="text-sm text-red-600 dark:text-red-400">{{ deleteFailure }}</p>

    <PresetMenu :presets="library.presets" :saved="library.saved" :open-id="openId" :busy="busy" :failed="library.status === 'error'" @open-preset="openPreset" @open-saved="openStored" @remove="remove" />

    <FilterBar />

    <p v-if="!columns.editable.value" role="alert" data-testid="raw-filter" class="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
      This report's situation uses a condition the builder cannot show (an “any” or a “not”). It is
      sent exactly as it was stored, so the filter bar above is not what is being asked.
    </p>

    <div class="grid gap-4 md:grid-cols-2">
      <GroupByPicker :dimensions="definitions.dimensions" :selected="columns.groupBy.value" :by-code="definitions.byCode" @change="columns.setGroupBy" @describe="describing = $event" />

      <ReadingOptions v-model:compare="columns.compare.value" v-model:min-n="columns.minN.value" :compare-on="columns.compareOn.value" :cohort="columns.cohort.value" :cohort-on="columns.cohortOn.value" :stats="definitions.stats" />
    </div>

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
    <p v-if="stale && result" class="text-xs text-amber-700 dark:text-amber-400" data-testid="report-stale">The question has changed since this ran. Run again to refresh it.</p>

    <EmptyState v-if="result === null && !busy && !failure" :view="idleView" testid="report-idle" @act="widen" />
    <p v-else-if="busy && result === null" role="status" class="text-sm text-zinc-500" data-testid="report-running">Running the report over every hand it covers…</p>

    <StatGrid :result="result" :stats="definitions.stats" :dimensions="definitions.byCode" :min-n="columns.minN.value" @describe="describing = $event">
      <template #empty><EmptyState :view="emptyView" testid="report-empty" @act="widen" /></template>
    </StatGrid>

    <SaveReportDialog
      :open="dialogOpen"
      :existing="openReport"
      :taken="taken"
      :busy="saving"
      :failure="saveFailure"
      :suggested-name="openReport?.name ?? ''"
      :suggested-module="filter.dataset === 'population' ? 'pool' : 'hero'"
      @update:name="savingName = $event"
      @save="save"
      @close="dialogOpen = false"
    />
  </section>
</template>
