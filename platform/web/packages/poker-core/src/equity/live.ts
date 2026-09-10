/**
 * The live part of a range: combos with a positive weight that do not touch a dead card. Kept
 * as parallel typed arrays so the hot loops never touch an object.
 */

import type { Card } from '../cards';
import { CARD_COUNT, COMBO_COUNT, comboCards } from '../cards';
import type { WeightedRange } from '../range';

export interface LiveSet {
  readonly n: number;
  readonly combo: Int32Array;
  readonly weight: Float64Array;
  /** Higher card id of each combo. */
  readonly a: Uint8Array;
  /** Lower card id of each combo. */
  readonly b: Uint8Array;
  readonly totalWeight: number;
}

/** Flags for the cards in `cards`, indexed by card id. */
export function cardFlags(cards: readonly Card[]): Uint8Array {
  const flags = new Uint8Array(CARD_COUNT);
  for (const c of cards) flags[c] = 1;
  return flags;
}

export function liveCombos(range: WeightedRange, dead: Uint8Array): LiveSet {
  const combo = new Int32Array(COMBO_COUNT);
  const weight = new Float64Array(COMBO_COUNT);
  const a = new Uint8Array(COMBO_COUNT);
  const b = new Uint8Array(COMBO_COUNT);
  let n = 0;
  let totalWeight = 0;
  for (let i = 0; i < COMBO_COUNT; i++) {
    const w = range.weights[i]!;
    if (w <= 0) continue;
    const [hi, lo] = comboCards(i);
    if (dead[hi] || dead[lo]) continue;
    combo[n] = i;
    weight[n] = w;
    a[n] = hi;
    b[n] = lo;
    totalWeight += w;
    n++;
  }
  return { n, combo: combo.subarray(0, n), weight: weight.subarray(0, n), a: a.subarray(0, n), b: b.subarray(0, n), totalWeight };
}
