import { describe, expect, it } from 'vitest';

import type { Dimension, Stat } from '../stats/api';
import { describeDimension, describeStat, exprSentence, nodeSentence } from './describe';

function dim(over: Partial<Dimension> & Pick<Dimension, 'code' | 'type'>): Dimension {
  return {
    label: over.code,
    tables: ['decisions'],
    description: '',
    values: [],
    ops: null,
    group_by: true,
    buckets: {},
    allowed_ops: [],
    ...over,
  } as Dimension;
}

const STREET = dim({ code: 'street', type: 'enum', label: 'Street', values: ['flop', 'turn'] });
const FACING = dim({ code: 'facing', type: 'enum', label: 'Facing', values: ['bet', 'raise'] });
const IS_CBET = dim({ code: 'facing_is_cbet', type: 'bool', label: 'Facing a c-bet' });
const ACTION = dim({ code: 'action', type: 'enum', label: 'Action', values: ['fold', 'call', 'raise'] });
const NET = dim({ code: 'net_won_bb', type: 'number', label: 'Net won (bb)' });
const STACK = dim({ code: 'eff_stack_bb', type: 'number', label: 'Effective stack (bb)', buckets: { '0-40': [0, 40], '40-75': [40, 75] } });

const DIMS = new Map([STREET, FACING, IS_CBET, ACTION, NET, STACK].map((d) => [d.code, d]));

/** The real registry entry for fold_to_cbet_flop, as `/v1/definitions` serves it. */
const FOLD_TO_CBET: Stat = {
  code: 'fold_to_cbet_flop',
  label: 'Fold to c-bet flop',
  category: 'postflop',
  grain: 'decision',
  format: 'percent',
  situation: {
    all: [
      { dim: 'street', op: 'eq', value: 'flop' },
      { dim: 'facing', op: 'eq', value: 'bet' },
      { dim: 'facing_is_cbet', op: 'eq', value: 1 },
    ],
  },
  action: { dim: 'action', op: 'eq', value: 'fold' },
  typical: [40, 55],
  cached: true,
  description: "Folded facing the preflop aggressor's flop bet.",
  notes: 'The c-bet must be the only bet in front.',
  higher_is_better: null,
};

/** The real registry entry for bb_per_100. */
const RATE: Stat = {
  code: 'bb_per_100',
  label: 'bb/100',
  category: 'money',
  grain: 'hand',
  format: 'per100',
  numerator: { sum: 'net_won_bb' },
  denominator: { count: true },
  higher_is_better: true,
  typical: [0, 10],
  cached: true,
  description: 'Big blinds won per 100 hands.',
};

describe('nodeSentence', () => {
  it('words a condition exactly as a filter chip words it', () => {
    expect(nodeSentence(FOLD_TO_CBET.situation, DIMS)).toBe('Street is flop · Facing is bet · Facing a c-bet: yes');
  });

  it('says so plainly when there is no condition', () => {
    expect(nodeSentence({ all: [] }, DIMS)).toBe('every row');
    expect(nodeSentence(null, DIMS)).toBe('');
  });

  it('admits a condition it cannot word rather than wording it wrongly', () => {
    expect(nodeSentence({ any: [{ dim: 'street', op: 'eq', value: 'flop' }] }, DIMS)).toContain('more complex');
  });
});

describe('exprSentence', () => {
  it('words each aggregate literally', () => {
    expect(exprSentence({ count: true }, DIMS)).toBe('the number of rows');
    expect(exprSentence({ sum: 'net_won_bb' }, DIMS)).toBe('the sum of Net won (bb)');
    expect(exprSentence({ countIf: { dim: 'action', op: 'eq', value: 'fold' } }, DIMS)).toBe('the number of rows where Action is fold');
  });

  it('words arithmetic', () => {
    expect(exprSentence({ div: [{ sum: 'net_won_bb' }, { count: true }] }, DIMS)).toBe('the sum of Net won (bb) divided by the number of rows');
    expect(exprSentence({ add: [{ count: true }, { count: true }] }, DIMS)).toBe('the number of rows plus the number of rows');
  });
});

describe('describeStat', () => {
  it('says what a situation-and-action stat actually counts', () => {
    const lines = describeStat(FOLD_TO_CBET, DIMS);
    const counts = lines.find((line) => line.term === 'Counts');
    expect(counts?.detail).toBe(
      'of the rows where Street is flop · Facing is bet · Facing a c-bet: yes — the share where Action is fold',
    );
  });

  it('says what an expression stat counts', () => {
    const counts = describeStat(RATE, DIMS).find((line) => line.term === 'Counts');
    expect(counts?.detail).toBe('the sum of Net won (bb), divided by the number of rows');
  });

  it('shows the typical band as a band, never as a gate', () => {
    expect(describeStat(FOLD_TO_CBET, DIMS).find((l) => l.term === 'Typically')?.detail).toBe('between 40% and 55%');
    expect(describeStat(RATE, DIMS).find((l) => l.term === 'Typically')?.detail).toBe('between 0 and 10');
  });

  it('refuses to imply a direction the registry does not commit to', () => {
    expect(describeStat(FOLD_TO_CBET, DIMS).find((l) => l.term === 'Direction')?.detail).toContain('does not say');
    expect(describeStat(RATE, DIMS).find((l) => l.term === 'Direction')?.detail).toBe('higher is better');
  });

  it('carries the caveat the registry records on the definition', () => {
    expect(describeStat(FOLD_TO_CBET, DIMS).find((l) => l.term === 'Caveat')?.detail).toContain('only bet in front');
    expect(describeStat(RATE, DIMS).find((l) => l.term === 'Caveat')).toBeUndefined();
  });

  it('names the grain in terms of what a row is', () => {
    expect(describeStat(FOLD_TO_CBET, DIMS).find((l) => l.term === 'Measured on')?.detail).toContain('per decision');
    expect(describeStat(RATE, DIMS).find((l) => l.term === 'Measured on')?.detail).toContain('per hand');
  });
});

describe('describeDimension', () => {
  it('lists the values, wording the empty one', () => {
    const values = describeDimension(dim({ code: 'opener_position', type: 'enum', values: ['', 'UTG', 'BTN'] })).find((l) => l.term === 'Values');
    expect(values?.detail).toBe("'' (not applicable), UTG, BTN");
  });

  it('says buckets are half-open, which is the trap they carry', () => {
    expect(describeDimension(STACK).find((l) => l.term === 'Grouped into')?.detail).toContain('half-open');
  });

  it('names the tables that hold it, which is what decides a stat’s grain', () => {
    expect(describeDimension(FACING).find((l) => l.term === 'Held on')?.detail).toBe('decisions');
  });
});
