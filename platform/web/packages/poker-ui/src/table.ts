/** The view model behind `PokerTable`: one hand plus one state becomes seats you can draw. */

import type { HandState, ReplayAction, ReplayHand } from '@poker/core';
import { cardToString, parseCard } from '@poker/core';

import type { SUIT_NAMES } from './format';
import { cardLabel, suitName } from './format';

export interface TableSeat {
  readonly seat: number;
  readonly name: string;
  readonly position: string;
  /** Chips behind, at this point in the hand. */
  readonly stack: number;
  /** Chips in front of the seat on the current street. */
  readonly committed: number;
  /** Cards to show face up; empty means face down (or out of the hand). */
  readonly cards: readonly string[];
  readonly isHero: boolean;
  readonly folded: boolean;
  readonly allIn: boolean;
  readonly wonHand: boolean;
}

export interface ShownCard {
  readonly text: string;
  readonly rank: string;
  readonly suit: string;
  readonly suitName: (typeof SUIT_NAMES)[number];
}

/** A card for display, or null when the text is not a card (an unrevealed hand, a stray value). */
export function shownCard(text: string): ShownCard | null {
  try {
    const card = parseCard(text);
    const label = cardLabel(card);
    return { text: cardToString(card), rank: label.slice(0, -1), suit: label.slice(-1), suitName: suitName(card) };
  } catch {
    return null;
  }
}

export function shownCards(cards: readonly string[]): ShownCard[] {
  return cards.map(shownCard).filter((c): c is ShownCard => c !== null);
}

/** Seats as they stand at `state`, in seat order. */
export function tableSeats(hand: ReplayHand, state: HandState): TableSeat[] {
  const chips = new Map(state.seats.map((s) => [s.seat, s]));
  return hand.seats.map((seat) => {
    const now = chips.get(seat.seat);
    return {
      seat: seat.seat,
      name: seat.name,
      position: seat.position,
      stack: now?.stack ?? seat.stack,
      committed: now?.committed ?? 0,
      cards: seat.cards,
      isHero: seat.isHero,
      folded: now?.folded ?? false,
      allIn: now?.allIn ?? false,
      wonHand: seat.wonHand,
    };
  });
}

const VERBS: Record<string, string> = {
  post_sb: 'posts the small blind',
  post_bb: 'posts the big blind',
  post_ante: 'posts an ante',
  post_straddle: 'straddles',
  post_dead: 'posts dead',
  fold: 'folds',
  check: 'checks',
  call: 'calls',
  bet: 'bets',
  raise: 'raises to',
  allin: 'is all in for',
  show: 'shows',
  muck: 'mucks',
  uncalled_return: 'takes back',
  win: 'wins',
};
const NO_AMOUNT = new Set(['fold', 'check', 'muck']);

/** `raises to 6.00`, `checks`, `calls 4.50` — the action log line, without the seat's name. */
export function actionText(action: ReplayAction, money: (value: number) => string): string {
  const verb = VERBS[action.kind] ?? action.kind;
  if (NO_AMOUNT.has(action.kind)) return verb;
  const amount = action.kind === 'raise' && action.amountTo > 0 ? action.amountTo : action.amount;
  const allIn = action.isAllIn && action.kind !== 'allin' ? ' and is all in' : '';
  return `${verb} ${money(amount)}${allIn}`;
}
