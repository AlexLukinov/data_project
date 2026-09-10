import { describe, expect, it } from 'vitest';

import { COMBO_COUNT, handClassOfName, parseCard, parseCombo } from '../src/cards';
import {
  combosIn,
  createRange,
  diff,
  filterByPredicate,
  fullRange,
  intersect,
  maxWeight,
  normalize,
  rangeFromEntries,
  removeCards,
  scale,
  subtract,
  toHandClassMatrix,
  totalCombos,
  union,
  weightWarnings,
  weightedCombos,
} from '../src/range';

const AsKh = parseCombo('AsKh');
const AsKs = parseCombo('AsKs');
const QdQc = parseCombo('QdQc');

describe('WeightedRange', () => {
  it('starts empty, or copies the weights it is given', () => {
    expect(totalCombos(createRange())).toBe(0);
    const source = new Float32Array(COMBO_COUNT);
    source[AsKh] = 0.5;
    const range = createRange(source, 'test');
    source[AsKh] = 1;
    expect(range.weights[AsKh]).toBe(0.5);
    expect(range.label).toBe('test');
    expect(() => createRange(new Float32Array(5))).toThrow(/1326 weights/);
  });

  it('counts raw and weighted combos', () => {
    const range = rangeFromEntries([
      [AsKh, 1],
      [AsKs, 0.5],
      [QdQc, 0.25],
    ]);
    expect(totalCombos(range)).toBe(3);
    expect(weightedCombos(range)).toBeCloseTo(1.75);
    expect(totalCombos(fullRange())).toBe(COMBO_COUNT);
    expect(weightedCombos(fullRange())).toBe(COMBO_COUNT);
  });

  it('removes every combo containing a dead card', () => {
    const without = removeCards(fullRange(), [parseCard('As')]);
    expect(totalCombos(without)).toBe(COMBO_COUNT - 51);
    expect(without.weights[AsKh]).toBe(0);
    expect(without.weights[QdQc]).toBe(1);
    const twoDead = removeCards(fullRange(), [parseCard('As'), parseCard('Kh')]);
    // 51 + 51 - 1 (the AsKh combo counted twice)
    expect(totalCombos(twoDead)).toBe(COMBO_COUNT - 101);
  });

  it('intersects, unions and subtracts as fuzzy sets', () => {
    const a = rangeFromEntries([
      [AsKh, 1],
      [AsKs, 0.5],
    ]);
    const b = rangeFromEntries([
      [AsKs, 0.75],
      [QdQc, 1],
    ]);
    expect(combosIn(intersect(a, b))).toEqual([AsKs]);
    expect(intersect(a, b).weights[AsKs]).toBe(0.5);
    expect(union(a, b).weights[AsKs]).toBe(0.75);
    expect(totalCombos(union(a, b))).toBe(3);
    const minus = subtract(a, b);
    expect(minus.weights[AsKh]).toBe(1);
    expect(minus.weights[AsKs]).toBe(0);
    expect(minus.weights[QdQc]).toBe(0);
  });

  it('scales by a scalar or per combo, and normalizes the maximum to 1', () => {
    const range = rangeFromEntries([
      [AsKh, 2],
      [AsKs, 1],
    ]);
    expect(scale(range, 0.5).weights[AsKh]).toBe(1);
    const factor = new Float32Array(COMBO_COUNT).fill(0);
    factor[AsKs] = 0.3;
    const scaled = scale(range, factor);
    expect(scaled.weights[AsKh]).toBe(0);
    expect(scaled.weights[AsKs]).toBeCloseTo(0.3);
    expect(() => scale(range, -1)).toThrow(/negative/);
    expect(maxWeight(normalize(range))).toBe(1);
    expect(normalize(range).weights[AsKs]).toBe(0.5);
    expect(totalCombos(normalize(createRange()))).toBe(0);
  });

  it('warns, without failing, about weights above 1', () => {
    expect(weightWarnings(fullRange())).toEqual([]);
    const above = rangeFromEntries([
      [AsKh, 1.005],
      [AsKs, 1.2],
    ]);
    expect(weightWarnings(above)).toEqual(['2 weights exceed 1 (largest 1.2); normalize to scale the range to 1']);
  });

  it('filters by predicate', () => {
    const pairsOnly = filterByPredicate(fullRange(), (combo) => combo === QdQc || combo === AsKh);
    expect(combosIn(pairsOnly)).toEqual([QdQc, AsKh].sort((x, y) => x - y));
  });

  it('folds combos into the 169-cell matrix with counts and fill fractions', () => {
    const range = rangeFromEntries([
      [AsKh, 1],
      [AsKs, 0.5],
      [QdQc, 0.25],
    ]);
    const cells = toHandClassMatrix(range);
    const ako = cells[handClassOfName('AKo')]!;
    expect(ako.comboCount).toBe(1);
    expect(ako.possibleCombos).toBe(12);
    expect(ako.averageWeight).toBeCloseTo(1 / 12);
    const aks = cells[handClassOfName('AKs')]!;
    expect(aks.averageWeight).toBeCloseTo(0.5 / 4);
    const qq = cells[handClassOfName('QQ')]!;
    expect(qq.weightedCombos).toBeCloseTo(0.25);
    const full = toHandClassMatrix(fullRange());
    expect(full.every((c) => c.averageWeight === 1)).toBe(true);
  });

  it('diffs two ranges per combo and per cell', () => {
    const a = rangeFromEntries([[AsKh, 1]]);
    const b = rangeFromEntries([
      [AsKh, 0.25],
      [QdQc, 1],
    ]);
    const d = diff(a, b);
    expect(d.perCombo[AsKh]).toBeCloseTo(0.75);
    expect(d.perCombo[QdQc]).toBe(-1);
    expect(d.perCell[handClassOfName('AKo')]).toBeCloseTo(0.75 / 12);
    expect(d.perCell[handClassOfName('QQ')]).toBeCloseTo(-1 / 6);
    expect(d.totalAbsolute).toBeCloseTo(1.75);
  });
});
