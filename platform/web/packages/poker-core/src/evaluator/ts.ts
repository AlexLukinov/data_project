/**
 * The pure-TypeScript evaluator: the fallback that lets every test run without WebAssembly and
 * the reference the WASM binding is checked against.
 *
 * It reproduces Cactus Kev's numbering exactly. Within a category, hands are ordered by their
 * defining ranks in descending lexicographic order — quads by (quad rank, kicker), full houses by
 * (trips, pair), flushes and high cards by the five ranks, and so on — which is what nested
 * descending loops enumerate, so each table is filled in generation order with no sort. The
 * table sizes are the classic ones: 10 + 156 + 156 + 1277 + 10 + 858 + 858 + 2860 + 1277 = 7462.
 *
 * Speed is not the goal here (that is the WASM evaluator's job), correctness and readability are.
 */

import type { Card } from '../cards';
import { ACE, RANK_COUNT, rankOf, suitOf } from '../cards';
import type { HandEvaluator } from './types';
import { RANK_BASE } from './types';

const NO_STRAIGHT = -1;
const WHEEL_MASK = 0b1000000001111; // A 5 4 3 2
const FIVE_HIGH = 3;

/** Highest rank of a straight in a rank bitmask, or NO_STRAIGHT. */
function straightHigh(mask: number): number {
  for (let high = ACE; high >= 4; high--) {
    if (((mask >> (high - 4)) & 0b11111) === 0b11111) return high;
  }
  return (mask & WHEEL_MASK) === WHEEL_MASK ? FIVE_HIGH : NO_STRAIGHT;
}

/** Keep only the five highest set bits. */
function top5(mask: number): number {
  let kept = 0;
  let out = 0;
  for (let r = ACE; r >= 0 && kept < 5; r--) {
    if (mask & (1 << r)) {
      out |= 1 << r;
      kept++;
    }
  }
  return out;
}

// ---- tables, built once ------------------------------------------------------------------

/** Offset of every 5-distinct-rank, non-straight mask in descending order (flushes and high cards). */
const DISTINCT5_OFFSET = new Int16Array(1 << RANK_COUNT).fill(-1);
{
  let offset = 0;
  for (let a = ACE; a >= 4; a--)
    for (let b = a - 1; b >= 3; b--)
      for (let c = b - 1; c >= 2; c--)
        for (let d = c - 1; d >= 1; d--)
          for (let e = d - 1; e >= 0; e--) {
            const mask = (1 << a) | (1 << b) | (1 << c) | (1 << d) | (1 << e);
            if (straightHigh(mask) !== NO_STRAIGHT) continue;
            DISTINCT5_OFFSET[mask] = offset++;
          }
  if (offset !== 1277) throw new Error(`distinct-5 table has ${offset} entries, expected 1277`);
}

/** (major, kicker) pairs with major ≠ kicker: quads and full houses. */
const TWO_RANK_OFFSET = new Int16Array(RANK_COUNT * RANK_COUNT).fill(-1);
{
  let offset = 0;
  for (let major = ACE; major >= 0; major--)
    for (let minor = ACE; minor >= 0; minor--) {
      if (minor === major) continue;
      TWO_RANK_OFFSET[major * RANK_COUNT + minor] = offset++;
    }
  if (offset !== 156) throw new Error(`two-rank table has ${offset} entries, expected 156`);
}

/** (trips, k1 > k2), kickers ≠ trips. */
const TRIPS_OFFSET = new Int16Array(RANK_COUNT ** 3).fill(-1);
{
  let offset = 0;
  for (let t = ACE; t >= 0; t--)
    for (let k1 = ACE; k1 >= 0; k1--) {
      if (k1 === t) continue;
      for (let k2 = k1 - 1; k2 >= 0; k2--) {
        if (k2 === t) continue;
        TRIPS_OFFSET[t * 169 + k1 * RANK_COUNT + k2] = offset++;
      }
    }
  if (offset !== 858) throw new Error(`trips table has ${offset} entries, expected 858`);
}

/** (high pair > low pair, kicker), kicker not a pair rank. */
const TWO_PAIR_OFFSET = new Int16Array(RANK_COUNT ** 3).fill(-1);
{
  let offset = 0;
  for (let p1 = ACE; p1 >= 0; p1--)
    for (let p2 = p1 - 1; p2 >= 0; p2--)
      for (let k = ACE; k >= 0; k--) {
        if (k === p1 || k === p2) continue;
        TWO_PAIR_OFFSET[p1 * 169 + p2 * RANK_COUNT + k] = offset++;
      }
  if (offset !== 858) throw new Error(`two-pair table has ${offset} entries, expected 858`);
}

/** (pair, k1 > k2 > k3), kickers ≠ pair. */
const PAIR_OFFSET = new Int16Array(RANK_COUNT ** 4).fill(-1);
{
  let offset = 0;
  for (let p = ACE; p >= 0; p--)
    for (let k1 = ACE; k1 >= 0; k1--) {
      if (k1 === p) continue;
      for (let k2 = k1 - 1; k2 >= 0; k2--) {
        if (k2 === p) continue;
        for (let k3 = k2 - 1; k3 >= 0; k3--) {
          if (k3 === p) continue;
          PAIR_OFFSET[p * 2197 + k1 * 169 + k2 * RANK_COUNT + k3] = offset++;
        }
      }
    }
  if (offset !== 2860) throw new Error(`pair table has ${offset} entries, expected 2860`);
}

