/**
 * The heuristic log, bound to the session.
 *
 * The logic lives in `~/heuristics/log.ts` and is tested with fakes; this file only wires it to
 * the session's fetcher and the browser copy, as the analyzer and the range library do.
 */
import { defineStore } from 'pinia';

import { createHeuristicsApi } from '~/heuristics/api';
import { createHeuristicCache } from '~/heuristics/cache';
import { createHeuristicLog } from '~/heuristics/log';
import { useAuthStore } from '~/stores/auth';

export const useHeuristicsStore = defineStore('heuristics', () =>
  createHeuristicLog(createHeuristicsApi(useAuthStore().fetch), createHeuristicCache()),
);
