/** Every §8 formula against a value worked by hand. */

import { describe, expect, it } from 'vitest';

import { COMBO_COUNT } from '../src/cards';
import type { WeightedEquities } from '../src/metrics/advantage';
import { bucketIndex, equityBuckets, nutAdvantage, nutThreshold, rangeAdvantage, weightedMeanEquity, weightedMedianEquity } from '../src/metrics/advantage';
import { NO_RAKE, alpha, balancedBluffRatio, bluffBreakeven, effectivePot, impliedOddsEquity, mdf, oddsRatio, potOdds, rakeTaken, requiredEquity, requiredEquityFacingBet } from '../src/metrics/pot';
import { equityRealization, evFromRealization } from '../src/metrics/realization';

const GG = { rakePct: 0.05, rakeCapBB: 3 };

describe('pot odds and sizing', () => {
  it('MDF and alpha: a half-pot bet into 100', () => {
    expect(mdf(100, 50)).toBeCloseTo(2 / 3, 10); // 100 / 150
    expect(alpha(100, 50)).toBeCloseTo(1 / 3, 10); // 50 / 150
    expect(mdf(100, 50) + alpha(100, 50)).toBeCloseTo(1, 10);
    expect(mdf(100, 0)).toBe(1);
  });

  it('required equity: general and facing-a-bet forms', () => {
    expect(requiredEquity(50, 100, 50)).toBe(0.25); // 50 / (100 + 50 + 50)
    expect(requiredEquityFacingBet(100, 50)).toBe(0.25); // 50 / (100 + 100)
    expect(requiredEquityFacingBet(100, 100)).toBeCloseTo(1 / 3, 10); // pot-size bet
    expect(requiredEquity(0, 100, 0)).toBe(0); // a check costs nothing
    expect(requiredEquity(30, 100, 50)).toBeCloseTo(30 / 180, 10); // a short call
  });

  it('bluff break-even and the balanced bluff ratio', () => {
    expect(bluffBreakeven(100, 50)).toBeCloseTo(1 / 3, 10);
    expect(balancedBluffRatio(100, 100)).toBe(0.5); // pot-size bet: one bluff per two value combos
    expect(balancedBluffRatio(100, 50)).toBeCloseTo(1 / 3, 10);
    expect(balancedBluffRatio(100, 200)).toBeCloseTo(2 / 3, 10);
  });

  it('odds ratio text', () => {
    expect(oddsRatio(100, 50)).toEqual({ toOne: 3, text: '3 : 1' });
    expect(oddsRatio(100, 45).text).toBe('3.2 : 1'); // 145 / 45 = 3.22
    expect(oddsRatio(100, 0).text).toBe('free');
  });

  it('implied odds lower the equity needed', () => {
    expect(impliedOddsEquity(50, 100, 50, 100)).toBeCloseTo(50 / 300, 10);
    expect(impliedOddsEquity(50, 100, 50, 0)).toBe(0.25);
  });

  it('rake: five percent capped at three big blinds', () => {
    expect(rakeTaken(100, GG)).toBe(3); // 5 capped at 3
    expect(rakeTaken(40, GG)).toBe(2); // 2 under the cap
    expect(rakeTaken(100, { rakePct: 0.05, rakeCapBB: null })).toBe(5);
    expect(effectivePot(100, GG)).toBe(97);
    expect(effectivePot(100, NO_RAKE)).toBe(100);
  });

  it('shows raw and rake-adjusted figures side by side', () => {
    const { raw, rakeAdjusted } = potOdds(100, 50, 50, GG);
    expect(raw.requiredEquity).toBe(0.25);
    expect(raw.mdf).toBeCloseTo(2 / 3, 10);
    expect(raw.odds.text).toBe('3 : 1');
    // Calling: the final pot 200 is raked to 197; hero nets 147 on a win, risks 50.
    expect(rakeAdjusted.requiredEquity).toBeCloseTo(50 / 197, 10);
    // Folding: the bettor takes 97; a bluff of 50 must work 50 / 147 of the time.
    expect(rakeAdjusted.alpha).toBeCloseTo(50 / 147, 10);
    expect(rakeAdjusted.mdf).toBeCloseTo(97 / 147, 10);
    expect(rakeAdjusted.bluffsPerValue).toBeCloseTo(50 / 147, 10);
    expect(rakeAdjusted.odds.text).toBe('2.9 : 1'); // wins 147 net, risks 50
  });

  it('refuses nonsense amounts', () => {
    expect(() => mdf(0, 50)).toThrow(/pot must be positive/);
    expect(() => alpha(100, -1)).toThrow(/bet must be zero or more/);
    expect(() => requiredEquity(-5, 100, 50)).toThrow(/call must be zero or more/);
  });
});

