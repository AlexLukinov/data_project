/**
 * What each step reveals once the prediction is committed (spec §15).
 *
 * Kept pure and out of the components for two reasons: these are the numbers the user is scored
 * against, so they get their own tests with hand-counted answers; and a reveal must be computable
 * only *after* the commit, which is easier to guarantee when it is one function call at one place.
 */
import type { Card, ComboIndex, DrawClass, MadeHandClass, WeightedRange } from '@poker/core';
import {
  MADE_HAND_CLASSES,
  classifyCombos,
  comboIndex,
  isRealDraw,
  removeCards,
  weightedCombos,
} from '@poker/core';

const PERCENT = 100;
const MIN_BOARD = 3;
const MAX_BOARD = 5;
const TOP_PAIR = MADE_HAND_CLASSES.indexOf('top_pair');
/** Above this share of its own range, a hand is the top of it. */
const VALUE_FROM = 0.7;
/** Below this, it has nothing worth protecting. */
const GIVE_UP_BELOW = 0.35;

/**
 * Whether the classifier can read this board: three to five cards.
 *
 * A board is dealt one card at a time, so every board-reading panel sees illegal boards on the
 * way — and `classifyCombos` throws on them, which takes the whole step's render down with it.
 */
export function isDealt(board: readonly Card[]): boolean {
  return board.length >= MIN_BOARD && board.length <= MAX_BOARD;
}

/** A share as the percentage the gate compares against, to one decimal. */
export function asPercent(share: number): string {
  return (share * PERCENT).toFixed(1);
}

function weightOf(range: WeightedRange, combo: ComboIndex): number {
  return range.weights[combo] ?? 0;
}

/**
 * A range as it can exist on this board (ADR-071).
 *
 * Every count below is a count of *hands somebody can be holding*, so the combos a board card
 * makes impossible are not in it — neither in what is counted nor in what it is counted out of.
 * `classifyCombos` already refuses to classify a blocked combo, so a denominator taken from the
 * whole range divided a live numerator by a dead total: on the shipped examples that understated
 * step 3's answer by 2 to 3 points, and on a range full of board cards by nine. It is also what
 * `distribute` does for the distribution panel the step draws beside the question, which is how
 * the two came to disagree on one screen.
 */
function onBoard(range: WeightedRange, board: readonly Card[]): WeightedRange {
  return removeCards(range, board);
}

/** The weighted share of a range that is top pair or better on this board. */
export function topPairOrBetterShare(range: WeightedRange, board: readonly Card[]): number {
  if (!isDealt(board)) return 0;
  const live = onBoard(range, board);
  const total = weightedCombos(live);
  if (total === 0) return 0;
  let strong = 0;
  classifyCombos(live, board).forEach((classification, combo) => {
    if (classification === undefined) return;
    if (MADE_HAND_CLASSES.indexOf(classification.made) <= TOP_PAIR) strong += weightOf(live, combo);
  });
  return strong / total;
}

/**
 * How many of a range's weighted combos two cards make impossible — of the combos it could still
 * hold. A combo the board had already killed is not one your hand removes.
 */
export function combosRemoved(range: WeightedRange, board: readonly Card[], cards: readonly Card[]): number {
  const live = isDealt(board) ? onBoard(range, board) : range;
  return weightedCombos(live) - weightedCombos(removeCards(live, cards));
}

/** How many flush-draw combos a range still holds once the dead cards are gone. */
export function flushDrawCombos(range: WeightedRange, board: readonly Card[], dead: readonly Card[]): number {
  if (!isDealt(board)) return 0;
  const live = removeCards(range, dead);
  let draws = 0;
  classifyCombos(live, board).forEach((classification, combo) => {
    if (classification?.draws.includes('flush_draw') === true) draws += weightOf(live, combo);
  });
  return draws;
}

/**
 * Where a combo sits inside its own range: the weighted share of the range it beats by
 * made-hand class. Class order, not equity — it is instant, and it is how a player reads a
 * board at the table.
 */
export function classPercentile(range: WeightedRange, board: readonly Card[], hole: readonly Card[]): number | null {
  if (hole.length !== 2 || !isDealt(board)) return null;
  const mine = comboIndex(hole[0]!, hole[1]!);
  const live = onBoard(range, board);
  const classes = classifyCombos(live, board);
  const own = classes[mine];
  if (own === undefined) return null;
  const rank = MADE_HAND_CLASSES.indexOf(own.made);
  const total = weightedCombos(live);
  if (total === 0) return null;
  let weaker = 0;
  classes.forEach((classification, combo) => {
    if (classification !== undefined && MADE_HAND_CLASSES.indexOf(classification.made) > rank) {
      weaker += weightOf(live, combo);
    }
  });
  return weaker / total;
}

export type HandRole = 'value' | 'protection' | 'semi-bluff' | 'give-up';

/**
 * What a hand is *for*, from where it sits in its own range and what it is drawing to.
 *
 * A rule of thumb, and shown as one: the top of the range is value, a real draw below that is a
 * semi-bluff, a made hand in the middle wants protection and the bottom is a give-up. No solver
 * is consulted, and the screen says so.
 */
export function roleOf(percentile: number, made: MadeHandClass, draws: readonly DrawClass[]): HandRole {
  if (percentile >= VALUE_FROM) return 'value';
  if (draws.some(isRealDraw)) return 'semi-bluff';
  return percentile >= GIVE_UP_BELOW && made !== 'no_pair' ? 'protection' : 'give-up';
}

/** Bluff combos for every value combo, or `null` when nothing has been marked as value. */
export function bluffToValue(value: WeightedRange | null, bluff: WeightedRange | null): number | null {
  const valueCombos = value === null ? 0 : weightedCombos(value);
  if (valueCombos === 0) return null;
  return (bluff === null ? 0 : weightedCombos(bluff)) / valueCombos;
}
