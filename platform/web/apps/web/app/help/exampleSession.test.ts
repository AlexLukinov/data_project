import { describe, expect, it } from 'vitest';

import type { Prediction } from '~/analyze/api';
import { workPatch } from '~/analyze/context';

import { createExampleSession } from './exampleSession';
import { EXAMPLE_OPENS_AT, exampleById } from './examples';

const EXAMPLE = exampleById('top-pair-dry-board')!;

function prediction(answer: string): Prediction {
  return { question: 'q', answer_type: 'percent', answer, actual: '', error: null, within_tolerance: null, committed_at: '2026-09-15T00:00:00Z' };
}

describe('createExampleSession', () => {
  it('opens on the first step with a board, over the example’s spot, with no hand and no pool', () => {
    const session = createExampleSession(EXAMPLE);
    expect(session.current.value).toBe(EXAMPLE_OPENS_AT);
    expect(session.context.step.step).toBe(EXAMPLE_OPENS_AT);
    expect(session.context.node).toBe(EXAMPLE.node);
    expect(session.context.spot.board).toHaveLength(3);
    expect(session.context.spot.heroCards).toHaveLength(2);
    expect([session.context.pool, session.context.poolFacing]).toEqual([null, null]);
    // Both pool-shaped gaps and the library's carry a reason, which is what lets all nine open.
    for (const missing of [session.context.poolMissing, session.context.poolFacingMissing, session.context.libraryMissing]) {
      expect(missing ?? '').not.toBe('');
    }
    expect(session.completed.value).toEqual([]);
  });

  it('keeps both of two patches made in one tick, because the context reads the live steps', () => {
    const session = createExampleSession(EXAMPLE);
    session.goTo(3);
    session.patch({ prediction: prediction('20') });
    session.patch({ takeaway: 'most of the big blind missed' });
    expect(session.context.step).toMatchObject({ step: 3, takeaway: 'most of the big blind missed' });
    expect(session.context.step.prediction?.answer).toBe('20');
    expect(session.completed.value).toEqual([3]);
  });

  it('keeps step 9’s heuristic in this tab, like everything else here', () => {
    const session = createExampleSession(EXAMPLE);
    expect(session.context.heuristic).toBe('');
    session.setHeuristic('bet small on paired boards');
    expect(session.context.heuristic).toBe('bet small on paired boards');
  });

  it('changes only the step on screen, and the spot follows the work', () => {
    const session = createExampleSession(EXAMPLE);
    session.goTo(5);
    session.patch(workPatch(session.context.step, { hero_cards: 'KsQs' }));
    expect(session.context.spot.heroCards).toHaveLength(2);
    expect(session.context.steps.find((s) => s.step === 5)?.work.hero_cards).toBe('KsQs');
    expect(session.context.steps.find((s) => s.step === 3)?.work.board).toBe(EXAMPLE.board);
  });

  it('goes only to the steps it offers, and names its neighbours up to either end', () => {
    const session = createExampleSession(EXAMPLE);
    // All nine are offered now (ADR-061); a number outside them still moves nothing.
    session.goTo(0);
    session.goTo(10);
    expect(session.current.value).toBe(EXAMPLE_OPENS_AT);
    session.goTo(1);
    expect(session.neighbour(-1)).toBeNull();
    expect(session.neighbour(1)).toBe(2);
    session.goTo(5);
    expect([session.neighbour(-1), session.neighbour(1)]).toEqual([4, 6]);
    session.goTo(9);
    expect(session.neighbour(1)).toBeNull();
  });

  it('starts every example afresh: nothing from one session leaks into the next', () => {
    const first = createExampleSession(EXAMPLE);
    first.patch({ prediction: prediction('20') });
    expect(createExampleSession(EXAMPLE).completed.value).toEqual([]);
  });
});
