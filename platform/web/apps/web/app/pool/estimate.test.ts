/**
 * A prior into class weights and back into a range (plan F.10).
 *
 * The property that matters: the reconstruction moves classes against each other and leaves the
 * shape *inside* a class alone, so a chart that plays A5s but not A4s still plays A5s but not
 * A4s afterwards. A class the pool could not measure must come back untouched.
 */
import { COMBO_COUNT, handClassName, handClassOf, parseRange } from '@poker/core';
import { describe, expect, it } from 'vitest';

import type { ClassEstimate, NodeEstimatedRange, PoolApi } from './api';
import { classEquity, classWeights, estimateAt, movers, reweight } from './estimate';

const range = (text: string) => parseRange(text).range;

function estimate(hand_class: string, likelihood: number, extra: Partial<ClassEstimate> = {}): ClassEstimate {
  return {
    hand_class,
    prior: 0.25,
    posterior: 0.25,
    likelihood,
    action_rate: 0.3 * likelihood,
    sample_size: 400,
    fallback: false,
    ...extra,
  };
}

describe('classWeights', () => {
  it('totals a range class by class, leaving out what is not in it', () => {
    // AA is 6 combos at full weight; AKs is 4 combos at half.
    const weights = classWeights(range('AA,AKs:0.5'));
    expect(weights).toEqual({ AA: 6, AKs: 2 });
  });

  it('counts a partly-drawn class by exactly the combos that are drawn', () => {
    expect(classWeights(range('AsKs,AdKd'))).toEqual({ AKs: 2 });
  });
});

describe('reweight', () => {
  it('moves classes against each other and rescales the top combo to 1', () => {
    const prior = range('AA,72o');
    const after = reweight(prior, [estimate('AA', 2), estimate('72o', 0.5)])!;

    const weightOf = (name: string) => {
      for (let combo = 0; combo < COMBO_COUNT; combo += 1) {
        if (handClassName(handClassOf(combo)) === name && (after.weights[combo] ?? 0) > 0) return after.weights[combo]!;
      }
      return 0;
    };
    expect(weightOf('AA')).toBeCloseTo(1, 5);
    expect(weightOf('72o')).toBeCloseTo(0.25, 5);
  });

  it('leaves the shape inside a class exactly as it was', () => {
    // Only two of AKs's four combos are drawn, and one at half weight.
    const prior = range('AsKs,AdKd:0.5');
    const after = reweight(prior, [estimate('AKs', 3)])!;
    const drawn = [...after.weights].filter((w) => w > 0);
    expect(drawn.length).toBe(2);
    expect(Math.min(...drawn) / Math.max(...drawn)).toBeCloseTo(0.5, 5);
  });

  it('does not touch a class the pool could not measure', () => {
    const prior = range('AA,72o');
    const kept = reweight(prior, [estimate('AA', 1, { fallback: true, likelihood: 1, sample_size: 12 }), estimate('72o', 1, { fallback: true, likelihood: 1 })])!;
    expect([...kept.weights].filter((w) => w > 0).every((w) => w === 1)).toBe(true);
  });

  it('is nothing rather than an empty matrix when every class is crushed', () => {
    expect(reweight(range('AA'), [estimate('AA', 0)])).toBeNull();
  });
});

describe('classEquity', () => {
  it('averages the combos of a class and skips the ones with no answer', () => {
    const per = new Float32Array(COMBO_COUNT).fill(Number.NaN);
    let seen = 0;
    for (let combo = 0; combo < COMBO_COUNT && seen < 2; combo += 1) {
      if (handClassName(handClassOf(combo)) === 'AA') {
        per[combo] = seen === 0 ? 0.8 : 0.6;
        seen += 1;
      }
    }
    expect(classEquity(per).AA).toBeCloseTo(0.7, 5);
    expect(classEquity(per).KK).toBeUndefined();
  });
});

describe('movers', () => {
  it('ranks by how far a class actually moved and never lists a fallback', () => {
    const answer = {
      classes: [
        estimate('AA', 2, { prior: 0.25, posterior: 0.45 }),
        estimate('KK', 1.1, { prior: 0.25, posterior: 0.27 }),
        estimate('72o', 1, { prior: 0.25, posterior: 0.25, fallback: true }),
      ],
    } as NodeEstimatedRange;
    expect(movers(answer, 5).map((row) => row.hand_class)).toEqual(['AA', 'KK']);
  });
});

describe('estimateAt', () => {
  it('does not ask about a range with nothing in it', async () => {
    let asked = 0;
    const api = { estimatedRange: async () => { asked += 1; return {} as NodeEstimatedRange; } } as unknown as PoolApi;
    expect(await estimateAt(api, { hero_position: 'UTG' } as never, range(''))).toBeNull();
    expect(asked).toBe(0);
  });

  /* `null` is "there was nothing to reconstruct". A refusal must not arrive wearing that answer:
     the page draws the same blank for both, so one of them has to be loud. */
  it('lets a refusal through rather than returning the empty-prior answer', async () => {
    const api = { estimatedRange: async () => { throw new Error('500'); } } as unknown as PoolApi;
    await expect(estimateAt(api, { hero_position: 'UTG' } as never, range('AA'))).rejects.toThrow('500');
  });
});
