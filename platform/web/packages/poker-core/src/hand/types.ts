/**
 * One hand as the replayer sees it (spec §9), and the table state at a point inside it.
 *
 * The shape mirrors the API's `HandDetail` field for field but in this package's own naming, so
 * `poker-core` stays free of the wire format: the app converts once, and a stored hand, a pool
 * hand and a pasted one arrive here identically (ADR-029).
 */

import type { Street } from '../node';

/** Every action kind `core.enums.ActionType` can emit. Bookkeeping ones move chips too. */
export const ACTION_KINDS = ['post_sb', 'post_bb', 'post_ante', 'post_straddle', 'post_dead', 'fold', 'check', 'call', 'bet', 'raise', 'allin', 'show', 'muck', 'uncalled_return', 'win'] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

/** Streets an action can carry — `showdown` is not a betting round, so it is not a `Street`. */
export type ActionStreet = Street | 'showdown';

/** Kinds that move chips from a stack into the pot. */
export const CONTRIBUTING: ReadonlySet<ActionKind> = new Set<ActionKind>(['post_sb', 'post_bb', 'post_ante', 'post_straddle', 'post_dead', 'call', 'bet', 'raise', 'allin']);

/** Kinds that are a player's own decision — what the action log numbers and a node ends on. */
export const DECISIONS: ReadonlySet<ActionKind> = new Set<ActionKind>(['fold', 'check', 'call', 'bet', 'raise', 'allin']);

export interface ReplaySeat {
  readonly seat: number;
  readonly name: string;
  /** `BTN`, `SB`, … or `UNKNOWN` when the hand did not let the parser derive one. */
  readonly position: string;
  readonly isHero: boolean;
  readonly isAnonymous: boolean;
  /** Chips at the start of the hand, in the table's currency. */
  readonly stack: number;
  /** Hole cards, when the hand revealed them: hero's always, a villain's at showdown. */
  readonly cards: readonly string[];
  readonly wonHand: boolean;
  readonly netWon: number;
}

export interface ReplayAction {
  readonly index: number;
  readonly street: ActionStreet;
  readonly seat: number;
  readonly kind: ActionKind;
  /** Chips this action added to the pot (or returned/awarded, for the bookkeeping kinds). */
  readonly amount: number;
  /** For raises, the total being raised **to**. Zero elsewhere. */
  readonly amountTo: number;
  /** What was in the middle when this action was taken, as the parser reckoned it. */
  readonly potBefore: number;
  readonly isAllIn: boolean;
}

export interface ReplayHand {
  readonly handUid: string;
  readonly site: string;
  readonly siteHandId: string;
  readonly playedAt: string;
  readonly stake: string;
  readonly bigBlind: number;
  /** Every board card the hand dealt, in order. What is *visible* is per state. */
  readonly board: readonly string[];
  readonly totalPot: number;
  readonly rake: number;
  readonly seats: readonly ReplaySeat[];
  readonly actions: readonly ReplayAction[];
}

export interface SeatState {
  readonly seat: number;
  /** Chips still behind. */
  readonly stack: number;
  /** Chips in front of this seat on the current street. */
  readonly committed: number;
  /** Chips this seat has put in over the whole hand. */
  readonly invested: number;
  readonly folded: boolean;
  readonly allIn: boolean;
}

export interface HandState {
  /** How many actions have been applied: 0 is the deal, `actions.length` is the end. */
  readonly index: number;
  readonly street: Street;
  /** Board cards face up at this point. */
  readonly board: readonly string[];
  /** Everything in the middle, including chips committed on the current street. */
  readonly pot: number;
  /** The seat about to act, or null at the end of the hand. */
  readonly actor: number | null;
  /** What the seat about to act must put in to continue. */
  readonly toCall: number;
  /** The action that produced this state, or null at the deal. */
  readonly last: ReplayAction | null;
  readonly seats: readonly SeatState[];
}
