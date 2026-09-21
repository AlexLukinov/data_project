import { describe, expect, it } from 'vitest';

import type { Cell, Dimension, Stat, StatFormat } from '../stats/api';
import { MIN_N, cellView, formatGroupValue, formatN, formatValue } from './cell';

function stat(over: Partial<Stat> & Pick<Stat, 'code'>): Stat {
  return { label: over.code, category: 'postflop', grain: 'decision', format: 'percent', ...over } as Stat;
}

function dim(over: Partial<Dimension> & Pick<Dimension, 'code' | 'type'>): Dimension {
  return { label: over.code, tables: ['decisions'], description: '', values: [], ops: null, group_by: true, buckets: {}, allowed_ops: [], ...over } as Dimension;
}

function cell(over: Partial<Cell> = {}): Cell {
  return { value: 50, n: 1000, baseline: null, baseline_n: null, delta: null, ...over };
}

const FOLD = stat({ code: 'fold_to_cbet_flop', label: 'Fold to c-bet flop', format: 'percent' });
const HANDS = stat({ code: 'hands', label: 'Hands', format: 'count', grain: 'hand' });
const RATE = stat({ code: 'bb_per_100', label: 'bb/100', format: 'per100', grain: 'hand', higher_is_better: true });
const AF = stat({ code: 'af', label: 'Aggression factor', format: 'ratio' });

describe('formatValue', () => {
  it('reads each format in its own unit', () => {
    expect(formatValue(22.59, 'percent')).toBe('22.6%');
    expect(formatValue(3245, 'count')).toBe('3,245');
    expect(formatValue(1.5, 'ratio')).toBe('1.50');
    expect(formatValue(-1.37, 'per100')).toBe('−1.37 bb/100');
    expect(formatValue(1.37, 'per100')).toBe('+1.37 bb/100');
  });

  it('never renders a missing value as a number', () => {
    const formats: StatFormat[] = ['percent', 'count', 'ratio', 'per100'];
    for (const format of formats) expect(formatValue(null, format)).toBe('—');
  });
});

describe('formatN', () => {
  it('separates a sample size, because 1443908 is unreadable', () => {
    expect(formatN(1443908)).toBe('1,443,908');
  });
});

describe('cellView — every cell shows n', () => {
  it('carries the sample size whatever the value is', () => {
    expect(cellView(cell({ value: 41, n: 11000 }), FOLD).nText).toBe('11,000');
    expect(cellView(cell({ value: null, n: 0 }), FOLD).nText).toBe('0');
    expect(cellView(cell({ value: 0, n: 3 }), FOLD).nText).toBe('3');
  });
});

describe('cellView — a thin sample is marked and not compared', () => {
  it('marks a cell under the threshold but still shows its value', () => {
    /* Measured on the founder's own hands: raise_cbet_flop is 0.0% over three observations. */
    const view = cellView(cell({ value: 0, n: 3, baseline: 44.05, delta: -44.05 }), FOLD);
    expect(view.thin).toBe(true);
    expect(view.text).toBe('0.0%');
    expect(view.deltaText).toBe('');
    expect(view.note).toContain('only 3 observations');
  });

  it('withholds the delta that would read as a 28-point leak from fifteen hands', () => {
    /* The real row: hero VPIP 6.67% in 5-bet pots from the BB against the field's 35.18%. */
    const view = cellView(cell({ value: 6.67, n: 15, baseline: 35.18, baseline_n: 27470, delta: -28.51 }), FOLD);
    expect(view.thin).toBe(true);
    expect(view.deltaText).toBe('');
    expect(view.deltaSense).toBe('');
  });

  it('compares once the sample is there', () => {
    const view = cellView(cell({ value: 30.96, n: 3327, baseline: 26.76, baseline_n: 9052689, delta: 4.2 }), FOLD);
    expect(view.thin).toBe(false);
    expect(view.deltaText).toBe('+4.2 pts');
    expect(view.baselineText).toBe('26.8%');
  });

  it('takes the threshold from the caller, so a link greys what it greyed when it was sent', () => {
    const thin = cell({ value: 41, n: 200, baseline: 40, delta: 1 });
    expect(cellView(thin, FOLD, MIN_N).thin).toBe(false);
    expect(cellView(thin, FOLD, 300).thin).toBe(true);
    expect(cellView(thin, FOLD, 0).thin).toBe(false);
  });
});

