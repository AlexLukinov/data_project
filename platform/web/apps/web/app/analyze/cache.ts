/**
 * The analyzer's offline copy (spec §15: "state in Pinia, autosaved to Dexie").
 *
 * Dexie is written on every change and the server on a debounce, so work survives a closed tab,
 * a stopped API and a reload — the browser copy is what the page reopens from when the server
 * has not caught up or cannot be reached.
 *
 * Rows are stored as plain objects: a Vue reactive proxy cannot cross into IndexedDB
 * (`DataCloneError`), which is the same lesson the range library learned in F.6.
 */
import Dexie from 'dexie';
import type { EntityTable } from 'dexie';

import type { Analysis } from './api';
import { plain } from './api';

export interface CachedAnalysis extends Analysis {
  cached_at: string;
  /** True while the server has not confirmed the latest local change. */
  unsaved: boolean;
}

export interface AnalysisCache {
  put(analysis: Analysis, unsaved: boolean): Promise<void>;
  get(id: string): Promise<CachedAnalysis | undefined>;
  all(): Promise<CachedAnalysis[]>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

type AnalysisDb = Dexie & { analyses: EntityTable<CachedAnalysis, 'id'> };

export const CACHE_NAME = 'poker-analyses';

/** Open (or create) the cache. `name` varies only in tests. */
export function createAnalysisCache(name = CACHE_NAME): AnalysisCache {
  const db = new Dexie(name) as AnalysisDb;
  db.version(1).stores({ analyses: 'id, updated_at' });

  return {
    put: (analysis, unsaved) =>
      db.analyses
        .put({ ...plain(analysis), cached_at: new Date().toISOString(), unsaved })
        .then(() => undefined),
    get: (id) => db.analyses.get(id),
    all: () => db.analyses.orderBy('updated_at').reverse().toArray(),
    remove: (id) => db.analyses.delete(id),
    clear: () => db.analyses.clear(),
  };
}
