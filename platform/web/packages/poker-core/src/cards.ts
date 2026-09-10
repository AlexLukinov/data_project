/**
 * Cards, combos and the 169 hand classes — the spec's §4.1 model.
 *
 * A card is an integer 0..51: `rank * 4 + suit`, ranks 2..A → 0..12, suits c,d,h,s → 0..3. The
 * suit order matters: it fixes the canonical spelling of a combo (§4.3) and it is the same
 * encoding PokerHandEvaluator uses, so card ids go to the WASM evaluator untouched.
 *
 * A combo is an integer 0..1325. For two distinct cards a < b, `comboIndex = b(b-1)/2 + a`: the
 * higher card chooses a triangle row, the lower card the column. Both directions are O(1) — the
 * reverse uses two 1326-entry lookup tables built once at module load.
 */

/** A card id, 0..51. */
export type Card = number;
/** A combo id, 0..1325. */
export type ComboIndex = number;
/** A rank, 0 (deuce) .. 12 (ace). */
export type Rank = number;
/** A suit, 0 (clubs) .. 3 (spades). */
export type Suit = number;
/** One of the 169 cells of the hand matrix, 0..168. */
export type HandClass = number;

export const RANK_CHARS = '23456789TJQKA';
export const SUIT_CHARS = 'cdhs';
export const RANK_COUNT = 13;
export const SUIT_COUNT = 4;
export const CARD_COUNT = 52;
export const COMBO_COUNT = 1326;
export const HAND_CLASS_COUNT = 169;

export const ACE: Rank = 12;
export const KING: Rank = 11;

/** A card string that is not a card. Carries the offending text for error messages. */
export class CardError extends Error {
  constructor(
    message: string,
    readonly text: string,
  ) {
    super(message);
    this.name = 'CardError';
  }
}

/** Build a card id from its rank and suit. */
export function makeCard(rank: Rank, suit: Suit): Card {
  return rank * SUIT_COUNT + suit;
}

/** The rank of a card, 0..12. */
export function rankOf(card: Card): Rank {
  return card >> 2;
}

/** The suit of a card, 0..3. */
export function suitOf(card: Card): Suit {
  return card & 3;
}

/** Parse `As`, `td`, `2C` (either case) into a card id. */
export function parseCard(text: string): Card {
  if (text.length !== 2) {
    throw new CardError(`"${text}" is not a card: expected a rank and a suit, like As or Td`, text);
  }
  const rank = RANK_CHARS.indexOf(text[0]!.toUpperCase());
  const suit = SUIT_CHARS.indexOf(text[1]!.toLowerCase());
  if (rank < 0) {
    throw new CardError(`"${text}" is not a card: the rank must be one of ${RANK_CHARS}`, text);
  }
  if (suit < 0) {
    throw new CardError(`"${text}" is not a card: the suit must be one of ${SUIT_CHARS}`, text);
  }
  return makeCard(rank, suit);
}

/** Parse `As Kd`, `As,Kd`, or the concatenated `AsKd` into card ids. Duplicates are an error. */
export function parseCards(text: string): Card[] {
  const compact = text.replace(/[\s,]+/g, '');
  if (compact.length % 2 !== 0) {
    throw new CardError(`"${text}" is not a list of cards: each card is a rank and a suit`, text);
  }
  const cards: Card[] = [];
  for (let i = 0; i < compact.length; i += 2) {
    const card = parseCard(compact.slice(i, i + 2));
    if (cards.includes(card)) {
      throw new CardError(`"${text}" lists ${cardToString(card)} twice`, text);
    }
    cards.push(card);
  }
  return cards;
}

/** `As`, `Td` — uppercase rank, lowercase suit, as every range view prints them. */
export function cardToString(card: Card): string {
  return RANK_CHARS[rankOf(card)]! + SUIT_CHARS[suitOf(card)]!;
}

// ---- combos ------------------------------------------------------------------------------

/** The combo id of two distinct cards, in either order. */
export function comboIndex(a: Card, b: Card): ComboIndex {
  if (a === b) {
    throw new CardError(`a combo needs two different cards, got ${cardToString(a)} twice`, cardToString(a));
  }
  const lo = a < b ? a : b;
  const hi = a < b ? b : a;
  return (hi * (hi - 1)) / 2 + lo;
}

const COMBO_HIGH = new Uint8Array(COMBO_COUNT);
const COMBO_LOW = new Uint8Array(COMBO_COUNT);
for (let hi = 1; hi < CARD_COUNT; hi++) {
  for (let lo = 0; lo < hi; lo++) {
    const index = (hi * (hi - 1)) / 2 + lo;
    COMBO_HIGH[index] = hi;
    COMBO_LOW[index] = lo;
  }
}

/** The two cards of a combo, higher card id first (= the canonical spelling order). */
export function comboCards(combo: ComboIndex): [Card, Card] {
  return [COMBO_HIGH[combo]!, COMBO_LOW[combo]!];
}

/**
 * Canonical spelling (§4.3): higher rank first; equal ranks → higher suit first with c < d < h < s.
 * Because a card id is `rank * 4 + suit`, that is simply the higher card id first.
 */
export function comboToString(combo: ComboIndex): string {
  return cardToString(COMBO_HIGH[combo]!) + cardToString(COMBO_LOW[combo]!);
}

