/**
 * What each way out of an empty report actually does to the question (plan F.12c, audit §2.4).
 *
 * `reports/emptyState.ts` names the ways out; this is the other half of the pair — the branch that
 * turns one of those keys back into a change to the filter. It is here rather than in the workbench
 * because it is the half that can be wrong silently: an empty state that offers "Look in the pool"
 * and then quietly leaves the dataset where it was is worse than one that offers nothing, and a
 * template is the one place that never gets asserted.
 *
 * Running the report is not here. An empty state offers Run report too, but running is the page's
 * own business — it has to check the page's own problems first — so the caller keeps that key.
 */

import type { Dataset } from '../stats/api';

/** The parts of the filter an empty state may change. `filter/model.ts`'s store satisfies it. */
export interface WidenTarget {
  dataset: Dataset;
  dateFrom: string;
  dateTo: string;
  clear(): void;
}

/** The other dataset, which is what "Look in the pool" and "Look in My hands" both mean. */
function other(dataset: Dataset): Dataset {
  return dataset === 'hero' ? 'population' : 'hero';
}

/**
 * Apply one way out, and say whether it was one of ours. The boolean is the point: a key nothing
 * here knows — `run`, or a key a later empty state adds — must reach the caller rather than be
 * swallowed into a button that does nothing.
 */
export function widenFilter(key: string, filter: WidenTarget): boolean {
  if (key === 'clear-situation') filter.clear();
  else if (key === 'clear-dates') {
    filter.dateFrom = '';
    filter.dateTo = '';
  } else if (key === 'other-dataset') filter.dataset = other(filter.dataset);
  else return false;
  return true;
}
