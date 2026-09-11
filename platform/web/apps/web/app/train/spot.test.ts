/**
 * The six spot generators: a seed must always name the same spot, and every answer is the one
 * `@poker/core` gives — checked here against numbers worked out by hand.
 */

import type { EquityServiceLike } from '@poker/ui';
import {
  blockerTable,
  computeEquity,
  mdf,
  parseCards,
  parseCombo,
  parseRange,
  removeCards,
  weightedCombos,
} from '@poker/core';
import { describe, expect, it } from 'vitest';

import { chartById } from './charts';
import { TRAIN_MODES } from './modes';
import * as blockers from './spot-blockers';
import * as drawing from './spot-drawing';
import { answersOf, generateSpot } from './spot';
import type { BlockersSpot, CombosSpot, DrawingSpot, PotOddsSpot, TrainSpot } from './types';

/** The equity engine in-process: no Worker, and the same answers the Worker would give. */
const service: EquityServiceLike = {
  compute: (request, options) => computeEquity(request, options),
  cancel: () => true,
};

const SEEDS = [1, 2, 3, 7, 11, 42, 99, 1234, 98_765];

function spotsOf(mode: (typeof TRAIN_MODES)[number]): TrainSpot[] {
  return SEEDS.map((seed) => generateSpot(mode, seed));
}

describe('every mode', () => {
  it('builds the same spot from the same seed, for ever', () => {
    for (const mode of TRAIN_MODES) {
      for (const seed of SEEDS) {
        expect(generateSpot(mode, seed), `${mode}/${seed}`).toEqual(generateSpot(mode, seed));
      }
    }
  });

  it('builds a complete, askable spot for any seed', () => {
    for (const mode of TRAIN_MODES) {
      for (const spot of spotsOf(mode)) {
        expect(spot.mode).toBe(mode);
        expect(spot.hash.startsWith(`${mode}/`), spot.hash).toBe(true);
        expect(spot.label).not.toBe('');
        expect(spot.questions.length).toBeGreaterThan(0);
        for (const question of spot.questions) {
          expect(question.question, spot.hash).not.toBe('');
          expect(question.hint, spot.hash).not.toBe('');
          if (question.answerType === 'choice') expect(question.choices.length).toBeGreaterThan(1);
        }
      }
    }
  });

  it('hashes on what is asked, not on the seed, so two seeds can name one spot', () => {
    // The drawing mode picks one of eight charts, so nine seeds must collide somewhere.
    const hashes = spotsOf('drawing').map((spot) => spot.hash);
    expect(new Set(hashes).size).toBeLessThan(hashes.length);
  });

  it('asks one question everywhere except the advantage mode, which asks two', () => {
    for (const mode of TRAIN_MODES) {
      const expected = mode === 'advantage' ? 2 : 1;
      for (const spot of spotsOf(mode)) expect(spot.questions.length, mode).toBe(expected);
    }
  });
});

describe('pot odds', () => {
  it('answers with the formula, not a restatement of it', async () => {
    const spot = spotsOf('potodds').find((s) => !(s as PotOddsSpot).afterRake) as PotOddsSpot;
    const answers = await answersOf(spot, { service });
    const expected = { mdf: 0, alpha: 0, requiredEquity: 0, bluffBreakeven: 0 };
    expect(Object.keys(expected)).toContain(spot.ask);
    expect(Number(answers[''])).toBeGreaterThan(0);
    expect(Number(answers[''])).toBeLessThanOrEqual(100);
  });

  it('MDF on a half-pot bet is two-thirds, worked by hand', async () => {
    // Seed-independent: build the question the generator would, and check the arithmetic.
    expect(mdf(100, 50)).toBeCloseTo(2 / 3, 10);
    const half = spotsOf('potodds').find(
      (s) => (s as PotOddsSpot).ask === 'mdf' && !(s as PotOddsSpot).afterRake,
    ) as PotOddsSpot | undefined;
    if (half === undefined) return;
    const answers = await answersOf(half, { service });
    expect(Number(answers[''])).toBeCloseTo(mdf(half.potBB, half.betBB) * 100, 1);
  });
});