// ---- evaluation --------------------------------------------------------------------------

const rankCounts = new Uint8Array(RANK_COUNT);
const suitCounts = new Uint8Array(4);
const suitMasks = new Uint16Array(4);

/** Highest `n` ranks in the mask, excluding the given ranks; returns them via the out array. */
function topRanks(mask: number, count: number, out: number[], exclude1 = -1, exclude2 = -1): void {
  out.length = 0;
  for (let r = ACE; r >= 0 && out.length < count; r--) {
    if (r === exclude1 || r === exclude2) continue;
    if (mask & (1 << r)) out.push(r);
  }
}

const kickers: number[] = [];

/** Scratch results of `scan()`: the rank bitmask and the flush rank (or -1). */
let scanRankMask = 0;
let scanFlushRank = -1;

/** Count ranks and suits; return a straight-flush rank when there is one, else 0. */
function scan(cards: readonly Card[]): number {
  rankCounts.fill(0);
  suitCounts.fill(0);
  suitMasks.fill(0);
  scanRankMask = 0;
  scanFlushRank = -1;
  for (const card of cards) {
    const r = rankOf(card);
    const s = suitOf(card);
    rankCounts[r]!++;
    suitCounts[s]!++;
    suitMasks[s]! |= 1 << r;
    scanRankMask |= 1 << r;
  }
  for (let s = 0; s < 4; s++) {
    if (suitCounts[s]! >= 5) {
      const high = straightHigh(suitMasks[s]!);
      if (high !== NO_STRAIGHT) return RANK_BASE.straightFlush + (ACE - high);
      scanFlushRank = RANK_BASE.flush + DISTINCT5_OFFSET[top5(suitMasks[s]!)]!;
      break;
    }
  }
  return 0;
}

/** Highest ranks holding four, three (twice) and two (twice) cards, -1 when absent. */
const groups = { quads: -1, trips: -1, secondTrips: -1, highPair: -1, lowPair: -1 };

function groupRanks(): void {
  groups.quads = groups.trips = groups.secondTrips = groups.highPair = groups.lowPair = -1;
  for (let r = ACE; r >= 0; r--) {
    const n = rankCounts[r]!;
    if (n === 4) groups.quads = r;
    else if (n === 3) {
      if (groups.trips < 0) groups.trips = r;
      else if (groups.secondTrips < 0) groups.secondTrips = r;
    } else if (n === 2) {
      if (groups.highPair < 0) groups.highPair = r;
      else if (groups.lowPair < 0) groups.lowPair = r;
    }
  }
}

function rankFromGroups(): number {
  const { quads, trips, secondTrips, highPair, lowPair } = groups;
  const rankMask = scanRankMask;
  if (quads >= 0) {
    topRanks(rankMask, 1, kickers, quads);
    return RANK_BASE.quads + TWO_RANK_OFFSET[quads * RANK_COUNT + kickers[0]!]!;
  }
  if (trips >= 0 && Math.max(secondTrips, highPair) >= 0) {
    return RANK_BASE.fullHouse + TWO_RANK_OFFSET[trips * RANK_COUNT + Math.max(secondTrips, highPair)]!;
  }
  if (scanFlushRank >= 0) return scanFlushRank;
  const straight = straightHigh(rankMask);
  if (straight !== NO_STRAIGHT) return RANK_BASE.straight + (ACE - straight);
  if (trips >= 0) {
    topRanks(rankMask, 2, kickers, trips);
    return RANK_BASE.trips + TRIPS_OFFSET[trips * 169 + kickers[0]! * RANK_COUNT + kickers[1]!]!;
  }
  if (lowPair >= 0) {
    topRanks(rankMask, 1, kickers, highPair, lowPair);
    return RANK_BASE.twoPair + TWO_PAIR_OFFSET[highPair * 169 + lowPair * RANK_COUNT + kickers[0]!]!;
  }
  if (highPair >= 0) {
    topRanks(rankMask, 3, kickers, highPair);
    return RANK_BASE.pair + PAIR_OFFSET[highPair * 2197 + kickers[0]! * 169 + kickers[1]! * RANK_COUNT + kickers[2]!]!;
  }
  return RANK_BASE.highCard + DISTINCT5_OFFSET[top5(rankMask)]!;
}

/**
 * Rank of the best 5-card hand among 5 to 7 cards. Duplicated cards are undefined behaviour,
 * as in every evaluator; callers guarantee distinct cards.
 */
export function evaluateCards(cards: readonly Card[]): number {
  if (cards.length < 5 || cards.length > 7) {
    throw new RangeError(`evaluate needs 5 to 7 cards, got ${cards.length}`);
  }
  const straightFlush = scan(cards);
  if (straightFlush !== 0) return straightFlush;
  groupRanks();
  return rankFromGroups();
}

/** The pure-TypeScript `HandEvaluator`. */
export class TsEvaluator implements HandEvaluator {
  readonly name = 'typescript';

  ready(): Promise<void> {
    return Promise.resolve();
  }

  rank7(c0: Card, c1: Card, c2: Card, c3: Card, c4: Card, c5: Card, c6: Card): number {
    return evaluateCards([c0, c1, c2, c3, c4, c5, c6]);
  }
}

export const tsEvaluator: HandEvaluator = new TsEvaluator();
