import 'fake-indexeddb/auto';

import { nodeKey } from '@poker/core';
import { describe, expect, it } from 'vitest';

import type { RangeSummary, StoredRange } from './api';
import { createRangeCache } from './cache';

let n = 0;
const summary = (id: string, version = 1, updated = '2026-09-10T10:00:00Z'): RangeSummary => ({
  id,
  name: `range ${id}`,
  node_key: nodeKey('UTG'),
  source: 'own',
  source_tool: '',
  format: 'combo',
  tags: [],
  version,
  created_at: '2026-09-10T09:00:00Z',
  updated_at: updated,
});
const stored = (id: string, version = 1): StoredRange => ({ ...summary(id, version), weights: `AsAh: ${version}`, note: '' });

describe('createRangeCache', () => {
  it('keeps a body only while its version matches the new list', async () => {
    const cache = createRangeCache(`test-${++n}`);
    await cache.put(stored('a', 1));
    await cache.put(stored('b', 1));
    await cache.replaceAll([summary('a', 1, '2026-09-10T12:00:00Z'), summary('b', 2), summary('c', 1)]);
    const all = (await cache.all()).sort((x, y) => x.id.localeCompare(y.id));
    expect(all.map((r) => [r.id, r.version, r.weights])).toEqual([
      ['a', 1, 'AsAh: 1'],
      ['b', 2, undefined],
      ['c', 1, undefined],
    ]);
    expect((await cache.get('a'))?.cached_at).toBeTruthy();
  });

  it('drops what the server no longer lists, and removes and clears', async () => {
    const cache = createRangeCache(`test-${++n}`);
    await cache.put(stored('gone'));
    await cache.replaceAll([summary('kept')]);
    expect((await cache.all()).map((r) => r.id)).toEqual(['kept']);
    await cache.remove('kept');
    expect(await cache.all()).toEqual([]);
    await cache.put(stored('x'));
    await cache.clear();
    expect(await cache.get('x')).toBeUndefined();
  });
});
