import { describe, expect, it } from 'vitest';

import type { Dimension } from '../stats/api';
import type { Clause } from './clause';
import { clauseLabel, filterSentence, valueLabel } from './label';

function dim(over: Partial<Dimension> & Pick<Dimension, 'code' | 'type' | 'label'>): Dimension {
  return { tables: ['decisions'], description: '', values: [], ops: null, group_by: true, buckets: {}, allowed_ops: [], ...over } as Dimension;
}

const STREET = dim({ code: 'street', type: 'enum', label: 'Street', values: ['flop'] });
const OPENER = dim({ code: 'opener_position', type: 'enum', label: "Opener's position", values: ['', 'UTG'] });
const FACING = dim({ code: 'facing', type: 'enum', label: 'Facing', values: ['5bet_plus', 'bet'] });
const IS_IP = dim({ code: 'is_ip', type: 'bool', label: 'In position' });
const SPR = dim({ code: 'spr', type: 'number', label: 'Stack-to-pot ratio', buckets: { '1-3': [1, 3], '13+': [13, null] } });
const STREET_LINE = dim({ code: 'street_line', type: 'line', label: 'My line this street' });
const SO_FAR = dim({ code: 'line_so_far', type: 'line', label: 'My line so far' });

const c = (d: string, op: string, ...values: string[]): Clause => ({ dim: d, op: op as Clause['op'], values });

describe('clauseLabel', () => {
  it('words an enum with the registry label and the op', () => {
    expect(clauseLabel(c('street', 'eq', 'flop'), STREET)).toBe('Street is flop');
    expect(clauseLabel(c('street', 'in', 'flop', 'turn'), STREET)).toBe('Street is one of flop, turn');
  });

  it('writes 5bet_plus the way a player does', () => {
    expect(clauseLabel(c('facing', 'eq', '5bet_plus'), FACING)).toBe('Facing is 5bet+');
    expect(valueLabel('5bet_plus')).toBe('5bet+');
  });

  it("says what '' means on an enum", () => {
    expect(clauseLabel(c('opener_position', 'eq', ''), OPENER)).toBe("Opener's position is not applicable");
  });

  /**
   * On a `line`, '' is the registry's "my first decision on this street" — not "not applicable".
   * Found while checking the wording of a real filter against the live registry.
   */
  it("reads an action line as actions, and '' as no action yet", () => {
    expect(clauseLabel(c('street_line', 'eq', ''), STREET_LINE)).toBe('My line this street: no action yet');
    expect(clauseLabel(c('line_so_far', 'eq', 'r/x-c/'), SO_FAR)).toBe('My line so far: raise / check-call / …');
  });

  it('states a bool as yes or no, not as 1 or 0', () => {
    expect(clauseLabel(c('is_ip', 'eq', '1'), IS_IP)).toBe('In position: yes');
    expect(clauseLabel(c('is_ip', 'eq', '0'), IS_IP)).toBe('In position: no');
  });

  it('writes a bucket as the range it is', () => {
    expect(clauseLabel(c('spr', 'bucket', '1-3'), SPR)).toBe('Stack-to-pot ratio 1–3');
    expect(clauseLabel(c('spr', 'bucket', '13+'), SPR)).toBe('Stack-to-pot ratio 13+');
  });

  it('spells a numeric comparison in symbols', () => {
    expect(clauseLabel(c('spr', 'gte', '3'), SPR)).toBe('Stack-to-pot ratio ≥ 3');
    expect(clauseLabel(c('spr', 'between', '1', '3'), SPR)).toBe('Stack-to-pot ratio between 1 and 3');
  });

  it('still reads when the registry no longer declares the dimension', () => {
    expect(clauseLabel(c('gone', 'eq', 'x'), undefined)).toBe('gone eq x');
  });
});

describe('filterSentence', () => {
  const dims = new Map([STREET, IS_IP].map((d) => [d.code, d]));

  it('is honest about the empty filter', () => {
    expect(filterSentence([], dims)).toBe('every hand');
  });

  it('joins the conditions in the order they were added', () => {
    expect(filterSentence([c('street', 'eq', 'flop'), c('is_ip', 'eq', '1')], dims)).toBe('Street is flop · In position: yes');
  });
});
