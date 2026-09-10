/**
 * One real hand, as the API returns it.
 *
 * These are the exact values `POST /v1/hands/parse` produces for the first hand of
 * `platform/seeds/hands/ggpoker/rush_nl50.txt` — a GGPoker Rush & Cash NL50 hand where hero
 * 3-bets QQ from the small blind, c-bets a dry flop and takes it down. Using the parser's own
 * output means the replay engine is tested against what it will actually be handed, including
 * the `pot_before` and `to_call` the parser reckoned.
 */

import type { ReplayAction, ReplayHand, ReplaySeat } from '../../src/index';

function seat(seat: number, name: string, position: string, stack: number, extra: Partial<ReplaySeat> = {}): ReplaySeat {
  return { seat, name, position, stack, isHero: false, isAnonymous: true, cards: [], wonHand: false, netWon: 0, ...extra };
}

function act(index: number, street: ReplayAction['street'], seat: number, kind: ReplayAction['kind'], amount: number, amountTo: number, potBefore: number): ReplayAction {
  return { index, street, seat, kind, amount, amountTo, potBefore, isAllIn: false };
}

/** `to_call` as the parser reckoned it, action by action — the replay engine must agree. */
export const TO_CALL: readonly number[] = [0, 0.25, 0.5, 0.5, 0.5, 0.5, 1.25, 5.5, 4.5, 0, 7, 0, 0];

export const GG_HAND: ReplayHand = {
  handUid: '38dcad35079a4607e9f2e7ca17e01a87',
  site: 'ggpoker',
  siteHandId: 'RC1851234567',
  playedAt: '2026-01-16T14:22:31Z',
  stake: 'NL50',
  bigBlind: 0.5,
  board: ['8h', '5d', '2s'],
  totalPot: 12.5,
  rake: 0.56,
  seats: [
    seat(1, '6a4f2b91', 'BTN', 52.3, { netWon: -6 }),
    seat(2, 'Hero', 'SB', 50, { isHero: true, isAnonymous: false, cards: ['Qh', 'Qs'], wonHand: true, netWon: 5.94 }),
    seat(3, 'c81d7e40', 'BB', 38.75, { netWon: -0.5 }),
    seat(4, '2f9a0c53', 'UTG', 61.05),
    seat(5, '7b3e1d68', 'HJ', 44.2),
    seat(6, 'e50c8a17', 'CO', 29.9),
  ],
  actions: [
    act(0, 'preflop', 2, 'post_sb', 0.25, 0.25, 0),
    act(1, 'preflop', 3, 'post_bb', 0.5, 0.5, 0.25),
    act(2, 'preflop', 4, 'fold', 0, 0, 0.75),
    act(3, 'preflop', 5, 'fold', 0, 0, 0.75),
    act(4, 'preflop', 6, 'fold', 0, 0, 0.75),
    act(5, 'preflop', 1, 'raise', 1.5, 1.5, 0.75),
    act(6, 'preflop', 2, 'raise', 5.75, 6, 2.25),
    act(7, 'preflop', 3, 'fold', 0, 0.5, 8),
    act(8, 'preflop', 1, 'call', 4.5, 6, 8),
    act(9, 'flop', 2, 'bet', 7, 7, 12.5),
    act(10, 'flop', 1, 'fold', 0, 0, 19.5),
    act(11, 'flop', 2, 'uncalled_return', 7, 0, 19.5),
    act(12, 'flop', 2, 'muck', 0, 0, 12.5),
  ],
};
