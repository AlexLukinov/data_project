import { describe, expect, it } from 'vitest';
import { computed, ref } from 'vue';

import { createFilterModel } from '../filter/model';
import type { Dataset, Dimension, ReportRequest, Stat } from '../stats/api';
import type { FilterAccess } from './model';
import { createColumnsModel } from './model';

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

function stat(code: string, grain: Stat['grain']): Stat {
  return { code, label: code.toUpperCase(), category: 'preflop', grain, format: 'percent' } as Stat;
}

const FACING = dim({ code: 'facing', type: 'enum', values: ['bet', 'raise'], allowed_ops: ['eq', 'in'] });
const POSITION = dim({ code: 'position', type: 'enum', tables: ['decisions', 'player_hands', 'stats_daily'], values: ['SB', 'BB', 'BTN'], allowed_ops: ['eq', 'in'] });
const STACK = dim({ code: 'eff_stack_bb', type: 'number', tables: ['decisions', 'player_hands'], buckets: { '40-75': [40, 75] }, allowed_ops: ['gte', 'lt'] });

const DIMS = new Map([FACING, POSITION, STACK].map((d) => [d.code, d]));
const STATS = [stat('hands', 'hand'), stat('vpip', 'hand'), stat('threebet', 'decision'), stat('cbet_flop', 'decision')];

/** The real shared filter behind the seam, so the two halves are tested as they ship. */
function build() {
  const dims = ref(DIMS);
  const filter = createFilterModel(dims);
  const access: FilterAccess = {
    tables: computed(() => filter.tables.value),
    dataset: computed(() => filter.dataset.value),
    load: (state) => filter.load(state),
    reportRequest: (extra) => filter.reportRequest(extra),
  };
  const columns = createColumnsModel(computed(() => DIMS as ReadonlyMap<string, Dimension>), ref(STATS), access);
  return { filter, columns };
}

describe('the columns a report measures with', () => {
  it('starts empty and says a stat is needed', () => {
    const { columns } = build();
    expect(columns.stats.value).toEqual([]);
    expect(columns.problems.value).toEqual(['pick at least one stat to measure']);
  });

  it('toggles a stat on and off, keeping the order it was chosen in', () => {
    const { columns } = build();
    columns.toggleStat('vpip');
    columns.toggleStat('threebet');
    expect(columns.stats.value).toEqual(['vpip', 'threebet']);
    columns.toggleStat('vpip');
    expect(columns.stats.value).toEqual(['threebet']);
  });
});

describe('the grain trap, closed on both halves', () => {
  it('drops a hand-grain stat when the FILTER moves under it', () => {
    const { filter, columns } = build();
    columns.toggleStat('vpip');
    expect(columns.request().stats).toEqual(['vpip']);
    filter.add(FACING);
    expect(columns.tables.value).toEqual(['decisions']);
    expect(columns.dropped.value).toEqual(['VPIP']);
    expect(columns.request().stats).toEqual([]);
  });

  it('drops a hand-grain stat when the GROUP-BY moves under it — the half D.3 did not cover', () => {
    const { columns } = build();
    columns.toggleStat('vpip');
    columns.setGroupBy(['facing']);
    expect(columns.tables.value).toEqual(['decisions']);
    expect(columns.dropped.value).toEqual(['VPIP']);
    expect(columns.usable.value.map((s) => s.code)).toEqual(['threebet', 'cbet_flop']);
  });

  it('keeps everything when the grouping is on every table', () => {
    const { columns } = build();
    columns.toggleStat('vpip');
    columns.toggleStat('threebet');
    columns.setGroupBy(['position']);
    expect(columns.dropped.value).toEqual([]);
    expect(columns.request().stats).toEqual(['vpip', 'threebet']);
  });
});

describe('the baseline and the cohort are enforced as pairs, not discovered as 422s', () => {
  it('sends a baseline on the hero dataset', () => {
    const { columns } = build();
    columns.toggleStat('vpip');
    columns.compare.value = true;
    expect(columns.compareOn.value).toBe(true);
    expect(columns.request().compare_to).toBe('population');
  });

  it('holds the baseline back on the pool, where there is no hero seat to compare', () => {
    const { filter, columns } = build();
    columns.toggleStat('vpip');
    columns.compare.value = true;
    filter.dataset.value = 'population';
    expect(columns.compareOn.value).toBe(false);
    expect(columns.request().compare_to).toBeUndefined();
    expect(columns.request().hero_only).toBe(false);
  });

  it('remembers the baseline rather than forgetting it, so switching back restores it', () => {
    const { filter, columns } = build();
    columns.compare.value = true;
    filter.dataset.value = 'population';
    filter.dataset.value = 'hero';
    expect(columns.compareOn.value).toBe(true);
  });

  it('sends a cohort on a pool report', () => {
    const { filter, columns } = build();
    columns.toggleStat('vpip');
    filter.dataset.value = 'population';
    columns.cohort.value = { rules: [{ stat: 'vpip', op: 'lt', value: 25 }] };
    expect(columns.cohortOn.value).toBe(true);
    expect(columns.request().cohort).toEqual({ rules: [{ stat: 'vpip', op: 'lt', value: 25 }] });
  });

  it('sends a cohort on a hero report only alongside the baseline it scopes', () => {
    const { columns } = build();
    columns.toggleStat('vpip');
    columns.cohort.value = { rules: [{ stat: 'vpip', op: 'lt', value: 25 }] };
    expect(columns.cohortOn.value).toBe(false);
    expect(columns.request().cohort).toBeUndefined();
    columns.compare.value = true;
    expect(columns.cohortOn.value).toBe(true);
    expect(columns.request().cohort).not.toBeUndefined();
  });
});

