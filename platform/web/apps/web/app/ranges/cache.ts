/**
 * The library's offline copy (spec §11.1: "a Dexie cache for offline use"). The server is the
 * system of record; this keeps the last list and the bodies of the ranges that were opened, so
 * the library page and the lookups still answer when the API does not. A body is kept only
 * while its version matches the summary's, so a stale body is never shown as current.
 */
import Dexie from 'dexie';
import type { EntityTable } from 'dexie';

import type { RangeSummary, StoredRange } from './api';

export interface CachedRange extends RangeSummary {
  weights?: string;
  note?: string;
  cached_at: string;
}

export interface RangeCache {
  /** The list from the server replaces the cached list; bodies survive when their version still matches. */
  replaceAll(summaries: readonly RangeSummary[]): Promise<void>;
  /** A range with its body, as opened or saved. */
  put(range: StoredRange): Promise<void>;
  all(): Promise<CachedRange[]>;
  get(id: string): Promise<CachedRange | undefined>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

type LibraryDb = Dexie & { ranges: EntityTable<CachedRange, 'id'> };

export const CACHE_NAME = 'poker-ranges';

/** Open (or create) the cache. `name` varies only in tests. */
export function createRangeCache(name = CACHE_NAME): RangeCache {
  const db = new Dexie(name) as LibraryDb;
  db.version(1).stores({ ranges: 'id, name, source, updated_at' });
  const now = (): string => new Date().toISOString();

  return {
    async replaceAll(summaries) {
      await db.transaction('rw', db.ranges, async () => {
        const existing = new Map((await db.ranges.toArray()).map((r) => [r.id, r]));
        const rows: CachedRange[] = summaries.map((s) => {
          const old = existing.get(s.id);
          const keepBody = old !== undefined && old.version === s.version && old.weights !== undefined;
          return keepBody ? { ...s, weights: old.weights, note: old.note, cached_at: now() } : { ...s, cached_at: now() };
        });
        await db.ranges.clear();
        await db.ranges.bulkPut(rows);
      });
    },
    put: (range) => db.ranges.put({ ...range, cached_at: now() }).then(() => undefined),
    all: () => db.ranges.orderBy('updated_at').reverse().toArray(),
    get: (id) => db.ranges.get(id),
    remove: (id) => db.ranges.delete(id),
    clear: () => db.ranges.clear(),
  };
}
