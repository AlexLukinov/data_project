/**
 * The auth store (plan D.2): Pinia registers one session so pages, the header and the route
 * middleware share the same in-memory token. The logic lives in `~/auth/session`, where it is
 * tested with a fake fetcher; this file only binds it to Nuxt's `$fetch` and the API origin.
 */
import { defineStore } from 'pinia';

import type { FetchOptions, Fetcher } from '../auth/api';
import { createAuthApi } from '../auth/api';
import { createSession } from '../auth/session';

/**
 * Nuxt's `$fetch` seen as a plain function: its typed-route overloads try to match every URL
 * against the app's routes and, past a handful of pages, the compiler gives up ("excessive
 * stack depth"). The API lives on another origin, so no route ever matches anyway.
 */
type PlainFetch = <T>(url: string, options?: FetchOptions) => Promise<T>;

export const useAuthStore = defineStore('auth', () => {
  const plainFetch = $fetch as unknown as PlainFetch;
  const fetcher: Fetcher = (url, options) => plainFetch(url, options);
  return createSession(createAuthApi(fetcher, useRuntimeConfig().public.apiBase));
});
