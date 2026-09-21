import { describe, expect, it } from 'vitest';

import { bestRoute, fit, linkFor, routeParts } from './match';

const ROUTES = ['/', '/pool', '/pool/cohorts', '/hands', '/hands/[id]', '/reports/[[id]]', '/ranges', '/ranges/import', '/ranges/[id]'];

describe('routeParts', () => {
  it('reads a literal, a required parameter and an optional one', () => {
    expect(routeParts('/reports/[[id]]')).toEqual([
      { literal: 'reports', param: false, optional: false },
      { literal: '[[id]]', param: true, optional: true },
    ]);
    expect(routeParts('/hands/[id]')[1]).toEqual({ literal: '[id]', param: true, optional: false });
  });
});

describe('fit', () => {
  it('counts the literal segments a pattern matched', () => {
    expect(fit('/pool/cohorts', '/pool/cohorts')).toBe(2);
    expect(fit('/hands/[id]', '/hands/abc')).toBe(1);
    expect(fit('/', '/')).toBe(0);
  });

  it('refuses a path of the wrong shape', () => {
    expect(fit('/', '/hands')).toBe(-1);
    expect(fit('/hands/[id]', '/hands')).toBe(-1);
    expect(fit('/pool', '/pool/cohorts')).toBe(-1);
    expect(fit('/pool/cohorts', '/pool/players')).toBe(-1);
  });

  it('lets an optional last segment be left out', () => {
    expect(fit('/reports/[[id]]', '/reports')).toBe(1);
    expect(fit('/reports/[[id]]', '/reports/abc')).toBe(1);
  });
});

describe('linkFor', () => {
  it('sends a row’s route to the list it is a row of, and leaves a real address alone', () => {
    expect(linkFor('/hands/[id]')).toBe('/hands');
    expect(linkFor('/reports/[[id]]')).toBe('/reports');
    expect(linkFor('/pool/cohorts')).toBe('/pool/cohorts');
    expect(linkFor('/')).toBe('/');
  });
});

describe('bestRoute', () => {
  it('prefers the literal over the parameter of the same shape', () => {
    expect(bestRoute(ROUTES, '/ranges/import')).toBe('/ranges/import');
    expect(bestRoute(ROUTES, '/ranges/xyz')).toBe('/ranges/[id]');
  });

  it('tells a list from one of its rows', () => {
    expect(bestRoute(ROUTES, '/hands')).toBe('/hands');
    expect(bestRoute(ROUTES, '/hands/9f2')).toBe('/hands/[id]');
  });

  it('answers the root only for the root', () => {
    expect(bestRoute(ROUTES, '/')).toBe('/');
    expect(bestRoute(ROUTES, '')).toBe('/');
  });

  it('answers null for a path no route claims', () => {
    expect(bestRoute(ROUTES, '/login')).toBeNull();
    expect(bestRoute(ROUTES, '/dev/components')).toBeNull();
    expect(bestRoute(ROUTES, '/pool/cohorts/extra')).toBeNull();
  });
});
