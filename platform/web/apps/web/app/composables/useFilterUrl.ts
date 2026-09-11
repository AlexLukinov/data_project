import type { LocationQuery } from 'vue-router';
import { watch } from 'vue';

import { fromQuery, sameQuery, toQuery } from '~/filter/url';
import { useFilterStore } from '~/stores/filter';

const KEYS = ['ds', 'from', 'to', 'f'];

/**
 * Bind the shared filter to this page's URL (plan D.3: "pasting a URL reproduces the filter").
 *
 * Call it once in a page's setup. The rule in both directions is *the URL wins when it says
 * something*: a pasted link replaces the filter, and a page opened with no filter parameters
 * adopts the one already in the store and stamps it into the address bar — so the filter follows
 * you from screen to screen instead of silently resetting.
 *
 * Writes use `router.replace`, not `push`: refining a filter is editing one view, and every
 * keystroke in a value box should not become a Back-button step.
 */
export function useFilterUrl(): void {
  const route = useRoute();
  const router = useRouter();
  const filter = useFilterStore();

  if (KEYS.some((key) => route.query[key] !== undefined)) filter.load(fromQuery(route.query));
  else void router.replace({ query: { ...route.query, ...toQuery(filter.state) } });

  watch(
    () => filter.query,
    (query) => {
      if (sameQuery(query, route.query)) return;
      void router.replace({ query: { ...strip(route.query), ...query } });
    },
    { deep: true },
  );

  watch(
    () => route.query,
    (query) => {
      if (sameQuery(filter.query, query)) return;
      filter.load(fromQuery(query));
    },
    { deep: true },
  );
}

/** Keep a page's own parameters (`?seat=3`) while the filter's four are rewritten. */
function strip(query: LocationQuery): LocationQuery {
  return Object.fromEntries(Object.entries(query).filter(([key]) => !KEYS.includes(key)));
}
