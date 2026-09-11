import { describe, expect, it } from 'vitest';

import type { Dimension, Stat } from '../stats/api';
import { TABLE_FOR_GRAIN, columnProblems, fits, groupByCategory, groupableDimensions, keepFitting, narrowByGroupBy, usableStats } from './columns';

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

function stat(code: string, grain: Stat['grain'], category: Stat['category'] = 'preflop'): Stat {
  return { code, label: code.toUpperCase(), category, grain, format: 'percent' } as Stat;
}

/* The real registry's tables for these three, as `/v1/definitions` serves them. */
const FACING = dim({ code: 'facing', type: 'enum', tables: ['decisions'] });
const POSITION = dim({ code: 'position', type: 'enum', tables: ['decisions', 'player_hands', 'stats_daily'] });
const PLAYER = dim({ code: 'player_key', type: 'string', tables: ['stats_daily'] });
const NOT_GROUPABLE = dim({ code: 'hole_cards', type: 'string', group_by: false });

const DIMS = new Map([FACING, POSITION, PLAYER, NOT_GROUPABLE].map((d) => [d.code, d]));
const ALL = ['decisions', 'player_hands', 'stats_daily'];

const HANDS = stat('hands', 'hand', 'money');
const VPIP = stat('vpip', 'hand');
const THREEBET = stat('threebet', 'decision');
const CBET = stat('cbet_flop', 'decision', 'postflop');
const STATS = [HANDS, VPIP, THREEBET, CBET];

describe('TABLE_FOR_GRAIN', () => {
  it('mirrors the server’s own mapping', () => {
    expect(TABLE_FOR_GRAIN).toEqual({ hand: 'player_hands', decision: 'decisions' });
  });
});

describe('narrowByGroupBy', () => {
  it('rules out hand-grain stats when the grouping is decision-only', () => {
    /* Verified against the running engine: group_by ['facing'] with stats ['hands'] is a 400,
       "dimension 'facing' is not available for hand-grain stat 'hands' (it is on ['decisions'])". */
    expect(narrowByGroupBy(ALL, ['facing'], DIMS)).toEqual(['decisions']);
  });

  it('leaves every table when the grouping is on all of them', () => {
    expect(narrowByGroupBy(ALL, ['position'], DIMS)).toEqual(ALL);
  });

  it('intersects several group-by columns', () => {
    expect(narrowByGroupBy(ALL, ['position', 'facing'], DIMS)).toEqual(['decisions']);
  });

  it('forces the rollup when grouping by a player', () => {
    expect(narrowByGroupBy(ALL, ['player_key'], DIMS)).toEqual(['stats_daily']);
  });

  it('starts from what the filter already narrowed, rather than from every table', () => {
    expect(narrowByGroupBy(['decisions'], ['position'], DIMS)).toEqual(['decisions']);
  });

  it('ignores a code the registry does not know, leaving the server to say so', () => {
    expect(narrowByGroupBy(ALL, ['no_such_dimension'], DIMS)).toEqual(ALL);
  });
});

describe('fits / usableStats', () => {
  it('keeps a stat only where its own grain’s table survived', () => {
    expect(fits(VPIP, ['decisions'])).toBe(false);
    expect(fits(THREEBET, ['decisions'])).toBe(true);
    expect(usableStats(STATS, ['decisions']).map((s) => s.code)).toEqual(['threebet', 'cbet_flop']);
    expect(usableStats(STATS, ALL)).toHaveLength(4);
  });

  it('offers nothing when no table can answer the situation at all', () => {
    expect(usableStats(STATS, [])).toEqual([]);
  });
});

describe('keepFitting', () => {
  it('names the stats it dropped, because the person picked them on purpose', () => {
    const kept = keepFitting(['hands', 'vpip', 'threebet'], STATS, ['decisions']);
    expect(kept.codes).toEqual(['threebet']);
    expect(kept.dropped).toEqual(['HANDS', 'VPIP']);
  });

  it('drops a code the registry no longer knows without a word about it', () => {
    const kept = keepFitting(['retired_stat', 'threebet'], STATS, ['decisions']);
    expect(kept.codes).toEqual(['threebet']);
    expect(kept.dropped).toEqual([]);
  });

  it('keeps the order they were chosen in — that is the order they are read across the grid', () => {
    expect(keepFitting(['cbet_flop', 'threebet'], STATS, ALL).codes).toEqual(['cbet_flop', 'threebet']);
  });
});

describe('groupableDimensions', () => {
  it('offers only what the registry flags as groupable', () => {
    expect(groupableDimensions([...DIMS.values()]).map((d) => d.code)).toEqual(['facing', 'position', 'player_key']);
  });
});

describe('columnProblems', () => {
  it('asks for a stat before a report can run', () => {
    expect(columnProblems([], [])).toEqual(['pick at least one stat to measure']);
  });

  it('stops at the server’s own ceilings rather than collecting a 422', () => {
    const many = Array.from({ length: 41 }, (_, i) => `s${i}`);
    expect(columnProblems(many, [])[0]).toContain('more than the 40');
    expect(columnProblems(['vpip'], ['a', 'b', 'c', 'd', 'e'])[0]).toContain('more than the 4');
  });

  it('is silent on a workable selection', () => {
    expect(columnProblems(['vpip'], ['position'])).toEqual([]);
  });
});

describe('groupByCategory', () => {
  it('reads in the registry’s category order and leaves empty categories out', () => {
    const groups = groupByCategory(STATS);
    expect(groups.map((g) => g.category)).toEqual(['preflop', 'postflop', 'money']);
    expect(groups[0]!.stats.map((s) => s.code)).toEqual(['vpip', 'threebet']);
  });
});
