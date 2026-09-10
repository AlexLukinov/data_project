/**
 * The range library store (plan F.6): Pinia registers one library so the pages share the list,
 * the status and the offline copy. The logic lives in `~/ranges/library`, tested with fakes; this
 * file only binds it to the session's fetcher and the Dexie cache.
 */
import { defineStore } from 'pinia';

import { createRangesApi } from '../ranges/api';
import { createRangeCache } from '../ranges/cache';
import { createLibrary } from '../ranges/library';
import { useAuthStore } from './auth';

export const useRangesStore = defineStore('ranges', () => createLibrary(createRangesApi(useAuthStore().fetch), createRangeCache()));
