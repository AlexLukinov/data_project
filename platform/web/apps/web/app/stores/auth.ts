/**
 * The auth store (plan D.2): Pinia registers one session so pages, the header and the route
 * middleware share the same in-memory token. The logic lives in `~/auth/session`, where it is
 * tested with a fake fetcher; this file only binds it to Nuxt's `$fetch` and the API origin.
 */
import { defineStore } from 'pinia';

import type { Fetcher } from '../auth/api';
import { createAuthApi } from '../auth/api';
import { createSession } from '../auth/session';

export const useAuthStore = defineStore('auth', () => {
  const fetcher: Fetcher = (url, options) => $fetch(url, options);
  return createSession(createAuthApi(fetcher, useRuntimeConfig().public.apiBase));
});
