/**
 * The one filter every screen shares (plan D.3).
 *
 * Framework-free apart from `ref`/`computed`, so it is unit-tested with a plain map of
 * dimensions and no Nuxt, no Pinia and no server — `stores/filter.ts` only binds it. It owns
 * four things and nothing else: the dataset, the date bounds, the list of clauses, and the
 * derivations every consumer wants (the AST, the URL query, the sentence, the problems).
 *
 * It deliberately does **not** own the group-by or the stat selection. Those belong to the
 * report workbench (plan D.5): two screens sharing a situation should not be forced to share
 * the columns they measure it with.
 */

import type { Ref } from 'vue';
import { computed, ref } from 'vue';

import type { Dataset, Dimension, FilterNode, ReportRequest } from '../stats/api';
import type { Clause } from './clause';
import { clausesToNode, defaultClause, isComplete, tablesFor } from './clause';
import { clauseProblem, filterSentence } from './label';
import type { FilterState } from './url';
import { DEFAULT_STATE, toQuery } from './url';

export type DimensionMap = ReadonlyMap<string, Dimension>;

export interface FilterModel {
  /** Plain state a bar edits directly (`v-model`); everything derived below is read-only. */
  dataset: Ref<Dataset>;
  dateFrom: Ref<string>;
  dateTo: Ref<string>;
  readonly clauses: Ref<Clause[]>;
  /** The §2.5 tree for the complete clauses; `{all: []}` when there are none. */
  readonly node: Ref<FilterNode>;
  /** Whether anything is actually filtered — what decides a list endpoint over a search. */
  readonly active: Ref<boolean>;
  readonly query: Ref<Record<string, string>>;
  readonly sentence: Ref<string>;
  readonly problems: Ref<string[]>;
  /** The fact tables that can answer every clause at once. */
  readonly tables: Ref<string[]>;
  readonly state: Ref<FilterState>;
  add(dim: Dimension): void;
  replace(index: number, clause: Clause): void;
  remove(index: number): void;
  clear(): void;
  load(state: FilterState): void;
  reportRequest(extra?: Omit<ReportRequest, 'dataset' | 'hero_only' | 'filter' | 'date_from' | 'date_to'>): ReportRequest;
}

export function createFilterModel(dims: Ref<DimensionMap>): FilterModel {
  const dataset = ref<Dataset>(DEFAULT_STATE.dataset);
  const dateFrom = ref(DEFAULT_STATE.dateFrom);
  const dateTo = ref(DEFAULT_STATE.dateTo);
  const clauses = ref<Clause[]>([]);

  const node = computed(() => clausesToNode(clauses.value, dims.value));
  const active = computed(() => clauses.value.some((c) => isComplete(c, dims.value.get(c.dim))));
  const state = computed<FilterState>(() => ({
    dataset: dataset.value,
    dateFrom: dateFrom.value,
    dateTo: dateTo.value,
    clauses: clauses.value,
  }));

  return {
    dataset,
    dateFrom,
    dateTo,
    clauses,
    node,
    active,
    state,
    query: computed(() => toQuery(state.value)),
    sentence: computed(() => filterSentence(clauses.value, dims.value)),
    problems: computed(() => problemsOf(clauses.value, dims.value)),
    tables: computed(() => tablesFor(clauses.value, dims.value)),
    ...edits(clauses, { dataset, dateFrom, dateTo }),
    reportRequest: (extra = {}) => request({ dataset, dateFrom, dateTo, node }, extra),
  };
}

function problemsOf(clauses: readonly Clause[], dims: DimensionMap): string[] {
  const problems: string[] = [];
  for (const clause of clauses) {
    const problem = clauseProblem(clause, dims.get(clause.dim));
    if (problem !== null) problems.push(problem);
  }
  return problems;
}

interface Bounds {
  dataset: Ref<Dataset>;
  dateFrom: Ref<string>;
  dateTo: Ref<string>;
}

function edits(clauses: Ref<Clause[]>, bounds: Bounds): Pick<FilterModel, 'add' | 'replace' | 'remove' | 'clear' | 'load'> {
  return {
    add: (dim) => {
      clauses.value = [...clauses.value, defaultClause(dim)];
    },
    replace: (index, clause) => {
      clauses.value = clauses.value.map((old, i) => (i === index ? clause : old));
    },
    remove: (index) => {
      clauses.value = clauses.value.filter((_, i) => i !== index);
    },
    clear: () => {
      clauses.value = [];
    },
    load: (next) => {
      bounds.dataset.value = next.dataset;
      bounds.dateFrom.value = next.dateFrom;
      bounds.dateTo.value = next.dateTo;
      clauses.value = next.clauses.map((c) => ({ ...c, values: [...c.values] }));
    },
  };
}

interface RequestParts {
  dataset: Ref<Dataset>;
  dateFrom: Ref<string>;
  dateTo: Ref<string>;
  node: Ref<FilterNode>;
}

/**
 * The request body. `hero_only` tracks the dataset because the server validates the pair
 * together: `{dataset: 'population'}` alone is a 422, since the pool has no hero seat.
 * Empty date bounds are omitted rather than sent as `''`.
 */
function request(parts: RequestParts, extra: Partial<ReportRequest>): ReportRequest {
  const population = parts.dataset.value === 'population';
  return {
    dataset: parts.dataset.value,
    hero_only: !population,
    ...(parts.dateFrom.value === '' ? {} : { date_from: parts.dateFrom.value }),
    ...(parts.dateTo.value === '' ? {} : { date_to: parts.dateTo.value }),
    filter: parts.node.value,
    ...extra,
  };
}
