import { nodeKey, step } from '@poker/core';
import { describe, expect, it } from 'vitest';

import type { RangeSummary, RangesApi, StoredRange } from './api';
import type { CachedRange, RangeCache } from './cache';
import { createLibrary, describeBackupError, describeLibraryError, filterLocally } from './library';

const KEY = nodeKey('UTG', { action_sequence: [step('UTG', 'raise')] });
const stored = (id: string, version = 1): StoredRange => ({
  id,
  name: `range ${id}`,
  node_key: KEY,
  source: 'own',
  source_tool: '',
  format: 'combo',
  tags: ['t'],
  version,
  created_at: '2026-09-10T09:00:00Z',
  updated_at: '2026-09-10T10:00:00Z',
  weights: `AsAh: ${version}`,
  note: '',
});
function summaryOf(range: StoredRange): RangeSummary {
  const summary: RangeSummary & { weights?: string; note?: string } = { ...range };
  delete summary.weights;
  delete summary.note;
  return summary;
}

/** A server that answers from a map, or refuses every call when `down`. */
function fakeApi(rows: StoredRange[], flags: { down: boolean }): RangesApi {
  const refuse = (): never => {
    throw new TypeError('fetch failed');
  };
  const guard = <T>(value: () => T): T => (flags.down ? refuse() : value());
  return {
    list: async () => guard(() => rows.map(summaryOf)),
    get: async (id) => guard(() => rows.find((r) => r.id === id)!),
    create: async () => refuse(),
    update: async () => refuse(),
    remove: async (id) => guard(() => void rows.splice(rows.findIndex((r) => r.id === id), 1)),
    versions: async () => guard(() => []),
    revert: async () => refuse(),
    lookup: async () => guard(() => rows),
    bulk: async () => refuse(),
    exportAll: async () => refuse(),
  };
}

/** Like IndexedDB, refuses anything structured clone cannot copy — a Vue reactive proxy, say. */
function fakeCache(): RangeCache & { rows: Map<string, CachedRange> } {
  const rows = new Map<string, CachedRange>();
  return {
    rows,
    replaceAll: async (list) => {
      const old = new Map(rows);
      rows.clear();
      for (const s of structuredClone([...list])) {
        const was = old.get(s.id);
        rows.set(s.id, was?.version === s.version ? { ...s, weights: was.weights, note: was.note, cached_at: 'now' } : { ...s, cached_at: 'now' });
      }
    },
    put: async (r) => void rows.set(r.id, { ...structuredClone(r), cached_at: 'now' }),
    all: async () => [...rows.values()],
    get: async (id) => rows.get(id),
    remove: async (id) => void rows.delete(id),
    clear: async () => rows.clear(),
  };
}

describe('the library', () => {
  it('reads from the server and keeps the cache current', async () => {
    const flags = { down: false };
    const cache = fakeCache();
    const lib = createLibrary(fakeApi([stored('a'), stored('b', 2)], flags), cache);
    expect((await lib.load()).map((r) => r.id)).toEqual(['a', 'b']);
    expect(lib.status.value).toBe('ready');
    expect([...cache.rows.keys()]).toEqual(['a', 'b']);
    expect((await lib.open('b')).weights).toBe('AsAh: 2');
    expect(cache.rows.get('b')?.weights).toBe('AsAh: 2');
  });

  it('falls back to the cache when the server is away, and says so', async () => {
    const flags = { down: false };
    const cache = fakeCache();
    const lib = createLibrary(fakeApi([stored('a'), stored('b')], flags), cache);
    await lib.load();
    await lib.open('a');
    flags.down = true;

    expect((await lib.load({ q: 'range a' })).map((r) => r.id)).toEqual(['a']);
    expect(lib.status.value).toBe('offline');
    expect(lib.error.value).toContain('The API did not answer');
    expect((await lib.open('a')).weights).toBe('AsAh: 1');
    await expect(lib.open('b')).rejects.toThrow('fetch failed');
    expect((await lib.lookup(KEY)).map((r) => r.id)).toEqual(['a']);
    expect(await lib.lookup(nodeKey('BB'))).toEqual([]);
    expect(lib.status.value).toBe('offline');

    flags.down = false;
    await lib.lookup(KEY);
    expect(lib.status.value).toBe('ready');
    expect(lib.error.value).toBeNull();
  });

  it('removes from the server, the cache and the list', async () => {
    const flags = { down: false };
    const cache = fakeCache();
    const lib = createLibrary(fakeApi([stored('a'), stored('b')], flags), cache);
    await lib.load();
    await lib.remove('a');
    expect(lib.items.value.map((r) => r.id)).toEqual(['b']);
    expect(cache.rows.has('a')).toBe(false);
  });

  it('filters the cached copy like the server would', () => {
    const rows: CachedRange[] = [
      { ...summaryOf(stored('a')), cached_at: 'now' },
      { ...summaryOf(stored('b')), source: 'solver', node_key: nodeKey('BB', { street: 'flop' }), tags: [], cached_at: 'now' },
    ];
    expect(filterLocally(rows, { source: 'solver' }).map((r) => r.id)).toEqual(['b']);
    expect(filterLocally(rows, { hero_position: 'UTG' }).map((r) => r.id)).toEqual(['a']);
    expect(filterLocally(rows, { street: 'flop', tag: 't' })).toEqual([]);
    expect(filterLocally(rows, { q: 'RANGE B' }).map((r) => r.id)).toEqual(['b']);
    expect(filterLocally(rows, {})).toHaveLength(2);
  });

  it('describes a failure in one sentence', () => {
    expect(describeLibraryError(new TypeError('fetch failed'))).toContain('did not answer');
    expect(describeLibraryError({ status: 409, data: { detail: "a range named 'x' already exists" } })).toBe("a range named 'x' already exists");
    // Reworded with `describeApiError`: a bare 5xx is usually the account's query budget, so the
    // sentence offers another attempt before it points at the terminal.
    expect(describeLibraryError({ statusCode: 500 })).toBe(
      'The API could not answer this — often because several questions were asked at once and only a few are answered at a time. Try again; if it keeps failing, the reason is in the terminal running `make api`.',
    );
    const dexie = Object.assign(new Error('Transaction aborted'), { name: 'AbortError' });
    expect(describeLibraryError(dexie)).toBe('AbortError: Transaction aborted');
  });

  it('never promises a cached copy for the backup, which only the server can build', () => {
    const silent = describeBackupError(new TypeError('fetch failed'));
    expect(silent).toContain('did not answer');
    expect(silent).not.toContain('cached copy');
    expect(silent).toContain('make api');
    // No longer the API's own "Not authenticated": by the time a page reads this the refresh
    // cookie is gone and the session is anonymous, so the sentence names the header's Sign in.
    expect(describeBackupError({ status: 401, data: { detail: 'Not authenticated' } })).toBe(
      'Your sign-in has expired. Use Sign in at the top of the page, then try again.',
    );
  });

  it('reports a cache failure without going offline', async () => {
    const flags = { down: false };
    const cache = fakeCache();
    cache.replaceAll = async () => {
      throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    };
    const lib = createLibrary(fakeApi([stored('a')], flags), cache);
    expect((await lib.load()).map((r) => r.id)).toEqual(['a']);
    expect(lib.status.value).toBe('ready');
    expect(lib.error.value).toBe('The offline copy could not be updated: QuotaExceededError: quota');
  });
});