describe('cellView — no observations, no number', () => {
  it('reads as a dash even when the pool has a baseline for the row', () => {
    /* The real row: flop_high_card '2' — hero n = 0, and the field's 46.05% beside it. */
    const view = cellView(cell({ value: null, n: 0, baseline: 46.05, baseline_n: 800000, delta: null }), FOLD);
    expect(view.empty).toBe(true);
    expect(view.text).toBe('—');
    expect(view.deltaText).toBe('');
    expect(view.note).toBe('no observations here');
  });

  it('distinguishes a stat the server did not answer for this row', () => {
    const view = cellView(undefined, FOLD);
    expect(view.empty).toBe(true);
    expect(view.note).toBe('Fold to c-bet flop was not measured for this row');
  });
});

describe('cellView — a count is never compared', () => {
  it('drops the delta the engine computes between hero hands and pool hands', () => {
    /* Measured: hands hero 3,245 vs pool 9,036,302, delta −9,033,057. Arithmetic, not information. */
    const view = cellView(cell({ value: 3245, n: 3245, baseline: 9036302, baseline_n: 9036302, delta: -9033057 }), HANDS);
    expect(view.text).toBe('3,245');
    expect(view.deltaText).toBe('');
    expect(view.baselineText).toBe('');
  });
});

describe('cellView — direction is only coloured where the registry commits', () => {
  it('colours a stat that declares which way is better', () => {
    const better = cellView(cell({ value: 5, n: 5000, baseline: 2, delta: 3 }), RATE);
    const worse = cellView(cell({ value: -1, n: 5000, baseline: 2, delta: -3 }), RATE);
    expect(better.deltaSense).toBe('good');
    expect(worse.deltaSense).toBe('bad');
  });

  it('leaves a stat with no declared direction uncoloured, rather than inventing a judgement', () => {
    /* Is a 42% fold-to-c-bet good? The registry says `higher_is_better: null`, so neither do we. */
    const view = cellView(cell({ value: 42, n: 5000, baseline: 39, delta: 3 }), FOLD);
    expect(view.deltaText).toBe('+3.0 pts');
    expect(view.deltaSense).toBe('');
  });

  it('formats a ratio delta without a unit', () => {
    expect(cellView(cell({ value: 2.5, n: 5000, baseline: 2, delta: 0.5 }), AF).deltaText).toBe('+0.50');
  });
});

/* The column is now an argument (ADR-057): the same string reads one way as an enum value and
   another way as somebody's screen name, and only the dimension says which of the two it is. */
describe('formatGroupValue', () => {
  const FACING = dim({ code: 'facing', type: 'enum', values: ['5bet_plus', ''] });
  const PLAYER = dim({ code: 'player_key', type: 'string', tables: ['stats_daily'] });
  const SIZE = dim({ code: 'size_pct', type: 'number', label: 'Bet size (fraction of pot)', buckets: { small: [0, 0.37], overbet: [1.1, null] } });

  it("words the registry's two conventions the way the filter chips do", () => {
    expect(formatGroupValue('5bet_plus', FACING)).toBe('5bet+');
    expect(formatGroupValue('', FACING)).toBe('not applicable');
    expect(formatGroupValue('BTN', FACING)).toBe('BTN');
    expect(formatGroupValue(null)).toBe('—');
    expect(formatGroupValue(1000)).toBe('1,000');
  });

  it('leaves a value alone off an enum, so a player called a_plus_b keeps their name', () => {
    expect(formatGroupValue('a_plus_b', PLAYER)).toBe('a_plus_b');
    expect(formatGroupValue('a_plus_b')).toBe('a_plus_b');
  });

  it('prints what a bucket covers, because “small” on its own says nothing', () => {
    expect(formatGroupValue('small', SIZE)).toBe('small (under 0.37 of the pot)');
    expect(formatGroupValue('overbet', SIZE)).toBe('overbet (1.1 of the pot and up)');
  });
});
