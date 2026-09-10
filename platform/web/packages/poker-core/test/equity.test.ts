/**
 * The equity engine against `fixtures/equity_spots.json`, whose expected values come from an
 * independent brute-force enumeration with the treys evaluator (see gen_equity_spots.py).
 * Tolerances are the plan's: 0.01 percentage points exact, 0.5 Monte Carlo.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { COMBO_COUNT, parseCards, parseCombo } from '../src/cards';
import { EquityCancelled, computeEquity, enumerateRunouts, equityKey } from '../src/equity/index';
import type { EquityRequest } from '../src/equity/types';
import { parseRange } from '../src/formats/index';
import { fullRange } from '../src/range';

interface Spot {
  readonly name: string;
  readonly hero: string;
  readonly villain: string;
  readonly board: string;
  readonly dead: string;
  readonly heroEquity: number;
  readonly perCombo?: Record<string, number>;
}

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'equity_spots.json');
const spots = (JSON.parse(readFileSync(FIXTURE, 'utf8')) as { spots: Spot[] }).spots;
const EXACT_TOLERANCE = 0.0001;
const MC_TOLERANCE = 0.005;

function requestOf(spot: Spot): EquityRequest {
  return {
    ranges: [parseRange(spot.hero).range, parseRange(spot.villain).range],
    board: parseCards(spot.board),
    deadCards: spot.dead === '' ? [] : parseCards(spot.dead),
  };
}

describe('exact equity matches the independent enumeration', () => {
  const exactSpots = spots.filter((s) => s.board !== '');
  it('has at least 30 spots in the fixture', () => {
    expect(spots.length).toBeGreaterThanOrEqual(30);
  });
  for (const spot of exactSpots) {
    it(spot.name, async () => {
      const result = await computeEquity(requestOf(spot), { mode: 'exact' });
      expect(result.exact).toBe(true);
      expect(Math.abs(result.heroEquity - spot.heroEquity), `hero ${result.heroEquity} vs ${spot.heroEquity}`).toBeLessThan(EXACT_TOLERANCE);
      expect(result.heroEquity + result.villainEquity).toBeCloseTo(1, 9);
      for (const [combo, expected] of Object.entries(spot.perCombo ?? {})) {
        const got = result.perComboEquity[parseCombo(combo)]!;
        expect(Math.abs(got - expected), `${combo}: ${got} vs ${expected}`).toBeLessThan(EXACT_TOLERANCE);
        const i = parseCombo(combo);
        const { win, tie, lose } = result.perComboWinTieLose;
        expect(win[i]! + tie[i]! + lose[i]!).toBeCloseTo(1, 5);
      }
    });
  }
});

describe('Monte Carlo', () => {
  for (const spot of spots.filter((s) => s.board === '')) {
    it(`${spot.name} within 0.5 pp of the exact value`, async () => {
      const result = await computeEquity(requestOf(spot), { iterations: 200_000, seed: 11 });
      expect(result.exact).toBe(false);
      expect(result.iterations).toBe(200_000);
      expect(Math.abs(result.heroEquity - spot.heroEquity)).toBeLessThan(MC_TOLERANCE);
      expect(result.confidence95).toBeGreaterThan(0);
      expect(result.confidence95).toBeLessThan(0.5);
    });
  }

  it('agrees with the exact engine on a flop, within its own confidence', async () => {
    const spot = spots.find((s) => s.name === 'flop: range vs range')!;
    const exact = await computeEquity(requestOf(spot), { mode: 'exact' });
    const mc = await computeEquity(requestOf(spot), { mode: 'monte-carlo', iterations: 100_000, seed: 3 });
    expect(Math.abs(mc.heroEquity - exact.heroEquity)).toBeLessThan(0.006);
  });

  it('is reproducible for a seed and splits three players to a total of one', async () => {
    const request: EquityRequest = {
      ranges: [parseRange('AA,KK').range, parseRange('QQ,AKs').range, parseRange('JJ,TT,99').range],
      board: [],
    };
    const a = await computeEquity(request, { iterations: 20_000, seed: 5 });
    const b = await computeEquity(request, { iterations: 20_000, seed: 5 });
    expect(a.players).toBe(3);
    expect(a.equities).toEqual(b.equities);
    expect(a.equities.reduce((x, y) => x + y, 0)).toBeCloseTo(1, 9);
    expect(a.equities[0]).toBeGreaterThan(a.equities[2]!);
  });
});

describe('control and shape', () => {
  const flop: EquityRequest = { ranges: [fullRange(), fullRange()], board: parseCards('Kh 7d 2c') };

  it('enumerates the right number of runouts', () => {
    expect(enumerateRunouts([0, 1, 2, 3], 2)).toHaveLength(6);
    expect(enumerateRunouts([0, 1, 2, 3], 1)).toHaveLength(4);
    expect(enumerateRunouts([0, 1, 2, 3], 0)).toEqual([[]]);
  });

  it('reports progress and can be cancelled from a progress callback', async () => {
    const controller = new AbortController();
    const seen: number[] = [];
    const job = computeEquity(flop, {
      signal: controller.signal,
      onProgress: (done, total) => {
        seen.push(done);
        if (done > 0 && done < total) controller.abort();
      },
    });
    await expect(job).rejects.toBeInstanceOf(EquityCancelled);
    expect(seen.length).toBeGreaterThan(1);
  });

  it('rejects an already-aborted signal before doing work', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(computeEquity(flop, { signal: controller.signal })).rejects.toBeInstanceOf(EquityCancelled);
  });

  it('marks combos outside the range or blocked by the board as NaN', async () => {
    const hero = parseRange('AA,KK').range;
    const villain = parseRange('QQ').range;
    const result = await computeEquity({ ranges: [hero, villain], board: parseCards('Ah 7d 2c') });
    expect(result.perComboEquity[parseCombo('AhAd')]).toBeNaN(); // blocked by the ace on board
    expect(result.perComboEquity[parseCombo('AsAd')]).toBeGreaterThan(0.9);
    expect(result.perComboEquity[parseCombo('QsQd')]).toBeNaN(); // not hero's
    expect(result.perComboEquity).toHaveLength(COMBO_COUNT);
    expect(result.perComboEquityVillain[parseCombo('QsQd')]).toBeLessThan(0.1);
  });

  it('refuses malformed requests plainly', async () => {
    await expect(computeEquity({ ranges: [fullRange()], board: [] })).rejects.toThrow(/2 to 10 ranges/);
    await expect(computeEquity({ ranges: [fullRange(), fullRange()], board: parseCards('Kh 7d') })).rejects.toThrow(/0, 3, 4 or 5 cards/);
    await expect(computeEquity({ ranges: [fullRange(), fullRange()], board: parseCards('Kh 7d 2c'), deadCards: parseCards('Kh') })).rejects.toThrow(/appears twice/);
    await expect(computeEquity({ ranges: [fullRange(), fullRange()], board: [] }, { mode: 'exact' })).rejects.toThrow(/exact equity needs/);
  });

  it('keys equal computations equally and different ones differently', () => {
    const a = { ranges: [parseRange('AA').range, parseRange('KK').range], board: parseCards('Kh 7d 2c') };
    const b = { ranges: [parseRange('AA').range, parseRange('KK').range], board: parseCards('Kh 7d 2c') };
    const c = { ranges: [parseRange('AA').range, parseRange('KK').range], board: parseCards('Kh 7d 3c') };
    expect(equityKey(a)).toBe(equityKey(b));
    expect(equityKey(a)).not.toBe(equityKey(c));
    expect(equityKey(a, { mode: 'monte-carlo', iterations: 10, seed: 1 })).not.toBe(equityKey(a));
    expect(equityKey({ ...a, board: [] }, { seed: 1 })).not.toBe(equityKey({ ...a, board: [] }, { seed: 2 }));
  });
});
