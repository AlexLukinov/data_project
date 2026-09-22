import { describe, expect, it } from 'vitest';

import type { Dimension } from '../stats/api';
import type { Clause } from '../filter/clause';
import { unsearchableLabels, unsearchableReason } from './searchable';

function dim(code: string, label: string, tables: Dimension['tables']): Dimension {
  return { code, label, type: 'bool', tables, description: '', values: [], value_labels: {}, ops: null, group_by: true, buckets: {}, allowed_ops: ['eq', 'ne'] };
}

// The real registry entries this guard exists for: `street` is on both marts, `saw_flop` and
// `did_vpip` only on the hand-grain one (`stats/registry/dimensions.yaml`).
const DIMS: ReadonlyMap<string, Dimension> = new Map([
  ['street', dim('street', 'Street', ['decisions', 'stats_daily'])],
  ['saw_flop', dim('saw_flop', 'Saw the flop', ['player_hands'])],
  ['did_vpip', dim('did_vpip', 'Put money in preflop', ['player_hands'])],
]);

function clause(dimCode: string): Clause {
  return { dim: dimCode, op: 'eq', values: ['1'] };
}

describe('unsearchableLabels', () => {
  it('is empty when every clause is on the decisions mart', () => {
    expect(unsearchableLabels([clause('street')], DIMS)).toEqual([]);
  });

  it('names the hand-grain dimensions, in the order they were added', () => {
    expect(unsearchableLabels([clause('did_vpip'), clause('street'), clause('saw_flop')], DIMS)).toEqual(['Put money in preflop', 'Saw the flop']);
  });

  it('ignores a dimension the registry has not answered for yet', () => {
    // An unknown code is an incomplete clause; `clausesToNode` drops it before anything is sent,
    // so reporting it here would blame the person for a clause that is never posted.
    expect(unsearchableLabels([clause('not_a_dimension')], DIMS)).toEqual([]);
  });
});

describe('unsearchableReason', () => {
  it('is null when the situation can be searched', () => {
    expect(unsearchableReason([clause('street')], DIMS)).toBeNull();
    expect(unsearchableReason([], DIMS)).toBeNull();
  });

  it('says which condition is the problem, in the singular', () => {
    const reason = unsearchableReason([clause('saw_flop')], DIMS);
    expect(reason).toContain('Saw the flop is counted per hand');
    expect(reason).toContain('it cannot pick out hands');
    expect(reason).toContain('Remove that condition');
  });

  it('agrees with itself in the plural', () => {
    const reason = unsearchableReason([clause('saw_flop'), clause('did_vpip')], DIMS);
    expect(reason).toContain('Saw the flop and Put money in preflop are counted per hand');
    expect(reason).toContain('they cannot pick out hands');
    expect(reason).toContain('Remove those conditions');
  });
});
