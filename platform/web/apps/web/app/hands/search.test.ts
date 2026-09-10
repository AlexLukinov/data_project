import { describe, expect, it } from 'vitest';

import { searchBody, situationFilter, situationLabel } from './search';

describe('situationFilter', () => {
  it('is null when nothing is chosen, so the plain list is used instead', () => {
    expect(situationFilter({})).toBeNull();
    expect(situationFilter({ street: '', position: '' })).toBeNull();
  });

  it('builds the registry filter tree the report engine takes', () => {
    expect(situationFilter({ street: 'flop', action: 'bet' })).toEqual({
      all: [
        { dim: 'action', op: 'eq', value: 'bet' },
        { dim: 'street', op: 'eq', value: 'flop' },
      ],
    });
  });
});

describe('situationLabel', () => {
  it('says what the list is showing', () => {
    expect(situationLabel({})).toBe('every hand');
    expect(situationLabel({ street: 'flop', position: 'BTN', facing: '5bet_plus' })).toBe('on the flop from BTN facing 5bet+');
    expect(situationLabel({ street: 'flop', action: 'bet' })).toBe('bet on the flop');
  });
});

describe('searchBody', () => {
  it('never asks for a hero seat on the pool, which has none', () => {
    expect(searchBody({ street: 'turn' }, 'population', 50)).toEqual({
      dataset: 'population',
      hero_only: false,
      filter: { all: [{ dim: 'street', op: 'eq', value: 'turn' }] },
      limit: 50,
    });
  });

  it('sends no filter field at all when no situation is chosen', () => {
    // An empty object is a malformed leaf to the engine, not "everything".
    expect(searchBody({}, 'hero', 10)).toEqual({ dataset: 'hero', hero_only: true, limit: 10 });
  });
});
