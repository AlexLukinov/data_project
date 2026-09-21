import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { classifyHand, comboIndex, parseCards, parseRange } from '@poker/core';
import { describe, expect, it } from 'vitest';

import { workOf } from '~/analyze/context';
import { classPercentile, isDealt, roleOf } from '~/analyze/reveals';
import { spotFrom } from '~/analyze/spot';
import { blockerQuestion, stepDef } from '~/analyze/steps';
import { chartById } from '~/train/charts';

import type { Example } from './examples';
import { EXAMPLES, EXAMPLE_STEPS, exampleById, exampleSteps } from './examples';

const SEED = fileURLToPath(new URL('../../../../../seeds/hands/pokerstars/cash_6max_nl50.txt', import.meta.url));
const FLUSH_DRAWS = 'How many flush draws can villain still have?';

/** What steps 5 and 7 will ask and reveal for an example, computed the way those steps compute it. */
function lesson(example: Example) {
  const spot = spotFrom(exampleSteps(example), example.node);
  const [a, b] = spot.heroCards;
  const made = classifyHand([a!, b!], spot.board);
  const percentile = classPercentile(spot.hero!, spot.board, spot.heroCards);
  return { question: blockerQuestion(spot.board).question, role: roleOf(percentile!, made.made, made.draws) };
}

describe('the examples', () => {
  it('are three to five, each with its own id, found by that id', () => {
    expect(EXAMPLES.length).toBeGreaterThanOrEqual(3);
    expect(EXAMPLES.length).toBeLessThanOrEqual(5);
    expect(new Set(EXAMPLES.map((e) => e.id)).size).toBe(EXAMPLES.length);
    for (const example of EXAMPLES) expect(exampleById(example.id)).toBe(example);
    expect(exampleById('no-such-example')).toBeNull();
  });

  it('give each seat the reference chart written for that seat', () => {
    for (const example of EXAMPLES) {
      expect(chartById(example.heroChart).position, example.id).toBe(example.node.hero_position);
      expect(chartById(example.villainChart).position, example.id).toBe(example.node.villain_position);
    }
  });

  it('deal a legal flop and a hand that is not on it and is in hero’s own chart', () => {
    for (const example of EXAMPLES) {
      const board = parseCards(example.board);
      const hand = parseCards(example.heroCards);
      expect(board, example.id).toHaveLength(3);
      expect(new Set([...board, ...hand]).size, example.id).toBe(5);
      const weight = parseRange(chartById(example.heroChart).text).range.weights[comboIndex(hand[0]!, hand[1]!)] ?? 0;
      expect(weight, example.id).toBeGreaterThan(0);
    }
  });

  it('are about hero’s flop bet, at the size step 8 balances against', () => {
    for (const example of EXAMPLES) {
      const last = example.node.action_sequence.at(-1)!;
      expect(example.node.street, example.id).toBe('flop');
      expect(last, example.id).toMatchObject({ position: example.node.hero_position, action: 'bet', size_pct: example.sizePct });
    }
  });
});

describe('exampleSteps', () => {
  it('opens as a spot the analyzer can read: both ranges, the flop and the hand', () => {
    for (const example of EXAMPLES) {
      const steps = exampleSteps(example);
      const spot = spotFrom(steps, example.node);
      expect(spot.hero, example.id).not.toBeNull();
      expect(spot.villain, example.id).not.toBeNull();
      expect(isDealt(spot.board), example.id).toBe(true);
      expect(spot.heroCards, example.id).toHaveLength(2);
      expect(workOf(steps, 6)?.size_pct, example.id).toBe(example.sizePct);
    }
  });

  it('never calls a reference chart the reader’s own, and commits nothing on the reader’s behalf', () => {
    for (const example of EXAMPLES) {
      const steps = exampleSteps(example);
      expect(workOf(steps, 1)?.ranges.map((r) => r.label), example.id).toEqual(['', '']);
      expect(steps.every((s) => s.prediction === null), example.id).toBe(true);
      for (const n of EXAMPLE_STEPS) expect(steps.some((s) => s.step === n), `${example.id} step ${n}`).toBe(true);
    }
  });
});

describe('what each example teaches is what the analyzer will reveal', () => {
  // Pinned so that a change to a reference chart or to a reveal rule which makes a lesson untrue
  // fails here, and the lesson is reread — not discovered by a reader.
  it('top pair on the dry flop: a rainbow board asks what the hand removes, and top pair is protection', () => {
    expect(lesson(exampleById('top-pair-dry-board')!)).toEqual({ question: stepDef(5).question, role: 'protection' });
  });

  it('the flush draw: a two-tone board asks about flush draws, and the draw is a semi-bluff', () => {
    expect(lesson(exampleById('flush-draw-their-board')!)).toEqual({ question: FLUSH_DRAWS, role: 'semi-bluff' });
  });

  it('range ahead, hand behind: seven-six on a paired ace is a give-up', () => {
    expect(lesson(exampleById('range-ahead-hand-behind')!)).toEqual({ question: stepDef(5).question, role: 'give-up' });
  });

  it('the seed example is the committed hand it names: the cards, the flop and the bet', () => {
    const text = readFileSync(SEED, 'utf8');
    const hand = text.slice(text.indexOf('PokerStars Hand #245678901235'));
    expect(hand).toContain('Dealt to Hero [Ah Kd]');
    expect(hand).toContain('*** FLOP *** [Kh 9d 4s]');
    expect(hand).toContain('Hero: bets $1.50');
    // $1.50 into $3.25, rounded as the replayer rounds a node's size.
    expect(exampleById('top-pair-dry-board')!.sizePct).toBeCloseTo(1.5 / 3.25, 3);
  });
});
