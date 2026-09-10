import type { Fetcher } from '../auth/api';
import { useAuthStore } from '../stores/auth';

/**
 * `$fetch` against the API for signed-in pages: takes a path (`/v1/auth/me`), adds the bearer
 * header, and on a 401 refreshes once and retries. Call it in event handlers or inside
 * `useAsyncData`, never bare in setup. `/health` on the home page stays public and uses `useFetch`.
 */
export function useApi(): Fetcher {
  return useAuthStore().fetch;
}
