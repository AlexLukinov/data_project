import { describe, expect, it } from 'vitest';

import { MIN_N } from './cell';
import type { ColumnsState } from './url';
import { DEFAULT_COLUMNS, columnsFromQuery, columnsToQuery, sameColumnsQuery } from './url';

function state(over: Partial<ColumnsState> = {}): ColumnsState {
  return { ...DEFAULT_COLUMNS, ...over };
}

describe('columnsToQuery', () => {
  it('says nothing when nothing differs from the default', () => {
    expect(columnsToQuery(state())).toEqual({});
  });

  it('writes the stats in the order they are read across the grid', () => {
    expect(columnsToQuery(state({ stats: ['cbet_flop', 'fold_to_cbet_flop'] })).s).toBe('cbet_flop,fold_to_cbet_flop');
  });

  it('writes the group-by outermost first', () => {
    expect(columnsToQuery(state({ groupBy: ['position', 'pot_type'] })).by).toBe('position,pot_type');
  });

  it('writes the baseline and the cohort that scopes it', () => {
    const query = columnsToQuery(
      state({ compare: true, cohort: { rules: [{ stat: 'vpip', op: 'lt', value: 25 }, { stat: 'hands', op: 'gte', value: 1000 }] } }),
    );
    expect(query.cmp).toBe('population');
    expect(query.coh).toBe('vpip:lt:25,hands:gte:1000');
  });

  it('writes the threshold only when it is not the default, because it changes what is greyed', () => {
    expect(columnsToQuery(state({ minN: MIN_N })).min).toBeUndefined();
    expect(columnsToQuery(state({ minN: 300 })).min).toBe('300');
    expect(columnsToQuery(state({ minN: 0 })).min).toBe('0');
  });
});

describe('columnsFromQuery', () => {
  it('reads back what it wrote', () => {
    const original = state({
      stats: ['vpip', 'pfr'],
      groupBy: ['position'],
      compare: true,
      cohort: { rules: [{ stat: 'vpip', op: 'lt', value: 25 }] },
      minN: 300,
    });
    expect(columnsFromQuery(columnsToQuery(original))).toEqual(original);
  });

  it('falls back to the default on an empty query', () => {
    expect(columnsFromQuery({})).toEqual(DEFAULT_COLUMNS);
  });

  it('takes the first value of a repeated parameter, as Vue Router hands it over', () => {
    expect(columnsFromQuery({ s: ['vpip', 'pfr'] }).stats).toEqual(['vpip']);
  });

  it('drops a segment that is not a code rather than sending it for the server to reject', () => {
    expect(columnsFromQuery({ s: 'vpip,DROP TABLE,pfr' }).stats).toEqual(['vpip', 'pfr']);
  });

  it('compares only against the field — nothing else is a baseline', () => {
    expect(columnsFromQuery({ cmp: 'population' }).compare).toBe(true);
    expect(columnsFromQuery({ cmp: 'regs' }).compare).toBe(false);
  });

  it('voids the whole cohort when one rule is unreadable', () => {
    /* A report over "regs" minus one criterion is a different report under the same name. */
    expect(columnsFromQuery({ coh: 'vpip:lt:25,hands:BETWEEN:1000' }).cohort).toBeNull();
    expect(columnsFromQuery({ coh: 'vpip:lt:notanumber' }).cohort).toBeNull();
    expect(columnsFromQuery({ coh: 'vpip:lt' }).cohort).toBeNull();
    expect(columnsFromQuery({ coh: 'vpip:lt:25:30' }).cohort).toBeNull();
  });

  it('reads a well-formed cohort', () => {
    expect(columnsFromQuery({ coh: 'vpip:gte:35,hands:gte:200' }).cohort).toEqual({
      rules: [{ stat: 'vpip', op: 'gte', value: 35 }, { stat: 'hands', op: 'gte', value: 200 }],
    });
  });

  it('ignores a threshold that would grey everything or nothing by accident', () => {
    expect(columnsFromQuery({ min: '-5' }).minN).toBe(MIN_N);
    expect(columnsFromQuery({ min: 'lots' }).minN).toBe(MIN_N);
    expect(columnsFromQuery({ min: '2.5' }).minN).toBe(MIN_N);
    expect(columnsFromQuery({ min: '0' }).minN).toBe(0);
  });
});

describe('sameColumnsQuery', () => {
  it('is what stops a URL write from looping', () => {
    const query = columnsToQuery(state({ stats: ['vpip'], minN: 300 }));
    expect(sameColumnsQuery(query, { ...query, ds: 'population' })).toBe(true);
    expect(sameColumnsQuery(query, { ...query, s: 'pfr' })).toBe(false);
    expect(sameColumnsQuery(query, {})).toBe(false);
  });
});
