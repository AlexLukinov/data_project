import { describe, expect, it, vi } from 'vitest';

import type { DefinitionsResponse, Dimension, StatsApi } from './api';
import { createDefinitions } from './definitions';

const DIMENSIONS: Dimension[] = [
  { code: 'site', label: 'Site', type: 'enum', tables: ['decisions'], description: '', values: ['ggpoker'], ops: null, group_by: true, buckets: {}, allowed_ops: ['eq'] },
  { code: 'street', label: 'Street', type: 'enum', tables: ['decisions'], description: '', values: ['flop'], ops: null, group_by: true, buckets: {}, allowed_ops: ['eq'] },
];

function fakeApi(answer: DefinitionsResponse | Error): StatsApi & { calls: number } {
  const api = {
    calls: 0,
    definitions: () => {
      api.calls += 1;
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
    runReport: () => Promise.reject(new Error('not used here')),
  };
  return api as StatsApi & { calls: number };
}

describe('the registry store', () => {
  it('loads once, however many screens ask', async () => {
    const api = fakeApi({ stats: [], dimensions: DIMENSIONS });
    const registry = createDefinitions(api);
    expect(registry.status.value).toBe('idle');

    await Promise.all([registry.load(), registry.load()]);
    await registry.load();

    expect(api.calls).toBe(1);
    expect(registry.status.value).toBe('ready');
    expect(registry.dimensions.value).toHaveLength(2);
  });

  it('indexes by code and groups by family', async () => {
    const registry = createDefinitions(fakeApi({ stats: [], dimensions: DIMENSIONS }));
    await registry.load();
    expect(registry.byCode.value.get('street')?.label).toBe('Street');
    expect(registry.groups.value.map((g) => g.name)).toEqual(['Table', 'Street']);
  });

  it('says what the loss costs without naming a control, and can be retried', async () => {
    // The sentence is rendered verbatim on every page that awaits the registry, most of which have
    // no situation builder, so it may not name one: what it says is what all of them lose.
    const api = fakeApi(new Error('offline'));
    const registry = createDefinitions(api);
    await expect(registry.load()).rejects.toThrow('offline');
    expect(registry.status.value).toBe('error');
    expect(registry.error.value).toContain('registry');
    expect(registry.error.value).toContain('nothing on this page can be named or explained');
    expect(registry.error.value).not.toContain('situation builder');

    await expect(registry.load()).rejects.toThrow('offline');
    expect(api.calls).toBe(2);
  });

  it('says what went wrong, not only that something did', async () => {
    const registry = createDefinitions(fakeApi(new TypeError('Failed to fetch')));
    await registry.load().catch(() => undefined);
    expect(registry.error.value).toContain('did not answer');
  });

  it('does not swallow the failure into a half-loaded registry', async () => {
    const registry = createDefinitions(fakeApi(new Error('boom')));
    await registry.load().catch(() => undefined);
    expect(registry.dimensions.value).toEqual([]);
    expect(registry.byCode.value.size).toBe(0);
  });
});

describe('the fake API itself', () => {
  it('is called through the interface the real transport implements', () => {
    const api = fakeApi({ stats: [], dimensions: [] });
    expect(vi.isMockFunction(api.definitions)).toBe(false);
    expect(typeof api.runReport).toBe('function');
  });
});
