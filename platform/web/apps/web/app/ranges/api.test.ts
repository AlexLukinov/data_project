import { nodeKey, step } from '@poker/core';
import { describe, expect, it } from 'vitest';

import type { FetchOptions, Fetcher } from '../auth/api';
import { createRangesApi } from './api';

interface Call {
  url: string;
  options: FetchOptions | undefined;
}

function recorder(): { fetch: Fetcher; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: Fetcher = async <T>(url: string, options?: FetchOptions): Promise<T> => {
    calls.push({ url, options });
    return [] as unknown as T;
  };
  return { fetch, calls };
}

const KEY = nodeKey('UTG', { action_sequence: [step('UTG', 'raise', { size_bb: 2.5 })] });

describe('createRangesApi', () => {
  it('spells every endpoint and sends keys as plain JSON', async () => {
    const { fetch, calls } = recorder();
    const api = createRangesApi(fetch);
    await api.list();
    await api.list({ source: 'own', hero_position: 'UTG', q: '' });
    await api.get('r1');
    await api.create({ name: 'UTG RFI', node_key: KEY, source: 'own', source_tool: 'SPH', format: 'combo', tags: ['rfi'], weights: 'AsAh: 1', note: '' });
    await api.update('r1', { name: 'UTG open' });
    await api.update('r1', { weights: 'AsAh: 1', note: 'edited', node_key: KEY });
    await api.remove('r1');
    await api.versions('r1');
    await api.revert('r1', 2);
    await api.lookup(KEY);
    await api.bulk({ on_conflict: 'skip', ranges: [{ name: 'a', node_key: KEY, source: 'own', source_tool: '', format: 'combo', tags: [], weights: '', note: '' }] });
    await api.exportAll();

    expect(calls.map((c) => [c.url, c.options?.method ?? 'GET'])).toEqual([
      ['/v1/ranges', 'GET'],
      ['/v1/ranges?source=own&hero_position=UTG', 'GET'],
      ['/v1/ranges/r1', 'GET'],
      ['/v1/ranges', 'POST'],
      ['/v1/ranges/r1', 'PUT'],
      ['/v1/ranges/r1', 'PUT'],
      ['/v1/ranges/r1', 'DELETE'],
      ['/v1/ranges/r1/versions', 'GET'],
      ['/v1/ranges/r1/revert/2', 'POST'],
      ['/v1/ranges/lookup', 'POST'],
      ['/v1/ranges/bulk', 'POST'],
      ['/v1/ranges/export', 'GET'],
    ]);
    const created = calls[3]!.options!.body!;
    expect(created.node_key).toEqual({ stake: '', table_size: 6, eff_stack_bb: 100, hero_position: 'UTG', villain_position: null, action_sequence: [{ position: 'UTG', action: 'raise', size_bb: 2.5, size_pct: null }], street: 'preflop', board_texture: [] });
    expect(created.weights).toBe('AsAh: 1');
    expect(calls[4]!.options!.body).toEqual({ name: 'UTG open' });
    expect(calls[9]!.options!.body!.hero_position).toBe('UTG');
    const bulk = calls[10]!.options!.body as { on_conflict: string; ranges: { node_key: { hero_position: string } }[] };
    expect(bulk.on_conflict).toBe('skip');
    expect(bulk.ranges[0]!.node_key.hero_position).toBe('UTG');
  });
});