describe('opening a stored document', () => {
  const PRESET: ReportRequest = {
    dataset: 'hero',
    hero_only: true,
    filter: { dim: 'position', op: 'in', value: ['SB', 'BB'] },
    group_by: ['position'],
    stats: ['vpip', 'threebet'],
    compare_to: 'population',
    limit: 500,
  };

  it('puts the situation into the builder and the columns here', () => {
    const { filter, columns } = build();
    columns.apply(PRESET);
    expect(filter.clauses.value).toEqual([{ dim: 'position', op: 'in', values: ['SB', 'BB'] }]);
    expect(filter.sentence.value).toBe('position is one of SB, BB');
    expect(columns.stats.value).toEqual(['vpip', 'threebet']);
    expect(columns.groupBy.value).toEqual(['position']);
    expect(columns.compare.value).toBe(true);
    expect(columns.editable.value).toBe(true);
  });

  it('asks the same question it was given', () => {
    const { columns } = build();
    columns.apply(PRESET);
    const body = columns.request();
    expect(body.filter).toEqual({ all: [{ dim: 'position', op: 'in', value: ['SB', 'BB'] }] });
    expect(body.stats).toEqual(['vpip', 'threebet']);
    expect(body.group_by).toEqual(['position']);
    expect(body.compare_to).toBe('population');
  });

  it('names the bucket a stored half-open pair came from', () => {
    const { filter, columns } = build();
    columns.apply({
      stats: ['vpip'],
      filter: { all: [{ dim: 'eff_stack_bb', op: 'gte', value: 40 }, { dim: 'eff_stack_bb', op: 'lt', value: 75 }] },
    });
    expect(filter.clauses.value).toEqual([{ dim: 'eff_stack_bb', op: 'bucket', values: ['40-75'] }]);
  });

  it('keeps a situation the builder cannot express, and says so instead of simplifying it', () => {
    const { filter, columns } = build();
    const any = { any: [{ dim: 'position', op: 'eq' as const, value: 'SB' }, { dim: 'position', op: 'eq' as const, value: 'BB' }] };
    columns.apply({ stats: ['vpip'], filter: any });
    expect(columns.editable.value).toBe(false);
    expect(filter.clauses.value).toEqual([]);
    /* The point: the report still asks what it was stored asking. */
    expect(columns.request().filter).toEqual(any);
  });

  it('carries the fields it does not edit — a named player, inline stats, a limit', () => {
    const { columns } = build();
    columns.apply({ dataset: 'population', hero_only: false, stats: ['threebet'], player_key: 'abc', limit: 50 });
    const body = columns.request();
    expect(body.player_key).toBe('abc');
    expect(body.limit).toBe(50);
  });

  it('resets a previously raw filter when a plain document is opened over it', () => {
    const { columns } = build();
    columns.apply({ stats: ['vpip'], filter: { not: { dim: 'position', op: 'eq', value: 'SB' } } });
    expect(columns.editable.value).toBe(false);
    columns.apply(PRESET);
    expect(columns.editable.value).toBe(true);
    expect(columns.request().filter).toEqual({ all: [{ dim: 'position', op: 'in', value: ['SB', 'BB'] }] });
  });
});

describe('the URL half', () => {
  it('round-trips through its own query', () => {
    const { columns } = build();
    columns.apply({ stats: ['vpip', 'threebet'], group_by: ['position'], compare_to: 'population' });
    columns.minN.value = 300;
    const query = columns.query.value;
    expect(query).toEqual({ s: 'vpip,threebet', by: 'position', cmp: 'population', min: '300' });

    const reopened = build();
    reopened.columns.load({ stats: ['vpip', 'threebet'], groupBy: ['position'], compare: true, cohort: null, minN: 300 });
    expect(reopened.columns.query.value).toEqual(query);
  });
});

describe('the dataset pairing the server validates together', () => {
  it('tracks hero_only, whichever dataset a stored report named', () => {
    const { columns } = build();
    const datasets: Dataset[] = ['hero', 'population'];
    for (const dataset of datasets) {
      columns.apply({ dataset, hero_only: dataset === 'hero', stats: ['threebet'] });
      const body = columns.request();
      expect(body.dataset).toBe(dataset);
      expect(body.hero_only).toBe(dataset === 'hero');
    }
  });
});
