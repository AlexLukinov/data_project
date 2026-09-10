/**
 * The fast 7-card evaluator the equity engine runs on: two lookup tables and no allocation.
 *
 * With seven cards, at most one suit can hold five or more, and when it does the best hand is
 * always a flush or straight flush in that suit (the two off-suit cards cannot build quads or a
 * full house around five distinct-rank suited cards). So:
 *
 *   flush present → FLUSH[rank bitmask of that suit]            (8,192 entries, 4,719 used)
 *   otherwise     → NO_FLUSH[perfect hash of the rank counts]    (49,205 entries)
 *
 * The rank counts of seven cards form a sequence of 13 digits in 0..4 summing to 7; there are
 * exactly 49,205 such sequences, and the hash is their lexicographic index, computed with a
 * small table of "how many sequences complete this prefix" counts. This is the same idea as
 * PokerHandEvaluator's `hash_quinary`; the tables here are built at first use from the
 * reference evaluator in `ts.ts`, not copied.
 */

import type { Card } from '../cards';
import { CARD_COUNT, RANK_COUNT, makeCard } from '../cards';
import { evaluateCards } from './ts';
import type { HandEvaluator } from './types';

const HAND_SIZE = 7;
const MAX_COUNT = 4;
const NO_FLUSH_SIZE = 49_205;
const FLUSH_MIN = 5;
/** Suit counts packed in 3-bit fields: adding SUIT_STEP[suit] bumps that suit's count. */
const SUIT_STEP = [1, 1 << 3, 1 << 6, 1 << 9];

/** dp[len][sum] = number of digit sequences (digits 0..4) of length len whose digits sum to sum. */
function buildDp(): number[][] {
  const dp: number[][] = Array.from({ length: RANK_COUNT + 1 }, () => new Array<number>(HAND_SIZE + 1).fill(0));
  dp[0]![0] = 1;
  for (let len = 1; len <= RANK_COUNT; len++)
    for (let sum = 0; sum <= HAND_SIZE; sum++)
      for (let d = 0; d <= MAX_COUNT && d <= sum; d++) dp[len]![sum]! += dp[len - 1]![sum - d]!;
  return dp;
}

/**
 * PREFIX[(i * 8 + remaining) * 5 + d] = number of valid sequences whose digit at position i is
 * below d, given `remaining` still to place at positions i..12. Summing these over the
 * positions of a sequence gives its lexicographic index.
 */
function buildPrefix(dp: number[][]): Int32Array {
  const table = new Int32Array(RANK_COUNT * (HAND_SIZE + 1) * (MAX_COUNT + 1));
  for (let i = 0; i < RANK_COUNT; i++)
    for (let remaining = 0; remaining <= HAND_SIZE; remaining++) {
      let below = 0;
      for (let d = 0; d <= MAX_COUNT; d++) {
        table[(i * (HAND_SIZE + 1) + remaining) * (MAX_COUNT + 1) + d] = below;
        if (d <= remaining) below += dp[RANK_COUNT - 1 - i]![remaining - d]!;
      }
    }
  return table;
}

/** Fill NO_FLUSH by visiting every rank-count sequence with a flush-free representative hand. */
function fillNoFlush(prefix: Int32Array, table: Int16Array): void {
  const counts = new Uint8Array(RANK_COUNT);
  const cards: Card[] = [];
  let filled = 0;
  const visit = (rank: number, remaining: number, index: number): void => {
    if (rank === RANK_COUNT) {
      if (remaining !== 0) return;
      table[index] = evaluateCards(cards);
      filled++;
      return;
    }
    for (let d = 0; d <= MAX_COUNT && d <= remaining; d++) {
      counts[rank] = d;
      // Suits go round-robin across the whole hand: a rank's copies get distinct suits and
      // no suit reaches five cards, so the representative can never be a flush.
      for (let k = 0; k < d; k++) cards.push(makeCard(rank, cards.length & 3));
      visit(rank + 1, remaining - d, index + prefix[(rank * (HAND_SIZE + 1) + remaining) * (MAX_COUNT + 1) + d]!);
      cards.length -= d;
    }
    counts[rank] = 0;
  };
  visit(0, HAND_SIZE, 0);
  if (filled !== NO_FLUSH_SIZE) throw new Error(`no-flush table filled ${filled} entries, expected ${NO_FLUSH_SIZE}`);
}