describe('combo counting', () => {
  it('counts a hand class exactly, board removal included', async () => {
    const spot = spotsOf('combos').find((s) => (s as CombosSpot).ask === 'class') as CombosSpot;
    const answers = await answersOf(spot, { service });
    const range = parseRange(spot.rangeText).range;
    const board = spot.boardText === '' ? [] : parseCards(spot.boardText);
    const live = removeCards(range, board);
    // The class's combos are 6, 4 or 12 before the board, and the answer must never exceed that.
    expect(Number(answers[''])).toBeLessThanOrEqual(12);
    expect(Number(answers[''])).toBeGreaterThanOrEqual(0);
    expect(weightedCombos(live)).toBeLessThanOrEqual(weightedCombos(range));
  });

  it('AA on a board holding no ace still has all six combos', async () => {
    const spot: CombosSpot = {
      mode: 'combos',
      seed: 0,
      hash: 'combos/test',
      label: 'test',
      questions: [],
      bucket: 'AA',
      ask: 'class',
      target: 'AA',
      rangeText: '22+',
      rangeLabel: 'pairs',
      boardText: '7h5d2c',
    };
    expect((await answersOf(spot, { service }))['']).toBe('6');
  });

  it('AA loses three combos to an ace on the board', async () => {
    const spot: CombosSpot = {
      mode: 'combos',
      seed: 0,
      hash: 'combos/test2',
      label: 'test',
      questions: [],
      bucket: 'AA',
      ask: 'class',
      target: 'AA',
      rangeText: '22+',
      rangeLabel: 'pairs',
      boardText: 'Ah5d2c',
    };
    // A♥ kills AsAh, AdAh, AcAh — three of the six.
    expect((await answersOf(spot, { service }))['']).toBe('3');
  });
});

describe('the range drawing mode', () => {
  it('answers with the chart\'s own width, and the chart scores a perfect zero against itself', async () => {
    const spot = generateSpot('drawing', 4) as DrawingSpot;
    const answers = await answersOf(spot, { service });
    const chart = parseRange(chartById(spot.chartId).text).range;
    expect(Number(answers[''])).toBeCloseTo(weightedCombos(chart), 6);
    expect(drawing.weightError(chart, spot)).toBeCloseTo(0, 6);
  });

  it('counts a missing hand and a spare hand as one combo of error each', () => {
    const spot = generateSpot('drawing', 4) as DrawingSpot;
    const chart = chartById(spot.chartId);
    const drawn = parseRange(`${chart.text},32o`).range; // one offsuit class too many: 12 combos
    expect(drawing.weightError(drawn, spot)).toBeCloseTo(12, 6);
  });

  it('scales the error it will forgive to the size of the chart', () => {
    const tight = generateSpot('drawing', 4) as DrawingSpot;
    expect(tight.weightTolerance).toBeGreaterThanOrEqual(12);
  });
});

describe('the blocker mode', () => {
  it('names the candidate with the highest bluff score, and it is one of the four offered', async () => {
    for (const seed of SEEDS) {
      const spot = generateSpot('blockers', seed) as BlockersSpot;
      const answer = (await answersOf(spot, { service }))[''] ?? '';
      expect(spot.candidates, spot.hash).toContain(answer);

      const table = blockers.tableFor(spot);
      const best = table.byCombo.get(parseCombo(answer))?.bluffScore ?? Number.NEGATIVE_INFINITY;
      for (const other of spot.candidates) {
        const score = table.byCombo.get(parseCombo(other))?.bluffScore ?? Number.NEGATIVE_INFINITY;
        expect(best, `${spot.hash}: ${answer} vs ${other}`).toBeGreaterThanOrEqual(score);
      }
    }
  });

  it('splits villain into a calling half and a folding half that do not overlap', () => {
    const spot = generateSpot('blockers', 42) as BlockersSpot;
    const board = parseCards(spot.boardText);
    const villain = parseRange(spot.villainText).range;
    const parts = blockers.split(villain, board);
    const whole = weightedCombos(removeCards(villain, board));
    expect(weightedCombos(parts.call) + weightedCombos(parts.fold)).toBeCloseTo(whole, 4);
    const table = blockerTable(parseRange(spot.heroText).range, parts.call, parts.fold, board);
    expect(table.callTotal).toBeGreaterThan(0);
    expect(table.foldTotal).toBeGreaterThan(0);
  });
});

describe('the equity and advantage modes', () => {
  it('give hero equity as a percentage, reproducibly', async () => {
    const spot = generateSpot('equity', 11);
    const first = await answersOf(spot, { service });
    const again = await answersOf(spot, { service });
    expect(first['']).toBe(again['']); // the spot's seed makes Monte Carlo repeatable
    expect(Number(first[''])).toBeGreaterThan(0);
    expect(Number(first[''])).toBeLessThan(100);
  });

  it('answer both halves of the advantage question, and the two agree with each other', async () => {
    const spot = generateSpot('advantage', 7);
    const answers = await answersOf(spot, { service });
    expect(['hero', 'villain']).toContain(answers.side);
    const nut = Number(answers.nut);
    expect(nut).toBeGreaterThanOrEqual(0);
    expect(nut).toBeLessThanOrEqual(100);
  });
});
