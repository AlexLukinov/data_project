/**
 * What the workbench owns on top of the shared filter (plan D.5).
 *
 * `filter/model.ts` owns the *situation* — the dataset, the dates, the clauses — and says in its
 * own docstring that the group-by and the stat selection are deliberately not its business,
 * because two screens should be able to share a situation without sharing the columns they
 * measure it with. This is the other half: the stats, the group-by, the baseline, the cohort and
 * the sample threshold, plus the one thing that turns all of it into a request.
 *
 * Framework-free apart from `ref`/`computed`, so it is unit-tested against a plain map of
 * dimensions and a fake filter — no Nuxt, no Pinia, no server.
 *
 * Three of the engine's rules are enforced here rather than discovered as a 422, because they are
 * rules about *pairs* of fields (`stats/request.py#_consistent`):
 *
 *  - `compare_to` needs the hero dataset — there is no pool-versus-pool baseline;
 *  - a `cohort` applies to a population report, or to a hero report's baseline (hero vs regs);
 *  - `hero_only` tracks the dataset, which `filter.reportRequest` already gets right.
 *
 * They are enforced by *inertness* rather than by clearing: switching to the pool leaves the
 * baseline switch remembered but not in effect, so switching back restores it. The screen says
 * which of the two it is; silently forgetting a setting the person chose is worse than either.
 */

import type { Ref } from 'vue';
import { computed, ref, shallowRef } from 'vue';

import type { Clause } from '../filter/clause';
import { nodeToClauses } from '../filter/node';
import type { FilterState } from '../filter/url';
import type { CohortSpec, CustomStatSpec, Dataset, Dimension, FilterNode, ReportRequest, Stat } from '../stats/api';
import { columnProblems, keepFitting, narrowByGroupBy, usableStats } from './columns';
import type { ColumnsState } from './url';
import { DEFAULT_COLUMNS, columnsToQuery } from './url';

/** Anything with a current value: a `ref`, a `computed`, or a getter over an unwrapped store. */
export interface Readable<T> {
  readonly value: T;
}

/** What a report needs from the shared filter — not `FilterModel` itself. */
export type ReportExtra = Omit<ReportRequest, 'dataset' | 'hero_only' | 'filter' | 'date_from' | 'date_to'>;

/**
 * The seam onto the shared filter.
 *
 * Deliberately the four things a report uses and nothing more, as a small readable interface
 * rather than `FilterModel`: Pinia unwraps a setup store's refs, so `useFilterStore()` is
 * value-shaped where `createFilterModel()` is ref-shaped, and a model typed against either one
 * cannot be constructed from the other. A seam also makes the unit tests a plain object.
 */
export interface FilterAccess {
  readonly tables: Readable<readonly string[]>;
  readonly dataset: Readable<Dataset>;
  load(state: FilterState): void;
  reportRequest(extra?: ReportExtra): ReportRequest;
}

/**
 * Fields of a stored report that the workbench does not edit but must not lose. A saved pool
 * report may name one player and a saved report may carry inline custom stats; dropping either on
 * the way through would answer a different question under the same name.
 */
export interface Carried {
  playerKey: string | null;
  custom: CustomStatSpec[];
  limit: number | null;
}

const NOTHING_CARRIED: Carried = { playerKey: null, custom: [], limit: null };

export interface ColumnsModel {
  readonly stats: Ref<string[]>;
  readonly groupBy: Ref<string[]>;
  readonly compare: Ref<boolean>;
  readonly cohort: Ref<CohortSpec | null>;
  readonly minN: Ref<number>;
  /**
   * A situation the clause builder cannot express — an `any`, a `not`, a nested `all`. Kept
   * verbatim and sent as it arrived; `editable` is false while it is set.
   */
  readonly rawFilter: Ref<FilterNode | null>;
  readonly carried: Ref<Carried>;
  /** Whether the builder can edit this report's situation at all. */
  readonly editable: Ref<boolean>;
  /** The fact tables that can answer the situation *and* the grouping. */
  readonly tables: Ref<string[]>;
  /** The stats worth offering, given those tables. */
  readonly usable: Ref<Stat[]>;
  /** Stats dropped because the situation or the grouping moved under them, by label. */
  readonly dropped: Ref<string[]>;
  /** Whether the baseline / cohort are actually in effect, as opposed to merely remembered. */
  readonly compareOn: Ref<boolean>;
  readonly cohortOn: Ref<boolean>;
  readonly problems: Ref<string[]>;
  readonly query: Ref<Record<string, string>>;
  readonly state: Ref<ColumnsState>;
  toggleStat(code: string): void;
  setGroupBy(codes: string[]): void;
  load(state: ColumnsState): void;
  /** Put a preset or a saved report's whole document into the workbench, filter included. */
  apply(request: ReportRequest): void;
  /** The body for `POST /v1/reports/run`, and the document a save stores. */
  request(): ReportRequest;
}

export type DimensionMap = ReadonlyMap<string, Dimension>;

export function createColumnsModel(dims: Readable<DimensionMap>, stats: Readable<readonly Stat[]>, filter: FilterAccess): ColumnsModel {
  const slots = makeSlots();
  const derived = derive(slots, dims, stats, filter);
  return {
    stats: slots.chosen,
    groupBy: slots.groupBy,
    compare: slots.compare,
    cohort: slots.cohort,
    minN: slots.minN,
    rawFilter: slots.rawFilter,
    carried: slots.carried,
    editable: computed(() => slots.rawFilter.value === null),
    tables: derived.tables,
    usable: derived.usable,
    dropped: computed(() => derived.fitting.value.dropped),
    compareOn: derived.compareOn,
    cohortOn: derived.cohortOn,
    problems: computed(() => columnProblems(derived.sent.value, slots.groupBy.value)),
    query: computed(() => columnsToQuery(derived.state.value)),
    state: derived.state,
    ...edits(slots),
    apply: (request) => applyRequest(request, slots, dims.value, filter),
    request: () => build(slots, derived, filter),
  };
}

