import { describe, expect, it } from 'vitest';

import type { ColumnFacts } from './compareColumn';
import { columnView } from './compareColumn';

const pool = (over: Partial<ColumnFacts>): ColumnFacts => ({ source: 'pool', status: 'success', failed: false, hasRange: false, answered: false, ...over });
const own = (over: Partial<ColumnFacts>): ColumnFacts => ({ source: 'own', status: 'success', failed: false, hasRange: false, answered: false, ...over });

describe('columnView — the pool column', () => {
  it('calls a failed pool call an error, not insufficient data and not unasked', () => {
    expect(columnView(pool({ status: 'error', failed: true }))).toBe('error');
  });

  it('says it is still asking, even while the previous situation left a range behind', () => {
    expect(columnView(pool({ status: 'pending', hasRange: true, answered: true }))).toBe('loading');
  });

  it('says insufficient data only for an answer that said so', () => {
    expect(columnView(pool({ answered: true }))).toBe('insufficient');
    expect(columnView(pool({ answered: false }))).toBe('unasked');
  });

  it('draws a range it has, such as tier 3, even when the showdown call failed', () => {
    expect(columnView(pool({ status: 'error', failed: true, hasRange: true }))).toBe('range');
  });
});

describe('columnView — my chart and the solver column', () => {
  it('says the library could not be read rather than that nothing is stored', () => {
    expect(columnView(own({ status: 'error', failed: true }))).toBe('error');
    expect(columnView(own({ status: 'error', failed: true, hasRange: true }))).toBe('error');
  });

  it('never says nothing is stored while the lookup runs', () => {
    expect(columnView(own({ status: 'pending' }))).toBe('loading');
    expect(columnView(own({ status: 'pending', hasRange: true }))).toBe('loading');
  });

  it('draws what the lookup found, and says so when it found nothing', () => {
    expect(columnView({ ...own({ hasRange: true }), source: 'solver' })).toBe('range');
    expect(columnView(own({}))).toBe('empty');
  });
});
