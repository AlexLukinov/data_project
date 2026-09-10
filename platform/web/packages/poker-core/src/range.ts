/**
 * Weighted ranges — the spec's §4.2. A range is 1326 non-negative weights indexed by combo.
 * Weights are not capped at 1 (real exports carry 1.005); `normalize` scales the maximum to 1 and
 * `weightWarnings` reports anything above 1 without blocking.
 *
 * Set semantics for weighted ranges: intersect = per-combo minimum, union = per-combo maximum,
 * subtract = per-combo difference clamped at zero. These are the fuzzy-set definitions; for
 * "the part of the range that takes action X with frequency f" use `scale` with a per-combo
 * factor, which multiplies.
 *
 * Every function returns a new range; nothing mutates its arguments.
 */

import type { Card, ComboIndex, HandClass } from './cards';
import { COMBOS_WITH_CARD, COMBO_COUNT, HAND_CLASS_COMBOS, HAND_CLASS_COUNT, HAND_CLASS_OF_COMBO } from './cards';
import { formatWeight } from './numbers';

export interface WeightedRange {
  /** Length 1326, indexed by combo. 0 = not in range. */
  readonly weights: Float32Array;
  readonly label?: string;
}

/** An empty range (every weight 0), or one built from an existing weight array (copied). */
export function createRange(weights?: ArrayLike<number>, label?: string): WeightedRange {
  const copy = new Float32Array(COMBO_COUNT);
  if (weights !== undefined) {
    if (weights.length !== COMBO_COUNT) {
      throw new RangeError(`a range has ${COMBO_COUNT} weights, got ${weights.length}`);
    }
    for (let i = 0; i < COMBO_COUNT; i++) copy[i] = weights[i]!;
  }
  return label === undefined ? { weights: copy } : { weights: copy, label };
}

/** Every combo at weight 1. */
export function fullRange(label?: string): WeightedRange {
  const range = createRange(undefined, label);
  range.weights.fill(1);
  return range;
}

/** A range from (combo, weight) pairs; a combo listed twice keeps the last weight. */
export function rangeFromEntries(entries: Iterable<readonly [ComboIndex, number]>, label?: string): WeightedRange {
  const range = createRange(undefined, label);
  for (const [combo, weight] of entries) range.weights[combo] = weight;
  return range;
}

/** Count of combos with a positive weight. */
export function totalCombos(range: WeightedRange): number {
  let n = 0;
  for (let i = 0; i < COMBO_COUNT; i++) if (range.weights[i]! > 0) n++;
  return n;
}

/** Sum of the weights. */
export function weightedCombos(range: WeightedRange): number {
  let sum = 0;
  for (let i = 0; i < COMBO_COUNT; i++) sum += range.weights[i]!;
  return sum;
}

/** The largest weight, 0 for an empty range. */
export function maxWeight(range: WeightedRange): number {
  let max = 0;
  for (let i = 0; i < COMBO_COUNT; i++) if (range.weights[i]! > max) max = range.weights[i]!;
  return max;
}

/** Non-blocking warnings about the weights (spec §4.2: weights above 1 are accepted, flagged). */
export function weightWarnings(range: WeightedRange): string[] {
  let above = 0;
  let max = 0;
  for (let i = 0; i < COMBO_COUNT; i++) {
    const w = range.weights[i]!;
    if (w > 1) {
      above++;
      if (w > max) max = w;
    }
  }
  if (above === 0) return [];
  return [aboveOneWarning(above, max)];
}

/** The one sentence every parser and editor uses for weights above 1. */
export function aboveOneWarning(count: number, largest: number): string {
  return `${count} weight${count === 1 ? ' exceeds' : 's exceed'} 1 (largest ${formatWeight(largest)}); normalize to scale the range to 1`;
}

/** Zero every combo that contains one of the cards (dead cards, the board, hero's hand). */
export function removeCards(range: WeightedRange, cards: readonly Card[]): WeightedRange {
  const out = createRange(range.weights, range.label);
  for (const card of cards) for (const combo of COMBOS_WITH_CARD[card]!) out.weights[combo] = 0;
  return out;
}

function combine(a: WeightedRange, b: WeightedRange, f: (x: number, y: number) => number): WeightedRange {
  const out = createRange();
  for (let i = 0; i < COMBO_COUNT; i++) out.weights[i] = f(a.weights[i]!, b.weights[i]!);
  return out;
}

