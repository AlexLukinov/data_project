import { describe, expect, it } from 'vitest';

import type { EmptyStateView, IdleFacts, Narrowing, PoolEmptyFacts, PoolIdleFacts, ReportEmptyFacts } from './emptyState';
import { narrowingWords, poolEmptyView, poolIdleView, reportEmptyView, reportIdleView } from './emptyState';

const situation = (over: Partial<Narrowing> = {}): Narrowing => ({ sentence: 'every hand', hasClauses: false, dateFrom: '', dateTo: '', ...over });

function idleFacts(over: Partial<IdleFacts> = {}): IdleFacts {
  return { reportName: null, hasStat: true, canRun: true, ...over };
}

function poolIdleFacts(over: Partial<PoolIdleFacts> = {}): PoolIdleFacts {
  return { ...idleFacts(), cohortLabel: null, storedRule: false, ...over };
}

function reportFacts(over: Partial<ReportEmptyFacts> = {}): ReportEmptyFacts {
  return { ...situation(), dataset: 'hero', rawFilter: false, canRun: true, ...over };
}

function poolFacts(over: Partial<PoolEmptyFacts> = {}): PoolEmptyFacts {
  return { ...situation(), rawFilter: false, cohortLabel: null, storedRule: false, canRun: true, side: 'left', ...over };
}

const keys = (view: EmptyStateView): string[] => view.actions.map((action) => action.key);
const labels = (view: EmptyStateView): string[] => view.actions.map((action) => action.label);

describe('narrowingWords', () => {
  it('is empty when nothing is narrowing anything, so no screen claims a situation it does not have', () => {
    expect(narrowingWords(situation())).toBe('');
    // `filter.sentence` reads "every hand" with no clauses; that is not a narrowing.
    expect(narrowingWords(situation({ sentence: 'every hand' }))).toBe('');
  });

  it('words each date bound the way the box that set it reads', () => {
    expect(narrowingWords(situation({ dateFrom: '2026-01-01', dateTo: '2026-02-01' }))).toBe('played between 2026-01-01 and 2026-02-01');
    expect(narrowingWords(situation({ dateFrom: '2026-01-01' }))).toBe('played on 2026-01-01 or later');
    expect(narrowingWords(situation({ dateTo: '2026-02-01' }))).toBe('played on 2026-02-01 or earlier');
  });

  it('joins the situation, the tag and the dates in the order the page shows them', () => {
    const words = narrowingWords(situation({ sentence: 'Position is one of BTN, CO', hasClauses: true, tag: 'bluff', dateFrom: '2026-01-01' }));
    expect(words).toBe('Position is one of BTN, CO, tagged “bluff” and played on 2026-01-01 or later');
  });
});

describe('reportIdleView — /reports before anything has run', () => {
  it('sends someone with no stat chosen to the picker rather than offering a run that cannot happen', () => {
    const view = reportIdleView(idleFacts({ hasStat: false }));
    expect(view.body).toBe('Nothing has run yet. The stats you pick above become the columns, so choose at least one, then press Run report.');
    expect(view.actions).toEqual([]);
  });

  /* `run()` returns early while a condition is incomplete, and the page's own Run report is
     visibly disabled — so a second one here would answer a click with nothing at all. */
  it('offers no run, and says what to put right first, while the page refuses to run', () => {
    const view = reportIdleView(idleFacts({ reportName: 'Openings by seat', canRun: false }));
    expect(view.actions).toEqual([]);
    expect(view.body).toContain('It cannot run as it stands: put right what the warning above says, then press Run report.');
  });

  it('teaches what the grid is, names the report that is set up, and offers Run report', () => {
    const view = reportIdleView(idleFacts({ reportName: 'Openings by seat' }));
    expect(view.lead).toBe('A report is a grid: one row per group, one column per stat, and the sample each cell counted under it.');
    expect(view.body).toContain('“Openings by seat” is set up.');
    expect(view.body).toContain('a report reads every hand it covers, so it waits until you ask for it');
    expect(labels(view)).toEqual(['Run report']);
  });

  it('names no report when none was opened', () => {
    expect(reportIdleView(idleFacts()).body).toContain('The report above is set up.');
  });
});

