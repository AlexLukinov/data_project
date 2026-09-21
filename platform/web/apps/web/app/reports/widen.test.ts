import { describe, expect, it } from 'vitest';

import type { WidenTarget } from './widen';
import { widenFilter } from './widen';

function target(over: Partial<WidenTarget> = {}): WidenTarget & { cleared: number } {
  const state = {
    dataset: 'hero' as const,
    dateFrom: '2026-01-01',
    dateTo: '2026-02-01',
    cleared: 0,
    clear(): void {
      state.cleared += 1;
    },
    ...over,
  };
  return state;
}

describe('widenFilter', () => {
  it('clears the situation without touching the dates, which are the bar’s own', () => {
    const filter = target();
    expect(widenFilter('clear-situation', filter)).toBe(true);
    expect(filter.cleared).toBe(1);
    expect(filter.dateFrom).toBe('2026-01-01');
  });

  it('clears both bounds, because one date left behind still narrows', () => {
    const filter = target();
    expect(widenFilter('clear-dates', filter)).toBe(true);
    expect([filter.dateFrom, filter.dateTo]).toEqual(['', '']);
    expect(filter.cleared).toBe(0);
  });

  /* One key, two labels: which dataset is "the other one" depends on which one you are standing in
     (`EMPTY_ACTIONS.lookInPool` and `lookInMine` share the key for exactly that reason). */
  it('swaps the dataset in whichever direction it is asked from', () => {
    const mine = target();
    widenFilter('other-dataset', mine);
    expect(mine.dataset).toBe('population');
    const pool = target({ dataset: 'population' });
    widenFilter('other-dataset', pool);
    expect(pool.dataset).toBe('hero');
  });

  it('hands back a key it does not own rather than swallowing it into a dead button', () => {
    const filter = target();
    expect(widenFilter('run', filter)).toBe(false);
    expect(widenFilter('upload', filter)).toBe(false);
    expect([filter.dataset, filter.dateFrom, filter.cleared]).toEqual(['hero', '2026-01-01', 0]);
  });
});
