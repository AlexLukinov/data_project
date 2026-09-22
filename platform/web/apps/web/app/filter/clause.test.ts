import { describe, expect, it } from 'vitest';

import type { Dimension } from '../stats/api';
import type { Clause } from './clause';
import { arity, clauseToNode, clausesToNode, defaultClause, isComplete, opsFor, tablesFor, withOp } from './clause';

function dim(over: Partial<Dimension> & Pick<Dimension, 'code' | 'type'>): Dimension {
  return {
    label: over.code,
    tables: ['decisions'],
    description: '',
    values: [],
    value_labels: {},
    ops: null,
    group_by: true,
    buckets: {},
    allowed_ops: [],
    ...over,
  } as Dimension;
}

const STREET = dim({ code: 'street', type: 'enum', values: ['preflop', 'flop', 'turn', 'river'], allowed_ops: ['eq', 'in', 'ne', 'not_in'] });
const OPENER = dim({ code: 'opener_position', type: 'enum', values: ['', 'UTG', 'BTN'], allowed_ops: ['eq', 'in', 'ne', 'not_in'] });
const IS_IP = dim({ code: 'is_ip', type: 'bool', allowed_ops: ['eq', 'ne'] });
const SPR = dim({
  code: 'spr',
  type: 'number',
  buckets: { '0-1': [0, 1], '1-3': [1, 3], '13+': [13, null] },
  allowed_ops: ['between', 'eq', 'gt', 'gte', 'in', 'lt', 'lte', 'ne', 'not_in'],
});
const PLAYERS = dim({ code: 'players_live', type: 'number', allowed_ops: ['between', 'eq', 'gt', 'gte', 'lt', 'lte', 'ne'] });
const LINE = dim({ code: 'street_line', type: 'line', allowed_ops: ['eq', 'in', 'like', 'ne', 'not_in', 'prefix'] });
const STAKE = dim({ code: 'stake_level', type: 'string', tables: ['decisions', 'player_hands', 'stats_daily'], allowed_ops: ['eq', 'in', 'like', 'ne', 'not_in', 'prefix'] });

const DIMS = new Map([STREET, OPENER, IS_IP, SPR, PLAYERS, LINE, STAKE].map((d) => [d.code, d]));
const clause = (dimension: string, op: string, ...values: string[]): Clause => ({ dim: dimension, op: op as Clause['op'], values });

describe('opsFor', () => {
  it("offers the server's allowed_ops, and bucket first where the registry has ranges", () => {
    expect(opsFor(STREET)).toEqual(['eq', 'in', 'ne', 'not_in']);
    expect(opsFor(SPR)[0]).toBe('bucket');
    expect(opsFor(PLAYERS)).not.toContain('bucket');
  });
});

describe('defaultClause', () => {
  it('opens on something meaningful rather than blank', () => {
    expect(defaultClause(STREET)).toEqual({ dim: 'street', op: 'eq', values: ['preflop'] });
    expect(defaultClause(SPR)).toEqual({ dim: 'spr', op: 'bucket', values: ['0-1'] });
    expect(defaultClause(IS_IP)).toEqual({ dim: 'is_ip', op: 'eq', values: ['1'] });
    // `allowed_ops` arrives sorted, so a number's first op is `between`; opening a fresh
    // condition on "is between 0 and 0" is worse than opening it on "is at least 0".
    expect(defaultClause(PLAYERS)).toEqual({ dim: 'players_live', op: 'gte', values: ['0'] });
  });

  it('pads to the arity of whatever op it does pick', () => {
    const onlyBetween = { ...PLAYERS, allowed_ops: ['between'] as Dimension['allowed_ops'] };
    expect(defaultClause(onlyBetween)).toEqual({ dim: 'players_live', op: 'between', values: ['0', '0'] });
  });

  it("skips '' when the enum offers a real value after it", () => {
    expect(defaultClause(OPENER).values).toEqual(['UTG']);
  });
});

describe('withOp', () => {
  it('pads to the new arity and keeps what still fits', () => {
    expect(withOp(clause('spr', 'gte', '3'), 'between', SPR).values).toEqual(['3', '0']);
    expect(withOp(clause('spr', 'between', '1', '3'), 'gte', SPR).values).toEqual(['1']);
    expect(arity('between')).toBe(2);
    expect(arity('in')).toBeNull();
  });

  it('does not carry a bucket name into a comparison, or the other way', () => {
    expect(withOp(clause('spr', 'bucket', '1-3'), 'gte', SPR).values).toEqual(['0']);
    expect(withOp(clause('spr', 'gte', '3'), 'bucket', SPR).values).toEqual(['0-1']);
  });
});

