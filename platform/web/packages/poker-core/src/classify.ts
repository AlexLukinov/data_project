/**
 * Hand classification against a board (spec §7.1 and §8): the made-hand class and the draw
 * classes of two hole cards on a 3–5 card board. This backs the distribution panel and the
 * blocker breakdown.
 *
 * Classes are RELATIVE to the board, as Flopzilla and GTO Wizard bucket them: a board that
 * pairs itself does not give every hand "a pair". The rule: first the absolute category of hole
 * cards + board; if it is a straight or better and the hole cards actually improve on what the
 * board makes alone, that category is the class. Otherwise the class comes from how the hole
 * cards touch the board — set vs trips, both cards paired, which board card is paired, pocket
 * pair over or under the board — and finally ace-high / king-high / nothing.
 */

import type { Card, Rank } from './cards';
import { ACE, COMBO_COUNT, KING, comboCards, rankOf, suitOf } from './cards';
import { evaluateCards } from './evaluator/ts';
import { Category, categoryOfRank } from './evaluator/types';
import type { WeightedRange } from './range';

export type MadeHandClass =
  | 'straight_flush'
  | 'quads'
  | 'full_house'
  | 'flush'
  | 'straight'
  | 'set'
  | 'trips'
  | 'two_pair'
  | 'overpair'
  | 'top_pair'
  | 'under_pair'
  | 'second_pair'
  | 'third_pair'
  | 'weak_pair'
  | 'ace_high'
  | 'king_high'
  | 'no_pair';

export const MADE_HAND_CLASSES: readonly MadeHandClass[] = [
  'straight_flush',
  'quads',
  'full_house',
  'flush',
  'straight',
  'set',
  'trips',
  'two_pair',
  'overpair',
  'top_pair',
  'under_pair',
  'second_pair',
  'third_pair',
  'weak_pair',
  'ace_high',
  'king_high',
  'no_pair',
];

export type DrawClass =
  | 'flush_draw'
  | 'backdoor_flush_draw'
  | 'open_ended_straight_draw'
  | 'gutshot'
  | 'backdoor_straight_draw'
  | 'combo_draw'
  | 'no_draw';

export const DRAW_CLASSES: readonly DrawClass[] = [
  'flush_draw',
  'backdoor_flush_draw',
  'open_ended_straight_draw',
  'gutshot',
  'backdoor_straight_draw',
  'combo_draw',
  'no_draw',
];

export interface HandClassification {
  readonly made: MadeHandClass;
  /** Every draw the hand has; `['no_draw']` when none. A combo can carry a made hand and draws. */
  readonly draws: readonly DrawClass[];
}

const FLOP = 3;
const RIVER = 5;

function rankMaskOf(cards: readonly Card[]): number {
  let mask = 0;
  for (const c of cards) mask |= 1 << rankOf(c);
  return mask;
}

function hasStraight(mask: number): boolean {
  for (let high = ACE; high >= 4; high--) if (((mask >> (high - 4)) & 0b11111) === 0b11111) return true;
  return (mask & 0b1000000001111) === 0b1000000001111;
}

/** Category of a board alone; boards of 3 or 4 cards cannot hold a straight or flush. */
function boardCategory(board: readonly Card[]): Category {
  if (board.length >= 5) return categoryOfRank(evaluateCards(board));
  const counts = new Uint8Array(13);
  for (const c of board) counts[rankOf(c)]!++;
  let pairs = 0;
  let best = Category.HighCard;
  for (const n of counts) {
    if (n === 4) return Category.Quads;
    if (n === 3) best = Category.Trips;
    if (n === 2) pairs++;
  }
  if (best === Category.Trips) return best;
  if (pairs >= 2) return Category.TwoPair;
  return pairs === 1 ? Category.Pair : Category.HighCard;
}

/** Distinct board ranks, highest first. */
function boardRanksDesc(board: readonly Card[]): Rank[] {
  return [...new Set(board.map(rankOf))].sort((a, b) => b - a);
}

function classifyByPairs(hole: readonly [Card, Card], board: readonly Card[]): MadeHandClass {
  const r0 = rankOf(hole[0]);
  const r1 = rankOf(hole[1]);
  const boardRanks = boardRanksDesc(board);
  const countOnBoard = (r: Rank): number => board.filter((c) => rankOf(c) === r).length;

  if (r0 === r1) {
    const onBoard = countOnBoard(r0);
    if (onBoard >= 2) return 'quads';
    if (onBoard === 1) return 'set';
    return r0 > boardRanks[0]! ? 'overpair' : 'under_pair';
  }

  const hits = [r0, r1].filter((r) => countOnBoard(r) > 0);
  if (hits.length === 2) return 'two_pair';
  if (hits.length === 1) {
    const r = hits[0]!;
    const onBoard = countOnBoard(r);
    if (onBoard === 3) return 'quads';
    if (onBoard === 2) return 'trips';
    const position = boardRanks.indexOf(r);
    if (position === 0) return 'top_pair';
    if (position === 1) return 'second_pair';
    if (position === 2) return 'third_pair';
    return 'weak_pair';
  }
  const high = Math.max(r0, r1);
  if (high === ACE) return 'ace_high';
  if (high === KING) return 'king_high';
  return 'no_pair';
}

