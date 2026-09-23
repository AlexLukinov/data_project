/**
 * Board texture — the TypeScript twin of `dbt/poker_dwh/macros/board.sql` (plan H.3, ADR-083).
 *
 * The pool buckets a board in SQL when the marts are built; the replayer needs the same buckets
 * in the browser to key a node by texture (`nodeKeyAt`). Two implementations of one rule drift
 * unless something holds them together, so both are run over
 * `tests/fixtures/board_texture.json`: `texture.test.ts` here, and the Python suite's
 * `test_board_texture_fixture.py`, which runs the same boards through the dbt macros themselves.
 * The values are the registry's (`stats/registry/dimensions.yaml`), and `textureTags` returns
 * them in the board hierarchy of ADR-079 — the flop class, then the turn, then the river — which
 * is also the order `TEXTURE_DIMENSIONS` in `analysis/pool/node_filter.py` looks a tag up in.
 *
 * Ranks are counted as the SQL counts them, 1 (deuce) to 13 (ace), with the ace duplicated as 0
 * so that it plays low as well as high.
 */

import type { Card } from './cards';
import { CardError, cardToString, parseCards, rankOf, suitOf } from './cards';

export const FLOP_SUITEDNESS = ['monotone', 'two_tone', 'rainbow'] as const;
export type FlopSuitedness = (typeof FLOP_SUITEDNESS)[number];
export const FLOP_PAIRING = ['trips', 'paired', 'unpaired'] as const;
export type FlopPairing = (typeof FLOP_PAIRING)[number];
export const FLOP_CONNECTIVITY = ['connected', 'oesd', 'disconnected'] as const;
export type FlopConnectivity = (typeof FLOP_CONNECTIVITY)[number];
export const FLOP_HIGH_CARD_CLASS = ['ace', 'king_queen', 'jack_ten', 'middle', 'low'] as const;
export type FlopHighCardClass = (typeof FLOP_HIGH_CARD_CLASS)[number];
/** In order of precedence: the first that applies is the card's class. */
export const TURN_CHANGE = ['turn_flush', 'turn_straight', 'turn_pair', 'turn_flush_draw', 'turn_overcard', 'turn_blank'] as const;
export type TurnChange = (typeof TURN_CHANGE)[number];
/** As the turn, without the draw: on the river there is no card to come. */
export const RIVER_CHANGE = ['river_flush', 'river_straight', 'river_pair', 'river_overcard', 'river_blank'] as const;
export type RiverChange = (typeof RIVER_CHANGE)[number];

export interface FlopTexture {
  readonly suitedness: FlopSuitedness;
  readonly pairing: FlopPairing;
  readonly connectivity: FlopConnectivity;
  readonly highCardClass: FlopHighCardClass;
}

const ACE_NO = 13;
const QUEEN_NO = 11;
const TEN_NO = 9;
const SEVEN_NO = 6;
const FLOP_CARDS = 3;
const MAX_BOARD_CARDS = 5;
/** Five-card windows start at 0 (A2345) through 9 (TJQKA). */
const STRAIGHT_WINDOWS = 10;
/** Four-card windows open at both ends start at 1 (2345) through 9 (TJQK): A234 and JQKA are one-ended. */
const OESD_FIRST_WINDOW = 1;
const OESD_WINDOWS = 9;

function rankNo(card: Card): number {
  return rankOf(card) + 1;
}

/** The distinct ranks with the ace duplicated as 0 — `ranks_ace_low` in board.sql. */
function ranksAceLow(ranks: readonly number[]): number[] {
  const distinct = new Set(ranks);
  if (distinct.has(ACE_NO)) distinct.add(0);
  return [...distinct];
}

function countWithin(ranks: readonly number[], low: number, width: number): number {
  return ranks.filter((rank) => rank >= low && rank <= low + width).length;
}

/**
 * How many board cards take part in the best straight — `straight_cards` in board.sql: the most
 * distinct board ranks inside any one five-card window. Three means some two-card holding has a
 * straight, four a one-card straight, five that the straight is on the board.
 */
function straightCards(ranks: readonly number[]): number {
  const aceLow = ranksAceLow(ranks);
  let best = 0;
  for (let low = 0; low < STRAIGHT_WINDOWS; low++) best = Math.max(best, countWithin(aceLow, low, 4));
  return best;
}

/** Three board ranks inside one five-card window: some two-card holding has a straight. */
function straightPossible(ranks: readonly number[]): boolean {
  return straightCards(ranks) >= 3;
}

/** Two board ranks inside one four-card window open at both ends: an OESD is available (ADR-075). */
function oesdPossible(ranks: readonly number[]): boolean {
  const aceLow = ranksAceLow(ranks);
  for (let low = OESD_FIRST_WINDOW; low < OESD_FIRST_WINDOW + OESD_WINDOWS; low++) {
    if (countWithin(aceLow, low, 3) >= 2) return true;
  }
  return false;
}