describe('clauseToNode', () => {
  it('emits one leaf with a scalar for a scalar op', () => {
    expect(clauseToNode(clause('street', 'eq', 'flop'), STREET)).toEqual({ dim: 'street', op: 'eq', value: 'flop' });
  });

  it('emits a list value exactly where the AST requires one', () => {
    expect(clauseToNode(clause('street', 'in', 'flop', 'turn'), STREET)).toEqual({ dim: 'street', op: 'in', value: ['flop', 'turn'] });
    expect(clauseToNode(clause('spr', 'between', '1', '3'), SPR)).toEqual({ dim: 'spr', op: 'between', value: [1, 3] });
  });

  it('sends a bool as 0 or 1, never true or false', () => {
    expect(clauseToNode(clause('is_ip', 'eq', '1'), IS_IP)).toEqual({ dim: 'is_ip', op: 'eq', value: 1 });
    expect(clauseToNode(clause('is_ip', 'eq', '0'), IS_IP)).toEqual({ dim: 'is_ip', op: 'eq', value: 0 });
  });

  it('reads a number dimension as a number, not as its text', () => {
    expect(clauseToNode(clause('spr', 'gte', '3.5'), SPR)).toEqual({ dim: 'spr', op: 'gte', value: 3.5 });
  });

  it("keeps '' as a value, because the registry means something by it", () => {
    expect(clauseToNode(clause('opener_position', 'eq', ''), OPENER)).toEqual({ dim: 'opener_position', op: 'eq', value: '' });
  });

  /**
   * The compiler renders `between` as SQL `BETWEEN low AND high`, which includes the top, while
   * the registry's buckets are half-open `[low, high)`. An SPR of exactly 1 belongs to `1-3`
   * alone; `between` would put it in both.
   */
  it('emits a bucket as a half-open pair, not as between', () => {
    expect(clauseToNode(clause('spr', 'bucket', '1-3'), SPR)).toEqual({
      all: [
        { dim: 'spr', op: 'gte', value: 1 },
        { dim: 'spr', op: 'lt', value: 3 },
      ],
    });
  });

  it('emits one leaf for a bucket with an open end', () => {
    expect(clauseToNode(clause('spr', 'bucket', '13+'), SPR)).toEqual({ dim: 'spr', op: 'gte', value: 13 });
  });
});

describe('clausesToNode', () => {
  it('ANDs the complete clauses and leaves out the unfinished ones', () => {
    const node = clausesToNode([clause('street', 'eq', 'flop'), clause('spr', 'between', '1')], DIMS);
    expect(node).toEqual({ all: [{ dim: 'street', op: 'eq', value: 'flop' }] });
  });

  it('is the engine default when nothing is chosen', () => {
    expect(clausesToNode([], DIMS)).toEqual({ all: [] });
  });

  it('drops a clause naming a dimension this server does not declare', () => {
    expect(clausesToNode([clause('gone', 'eq', 'x')], DIMS)).toEqual({ all: [] });
  });
});

describe('isComplete', () => {
  it('refuses the shapes the Leaf validator would reject', () => {
    expect(isComplete(clause('street', 'in'), STREET)).toBe(false);
    expect(isComplete(clause('spr', 'between', '1'), SPR)).toBe(false);
    expect(isComplete(clause('spr', 'gte', 'abc'), SPR)).toBe(false);
    expect(isComplete(clause('spr', 'gte', ' '), SPR)).toBe(false);
    expect(isComplete(clause('street', 'eq', 'nope'), STREET)).toBe(false);
    expect(isComplete(clause('street', 'gt', 'flop'), STREET)).toBe(false);
    expect(isComplete(clause('spr', 'bucket', 'nope'), SPR)).toBe(false);
    expect(isComplete(clause('street', 'eq', 'flop'), undefined)).toBe(false);
  });

  it('accepts an empty line or string, which the registry treats as a value', () => {
    expect(isComplete(clause('street_line', 'eq', ''), LINE)).toBe(true);
    expect(isComplete(clause('stake_level', 'prefix', ''), STAKE)).toBe(true);
  });
});

describe('tablesFor', () => {
  it('narrows to the tables that hold every clause at once', () => {
    expect(tablesFor([clause('stake_level', 'eq', 'NL50')], DIMS)).toEqual(['decisions', 'player_hands', 'stats_daily']);
    expect(tablesFor([clause('street', 'eq', 'flop')], DIMS)).toEqual(['decisions']);
    expect(tablesFor([clause('street', 'eq', 'flop'), clause('stake_level', 'eq', 'NL50')], DIMS)).toEqual(['decisions']);
  });
});