interface Slots {
  chosen: Ref<string[]>;
  groupBy: Ref<string[]>;
  compare: Ref<boolean>;
  minN: Ref<number>;
  cohort: Ref<CohortSpec | null>;
  rawFilter: Ref<FilterNode | null>;
  carried: Ref<Carried>;
}

function makeSlots(): Slots {
  return {
    chosen: ref<string[]>([...DEFAULT_COLUMNS.stats]),
    groupBy: ref<string[]>([...DEFAULT_COLUMNS.groupBy]),
    compare: ref(DEFAULT_COLUMNS.compare),
    minN: ref(DEFAULT_COLUMNS.minN),
    /* Documents, not state to poke at: each is replaced whole, and `shallowRef` keeps the
       recursive `FilterNode` union out of Vue's deep-unwrap machinery, which mangles it. */
    cohort: shallowRef<CohortSpec | null>(DEFAULT_COLUMNS.cohort),
    rawFilter: shallowRef<FilterNode | null>(null),
    carried: shallowRef<Carried>({ ...NOTHING_CARRIED }),
  };
}

interface Derived {
  tables: Ref<string[]>;
  usable: Ref<Stat[]>;
  fitting: Ref<{ codes: string[]; dropped: string[] }>;
  compareOn: Ref<boolean>;
  cohortOn: Ref<boolean>;
  /** The stats actually sent: one the current tables cannot answer is held back, not posted. */
  sent: Ref<string[]>;
  state: Ref<ColumnsState>;
}

function derive(slots: Slots, dims: Readable<DimensionMap>, stats: Readable<readonly Stat[]>, filter: FilterAccess): Derived {
  const tables = computed(() => narrowByGroupBy(filter.tables.value, slots.groupBy.value, dims.value));
  const fitting = computed(() => keepFitting(slots.chosen.value, stats.value, tables.value));
  const compareOn = computed(() => slots.compare.value && filter.dataset.value === 'hero');
  return {
    tables,
    fitting,
    compareOn,
    usable: computed(() => usableStats(stats.value, tables.value)),
    cohortOn: computed(() => slots.cohort.value !== null && (filter.dataset.value === 'population' || compareOn.value)),
    sent: computed(() => fitting.value.codes),
    state: computed<ColumnsState>(() => ({
      stats: slots.chosen.value,
      groupBy: slots.groupBy.value,
      compare: slots.compare.value,
      cohort: slots.cohort.value,
      minN: slots.minN.value,
    })),
  };
}

function edits(slots: Slots): Pick<ColumnsModel, 'toggleStat' | 'setGroupBy' | 'load'> {
  return {
    toggleStat: (code) => {
      const chosen = slots.chosen.value;
      slots.chosen.value = chosen.includes(code) ? chosen.filter((entry) => entry !== code) : [...chosen, code];
    },
    setGroupBy: (codes) => {
      slots.groupBy.value = [...codes];
    },
    load: (next) => {
      slots.chosen.value = [...next.stats];
      slots.groupBy.value = [...next.groupBy];
      slots.compare.value = next.compare;
      slots.cohort.value = next.cohort === null ? null : { rules: next.cohort.rules.map((rule) => ({ ...rule })) };
      slots.minN.value = next.minN;
    },
  };
}

/**
 * Load a whole `ReportRequest` — the situation into the shared filter, the columns here.
 *
 * The filter arrives as a compiled tree and has to become clauses again for the builder to show
 * it (`filter/node.ts`). Where it cannot, the tree is kept verbatim in `rawFilter` and sent
 * unchanged: a preset whose situation the builder quietly simplified would put the wrong number
 * on screen under the preset's own name.
 */
function applyRequest(request: ReportRequest, slots: Slots, dims: DimensionMap, filter: FilterAccess): void {
  const node: FilterNode = request.filter ?? { all: [] };
  const clauses: Clause[] | null = nodeToClauses(node, dims);
  filter.load({
    dataset: request.dataset ?? 'hero',
    dateFrom: request.date_from ?? '',
    dateTo: request.date_to ?? '',
    clauses: clauses ?? [],
  });
  slots.rawFilter.value = clauses === null ? node : null;
  slots.chosen.value = [...(request.stats ?? [])];
  slots.groupBy.value = [...(request.group_by ?? [])];
  slots.compare.value = request.compare_to === 'population';
  slots.cohort.value = request.cohort ?? null;
  slots.carried.value = {
    playerKey: request.player_key ?? null,
    custom: [...(request.custom ?? [])],
    limit: request.limit ?? null,
  };
}

/**
 * The request body. `filter.reportRequest` supplies the situation half — including the
 * `hero_only` pairing the server validates — and the columns are added here. Only what is
 * actually *in effect* is sent, so a remembered-but-inert baseline never becomes a 422.
 */
function build(slots: Slots, derived: Derived, filter: FilterAccess): ReportRequest {
  const carried = slots.carried.value;
  const cohort = slots.cohort.value;
  const body = filter.reportRequest({
    stats: derived.sent.value,
    group_by: slots.groupBy.value,
    ...(derived.compareOn.value ? { compare_to: 'population' as const } : {}),
    ...(derived.cohortOn.value && cohort !== null ? { cohort } : {}),
    ...(carried.playerKey === null ? {} : { player_key: carried.playerKey }),
    ...(carried.custom.length === 0 ? {} : { custom: carried.custom }),
    ...(carried.limit === null ? {} : { limit: carried.limit }),
  });
  if (slots.rawFilter.value !== null) body.filter = slots.rawFilter.value;
  return body;
}