/** Parse a combo spelled as two concatenated cards, any case, any order. */
export function parseCombo(text: string): ComboIndex {
  const cards = parseCards(text);
  if (cards.length !== 2) {
    throw new CardError(`"${text}" is not a combo: expected exactly two cards, like AsKh`, text);
  }
  return comboIndex(cards[0]!, cards[1]!);
}

/** Whether the combo contains the card. */
export function comboHasCard(combo: ComboIndex, card: Card): boolean {
  return COMBO_HIGH[combo] === card || COMBO_LOW[combo] === card;
}

/** Whether two combos share at least one card (the card-removal test). */
export function combosShareCard(a: ComboIndex, b: ComboIndex): boolean {
  const ah = COMBO_HIGH[a]!;
  const al = COMBO_LOW[a]!;
  const bh = COMBO_HIGH[b]!;
  const bl = COMBO_LOW[b]!;
  return ah === bh || ah === bl || al === bh || al === bl;
}

/** For each card, the 51 combos that contain it. Blockers and card removal walk these lists. */
export const COMBOS_WITH_CARD: readonly (readonly ComboIndex[])[] = (() => {
  const lists: ComboIndex[][] = Array.from({ length: CARD_COUNT }, () => []);
  for (let combo = 0; combo < COMBO_COUNT; combo++) {
    lists[COMBO_HIGH[combo]!]!.push(combo);
    lists[COMBO_LOW[combo]!]!.push(combo);
  }
  return lists;
})();

// ---- hand classes (the 13×13 matrix) -----------------------------------------------------

/**
 * Matrix layout, as every range editor draws it: row 0 / column 0 is the ace, row 12 / column 12
 * the deuce. Diagonal = pairs, above the diagonal (row < column) = suited, below = offsuit. The
 * class id is `row * 13 + column`.
 */
export function handClassOf(combo: ComboIndex): HandClass {
  const hi = COMBO_HIGH[combo]!;
  const lo = COMBO_LOW[combo]!;
  const highRank = rankOf(hi);
  const lowRank = rankOf(lo);
  if (highRank === lowRank) {
    return (ACE - highRank) * RANK_COUNT + (ACE - highRank);
  }
  const suited = suitOf(hi) === suitOf(lo);
  const row = suited ? ACE - highRank : ACE - lowRank;
  const column = suited ? ACE - lowRank : ACE - highRank;
  return row * RANK_COUNT + column;
}

/** Row and column of a class in the matrix. */
export function handClassCell(cls: HandClass): { row: number; column: number } {
  return { row: Math.floor(cls / RANK_COUNT), column: cls % RANK_COUNT };
}

export function isPairClass(cls: HandClass): boolean {
  const { row, column } = handClassCell(cls);
  return row === column;
}

export function isSuitedClass(cls: HandClass): boolean {
  const { row, column } = handClassCell(cls);
  return row < column;
}

/** `AA`, `AKs`, `AKo`. */
export function handClassName(cls: HandClass): string {
  const { row, column } = handClassCell(cls);
  const first = RANK_CHARS[ACE - Math.min(row, column)]!;
  const second = RANK_CHARS[ACE - Math.max(row, column)]!;
  if (row === column) return first + second;
  return first + second + (row < column ? 's' : 'o');
}

/** Parse `AA`, `AKs`, `t9o` (any case). Unpaired names need the `s`/`o` suffix here. */
export function handClassOfName(name: string): HandClass {
  const upper = name.toUpperCase();
  const a = RANK_CHARS.indexOf(upper[0] ?? '');
  const b = RANK_CHARS.indexOf(upper[1] ?? '');
  const suffix = upper.slice(2);
  if (a < 0 || b < 0 || upper.length > 3) {
    throw new CardError(`"${name}" is not a hand class like AA, AKs or T9o`, name);
  }
  const high = Math.max(a, b);
  const low = Math.min(a, b);
  if (high === low) {
    if (suffix !== '') throw new CardError(`"${name}": a pair has no suited/offsuit suffix`, name);
    return (ACE - high) * RANK_COUNT + (ACE - high);
  }
  if (suffix === 'S') return (ACE - high) * RANK_COUNT + (ACE - low);
  if (suffix === 'O') return (ACE - low) * RANK_COUNT + (ACE - high);
  throw new CardError(`"${name}" needs a suffix: ${name.slice(0, 2)}s (suited) or ${name.slice(0, 2)}o (offsuit)`, name);
}

/** The combos of each class: 6 for a pair, 4 suited, 12 offsuit. */
export const HAND_CLASS_COMBOS: readonly (readonly ComboIndex[])[] = (() => {
  const lists: ComboIndex[][] = Array.from({ length: HAND_CLASS_COUNT }, () => []);
  for (let combo = 0; combo < COMBO_COUNT; combo++) {
    lists[handClassOf(combo)]!.push(combo);
  }
  return lists;
})();

/** Class of every combo, precomputed. */
export const HAND_CLASS_OF_COMBO: Uint8Array = (() => {
  const table = new Uint8Array(COMBO_COUNT);
  for (let combo = 0; combo < COMBO_COUNT; combo++) table[combo] = handClassOf(combo);
  return table;
})();
