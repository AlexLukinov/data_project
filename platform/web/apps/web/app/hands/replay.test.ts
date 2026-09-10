import { describe, expect, it } from 'vitest';

import type { HandDetail } from './api';
import { seatToWatch, toReplayHand } from './replay';

const DETAIL: HandDetail = {
  hand_uid: 'abc',
  site: 'ggpoker',
  site_hand_id: 'RC1',
  played_at_utc: '2026-01-16T14:22:31Z',
  game_type: 'holdem',
  stake_level: 'NL50',
  big_blind: 0.5,
  board: ['8h', '5d', '2s'],
  total_pot: 12.5,
  rake: 0.56,
  players: [
    { seat: 1, screen_name: '6a4f2b91', position: 'BTN', is_hero: false, is_anonymized: true, starting_stack: 52.3, hole_cards: '', net_won: -6, net_won_bb: -12, went_to_showdown: false, won_hand: false },
    { seat: 2, screen_name: 'Hero', position: 'SB', is_hero: true, is_anonymized: false, starting_stack: 50, hole_cards: 'Qh Qs', net_won: 5.94, net_won_bb: 11.88, went_to_showdown: false, won_hand: true },
  ],
  actions: [{ action_index: 0, street: 'preflop', seat: 2, action_type: 'post_sb', amount: 0.25, amount_to: 0.25, pot_before: 0, to_call: 0, is_allin: false }],
};

describe('toReplayHand', () => {
  it('renames the wire fields without changing a value', () => {
    const hand = toReplayHand(DETAIL);
    expect(hand.handUid).toBe('abc');
    expect(hand.bigBlind).toBe(0.5);
    expect(hand.seats[1]).toMatchObject({ seat: 2, name: 'Hero', position: 'SB', isHero: true, cards: ['Qh', 'Qs'], wonHand: true });
    expect(hand.seats[0]!.cards).toEqual([]);
    expect(hand.actions[0]).toMatchObject({ index: 0, seat: 2, kind: 'post_sb', amount: 0.25, potBefore: 0 });
  });

  it('refuses an action kind the model does not know', () => {
    const strange = { ...DETAIL, actions: [{ ...DETAIL.actions[0]!, action_type: 'teleports' }] };
    expect(() => toReplayHand(strange)).toThrow(/unknown action type "teleports"/);
  });
});

describe('seatToWatch', () => {
  it('prefers hero, then what the list asked for, then the first seat', () => {
    const hand = toReplayHand(DETAIL);
    expect(seatToWatch(hand, 1)).toBe(2);
    const noHero = toReplayHand({ ...DETAIL, players: DETAIL.players.map((p) => ({ ...p, is_hero: false })) });
    expect(seatToWatch(noHero, 1)).toBe(1);
    expect(seatToWatch(noHero, null)).toBe(1);
  });
});
