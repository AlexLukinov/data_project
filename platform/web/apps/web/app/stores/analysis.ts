/**
 * The analyzer's store (plan F.9, spec §15): Pinia holds one analysis so the stepper, the step
 * components and the save indicator all read the same state. The logic lives in
 * `~/analyze/session`, tested with fakes; this file only binds it to the session's fetcher and
 * the Dexie cache.
 */
import { defineStore } from 'pinia';

import { createAnalysesApi } from '../analyze/api';
import { createAnalysisCache } from '../analyze/cache';
import { createAnalysisSession } from '../analyze/session';
import { useAuthStore } from './auth';

export const useAnalysisStore = defineStore('analysis', () =>
  createAnalysisSession(createAnalysesApi(useAuthStore().fetch), createAnalysisCache()),
);