/** Per-combo minimum. */
export function intersect(a: WeightedRange, b: WeightedRange): WeightedRange {
  return combine(a, b, Math.min);
}

/** Per-combo maximum. */
export function union(a: WeightedRange, b: WeightedRange): WeightedRange {
  return combine(a, b, Math.max);
}

/** Per-combo `a - b`, never below zero. */
export function subtract(a: WeightedRange, b: WeightedRange): WeightedRange {
  return combine(a, b, (x, y) => Math.max(0, x - y));
}

/** Multiply every weight by a scalar, or by a per-combo factor (an action frequency per combo). */
export function scale(range: WeightedRange, factor: number | ArrayLike<number>): WeightedRange {
  const out = createRange(undefined, range.label);
  if (typeof factor === 'number') {
    if (factor < 0) throw new RangeError(`a scale factor cannot be negative, got ${factor}`);
    for (let i = 0; i < COMBO_COUNT; i++) out.weights[i] = range.weights[i]! * factor;
    return out;
  }
  if (factor.length !== COMBO_COUNT) {
    throw new RangeError(`a per-combo factor has ${COMBO_COUNT} entries, got ${factor.length}`);
  }
  for (let i = 0; i < COMBO_COUNT; i++) out.weights[i] = range.weights[i]! * factor[i]!;
  return out;
}

/** Scale so the largest weight is exactly 1. An empty range stays empty. */
export function normalize(range: WeightedRange): WeightedRange {
  const max = maxWeight(range);
  return max === 0 ? createRange(range.weights, range.label) : scale(range, 1 / max);
}

/** Keep the combos the predicate accepts, zero the rest. */
export function filterByPredicate(range: WeightedRange, keep: (combo: ComboIndex) => boolean): WeightedRange {
  const out = createRange(undefined, range.label);
  for (let i = 0; i < COMBO_COUNT; i++) if (range.weights[i]! > 0 && keep(i)) out.weights[i] = range.weights[i]!;
  return out;
}

/** The combos with a positive weight, ascending. */
export function combosIn(range: WeightedRange): ComboIndex[] {
  const out: ComboIndex[] = [];
  for (let i = 0; i < COMBO_COUNT; i++) if (range.weights[i]! > 0) out.push(i);
  return out;
}

/** One cell of the 13×13 matrix. */
export interface HandClassCell {
  readonly cls: HandClass;
  /** Combos of this class with a positive weight. */
  readonly comboCount: number;
  /** Sum of the weights over the class. */
  readonly weightedCombos: number;
  /** Combos the class has before any removal: 6, 4 or 12. */
  readonly possibleCombos: number;
  /** `weightedCombos / possibleCombos`: the fill fraction the matrix paints. */
  readonly averageWeight: number;
}

/** The 169 cells, indexed by class. */
export function toHandClassMatrix(range: WeightedRange): HandClassCell[] {
  const cells: HandClassCell[] = [];
  for (let cls = 0; cls < HAND_CLASS_COUNT; cls++) {
    let count = 0;
    let sum = 0;
    for (const combo of HAND_CLASS_COMBOS[cls]!) {
      const w = range.weights[combo]!;
      if (w > 0) {
        count++;
        sum += w;
      }
    }
    const possible = HAND_CLASS_COMBOS[cls]!.length;
    cells.push({ cls, comboCount: count, weightedCombos: sum, possibleCombos: possible, averageWeight: sum / possible });
  }
  return cells;
}

/** `a - b`, per combo and per cell (average weight), for the range comparison view. */
export interface RangeDiff {
  readonly perCombo: Float32Array;
  readonly perCell: Float32Array;
  /** Sum over combos of `|a - b|`. */
  readonly totalAbsolute: number;
}

export function diff(a: WeightedRange, b: WeightedRange): RangeDiff {
  const perCombo = new Float32Array(COMBO_COUNT);
  const perCell = new Float32Array(HAND_CLASS_COUNT);
  let totalAbsolute = 0;
  for (let i = 0; i < COMBO_COUNT; i++) {
    const d = a.weights[i]! - b.weights[i]!;
    perCombo[i] = d;
    totalAbsolute += Math.abs(d);
    const cls = HAND_CLASS_OF_COMBO[i]!;
    perCell[cls]! += d / HAND_CLASS_COMBOS[cls]!.length;
  }
  return { perCombo, perCell, totalAbsolute };
}
