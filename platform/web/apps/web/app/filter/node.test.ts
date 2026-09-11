import { describe, expect, it } from 'vitest';

import type { Dimension, FilterNode } from '../stats/api';
import { clausesToNode } from './clause';
import { flatten, isEveryRow, nodeToClauses } from './node';

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

const STREET = dim({ code: 'street', type: 'enum', values: ['preflop', 'flop'], allowed_ops: ['eq', 'in', 'ne', 'not_in'] });
const POSITION = dim({ code: 'position', type: 'enum', values: ['SB', 'BB', 'UTG', 'CO', 'BTN'], allowed_ops: ['eq', 'in', 'ne', 'not_in'] });
const IS_IP = dim({ code: 'is_ip', type: 'bool', allowed_ops: ['eq', 'ne'] });
/* The real registry's buckets: half-open, and the top one open-ended. */
const STACK = dim({
  code: 'eff_stack_bb',
  type: 'number',
  buckets: { '0-40': [0, 40], '40-75': [40, 75], '75-125': [75, 125], '200+': [200, null] },
  allowed_ops: ['between', 'eq', 'gt', 'gte', 'lt', 'lte', 'ne'],
});
const LINE = dim({ code: 'street_line', type: 'line', allowed_ops: ['eq', 'in', 'like', 'ne', 'prefix'] });

const DIMS = new Map([STREET, POSITION, IS_IP, STACK, LINE].map((d) => [d.code, d]));

describe('isEveryRow', () => {
  it('is true only for the engine’s own empty default', () => {
    expect(isEveryRow({ all: [] })).toBe(true);
    expect(isEveryRow({ all: [{ dim: 'street', op: 'eq', value: 'flop' }] })).toBe(false);
    expect(isEveryRow({ dim: 'street', op: 'eq', value: 'flop' })).toBe(false);
  });
});

describe('nodeToClauses', () => {
  it('reads a bare leaf, which is how the repo’s own presets are written', () => {
    /* analysis/hero/presets.yaml, blind_defence: filter is a Leaf, not wrapped in `all`. */
    const node: FilterNode = { dim: 'position', op: 'in', value: ['SB', 'BB'] };
    expect(nodeToClauses(node, DIMS)).toEqual([{ dim: 'position', op: 'in', values: ['SB', 'BB'] }]);
  });

  it('reads an empty filter as no clauses at all', () => {
    expect(nodeToClauses({ all: [] }, DIMS)).toEqual([]);
  });

  it('turns numbers and bools back into the text a clause and a URL carry', () => {
    const node: FilterNode = { all: [{ dim: 'is_ip', op: 'eq', value: 1 }] };
    expect(nodeToClauses(node, DIMS)).toEqual([{ dim: 'is_ip', op: 'eq', values: ['1'] }]);
  });

  it('names the bucket a half-open pair came from', () => {
    const node: FilterNode = {
      all: [
        { dim: 'eff_stack_bb', op: 'gte', value: 75 },
        { dim: 'eff_stack_bb', op: 'lt', value: 125 },
      ],
    };
    expect(nodeToClauses(node, DIMS)).toEqual([{ dim: 'eff_stack_bb', op: 'bucket', values: ['75-125'] }]);
  });

  it('names an open-ended bucket from the single leaf it compiled to', () => {
    const node: FilterNode = { all: [{ dim: 'eff_stack_bb', op: 'gte', value: 200 }] };
    expect(nodeToClauses(node, DIMS)).toEqual([{ dim: 'eff_stack_bb', op: 'bucket', values: ['200+'] }]);
  });

  it('leaves bounds that are not a declared bucket as the plain clauses they are', () => {
    const node: FilterNode = {
      all: [
        { dim: 'eff_stack_bb', op: 'gte', value: 60 },
        { dim: 'eff_stack_bb', op: 'lt', value: 90 },
      ],
    };
    expect(nodeToClauses(node, DIMS)).toEqual([
      { dim: 'eff_stack_bb', op: 'gte', values: ['60'] },
      { dim: 'eff_stack_bb', op: 'lt', values: ['90'] },
    ]);
  });

  it('refuses what a clause list cannot say, rather than reshaping it into something else', () => {
    const any: FilterNode = { any: [{ dim: 'street', op: 'eq', value: 'flop' }] };
    const not: FilterNode = { not: { dim: 'street', op: 'eq', value: 'flop' } };
    expect(nodeToClauses(any, DIMS)).toBeNull();
    expect(nodeToClauses(not, DIMS)).toBeNull();
    expect(nodeToClauses({ all: [{ any: [{ dim: 'street', op: 'eq', value: 'flop' }] }] }, DIMS)).toBeNull();
  });

  it('flattens a nested all, which is the shape this app’s own compiler emits for a bucket', () => {
    /* `clausesToNode([bucket]) === {all: [{all: [gte, lt]}]}` — so refusing nesting would make
       every saved report with a stack or sizing bucket uneditable on reopening. */
    const nested: FilterNode = {
      all: [
        { dim: 'street', op: 'eq', value: 'flop' },
        { all: [{ dim: 'eff_stack_bb', op: 'gte', value: 40 }, { dim: 'eff_stack_bb', op: 'lt', value: 75 }] },
      ],
    };
    expect(nodeToClauses(nested, DIMS)).toEqual([
      { dim: 'street', op: 'eq', values: ['flop'] },
      { dim: 'eff_stack_bb', op: 'bucket', values: ['40-75'] },
    ]);
  });

  it("keeps a line's empty value, which the registry means as 'my first decision on this street'", () => {
    const node: FilterNode = { all: [{ dim: 'street_line', op: 'eq', value: '' }] };
    expect(nodeToClauses(node, DIMS)).toEqual([{ dim: 'street_line', op: 'eq', values: [''] }]);
  });
});

