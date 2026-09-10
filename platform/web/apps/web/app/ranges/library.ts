/**
 * The range library behind the store (plan F.6): the server is the system of record, the Dexie
 * cache the offline copy. Reads try the API and fall back to the cache; writes go to the API
 * and refresh the cache. Framework-free apart from Vue refs, so it is tested with fakes; the
 * Pinia store only binds it to the session's fetcher and the real cache.
 */
import type { NodeKey } from '@poker/core';
import { nodeKeyEquals } from '@poker/core';
import { ref } from 'vue';
import type { Ref } from 'vue';

import { errorDetail, errorStatus } from '../auth/api';
import type { BulkIn, BulkOut, LibraryExport, ListFilters, RangeIn, RangeSummary, RangeUpdate, RangeVersion, RangesApi, StoredRange } from './api';
import type { CachedRange, RangeCache } from './cache';

export type LibraryStatus = 'idle' | 'loading' | 'ready' | 'offline';

export interface Library {
  items: Ref<RangeSummary[]>;
  status: Ref<LibraryStatus>;
  /** One sentence when the last call fell back to the cache. */
  error: Ref<string | null>;
  /** The list from the server, refreshing the cache; the cached copy when the server is away. */
  load(filters?: ListFilters): Promise<RangeSummary[]>;
  /** One range with its body: the server's, else the cached body when its version is current. */
  open(id: string): Promise<StoredRange>;
  /** Every stored range at this situation; offline, the cached ones that still carry a body. */
  lookup(key: NodeKey): Promise<StoredRange[]>;
  versions(id: string): Promise<RangeVersion[]>;
  exportAll(): Promise<LibraryExport>;
  create(body: RangeIn): Promise<StoredRange>;
  update(id: string, body: RangeUpdate): Promise<StoredRange>;
  revert(id: string, version: number): Promise<StoredRange>;
  remove(id: string): Promise<void>;
  importBulk(body: BulkIn): Promise<BulkOut>;
}

type Reads = Pick<Library, 'load' | 'open' | 'lookup' | 'versions' | 'exportAll'>;
type Writes = Pick<Library, 'create' | 'update' | 'revert' | 'remove' | 'importBulk'>;

interface State {
  items: Ref<RangeSummary[]>;
  status: Ref<LibraryStatus>;
  error: Ref<string | null>;
  ready(): void;
  offline(error: unknown): void;
}

const NO_ANSWER = 'The API did not answer; showing the cached copy. Start it with `make api` in platform/.';
const CACHE_FAILED = 'The offline copy could not be updated';

/** One sentence for a failed library call: the API's own detail, else its status, else what threw. */
export function describeLibraryError(error: unknown): string {
  const status = errorStatus(error);
  if (status !== undefined) return errorDetail(error) ?? `The API answered with status ${status}.`;
  if (error instanceof Error && error.name !== 'FetchError' && error.name !== 'TypeError') return `${error.name}: ${error.message}`;
  return NO_ANSWER;
}

/** The list filters applied to the cached copy, for when the API is away. */
export function filterLocally(list: readonly CachedRange[], filters: ListFilters): CachedRange[] {
  const q = filters.q?.toLowerCase();
  return list.filter(
    (r) =>
      (!filters.source || r.source === filters.source) &&
      (!filters.hero_position || r.node_key.hero_position === filters.hero_position) &&
      (!filters.street || r.node_key.street === filters.street) &&
      (!filters.tag || r.tags.includes(filters.tag)) &&
      (!q || r.name.toLowerCase().includes(q)),
  );
}

type WithBody = CachedRange & { weights: string };

function hasBody(cached: CachedRange | undefined): cached is WithBody {
  return cached !== undefined && cached.weights !== undefined;
}

function asStored(cached: WithBody): StoredRange {
  return { ...cached, note: cached.note ?? '' };
}

function createState(): State {
  const items = ref<RangeSummary[]>([]);
  const status = ref<LibraryStatus>('idle');
  const error = ref<string | null>(null);
  return {
    items,
    status,
    error,
    ready: () => {
      status.value = 'ready';
      error.value = null;
    },
    offline: (e) => {
      status.value = 'offline';
      error.value = describeLibraryError(e);
    },
  };
}

function createReads(api: RangesApi, cache: RangeCache, state: State): Reads {
  async function load(filters: ListFilters = {}): Promise<RangeSummary[]> {
    state.status.value = 'loading';
    const unfiltered = Object.values(filters).every((v) => v === undefined || v === '');
    let list: RangeSummary[];
    try {
      list = await api.list(filters);
    } catch (e) {
      state.items.value = filterLocally(await cache.all(), filters);
      state.offline(e);
      return state.items.value;
    }
    state.items.value = list;
    state.ready();
    // The cache gets the server's plain objects, never the ref's reactive proxies (IndexedDB
    // cannot clone a Proxy). A cache failure is reported, but the library is not "offline".
    if (unfiltered) await cache.replaceAll(list).catch((e: unknown) => (state.error.value = `${CACHE_FAILED}: ${describeLibraryError(e)}`));
    return list;
  }
  async function open(id: string): Promise<StoredRange> {
    try {
      const range = await api.get(id);
      await cache.put(range);
      return range;
    } catch (e) {
      const cached = await cache.get(id);
      if (!hasBody(cached)) throw e;
      state.offline(e);
      return asStored(cached);
    }
  }
  async function lookup(key: NodeKey): Promise<StoredRange[]> {
    try {
      return await api.lookup(key);
    } catch (e) {
      state.offline(e);
      return (await cache.all()).filter(hasBody).filter((r) => nodeKeyEquals(r.node_key, key)).map(asStored);
    }
  }
  return { load, open, lookup, versions: (id) => api.versions(id), exportAll: () => api.exportAll() };
}

function createWrites(api: RangesApi, cache: RangeCache, state: State): Writes {
  async function kept(range: StoredRange): Promise<StoredRange> {
    await cache.put(range);
    return range;
  }
  return {
    create: async (body) => kept(await api.create(body)),
    update: async (id, body) => kept(await api.update(id, body)),
    revert: async (id, version) => kept(await api.revert(id, version)),
    remove: async (id) => {
      await api.remove(id);
      await cache.remove(id);
      state.items.value = state.items.value.filter((r) => r.id !== id);
    },
    importBulk: async (body) => {
      const report = await api.bulk(body);
      for (const range of [...report.created, ...report.updated]) await cache.put(range);
      return report;
    },
  };
}

/** Build the library over a transport and a cache. */
export function createLibrary(api: RangesApi, cache: RangeCache): Library {
  const state = createState();
  return { items: state.items, status: state.status, error: state.error, ...createReads(api, cache, state), ...createWrites(api, cache, state) };
}
