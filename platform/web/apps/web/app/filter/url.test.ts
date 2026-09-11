import { describe, expect, it } from 'vitest';

import type { Clause } from './clause';
import { DEFAULT_STATE, decodeClauses, encodeClauses, fromQuery, sameQuery, toQuery } from './url';

const clause = (dim: string, op: string, ...values: string[]): Clause => ({ dim, op: op as Clause['op'], values });

describe('encodeClauses', () => {
  it('reads as the situation it is', () => {
    const text = encodeClauses([clause('street', 'eq', 'flop'), clause('position', 'in', 'BTN', 'CO')]);
    expect(text).toBe('street:eq:flop;position:in:BTN,CO');
  });

  it('keeps a bucket name whole, dashes and all', () => {
    expect(encodeClauses([clause('eff_stack_bb', 'bucket', '75-125')])).toBe('eff_stack_bb:bucket:75-125');
    expect(encodeClauses([clause('spr', 'bucket', '13+')])).toBe('spr:bucket:13%2B');
  });

  it('escapes a value that would otherwise be read as a separator', () => {
    expect(encodeClauses([clause('line_so_far', 'eq', 'r/x-c/')])).toBe('line_so_far:eq:r%2Fx-c%2F');
    expect(encodeClauses([clause('hand_class', 'in', 'A,B', 'C;D')])).toBe('hand_class:in:A%2CB,C%3BD');
  });
});

describe('the round trip', () => {
  const cases: Clause[][] = [
    [],
    [clause('street', 'eq', 'flop')],
    [clause('position', 'in', 'BTN', 'CO', 'SB'), clause('facing', 'eq', 'bet')],
    [clause('spr', 'between', '1', '3')],
    [clause('eff_stack_bb', 'bucket', '40-75')],
    [clause('line_so_far', 'eq', 'r/x-c/')],
    [clause('street_line', 'eq', '')],
    [clause('opener_position', 'eq', '')],
    [clause('hand_class', 'in', 'AKs', 'T9o')],
    [clause('stake_level', 'prefix', 'NL')],
    [clause('hole_cards', 'eq', 'As Kd')],
    [clause('facing_size_pct', 'gte', '0.75'), clause('is_ip', 'eq', '1'), clause('street', 'eq', 'turn')],
  ];

  it.each(cases)('survives encode → decode unchanged (%#)', (...clauses) => {
    expect(decodeClauses(encodeClauses(clauses))).toEqual(clauses);
  });

  it('survives the whole state through a query bag', () => {
    const state = {
      dataset: 'population' as const,
      dateFrom: '2026-01-01',
      dateTo: '2026-09-01',
      clauses: [clause('street', 'eq', 'river'), clause('spr', 'between', '0', '1')],
    };
    expect(fromQuery(toQuery(state))).toEqual(state);
  });

  it('writes only what differs from the default', () => {
    expect(toQuery(DEFAULT_STATE)).toEqual({});
    expect(toQuery({ ...DEFAULT_STATE, dataset: 'population' })).toEqual({ ds: 'population' });
  });
});

describe('fromQuery', () => {
  it('falls back to the default for anything it cannot read', () => {
    expect(fromQuery({})).toEqual(DEFAULT_STATE);
    expect(fromQuery({ ds: 'nonsense' }).dataset).toBe('hero');
    expect(fromQuery({ from: 'last tuesday' }).dateFrom).toBe('');
    expect(fromQuery({ from: '2026-1-1' }).dateFrom).toBe('');
  });

  it('takes the first value of a repeated parameter', () => {
    expect(fromQuery({ ds: ['population', 'hero'] }).dataset).toBe('population');
  });

  it('drops a segment it cannot read and keeps the rest', () => {
    expect(decodeClauses('street:eq:flop;rubbish;position:eq:BTN')).toEqual([
      clause('street', 'eq', 'flop'),
      clause('position', 'eq', 'BTN'),
    ]);
    expect(decodeClauses('STREET:eq:flop')).toEqual([]);
    expect(decodeClauses('street:eq:%zz')).toEqual([]);
  });

  it('reads an empty value as the empty string, not as no value', () => {
    expect(decodeClauses('street_line:eq:')).toEqual([clause('street_line', 'eq', '')]);
  });
});

describe('sameQuery', () => {
  it('is true when both say the same thing, however they spell absence', () => {
    expect(sameQuery({}, {})).toBe(true);
    expect(sameQuery({}, { ds: undefined, other: 'kept' })).toBe(true);
    expect(sameQuery({ f: 'street:eq:flop' }, { f: 'street:eq:flop' })).toBe(true);
    expect(sameQuery({ f: 'street:eq:flop' }, { f: 'street:eq:turn' })).toBe(false);
    expect(sameQuery({ ds: 'population' }, {})).toBe(false);
  });
});