describe('poolIdleView — /pool before anything has run', () => {
  it('asks for a stat first, in the same words as /reports', () => {
    expect(poolIdleView(poolIdleFacts({ hasStat: false })).actions).toEqual([]);
    expect(poolIdleView(poolIdleFacts({ hasStat: false })).body).toContain('choose at least one, then press Run report');
  });

  it('says the dataset is the pool and the cohort is what there is to change', () => {
    const view = poolIdleView(poolIdleFacts({ reportName: 'Regs by position' }));
    expect(view.lead).toContain('what the field does');
    expect(view.body).toContain('“Regs by position” is set up over the whole field.');
    expect(view.body).toContain('to count one slice of the players instead of all of them, pick a cohort above');
  });

  /* Both shipped pool reports carry a cohort of their own, and it is sent whenever the picker names
     none — so "the whole field" here contradicted the cohort note beside the picker on the same
     screen. The heading over the grid stopped saying it for the same reason. */
  it('does not claim the whole field when the open report carries a rule of its own', () => {
    const view = poolIdleView(poolIdleFacts({ reportName: 'Regs by position', storedRule: true }));
    expect(view.body).toContain('“Regs by position” is set up over the players this report scopes to.');
    expect(view.body).not.toContain('whole field');
    expect(view.body).toContain('Who is in a cohort is recounted when the daily statistics are next rebuilt');
  });

  it('warns that a chosen cohort is recounted only when the daily statistics are rebuilt', () => {
    const view = poolIdleView(poolIdleFacts({ cohortLabel: 'Regs' }));
    expect(view.body).toContain('set up over “Regs”');
    expect(view.body).toContain('Who is in a cohort is recounted when the daily statistics are next rebuilt');
  });

  it('offers no run while an unresolvable cohort in the link is blocking it', () => {
    const view = poolIdleView(poolIdleFacts({ canRun: false }));
    expect(view.actions).toEqual([]);
    expect(view.body).toContain('put right what the warning above says');
  });
});

describe('reportEmptyView — a report that ran and counted nothing', () => {
  it('says nothing of mine is stored, and that an upload lands in seconds — not that the question was wrong', () => {
    const view = reportEmptyView(reportFacts());
    expect(view.lead).toBe('This report read every hand you have and counted none.');
    expect(view.body).toContain('they are counted here seconds after they land');
    expect(view.body).toContain('the Upload page says when a file had no seat recognised as yours');
    expect(view.actions).toEqual([{ key: 'upload', label: 'Upload hand histories', to: '/upload' }]);
  });

  it('says what a pool hand is when the pool is the empty one', () => {
    const view = reportEmptyView(reportFacts({ dataset: 'population' }));
    expect(view.lead).toBe('This report read every hand in the pool and counted none.');
    expect(view.body).toContain('Pool hands are the tables you observed rather than played.');
    expect(labels(view)).toEqual(['Upload hand histories', 'Look in My hands']);
  });

  it('names what narrowed it and offers only the widenings that apply', () => {
    const view = reportEmptyView(reportFacts({ sentence: 'Street is flop', hasClauses: true, dateFrom: '2026-01-01' }));
    expect(view.lead).toBe('None of your hands match Street is flop and played on 2026-01-01 or later.');
    expect(keys(view)).toEqual(['clear-situation', 'clear-dates', 'other-dataset', 'run']);
    expect(labels(view)).toContain('Look in the pool');
  });

  it('offers no situation to clear when only the dates narrow it', () => {
    const view = reportEmptyView(reportFacts({ dateTo: '2026-02-01' }));
    expect(view.lead).toBe('None of your hands match played on 2026-02-01 or earlier.');
    expect(keys(view)).toEqual(['clear-dates', 'other-dataset', 'run']);
  });

  it('sends a pool report back to My hands rather than to the pool it is already reading', () => {
    const view = reportEmptyView(reportFacts({ dataset: 'population', sentence: 'Street is river', hasClauses: true }));
    expect(view.lead).toBe('No hand in the pool matches Street is river.');
    expect(view.body).toContain('ask the same question of your own hands');
    expect(labels(view)).toContain('Look in My hands');
  });

  it('never offers to clear a stored situation it cannot clear, and says where a wider one comes from', () => {
    const view = reportEmptyView(reportFacts({ rawFilter: true, sentence: 'Street is flop', hasClauses: true, dateFrom: '2026-01-01' }));
    expect(view.lead).toBe('None of your hands match the situation this report has stored.');
    expect(view.body).toContain('Open another report above to ask something wider.');
    expect(keys(view)).toEqual(['clear-dates', 'other-dataset', 'run']);
  });

  /* The widenings stay — clearing the condition is what unblocks the run — but Run again goes:
     `run()` refuses it, so it would be a button that answers a click with nothing. */
  it('drops Run again while the page refuses to run, and says what to put right first', () => {
    const view = reportEmptyView(reportFacts({ sentence: 'Street is flop', hasClauses: true, canRun: false }));
    expect(keys(view)).toEqual(['clear-situation', 'other-dataset']);
    expect(view.body).toContain('It cannot be run again as it stands: put right what the warning above says first.');
  });
});