describe('the round trip', () => {
  /* The property that matters: opening a stored report and re-running it asks the same question. */
  const cases: { name: string; node: FilterNode }[] = [
    { name: 'empty', node: { all: [] } },
    { name: 'one enum', node: { all: [{ dim: 'street', op: 'eq', value: 'flop' }] } },
    { name: 'a list', node: { all: [{ dim: 'position', op: 'in', value: ['SB', 'BB'] }] } },
    { name: 'a bool', node: { all: [{ dim: 'is_ip', op: 'eq', value: 1 }] } },
    {
      name: 'a bucket',
      node: {
        all: [
          { dim: 'eff_stack_bb', op: 'gte', value: 40 },
          { dim: 'eff_stack_bb', op: 'lt', value: 75 },
        ],
      },
    },
    {
      name: 'a bucket beside an enum',
      node: {
        all: [
          { dim: 'street', op: 'eq', value: 'flop' },
          { dim: 'eff_stack_bb', op: 'gte', value: 0 },
          { dim: 'eff_stack_bb', op: 'lt', value: 40 },
        ],
      },
    },
    { name: 'a multi-street line', node: { all: [{ dim: 'street_line', op: 'prefix', value: 'r/x-c/' }] } },
  ];

  it.each(cases)('asks the same question after the round trip: $name', ({ node }) => {
    const clauses = nodeToClauses(node, DIMS);
    expect(clauses).not.toBeNull();
    /* Compared leaf by leaf, not tree by tree: a bucket recompiles into a nested `all` and a bare
       leaf comes back wrapped in one, and neither changes which rows the engine matches. */
    expect(flatten(clausesToNode(clauses!, DIMS))).toEqual(flatten(node));
  });

  it('returns the same clauses a chart of clauses compiled from — the property a save relies on', () => {
    const clauses = [
      { dim: 'street', op: 'eq' as const, values: ['flop'] },
      { dim: 'position', op: 'in' as const, values: ['SB', 'BB'] },
      { dim: 'eff_stack_bb', op: 'bucket' as const, values: ['40-75'] },
      { dim: 'is_ip', op: 'eq' as const, values: ['1'] },
    ];
    expect(nodeToClauses(clausesToNode(clauses, DIMS), DIMS)).toEqual(clauses);
  });
});
