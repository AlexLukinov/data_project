/**
 * The stat registry store (plan D.3): Pinia registers one copy so every screen's builder,
 * labels and op pickers come from the same `/v1/definitions` answer. The logic lives in
 * `~/stats/definitions`, tested with a fake API; this file only binds it to the session's
 * fetcher.
 */
import { defineStore } from 'pinia';

import { createStatsApi } from '../stats/api';
import { createDefinitions } from '../stats/definitions';
import { useAuthStore } from './auth';

export const useDefinitionsStore = defineStore('definitions', () => createDefinitions(createStatsApi(useAuthStore().fetch)));