/** Fill FLUSH: for every rank mask with five or more bits, the rank of those cards in one suit. */
function fillFlush(table: Int16Array): void {
  for (let mask = 0; mask < 1 << RANK_COUNT; mask++) {
    const cards: Card[] = [];
    for (let r = 0; r < RANK_COUNT; r++) if (mask & (1 << r)) cards.push(makeCard(r, 0));
    if (cards.length >= FLUSH_MIN && cards.length <= HAND_SIZE) table[mask] = evaluateCards(cards);
  }
}

interface Tables {
  readonly prefix: Int32Array;
  readonly noFlush: Int16Array;
  readonly flush: Int16Array;
}

let tables: Tables | null = null;

function buildTables(): Tables {
  const prefix = buildPrefix(buildDp());
  const noFlush = new Int16Array(NO_FLUSH_SIZE);
  fillNoFlush(prefix, noFlush);
  const flush = new Int16Array(1 << RANK_COUNT);
  fillFlush(flush);
  return { prefix, noFlush, flush };
}

/** The tables, built on first use (about 50k reference evaluations, well under a second). */
export function fastTables(): Tables {
  if (tables === null) tables = buildTables();
  return tables;
}

const counts = new Uint8Array(RANK_COUNT);
const RANK_OF = new Uint8Array(CARD_COUNT).map((_, c) => c >> 2);
const SUIT_OF = new Uint8Array(CARD_COUNT).map((_, c) => c & 3);

/** Rank of the best five of seven distinct cards; lower is stronger. Tables must be built. */
export function fastRank7(t: Tables, c0: Card, c1: Card, c2: Card, c3: Card, c4: Card, c5: Card, c6: Card): number {
  const suits =
    SUIT_STEP[SUIT_OF[c0]!]! + SUIT_STEP[SUIT_OF[c1]!]! + SUIT_STEP[SUIT_OF[c2]!]! + SUIT_STEP[SUIT_OF[c3]!]! +
    SUIT_STEP[SUIT_OF[c4]!]! + SUIT_STEP[SUIT_OF[c5]!]! + SUIT_STEP[SUIT_OF[c6]!]!;
  for (let s = 0; s < 4; s++) {
    if (((suits >> (3 * s)) & 7) >= FLUSH_MIN) {
      let mask = 0;
      if (SUIT_OF[c0] === s) mask |= 1 << RANK_OF[c0]!;
      if (SUIT_OF[c1] === s) mask |= 1 << RANK_OF[c1]!;
      if (SUIT_OF[c2] === s) mask |= 1 << RANK_OF[c2]!;
      if (SUIT_OF[c3] === s) mask |= 1 << RANK_OF[c3]!;
      if (SUIT_OF[c4] === s) mask |= 1 << RANK_OF[c4]!;
      if (SUIT_OF[c5] === s) mask |= 1 << RANK_OF[c5]!;
      if (SUIT_OF[c6] === s) mask |= 1 << RANK_OF[c6]!;
      return t.flush[mask]!;
    }
  }
  counts.fill(0);
  counts[RANK_OF[c0]!]!++;
  counts[RANK_OF[c1]!]!++;
  counts[RANK_OF[c2]!]!++;
  counts[RANK_OF[c3]!]!++;
  counts[RANK_OF[c4]!]!++;
  counts[RANK_OF[c5]!]!++;
  counts[RANK_OF[c6]!]!++;
  let index = 0;
  let remaining = HAND_SIZE;
  for (let r = 0; r < RANK_COUNT && remaining > 0; r++) {
    const d = counts[r]!;
    if (d === 0) continue;
    index += t.prefix[(r * (HAND_SIZE + 1) + remaining) * (MAX_COUNT + 1) + d]!;
    remaining -= d;
  }
  return t.noFlush[index]!;
}

/** The table-driven `HandEvaluator`; `ready()` builds the tables. */
export class FastEvaluator implements HandEvaluator {
  readonly name = 'typescript-tables';

  ready(): Promise<void> {
    fastTables();
    return Promise.resolve();
  }

  rank7(c0: Card, c1: Card, c2: Card, c3: Card, c4: Card, c5: Card, c6: Card): number {
    return fastRank7(fastTables(), c0, c1, c2, c3, c4, c5, c6);
  }
}

export const fastEvaluator: HandEvaluator = new FastEvaluator();
