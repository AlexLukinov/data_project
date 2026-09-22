import { describe, expect, it } from 'vitest';
import { ref } from 'vue';

import type { Dimension } from '../stats/api';
import { createFilterModel } from './model';
import { fromQuery } from './url';

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

const STREET = dim({ code: 'street', type: 'enum', label: 'Street', values: ['preflop', 'flop'], allowed_ops: ['eq', 'in'] });
const POSITION = dim({ code: 'position', type: 'enum', label: 'Position', tables: ['decisions', 'player_hands'], values: ['BTN', 'CO'], allowed_ops: ['eq', 'in'] });
const SPR = dim({ code: 'spr', type: 'number', label: 'SPR', buckets: { '1-3': [1, 3] }, allowed_ops: ['between', 'gte'] });

function model(dimensions: Dimension[] = [STREET, POSITION, SPR]) {
  return createFilterModel(ref(new Map(dimensions.map((d) => [d.code, d]))));
}

describe('the shared filter', () => {
  it('starts as every hand on the hero dataset', () => {
    const filter = model();
    expect(filter.node.value).toEqual({ all: [] });
    expect(filter.active.value).toBe(false);
    expect(filter.sentence.value).toBe('every hand');
    expect(filter.query.value).toEqual({});
  });

  it('adds, edits and removes conditions', () => {
    const filter = model();
    filter.add(STREET);
    expect(filter.clauses.value).toEqual([{ dim: 'street', op: 'eq', values: ['preflop'] }]);
    filter.replace(0, { dim: 'street', op: 'eq', values: ['flop'] });
    expect(filter.node.value).toEqual({ all: [{ dim: 'street', op: 'eq', value: 'flop' }] });
    expect(filter.active.value).toBe(true);
    filter.add(POSITION);
    expect(filter.clauses.value).toHaveLength(2);
    filter.remove(0);
    expect(filter.clauses.value.map((c) => c.dim)).toEqual(['position']);
    filter.clear();
    expect(filter.clauses.value).toEqual([]);
  });

  it('words the situation from the registry labels', () => {
    const filter = model();
    filter.add(STREET);
    filter.replace(0, { dim: 'street', op: 'eq', values: ['flop'] });
    filter.add(POSITION);
    filter.replace(1, { dim: 'position', op: 'in', values: ['BTN', 'CO'] });
    expect(filter.sentence.value).toBe('Street is flop · Position is one of BTN, CO');
  });

  it('reports the problem rather than sending a clause the engine would refuse', () => {
    const filter = model();
    filter.add(SPR);
    filter.replace(0, { dim: 'spr', op: 'between', values: ['1'] });
    expect(filter.problems.value).toEqual(['SPR needs a low and a high']);
    expect(filter.node.value).toEqual({ all: [] });
  });

  it('narrows the tables a situation can be answered on', () => {
    const filter = model();
    filter.add(POSITION);
    expect(filter.tables.value).toEqual(['decisions', 'player_hands']);
    filter.add(STREET);
    expect(filter.tables.value).toEqual(['decisions']);
  });
});

describe('the report request', () => {
  it('pairs the population dataset with hero_only false, which the server validates together', () => {
    const filter = model();
    expect(filter.reportRequest()).toEqual({ dataset: 'hero', hero_only: true, filter: { all: [] } });
    filter.dataset.value = 'population';
    expect(filter.reportRequest()).toEqual({ dataset: 'population', hero_only: false, filter: { all: [] } });
  });

  it('omits an empty date bound rather than sending an empty string', () => {
    const filter = model();
    filter.dateFrom.value = '2026-01-01';
    expect(filter.reportRequest()).toEqual({
      dataset: 'hero',
      hero_only: true,
      date_from: '2026-01-01',
      filter: { all: [] },
    });
  });

  it('carries the caller-supplied stats and group-by through untouched', () => {
    const filter = model();
    const request = filter.reportRequest({ stats: ['vpip'], group_by: ['position'] });
    expect(request.stats).toEqual(['vpip']);
    expect(request.group_by).toEqual(['position']);
  });
});

describe('loading a state', () => {
  it('round-trips through the query the model itself produced', () => {
    const filter = model();
    filter.dataset.value = 'population';
    filter.dateFrom.value = '2026-02-03';
    filter.add(STREET);
    filter.add(SPR);
    const query = filter.query.value;

    const reopened = model();
    reopened.load(fromQuery(query));
    expect(reopened.dataset.value).toBe('population');
    expect(reopened.dateFrom.value).toBe('2026-02-03');
    expect(reopened.clauses.value).toEqual(filter.clauses.value);
    expect(reopened.node.value).toEqual(filter.node.value);
    expect(reopened.query.value).toEqual(query);
  });

  it('copies the clauses it is given, so the source can go on changing', () => {
    const filter = model();
    const state = fromQuery({ f: 'street:eq:flop' });
    filter.load(state);
    state.clauses[0]!.values[0] = 'turn';
    expect(filter.clauses.value[0]!.values).toEqual(['flop']);
  });
});