describe('poolEmptyView — a pool grid that ran and counted nothing', () => {
  it('says the pool itself is empty when nothing narrows it and no cohort is chosen', () => {
    const view = poolEmptyView(poolFacts());
    expect(view.lead).toBe('This report read every hand in the pool and counted none.');
    expect(view.body).toContain('mark them Pool hands');
    expect(keys(view)).toEqual(['upload']);
  });

  it('blames the cohort, not the pool, when a cohort holds nobody with hands', () => {
    const view = poolEmptyView(poolFacts({ cohortLabel: 'Regs' }));
    expect(view.lead).toBe('No player in “Regs” has a hand here to count.');
    expect(view.body).toContain('Who is in a cohort is recounted when the daily statistics are next rebuilt');
    expect(view.body).toContain('Measure the whole field to see what the pool holds at all.');
    expect(labels(view)).toEqual(['Measure the whole field', 'Upload hand histories']);
  });

  it('names the cohort and the situation together, and offers the whole field as the wider question', () => {
    const view = poolEmptyView(poolFacts({ cohortLabel: 'Regs', sentence: 'Street is turn', hasClauses: true }));
    expect(view.lead).toBe('No hand from the players in “Regs” matches Street is turn.');
    expect(view.body).toContain('Drop one and run the report again.');
    expect(view.body).toContain('Who is in a cohort is recounted');
    expect(keys(view)).toEqual(['clear-situation', 'whole-field', 'run']);
  });

  it('points a stored situation at the reports above, and leaves the rebuild note out with no cohort', () => {
    const view = poolEmptyView(poolFacts({ rawFilter: true, hasClauses: true, sentence: 'Street is flop' }));
    expect(view.lead).toBe('No hand in the pool matches the situation this report has stored.');
    expect(view.body).toBe('That situation uses a condition the filter bar cannot show, so it cannot be widened here. Pick another report above to ask something wider.');
    expect(keys(view)).toEqual(['run']);
  });

  /* A report carrying its own cohort counts a slice of the field, so "every hand in the pool" and
     "upload some" were both false: the pool can be full and this grid still empty. */
  it('blames the report’s own rule, not an empty pool, when that rule is what scoped the grid', () => {
    const view = poolEmptyView(poolFacts({ storedRule: true }));
    expect(view.lead).toBe('No player this report scopes to has a hand here to count.');
    expect(view.body).toContain('choosing a cohort under “Which players” replaces it');
    expect(keys(view)).toEqual(['upload']);
  });

  it('names the report’s own rule in the lead when a situation narrowed it too', () => {
    const view = poolEmptyView(poolFacts({ storedRule: true, hasClauses: true, sentence: 'Street is turn' }));
    expect(view.lead).toBe('No hand from the players this report scopes to matches Street is turn.');
    expect(view.body).toContain('Who is in a cohort is recounted');
    /* Nothing to widen to: the whole field is not reachable by clearing a cohort nobody picked. */
    expect(keys(view)).not.toContain('whole-field');
  });

  /* The button cleared the *left* grid's cohort wherever it was pressed, and the picker's "against"
     has no whole field to offer — so the right-hand grid says what its own select can do instead. */
  it('does not offer the whole field under the second grid, and names the select that can change it', () => {
    const view = poolEmptyView(poolFacts({ cohortLabel: 'Fish', side: 'right' }));
    expect(keys(view)).toEqual(['upload']);
    expect(view.body).toContain('set “against” back to “nothing — one grid”');
    expect(view.body).not.toContain('Measure the whole field');
  });

  it('offers the whole field on the narrowed left grid only, where the button does what it says', () => {
    const narrowed = { cohortLabel: 'Regs', hasClauses: true, sentence: 'Street is turn' };
    expect(keys(poolEmptyView(poolFacts({ ...narrowed, side: 'right' })))).toEqual(['clear-situation', 'run']);
    expect(keys(poolEmptyView(poolFacts(narrowed)))).toEqual(['clear-situation', 'whole-field', 'run']);
  });

  it('drops Run again while the page refuses to run', () => {
    const view = poolEmptyView(poolFacts({ cohortLabel: 'Regs', hasClauses: true, sentence: 'Street is turn', canRun: false }));
    expect(keys(view)).toEqual(['clear-situation', 'whole-field']);
    expect(view.body).toContain('It cannot be run again as it stands');
  });
});
