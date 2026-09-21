import { describe, expect, it } from 'vitest';

import type { EmptyStateView } from '../reports/emptyState';
import type { HandsEmptyFacts } from './emptyState';
import { handsEmptyView } from './emptyState';

function facts(over: Partial<HandsEmptyFacts> = {}): HandsEmptyFacts {
  return { dataset: 'hero', sentence: 'every hand', hasClauses: false, dateFrom: '', dateTo: '', tag: '', ...over };
}

const keys = (view: EmptyStateView): string[] => view.actions.map((action) => action.key);
const labels = (view: EmptyStateView): string[] => view.actions.map((action) => action.label);

describe('handsEmptyView — My hands', () => {
  it('says what the list holds and both ways a hand gets into it, rather than "No hands match"', () => {
    const view = handsEmptyView(facts());
    expect(view.lead).toBe('Every hand you upload is listed here, newest first; open one to step through it.');
    expect(view.body).toContain('they appear here seconds after they land');
    expect(view.body).toContain('to read one hand without storing it, paste it instead');
    expect(view.actions).toEqual([
      { key: 'upload', label: 'Upload hand histories', to: '/upload' },
      { key: 'paste', label: 'Paste a hand', to: '/hands/paste' },
    ]);
  });

  it('answers "uploaded already and still nothing" with the warning the Upload page actually shows', () => {
    // `upload/status.ts` words `hands_without_hero` there (ADR-051), so this points at a real line.
    expect(handsEmptyView(facts()).body).toContain('the Upload page says when a file had no seat recognised as yours');
  });

  it('names every narrowing it found and offers exactly the ones that can be let go of', () => {
    const view = handsEmptyView(facts({ sentence: 'Position is one of BTN, CO', hasClauses: true, tag: 'bluff', dateFrom: '2026-01-01', dateTo: '2026-02-01' }));
    expect(view.lead).toBe('None of your hands match Position is one of BTN, CO, tagged “bluff” and played between 2026-01-01 and 2026-02-01.');
    expect(keys(view)).toEqual(['clear-situation', 'clear-dates', 'clear-tag', 'other-dataset']);
    expect(labels(view)).toContain('Look in the pool');
  });

  it('offers no situation to clear when a tag alone emptied the list', () => {
    const view = handsEmptyView(facts({ tag: 'river-bluff' }));
    expect(view.lead).toBe('None of your hands match tagged “river-bluff”.');
    expect(keys(view)).toEqual(['clear-tag', 'other-dataset']);
  });
});

describe('handsEmptyView — the pool', () => {
  it('says what a pool hand is and how one gets stored, and does not offer to paste one', () => {
    const view = handsEmptyView(facts({ dataset: 'population' }));
    expect(view.lead).toBe('The hands from tables you observed are listed here — every seat at them, not only yours.');
    expect(view.body).toBe('No pool hands are stored yet. Upload the hand histories of the tables you observed on the Upload page and mark them Pool hands.');
    expect(labels(view)).toEqual(['Upload hand histories', 'Look in My hands']);
  });

  it('sends a narrowed pool list back to My hands, never to the pool it is already reading', () => {
    const view = handsEmptyView(facts({ dataset: 'population', sentence: 'Street is river', hasClauses: true }));
    expect(view.lead).toBe('No hand in the pool matches Street is river.');
    expect(view.body).toContain('look for the same situation in your own hands');
    expect(keys(view)).toEqual(['clear-situation', 'other-dataset']);
    expect(labels(view)).toContain('Look in My hands');
  });
});
