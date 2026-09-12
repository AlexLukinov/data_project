/**
 * The dataset lock (plan D.6: "population workbench, **dataset locked**").
 *
 * The pool page shares D.3's filter store with the hand list and the reports workbench — that is
 * the point of a shared filter, and a situation should follow you from one to the other. What it
 * must **not** share is the dataset: `/pool` is the population and nothing else.
 *
 * The lock is therefore structural rather than a setting. Instead of writing `population` into the
 * shared store on mount — which would leave the hand list showing pool hands after a visit here,
 * and which the URL would quietly undo, since `filter/url.ts` reads any missing or unknown `ds` as
 * `hero` — the page wraps the store in a `FilterAccess` whose dataset **is** `population` and whose
 * every request says so. The store keeps the **dataset** it held, in both directions; its
 * situation and dates are still shared, and still meant to be.
 *
 * That matters more than tidiness: `analysis/pool/service.py` refuses a body whose dataset is not
 * `population`, and `stats/request.py` refuses `population` beside `hero_only`. A page that let the
 * URL win would answer a 400 to a link that looked perfectly ordinary.
 *
 * `compare_to` is left to go inert on its own, as `reports/model.ts` already arranges: the engine
 * refuses a baseline on a pool report ("compare_to needs the hero dataset"), and `compareOn` is
 * false whenever the dataset is population, so the setting is remembered and not sent.
 */

import { computed } from 'vue';

import type { FilterAccess, ReportExtra } from '../reports/model';
import type { Dataset, ReportRequest } from '../stats/api';

const POPULATION: Dataset = 'population';

/** The four things `createColumnsModel` needs from the shared filter, dataset pinned. */
export interface SharedFilter {
  readonly tables: readonly string[];
  readonly dataset: Dataset;
  load(state: Parameters<FilterAccess['load']>[0]): void;
  reportRequest(extra?: ReportExtra): ReportRequest;
}

/**
 * The shared filter, read as a population filter.
 *
 * The situation, the dates and the clause-derived tables are the store's own; only the dataset and
 * `hero_only` are overridden, and they are overridden in **both** directions:
 *
 *  - **out** — a request built from a store that currently says `hero` still asks the pool;
 *  - **in** — `load` keeps the dataset the store already had, because the things that call it carry
 *    a dataset of their own. `reports/model.ts#applyRequest` does
 *    `filter.load({ dataset: request.dataset ?? 'hero', … })`, so opening a pool preset here would
 *    otherwise stamp `population` onto the store the hand list and the reports workbench share, and
 *    a visit to this page would silently change what `/hands` answers. The clauses and the dates
 *    *should* follow you between pages — that is what a shared filter is for. The dataset should
 *    not, because on this page it was never a choice.
 */
export function lockedToPopulation(filter: SharedFilter): FilterAccess {
  return {
    tables: computed(() => filter.tables),
    dataset: computed(() => POPULATION),
    load: (state) => filter.load({ ...state, dataset: filter.dataset }),
    reportRequest: (extra) => ({ ...filter.reportRequest(extra), dataset: POPULATION, hero_only: false }),
  };
}
