import type { NodeKey } from '@poker/core';
import { describe, expect, it, vi } from 'vitest';

import { cohortQuery, createPoolApi, groupKey, presetKey, WHOLE_FIELD_KEY } from './api';

const KEY: NodeKey = {
  stake: '',
  table_size: 6,
  eff_stack_bb: 100,
  hero_position: 'BB',
  villain_position: 'BTN',
  action_sequence: [{ position: 'BTN', action: 'raise', size_bb: 2.5, size_pct: null }],
  street: 'preflop',
  line_so_far: null,
  size_bucket: null,
  pot_type: null,
  board_texture: [],
};

describe('cohortQuery', () => {
  it('sends the field as nothing at all', () => {
    expect(cohortQuery()).toBe('');
    expect(cohortQuery(WHOLE_FIELD_KEY)).toBe('');
  });

  it('sends a preset or a group in the server’s own scheme, and a saved cohort as its id', () => {
    expect(cohortQuery(presetKey('reg'))).toBe('?cohort=preset%3Areg');
    expect(cohortQuery(groupKey('unknown'))).toBe('?cohort=group%3Aunknown');
    expect(cohortQuery('3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toBe('?cohort_id=3f2504e0-4f89-11d3-9a0c-0305e82c3301');
  });
});

describe('createPoolApi', () => {
  it('puts the cohort key on every node route the same way', async () => {
    const fetch = vi.fn().mockResolvedValue({});
    const api = createPoolApi(fetch);
    await api.frequencies(KEY, groupKey('reg'));
    await api.showdownRange(KEY, presetKey('fish'));
    await api.estimatedRange(KEY, { AA: 1 }, 'saved-id');
    await api.realization(KEY);
    expect(fetch.mock.calls.map((call) => call[0])).toEqual([
      '/v1/pool/node/frequencies?cohort=group%3Areg',
      '/v1/pool/node/showdown-range?cohort=preset%3Afish',
      '/v1/pool/node/estimated-range?cohort_id=saved-id',
      '/v1/pool/node/eqr',
    ]);
  });
});
