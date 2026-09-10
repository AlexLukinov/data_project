/**
 * The range library transport (plan F.6): `/v1/ranges` on top of the session's fetcher, so the
 * store and the pages never spell a URL. Field names are the API's (snake_case), exactly as
 * `api/schemas_ranges.py` sends them.
 */
import type { NodeKey } from '@poker/core';
import { nodeKeyJson } from '@poker/core';

import type { Fetcher } from '../auth/api';

export type RangeSource = 'own' | 'solver' | 'pool';
export type RangeNotation = 'combo' | 'class';
export type OnConflict = 'skip' | 'version';

export interface RangeSummary {
  id: string;
  name: string;
  node_key: NodeKey;
  source: RangeSource;
  source_tool: string;
  format: RangeNotation;
  tags: string[];
  version: number;
  created_at: string;
  updated_at: string;
}

export interface StoredRange extends RangeSummary {
  /** The combo text `serializeRange(range, 'combo')` writes. */
  weights: string;
  note: string;
}

export interface RangeVersion {
  version: number;
  weights: string;
  note: string;
  created_at: string;
}

export interface RangeIn {
  name: string;
  node_key: NodeKey;
  source: RangeSource;
  source_tool: string;
  format: RangeNotation;
  tags: string[];
  weights: string;
  note: string;
}

export interface RangeUpdate {
  name?: string;
  node_key?: NodeKey;
  source?: RangeSource;
  source_tool?: string;
  format?: RangeNotation;
  tags?: string[];
  /** A body makes a new version, carrying `note`. */
  weights?: string;
  note?: string;
}

export interface BulkIn {
  ranges: RangeIn[];
  on_conflict: OnConflict;
}

export interface BulkOut {
  created: StoredRange[];
  updated: StoredRange[];
  skipped: { name: string; reason: string }[];
}

export interface LibraryExport {
  format: 'poker-ranges/1';
  exported_at: string;
  ranges: StoredRange[];
}

export interface ListFilters {
  source?: RangeSource;
  tag?: string;
  hero_position?: string;
  street?: string;
  q?: string;
}

export interface RangesApi {
  list(filters?: ListFilters): Promise<RangeSummary[]>;
  get(id: string): Promise<StoredRange>;
  create(body: RangeIn): Promise<StoredRange>;
  update(id: string, body: RangeUpdate): Promise<StoredRange>;
  remove(id: string): Promise<void>;
  versions(id: string): Promise<RangeVersion[]>;
  revert(id: string, version: number): Promise<StoredRange>;
  /** Every stored range at exactly this situation. */
  lookup(key: NodeKey): Promise<StoredRange[]>;
  bulk(body: BulkIn): Promise<BulkOut>;
  exportAll(): Promise<LibraryExport>;
}

const BASE = '/v1/ranges';

function query(filters: ListFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== '') params.set(key, value);
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}

/** The body as the API wants it: the key as plain JSON, everything else as is. */
function wire(body: RangeIn | RangeUpdate): Record<string, unknown> {
  const { node_key, ...rest } = body;
  return node_key === undefined ? { ...rest } : { ...rest, node_key: nodeKeyJson(node_key) };
}

/** Bind the library endpoints to a fetcher (the auth store's, which adds the bearer header). */
export function createRangesApi(fetch: Fetcher): RangesApi {
  return {
    list: (filters = {}) => fetch<RangeSummary[]>(`${BASE}${query(filters)}`),
    get: (id) => fetch<StoredRange>(`${BASE}/${id}`),
    create: (body) => fetch<StoredRange>(BASE, { method: 'POST', body: wire(body) }),
    update: (id, body) => fetch<StoredRange>(`${BASE}/${id}`, { method: 'PUT', body: wire(body) }),
    remove: (id) => fetch<void>(`${BASE}/${id}`, { method: 'DELETE' }),
    versions: (id) => fetch<RangeVersion[]>(`${BASE}/${id}/versions`),
    revert: (id, version) => fetch<StoredRange>(`${BASE}/${id}/revert/${version}`, { method: 'POST' }),
    lookup: (key) => fetch<StoredRange[]>(`${BASE}/lookup`, { method: 'POST', body: nodeKeyJson(key) }),
    bulk: (body) => fetch<BulkOut>(`${BASE}/bulk`, { method: 'POST', body: { on_conflict: body.on_conflict, ranges: body.ranges.map(wire) } }),
    exportAll: () => fetch<LibraryExport>(`${BASE}/export`),
  };
}
