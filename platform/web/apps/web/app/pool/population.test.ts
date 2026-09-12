import { describe, expect, it, vi } from 'vitest';

import type { ReportRequest } from '../stats/api';
import { lockedToPopulation } from './population';

function shared(over: Partial<{ dataset: 'hero' | 'population'; request: ReportRequest }> = {}) {
  return {
    tables: ['decisions'] as const,
    dataset: over.dataset ?? ('hero' as const),
    load: vi.fn(),
    reportRequest: (extra?: object): ReportRequest => ({ dataset: over.dataset ?? 'hero', hero_only: true, ...over.request, ...extra }),
  };
}

describe('lockedToPopulation', () => {
  it('reads as the population however the shared store is set', () => {
    expect(lockedToPopulation(shared()).dataset.value).toBe('population');
    expect(lockedToPopulation(shared({ dataset: 'population' })).dataset.value).toBe('population');
  });

  it('overrides a hero request on the way out, so a stale store cannot earn a 400', () => {
    const request = lockedToPopulation(shared()).reportRequest();
    expect(request.dataset).toBe('population');
    expect(request.hero_only).toBe(false);
  });

  it('sets the pair together — the engine refuses population beside hero_only', () => {
    const request = lockedToPopulation(shared({ request: { hero_only: true } })).reportRequest();
    expect(request).toMatchObject({ dataset: 'population', hero_only: false });
  });

  it('keeps everything else the shared filter put in the request', () => {
    const filter = shared({ request: { date_from: '2026-01-01', filter: { all: [] } } });
    const request = lockedToPopulation(filter).reportRequest({ stats: ['vpip'] });
    expect(request.date_from).toBe('2026-01-01');
    expect(request.filter).toEqual({ all: [] });
    expect(request.stats).toEqual(['vpip']);
  });

  it('passes the situation’s tables straight through, so the grain rules are unchanged', () => {
    expect(lockedToPopulation(shared()).tables.value).toEqual(['decisions']);
  });

  it('never writes the dataset back into the shared store', () => {
    const filter = shared();
    const access = lockedToPopulation(filter);
    access.reportRequest();
    access.load({} as Parameters<typeof access.load>[0]);
    expect(filter.dataset).toBe('hero');
    expect(filter.load).toHaveBeenCalledOnce();
  });

  /*
   * The regression that motivated the `load` override: `applyRequest` loads the *request's* dataset
   * into the shared store, so opening a pool preset would have switched `/hands` to the population.
   */
  it('keeps the store’s own dataset when a pool document is loaded into it', () => {
    const filter = shared();
    lockedToPopulation(filter).load({ dataset: 'population', dateFrom: '', dateTo: '', clauses: [] } as Parameters<
      ReturnType<typeof lockedToPopulation>['load']
    >[0]);
    expect(filter.load).toHaveBeenCalledWith(expect.objectContaining({ dataset: 'hero' }));
  });

  it('passes the situation and the dates through untouched — those *should* follow you between pages', () => {
    const filter = shared();
    lockedToPopulation(filter).load({
      dataset: 'population',
      dateFrom: '2026-01-01',
      dateTo: '2026-03-31',
      clauses: [{ dim: 'street', op: 'eq', values: ['flop'] }],
    } as Parameters<ReturnType<typeof lockedToPopulation>['load']>[0]);
    expect(filter.load).toHaveBeenCalledWith(
      expect.objectContaining({ dateFrom: '2026-01-01', dateTo: '2026-03-31', clauses: [{ dim: 'street', op: 'eq', values: ['flop'] }] }),
    );
  });

  it('leaves a store already on the population there — the override preserves, it does not force hero', () => {
    const filter = shared({ dataset: 'population' });
    lockedToPopulation(filter).load({ dataset: 'hero', dateFrom: '', dateTo: '', clauses: [] } as Parameters<
      ReturnType<typeof lockedToPopulation>['load']
    >[0]);
    expect(filter.load).toHaveBeenCalledWith(expect.objectContaining({ dataset: 'population' }));
  });
});