describe('equity realization', () => {
  it('EQR = (EV / pot) / equity, and back', () => {
    expect(equityRealization(20, 100, 0.4)).toBeCloseTo(0.5, 10); // realizes half its equity
    expect(equityRealization(50, 100, 0.4)).toBeCloseTo(1.25, 10); // over-realizes
    expect(evFromRealization(0.4, 0.5, 100)).toBeCloseTo(20, 10);
    expect(() => equityRealization(20, 100, 0)).toThrow(/equity must be in/);
    expect(() => evFromRealization(0.4, 1, 0)).toThrow(/pot must be positive/);
  });
});

function side(points: [number, number, number][]): WeightedEquities {
  const equities = new Float32Array(COMBO_COUNT).fill(Number.NaN);
  const weights = new Float32Array(COMBO_COUNT);
  for (const [combo, equity, weight] of points) {
    equities[combo] = equity;
    weights[combo] = weight;
  }
  return { equities, weights };
}

const hero = side([
  [0, 0.9, 1],
  [1, 0.5, 1],
]);
const villain = side([
  [2, 0.85, 2],
  [3, 0.1, 1],
]);

describe('range advantage', () => {
  it('weighted mean, median and buckets', () => {
    expect(weightedMeanEquity(hero)).toBeCloseTo(0.7, 6);
    expect(weightedMeanEquity(villain)).toBeCloseTo(0.6, 6); // (0.85·2 + 0.1) / 3
    expect(weightedMedianEquity(hero)).toBeCloseTo(0.5, 6);
    expect(weightedMedianEquity(villain)).toBeCloseTo(0.85, 6);
    expect(equityBuckets(hero).shares).toEqual([0, 0, 0.5, 0, 0.5]);
    expect(bucketIndex(1)).toBe(4);
    expect(bucketIndex(0.2)).toBe(1);
    expect(bucketIndex(0)).toBe(0);
    const empty = side([]);
    expect(weightedMeanEquity(empty)).toBeNaN();
  });

  it('reports the difference and both bucket rows', () => {
    const adv = rangeAdvantage(hero, villain);
    expect(adv.difference).toBeCloseTo(0.1, 6);
    expect(adv.buckets.villain[4]).toBeCloseTo(2 / 3, 6);
    expect(adv.buckets.villain[0]).toBeCloseTo(1 / 3, 6);
  });
});

describe('nut advantage', () => {
  it('by cutoff: who holds the combos at or above 80%', () => {
    const nut = nutAdvantage(hero, villain);
    expect(nut.mode).toBe('cutoff');
    expect(nut.threshold).toBe(0.8);
    expect(nut.hero).toEqual({ nutWeight: 1, share: 0.5 });
    expect(nut.villain.nutWeight).toBe(2);
    expect(nut.villain.share).toBeCloseTo(2 / 3, 6);
    expect(nut.split.hero).toBeCloseTo(1 / 3, 6);
    expect(nut.split.villain).toBeCloseTo(2 / 3, 6);
  });

  it('by top percent of the combined distribution', () => {
    // Combined by weight: 0.9 (1), 0.85 (2), 0.5 (1), 0.1 (1) = 5. Top 40% = 2 → reaches 0.85.
    expect(nutThreshold(hero, villain, 40)).toBeCloseTo(0.85, 6);
    expect(nutThreshold(hero, villain, 20)).toBeCloseTo(0.9, 6);
    const top20 = nutAdvantage(hero, villain, { mode: 'topPercent', topPercent: 20 });
    expect(top20.hero.nutWeight).toBe(1);
    expect(top20.villain.nutWeight).toBe(0);
    expect(top20.split).toEqual({ hero: 1, villain: 0 });
    expect(() => nutThreshold(hero, villain, 0)).toThrow(/topPercent/);
  });
});