function alike(values: readonly number[]): 'all' | 'two' | 'none' {
  const [a, b, c] = values as [number, number, number];
  if (a === b && b === c) return 'all';
  return a === b || b === c || a === c ? 'two' : 'none';
}

function spell(cards: readonly Card[]): string {
  return cards.map(cardToString).join(' ');
}

/** The four flop classes of the registry (`flop_*` in dimensions.yaml). Exactly three cards. */
export function flopTexture(flop: readonly Card[]): FlopTexture {
  if (flop.length !== FLOP_CARDS) {
    throw new CardError(`a flop has ${FLOP_CARDS} cards, not ${flop.length}`, spell(flop));
  }
  const ranks = flop.map(rankNo);
  const suits = flop.map(suitOf);
  const suitsAlike = alike(suits);
  const ranksAlike = alike(ranks);
  const high = Math.max(...ranks);
  return {
    suitedness: suitsAlike === 'all' ? 'monotone' : suitsAlike === 'two' ? 'two_tone' : 'rainbow',
    pairing: ranksAlike === 'all' ? 'trips' : ranksAlike === 'two' ? 'paired' : 'unpaired',
    connectivity: straightPossible(ranks) ? 'connected' : oesdPossible(ranks) ? 'oesd' : 'disconnected',
    highCardClass: high === ACE_NO ? 'ace' : high >= QUEEN_NO ? 'king_queen' : high >= TEN_NO ? 'jack_ten' : high >= SEVEN_NO ? 'middle' : 'low',
  };
}

/**
 * What one more card made — `street_change` in board.sql, the first class in order of
 * precedence: a flush (at least two of its suit were already there, so the third, fourth or
 * fifth of a suit), a straight (the card takes part in a straight that needs fewer hole cards
 * than before), a paired board, a flush draw (exactly one of its suit before; turn only), an
 * overcard above every earlier card, else a blank (ADR-082).
 */
function streetChange(before: readonly Card[], card: Card, draws: boolean): 'flush' | 'straight' | 'pair' | 'flush_draw' | 'overcard' | 'blank' {
  const beforeRanks = before.map(rankNo);
  const sameSuit = before.filter((c) => suitOf(c) === suitOf(card)).length;
  const rank = rankNo(card);
  if (sameSuit >= 2) return 'flush';
  const after = straightCards([...beforeRanks, rank]);
  if (after >= 3 && after > straightCards(beforeRanks)) return 'straight';
  if (beforeRanks.includes(rank)) return 'pair';
  if (draws && sameSuit === 1) return 'flush_draw';
  if (rank > Math.max(...beforeRanks)) return 'overcard';
  return 'blank';
}

/** The registry's `turn_change` for `turn` after the three-card `flop`. */
export function turnChange(flop: readonly Card[], turn: Card): TurnChange {
  if (flop.length !== FLOP_CARDS) {
    throw new CardError(`the turn follows a flop of ${FLOP_CARDS} cards, not ${flop.length}`, spell(flop));
  }
  return `turn_${streetChange(flop, turn, true)}`;
}

/** The registry's `river_change` for `river` after the four-card `board`. */
export function riverChange(board: readonly Card[], river: Card): RiverChange {
  if (board.length !== FLOP_CARDS + 1) {
    throw new CardError(`the river follows a board of ${FLOP_CARDS + 1} cards, not ${board.length}`, spell(board));
  }
  const change = streetChange(board, river, false);
  if (change === 'flush_draw') throw new CardError('a river card cannot bring a draw', spell(board));
  return `river_${change}`;
}

/**
 * The `board_texture` tags of a board as `ReplayHand.board` spells it (`['Qh', '7h', '2s']`):
 * nothing for no board, the four flop classes for a flop, plus the turn's class for four cards
 * and the river's for five — each a value of one registry dimension, in hierarchy order, and
 * never the raw high-card rank. A board of one, two or more than five cards, a misspelt card
 * or a card dealt twice is an error, not a guess.
 */
export function textureTags(board: readonly string[]): string[] {
  if (board.length === 0) return [];
  if (board.length < FLOP_CARDS || board.length > MAX_BOARD_CARDS) {
    throw new CardError(`a board has ${FLOP_CARDS} to ${MAX_BOARD_CARDS} cards, not ${board.length}`, board.join(' '));
  }
  const cards = parseCards(board.join(' '));
  if (cards.length !== board.length) {
    // parseCards re-pairs the characters, so '' or 'AhKh' as one element would pass as cards.
    throw new CardError(`"${board.join(' ')}" is not a list of ${board.length} cards`, board.join(' '));
  }
  const flop = cards.slice(0, FLOP_CARDS);
  const texture = flopTexture(flop);
  const tags: string[] = [texture.suitedness, texture.pairing, texture.connectivity, texture.highCardClass];
  if (cards.length > FLOP_CARDS) tags.push(turnChange(flop, cards[FLOP_CARDS]!));
  if (cards.length === MAX_BOARD_CARDS) tags.push(riverChange(cards.slice(0, FLOP_CARDS + 1), cards[MAX_BOARD_CARDS - 1]!));
  return tags;
}
