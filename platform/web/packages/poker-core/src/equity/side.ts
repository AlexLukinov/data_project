/**
 * One side of an exact heads-up computation, seen from a single runout.
 *
 * After `evaluate()` the side knows which of its live combos survive this runout and their
 * ranks. After `index()` it can answer, in O(1), "how much of my weight does a rank beat, tie
 * or lose to" — weights are bucketed by rank (there are only 7,462) and prefix-summed — and, in
 * O(log 51) per card, the same question restricted to the combos holding a given card. That
 * second index is what makes card removal exact: a hero combo (a, b) subtracts the villain
 * combos holding a or b from whatever it beat, tied or lost to, and adds back the combo (a, b)
 * itself, which both lists contained.
 */

import type { Card } from '../cards';
import { CARD_COUNT, COMBO_COUNT } from '../cards';
import type { HandEvaluator } from '../evaluator/types';
import { WORST_RANK } from '../evaluator/types';
import type { WeightedRange } from '../range';
import type { LiveSet } from './live';
import { liveCombos } from './live';

const RANK_SLOTS = WORST_RANK + 1;

export class Side {
  readonly live: LiveSet;
  readonly weights: Float32Array;
  /** Live indices present in the current runout, and their ranks. */
  readonly idx: Int32Array;
  readonly rank: Int32Array;
  m = 0;

  readonly weightByRank = new Float64Array(RANK_SLOTS);
  readonly cumulativeByRank = new Float64Array(RANK_SLOTS);
  total = 0;

  readonly cardStart = new Int32Array(CARD_COUNT + 1);
  private readonly cardFill = new Int32Array(CARD_COUNT);
  readonly segmentRank: Int32Array;
  readonly segmentCumulative: Float64Array;
  readonly segmentTotal = new Float64Array(CARD_COUNT);

  /** Accumulated over runouts, by combo. */
  readonly numerator = new Float64Array(COMBO_COUNT);
  readonly denominator = new Float64Array(COMBO_COUNT);
  readonly winWeight = new Float64Array(COMBO_COUNT);
  readonly tieWeight = new Float64Array(COMBO_COUNT);
  readonly loseWeight = new Float64Array(COMBO_COUNT);

  constructor(range: WeightedRange, dead: Uint8Array) {
    this.live = liveCombos(range, dead);
    this.weights = range.weights;
    this.idx = new Int32Array(this.live.n);
    this.rank = new Int32Array(this.live.n);
    this.segmentRank = new Int32Array(2 * this.live.n);
    this.segmentCumulative = new Float64Array(2 * this.live.n);
  }

  /** Rank every live combo not blocked by the runout. `board` holds the five community cards. */
  evaluate(blocked: Uint8Array, board: readonly Card[], evaluator: HandEvaluator): void {
    const { n, a, b } = this.live;
    const [b0, b1, b2, b3, b4] = board as [Card, Card, Card, Card, Card];
    let m = 0;
    for (let i = 0; i < n; i++) {
      const ca = a[i]!;
      const cb = b[i]!;
      if (blocked[ca] || blocked[cb]) continue;
      this.idx[m] = i;
      this.rank[m] = evaluator.rank7(ca, cb, b0, b1, b2, b3, b4);
      m++;
    }
    this.m = m;
  }

  /** Build the by-rank and by-card indexes for the current runout. */
  index(): void {
    this.indexByRank();
    this.indexByCard();
  }

  private indexByRank(): void {
    const { weightByRank, cumulativeByRank, idx, rank, m } = this;
    const weight = this.live.weight;
    weightByRank.fill(0);
    for (let k = 0; k < m; k++) weightByRank[rank[k]!]! += weight[idx[k]!]!;
    let running = 0;
    for (let r = 0; r < RANK_SLOTS; r++) {
      running += weightByRank[r]!;
      cumulativeByRank[r] = running;
    }
    this.total = running;
  }

  private indexByCard(): void {
    const { cardStart, cardFill, segmentRank, segmentCumulative, segmentTotal, idx, rank, m } = this;
    const { a, b, weight } = this.live;
    cardStart.fill(0);
    for (let k = 0; k < m; k++) {
      cardStart[a[idx[k]!]! + 1]++;
      cardStart[b[idx[k]!]! + 1]++;
    }
    for (let c = 0; c < CARD_COUNT; c++) {
      cardStart[c + 1]! += cardStart[c]!;
      cardFill[c] = cardStart[c]!;
    }
    for (let k = 0; k < m; k++) {
      const i = idx[k]!;
      const r = rank[k]!;
      const w = weight[i]!;
      insertSorted(segmentRank, segmentCumulative, cardStart[a[i]!]!, cardFill[a[i]!]!++, r, w);
      insertSorted(segmentRank, segmentCumulative, cardStart[b[i]!]!, cardFill[b[i]!]!++, r, w);
    }
    for (let c = 0; c < CARD_COUNT; c++) {
      let running = 0;
      for (let p = cardStart[c]!; p < cardStart[c + 1]!; p++) {
        running += segmentCumulative[p]!;
        segmentCumulative[p] = running;
      }
      segmentTotal[c] = running;
    }
  }

  /** Weight of this side's combos holding `card` with a rank below `r` (they beat `r`). */
  cardWeightBelow(card: Card, r: number): number {
    const lo = this.cardStart[card]!;
    const p = firstAtLeast(this.segmentRank, lo, this.cardStart[card + 1]!, r);
    return p > lo ? this.segmentCumulative[p - 1]! : 0;
  }

  /** Weight of this side's combos holding `card` with a rank at or below `r`. */
  cardWeightAtOrBelow(card: Card, r: number): number {
    const lo = this.cardStart[card]!;
    const p = firstAtLeast(this.segmentRank, lo, this.cardStart[card + 1]!, r + 1);
    return p > lo ? this.segmentCumulative[p - 1]! : 0;
  }
}

/** Insert (rank, weight) at position `at`, keeping [start, at] sorted by rank. Segments are ≤ 51 long. */
function insertSorted(ranks: Int32Array, weights: Float64Array, start: number, at: number, rank: number, weight: number): void {
  let p = at;
  while (p > start && ranks[p - 1]! > rank) {
    ranks[p] = ranks[p - 1]!;
    weights[p] = weights[p - 1]!;
    p--;
  }
  ranks[p] = rank;
  weights[p] = weight;
}

/** First index in [lo, hi) whose value is ≥ target, or hi. */
function firstAtLeast(values: Int32Array, lo: number, hi: number, target: number): number {
  let l = lo;
  let h = hi;
  while (l < h) {
    const mid = (l + h) >>> 1;
    if (values[mid]! < target) l = mid + 1;
    else h = mid;
  }
  return l;
}