const BIG_CATEGORY_CLASS: Partial<Record<Category, MadeHandClass>> = {
  [Category.StraightFlush]: 'straight_flush',
  [Category.Quads]: 'quads',
  [Category.FullHouse]: 'full_house',
  [Category.Flush]: 'flush',
  [Category.Straight]: 'straight',
};

/** The made-hand class of two hole cards on a 3–5 card board. */
export function classifyMadeHand(hole: readonly [Card, Card], board: readonly Card[]): MadeHandClass {
  if (board.length < FLOP || board.length > RIVER) {
    throw new RangeError(`a board has 3 to 5 cards, got ${board.length}`);
  }
  const all = [hole[0], hole[1], ...board];
  const rank = evaluateCards(all);
  const category = categoryOfRank(rank);
  const big = BIG_CATEGORY_CLASS[category];
  if (big !== undefined) {
    const boardOnly = boardCategory(board);
    if (category > boardOnly) return big;
    // Same category as the board alone: the hole cards count only if they make it better.
    if (board.length === RIVER && rank < evaluateCards(board)) return big;
    if (board.length < RIVER && category > boardOnly) return big;
  }
  return classifyByPairs(hole, board);
}

/** Whether a straight exists in `mask` that needs at least one hole-card rank. */
function straightUsesHole(boardMask: number, holeMask: number, extraMask: number): boolean {
  return hasStraight(boardMask | holeMask | extraMask) && !hasStraight(boardMask | extraMask);
}

/** Ranks whose arrival completes a straight for the hole cards, given the current board. */
function straightOuts(boardMask: number, holeMask: number): number {
  let outs = 0;
  for (let r = 0; r <= ACE; r++) {
    const bit = 1 << r;
    if ((boardMask | holeMask) & bit) continue;
    if (straightUsesHole(boardMask, holeMask, bit)) outs++;
  }
  return outs;
}

/** Whether two more cards (distinct ranks, neither held) could complete a straight for the hole cards. */
function hasBackdoorStraight(boardMask: number, holeMask: number): boolean {
  for (let a = 0; a <= ACE; a++) {
    if ((boardMask | holeMask) & (1 << a)) continue;
    for (let b = a + 1; b <= ACE; b++) {
      if ((boardMask | holeMask) & (1 << b)) continue;
      if (straightUsesHole(boardMask, holeMask, (1 << a) | (1 << b))) return true;
    }
  }
  return false;
}

/** The draw classes of two hole cards on a 3–4 card board; on the river there are no draws. */
export function classifyDraws(hole: readonly [Card, Card], board: readonly Card[], made: MadeHandClass): DrawClass[] {
  if (board.length >= RIVER) return ['no_draw'];
  const draws: DrawClass[] = [];

  const madeFlush = made === 'flush' || made === 'straight_flush';
  if (!madeFlush) {
    const suitCounts = [0, 0, 0, 0];
    const holeSuits = [0, 0, 0, 0];
    for (const c of board) suitCounts[suitOf(c)]!++;
    for (const c of hole) {
      suitCounts[suitOf(c)]!++;
      holeSuits[suitOf(c)]!++;
    }
    for (let s = 0; s < 4; s++) {
      if (holeSuits[s] === 0) continue;
      if (suitCounts[s] === 4) draws.push('flush_draw');
      else if (suitCounts[s] === 3 && board.length === FLOP) draws.push('backdoor_flush_draw');
    }
  }

  const madeStraight = made === 'straight' || made === 'straight_flush';
  if (!madeStraight) {
    const boardMask = rankMaskOf(board);
    const holeMask = rankMaskOf(hole);
    const outs = straightOuts(boardMask, holeMask);
    if (outs >= 2) draws.push('open_ended_straight_draw');
    else if (outs === 1) draws.push('gutshot');
    else if (board.length === FLOP && hasBackdoorStraight(boardMask, holeMask)) draws.push('backdoor_straight_draw');
  }

  const realDraws = draws.filter((d) => d === 'flush_draw' || d === 'open_ended_straight_draw' || d === 'gutshot');
  const hasPair = made !== 'ace_high' && made !== 'king_high' && made !== 'no_pair';
  if (realDraws.length >= 2 || (realDraws.length === 1 && hasPair)) draws.push('combo_draw');

  return draws.length === 0 ? ['no_draw'] : draws;
}

/** Made-hand class and draws of two hole cards on a board. */
export function classifyHand(hole: readonly [Card, Card], board: readonly Card[]): HandClassification {
  const made = classifyMadeHand(hole, board);
  return { made, draws: classifyDraws(hole, board, made) };
}

/** A draw that adds outs now (backdoors do not). */
export function isRealDraw(draw: DrawClass): boolean {
  return draw === 'flush_draw' || draw === 'open_ended_straight_draw' || draw === 'gutshot' || draw === 'combo_draw';
}

/**
 * Classify every live combo of a range on a board; indexed by combo, `undefined` where the
 * combo has no weight or shares a card with the board.
 */
export function classifyCombos(range: WeightedRange, board: readonly Card[]): (HandClassification | undefined)[] {
  const out = new Array<HandClassification | undefined>(COMBO_COUNT);
  const onBoard = new Set(board);
  for (let combo = 0; combo < COMBO_COUNT; combo++) {
    if (range.weights[combo]! <= 0) continue;
    const [a, b] = comboCards(combo);
    if (onBoard.has(a) || onBoard.has(b)) continue;
    out[combo] = classifyHand([a, b], board);
  }
  return out;
}
