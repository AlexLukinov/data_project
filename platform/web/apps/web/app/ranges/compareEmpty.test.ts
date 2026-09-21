import { describe, expect, it } from 'vitest';

import { LIBRARY_EMPTY, POOL_THIN, POOL_UNASKED, compareEmptyView, tier3Problem } from './compareEmpty';

const online = { situation: 'UTG open · 100bb · 6-max', offline: false } as const;

describe('a library column with nothing to draw', () => {
  it('does not offer an import the API cannot take, and says the offline copy is what answered', () => {
    const view = compareEmptyView({ ...online, source: 'own', offline: true });
    expect(view.actions).toEqual([]);
    expect(view.body).toContain("this browser's offline copy");
    expect(view.body).toContain('the API did not answer');
  });

  it('says the same of the solver column, since one lookup answers both', () => {
    const view = compareEmptyView({ ...online, source: 'solver', offline: true });
    expect(view.actions).toEqual([]);
    expect(view.body).toContain('offline copy');
    expect(view.body).not.toContain('GTO Wizard');
  });

  it('names the situation it looked for and what has to match before a chart counts as it', () => {
    const view = compareEmptyView({ ...online, source: 'own' });
    expect(view.lead).toBe('Your own chart for UTG open · 100bb · 6-max would be drawn here.');
    expect(view.body).toContain('every step of the action');
    expect(view.body).toContain('what the field does with it');
    expect(view.actions).toEqual([{ key: 'import', label: 'Import a folder', to: '/ranges/import' }]);
  });

  it('tells the solver column where a solver range comes from and what to mark it', () => {
    const view = compareEmptyView({ ...online, source: 'solver' });
    expect(view.lead).toContain("A solver's range for UTG open");
    expect(view.body).toContain('Import ranges page');
    expect(view.body).toContain('source for all');
    expect(view.actions[0]?.to).toBe('/ranges/import');
  });

  /** The select alone binds a draft; `applyBatch` is what puts it on the rows (import.vue:150). */
  it('names the button that actually marks the rows, not just the box above them', () => {
    expect(compareEmptyView({ ...online, source: 'solver' }).body).toContain('press Apply to all');
  });
});

describe('the pool column and the library picker', () => {
  it('turns "insufficient data" into the two things that widen the question', () => {
    expect(POOL_THIN).toContain('stake');
    expect(POOL_THIN).toContain('texture');
  });

  it('keeps "not asked" apart from "asked and had nothing"', () => {
    expect(POOL_UNASKED).toContain('has not been asked');
    expect(POOL_UNASKED).not.toContain('enough');
  });

  it('offers the import from an empty library rather than an empty picker', () => {
    expect(LIBRARY_EMPTY.actions).toEqual([{ key: 'import', label: 'Import a folder', to: '/ranges/import' }]);
    expect(LIBRARY_EMPTY.lead).toContain('empty');
  });
});

describe('a failed reconstruction', () => {
  it('keeps the reason and says what the Pool column is showing instead', () => {
    const said = tier3Problem('The API did not answer.', true);
    expect(said).toContain('The API did not answer.');
    expect(said).toContain('Pool column');
    expect(said).toContain('showed down');
  });

  /**
   * The failure path first: under one quota refusal the showdown call falls with the estimate, so
   * the Pool column is an error of its own and there is no range for this sentence to point at.
   * The old wording promised one anyway — this expectation is new, not a loosened one.
   */
  it('does not promise a showdown range when none is drawn', () => {
    const said = tier3Problem('The API did not answer.', false);
    expect(said).toContain('The API did not answer.');
    expect(said).not.toContain('Pool column');
    expect(said).not.toContain('showed down');
  });
});
