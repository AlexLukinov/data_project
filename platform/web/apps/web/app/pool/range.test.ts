import type { WeightedRange } from '@poker/core';
import { COMBO_COUNT, parseCombo } from '@poker/core';
import { describe, expect, it } from 'vitest';

import { poolRange } from './range';

function weight(range: WeightedRange, combo: string): number {
  return range.weights[parseCombo(combo)]!;
}

describe('poolRange', () => {
  it('corrects for how many combos a class has', () => {
    // AA has 6 combos, AKo has 12. Shown equally often, AA is twice as likely per combo.
    const range = poolRange({ AA: 60, AKo: 60 })!;
    expect(weight(range, 'AsAh')).toBe(1);
    expect(weight(range, 'AsKh')).toBeCloseTo(0.5, 3);
  });

  it('scales the most frequent class to a full cell', () => {
    const range = poolRange({ AA: 12, KK: 6 })!;
    expect(weight(range, 'AsAh')).toBe(1);
    expect(weight(range, 'KsKh')).toBeCloseTo(0.5, 3);
  });

  it('drops the noise below the floor', () => {
    const range = poolRange({ AA: 1000, '72o': 1 })!;
    expect(weight(range, '7s2h')).toBe(0);
  });

  it('is null when there is nothing to draw', () => {
    expect(poolRange({})).toBeNull();
    expect(poolRange({ AA: 0 })).toBeNull();
    // An unknown class name is not a class: it must not become a range of one cell.
    expect(poolRange({ 'not a hand': 10 })).toBeNull();
  });

  it('carries its own label so a matrix can be told apart', () => {
    expect(poolRange({ QQ: 5 }, 'Pool · CO opens')!.label).toBe('Pool · CO opens');
  });

  it('builds a real weighted range, not a sparse object', () => {
    const range = poolRange({ AA: 6, KK: 6, AKs: 4 })!;
    expect(range.weights).toHaveLength(COMBO_COUNT);
    expect(weight(range, 'AsKs')).toBeGreaterThan(0);
    expect(weight(range, '2s2h')).toBe(0);
  });
});
