/**
 * What the nine steps build up, and the two questions that depend on the board.
 *
 * The subtraction is the part worth pinning down: the range that reaches the flop is what
 * continued, not what was dealt, and every step after 2 reads that and not the original.
 */
import { nodeKey, parseCards, weightedCombos } from '@poker/core';
import { describe, expect, it } from 'vitest';

import type { AnalysisStep } from './api';
import { emptyStep, emptyWork } from './api';
import { blockerQuestion, STEPS, stepDef } from './steps';
import { EMPTY_SPOT, spotFrom } from './spot';

const KEY = nodeKey('BB', { villain_position: 'CO', street: 'flop' });

/** `AsKs`, `AhKh`, `AdKd`, `AcKc` — four combos, easy to count. */
const AK_SUITED = 'AsKs: 1,AhKh: 1,AdKd: 1,AcKc: 1';
const AK_OFF_TWO = 'AsKh: 1,AhKs: 1';

function step(number: number, work: Partial<ReturnType<typeof emptyWork>>): AnalysisStep {
  return { ...emptyStep(number), work: { ...emptyWork(), ...work } };
}

describe('spotFrom', () => {
  it('is empty until there is a situation', () => {
    expect(spotFrom([], null)).toBe(EMPTY_SPOT);
  });

  it('takes each seat its assigned range', () => {
    const steps = [
      step(1, {
        ranges: [
          { position: 'BB', weights: AK_SUITED, label: 'my defend' },
          { position: 'CO', weights: AK_OFF_TWO, label: '' },
        ],
      }),
    ];
    const spot = spotFrom(steps, KEY);
    expect(weightedCombos(spot.hero!)).toBe(4);
    expect(spot.hero!.label).toBe('my defend');
    expect(weightedCombos(spot.villain!)).toBe(2);
    expect(spot.villain!.label).toBe('CO'); // no label given, so the seat names it
  });

  it('carries what continued to the flop, not what was dealt', () => {
    const steps = [
      step(1, { ranges: [{ position: 'CO', weights: `${AK_SUITED},${AK_OFF_TWO}`, label: '' }] }),
      step(2, {
        splits: [
          { position: 'CO', action: 'fold', weights: AK_OFF_TWO },
          { position: 'CO', action: 'call', weights: AK_SUITED },
        ],
      }),
    ];
    // Six combos were dealt; the two that folded are gone.
    expect(weightedCombos(spotFrom(steps, KEY).villain!)).toBe(4);
  });

  it('adds every branch that is not a fold', () => {
    const steps = [
      step(2, {
        splits: [
          { position: 'CO', action: 'call', weights: AK_OFF_TWO },
          { position: 'CO', action: 'raise', weights: AK_SUITED },
        ],
      }),
    ];
    expect(weightedCombos(spotFrom(steps, KEY).villain!)).toBe(6);
  });

  it('reads the board and hero\'s cards from the steps that set them', () => {
    const steps = [step(3, { board: 'Ah 7d 2c' }), step(5, { hero_cards: 'KsQs' })];
    const spot = spotFrom(steps, KEY);
    expect(spot.board).toEqual(parseCards('Ah7d2c'));
    expect(spot.heroCards).toEqual(parseCards('KsQs'));
  });

  it('survives half-typed text rather than taking the page down', () => {
    const steps = [step(3, { board: 'Ah 7' }), step(1, { ranges: [{ position: 'BB', weights: 'nonsense', label: '' }] })];
    const spot = spotFrom(steps, KEY);
    expect(spot.board).toEqual([]);
    expect(spot.hero).toBeNull();
  });
});

describe('the nine steps', () => {
  it('are nine, numbered 1 to 9, each with a question of its own', () => {
    expect(STEPS.map((s) => s.step)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(new Set(STEPS.map((s) => s.question)).size).toBe(9);
    for (const definition of STEPS) {
      expect(definition.question.endsWith('?')).toBe(true);
      if (definition.answerType === 'choice') expect(definition.choices.length).toBeGreaterThan(1);
    }
  });

  it('clamps a step number to the nine that exist', () => {
    expect(stepDef(0).step).toBe(1);
    expect(stepDef(99).step).toBe(9);
  });

  it('asks about flush draws only when the board can make one', () => {
    expect(blockerQuestion(parseCards('Ah7h2c')).question).toContain('flush draws');
    expect(blockerQuestion(parseCards('Ah7h2h')).question).toContain('flush draws'); // monotone
    expect(blockerQuestion(parseCards('Ah7d2c')).question).toBe(stepDef(5).question);
    expect(blockerQuestion([]).question).toBe(stepDef(5).question);
  });
});
