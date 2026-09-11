import type { LocationQuery } from 'vue-router';
import { watch } from 'vue';

import type { ColumnsModel } from '~/reports/model';
import { COLUMN_KEYS, columnsFromQuery, columnsToQuery, sameColumnsQuery } from '~/reports/url';
import { fromQuery, sameQuery, toQuery } from '~/filter/url';
import { useFilterStore } from '~/stores/filter';

const FILTER_KEYS = ['ds', 'from', 'to', 'f'];

/**
 * Bind a whole report — situation *and* columns — to this page's URL (plan D.5: "a saved report
 * reopens from its URL").
 *
 * This is `useFilterUrl()`'s job plus the columns, and it is one composable rather than two on
 * purpose. Both halves write with `router.replace`, and two independent writers in the same tick
 * each compute their next query from a `route.query` that the other has not landed in yet, so the
 * second silently drops the first's keys. Owning all eight keys here means one read and one write.
 *
 * The rule in both directions is `useFilterUrl`'s, unchanged: *the URL wins when it says
 * something.* A pasted link replaces the report; a page opened with no report parameters keeps
 * whatever the shared filter already held — so a situation follows you from the hand list into the
 * workbench — and stamps it into the address bar.
 *
 * Call it once in a page's setup, and do not also call `useFilterUrl()`.
 */
export function useReportUrl(columns: ColumnsModel): void {
  const route = useRoute();
  const router = useRouter();
  const filter = useFilterStore();

  const keys = [...FILTER_KEYS, ...COLUMN_KEYS];
  const query = (): Record<string, string> => ({ ...toQuery(filter.state), ...columnsToQuery(columns.state.value) });

  if (keys.some((key) => route.query[key] !== undefined)) {
    filter.load(fromQuery(route.query));
    columns.load(columnsFromQuery(route.query));
  } else {
    void router.replace({ query: { ...route.query, ...query() } });
  }

  watch(
    () => query(),
    (next) => {
      if (sameQuery(next, route.query) && sameColumnsQuery(next, route.query)) return;
      void router.replace({ query: { ...strip(route.query), ...next } });
    },
    { deep: true },
  );

  watch(
    () => route.query,
    (next) => {
      if (sameQuery(query(), next) && sameColumnsQuery(query(), next)) return;
      filter.load(fromQuery(next));
      columns.load(columnsFromQuery(next));
    },
    { deep: true },
  );

  /** Keep a page's own parameters (a saved report's id lives in the path, but `?tab=` may not). */
  function strip(bag: LocationQuery): LocationQuery {
    return Object.fromEntries(Object.entries(bag).filter(([key]) => !keys.includes(key)));
  }
}
