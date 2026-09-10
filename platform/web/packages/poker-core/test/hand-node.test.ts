/**
 * Stepping through a hand walks the node tree (spec §9.3).
 *
 * Every assertion is the situation a player would say out loud at that point in the hand, so a
 * wrong key is visible as a wrong sentence rather than as a wrong object.
 */

import { describe, expect, it } from 'vitest';

import type { ReplayHand } from '../src/index';
import { nodeKeyAt, nodeKeyLabel } from '../src/index';
import { GG_HAND } from './fixtures/hand';

function labelAt(hand: ReplayHand, index: number): string {
  const key = nodeKeyAt(hand, index);
  return key === null ? '' : nodeKeyLabel(key);
}

describe('nodeKeyAt', () => {
  it('has no situation before anyone has acted', () => {
    expect(nodeKeyAt(GG_HAND, 0)).toBeNull();
    // Blinds are not decisions: posting one does not make a node.
    expect(nodeKeyAt(GG_HAND, 2)).toBeNull();
  });

  it('names the situation each decision creates', () => {
    // Nobody to be effective against yet, so the stack is UTG's own 61.05 at 0.50 blinds.
    expect(labelAt(GG_HAND, 3)).toBe('UTG fold · 122bb · NL50');
    // An open everyone has folded to faces nobody, so the stack quoted is the raiser's own.
    expect(labelAt(GG_HAND, 6)).toBe('BTN RFI · 105bb · NL50');
    expect(labelAt(GG_HAND, 7)).toBe('SB 3-bet vs BTN 3bb · 100bb · NL50');
    expect(labelAt(GG_HAND, 9)).toBe('BTN call vs SB 12bb · 100bb · NL50');
    expect(labelAt(GG_HAND, 10)).toBe('SB bet vs BTN · flop · 100bb · NL50');
  });

  it('ends the sequence with the seat that just acted', () => {
    const key = nodeKeyAt(GG_HAND, 7)!;
    expect(key.hero_position).toBe('SB');
    expect(key.villain_position).toBe('BTN');
    expect(key.action_sequence.map((s) => `${s.position} ${s.action}`)).toEqual([
      'UTG fold',
      'HJ fold',
      'CO fold',
      'BTN raise',
      'SB raise',
    ]);
  });

  it('sizes a preflop raise in blinds and a flop bet in pot share', () => {
    expect(nodeKeyAt(GG_HAND, 7)!.action_sequence.at(-1)).toMatchObject({ size_bb: 12, size_pct: null });
    expect(nodeKeyAt(GG_HAND, 10)!.action_sequence.at(-1)).toMatchObject({ size_bb: null, size_pct: 0.56 });
  });

  it('takes the effective stack from the two seats still involved', () => {
    // Hero has 50 and the button 52.30 at 0.50 blinds: they are playing 100bb, not 105.
    expect(nodeKeyAt(GG_HAND, 7)!.eff_stack_bb).toBe(100);
    expect(nodeKeyAt(GG_HAND, 7)!.table_size).toBe(6);
  });

  it('leaves the board texture to the server', () => {
    expect(nodeKeyAt(GG_HAND, 10)!.board_texture).toEqual([]);
    expect(nodeKeyAt(GG_HAND, 10)!.street).toBe('flop');
  });

  it('refuses to invent a situation when a seat has no position', () => {
    const unknown: ReplayHand = { ...GG_HAND, seats: GG_HAND.seats.map((s) => ({ ...s, position: 'UNKNOWN' })) };
    expect(nodeKeyAt(unknown, 7)).toBeNull();
  });

  it('calls an unraised preflop call a limp', () => {
    const limped: ReplayHand = {
      ...GG_HAND,
      actions: [GG_HAND.actions[0]!, GG_HAND.actions[1]!, { ...GG_HAND.actions[2]!, kind: 'call', amount: 0.5, amountTo: 0.5 }],
    };
    expect(nodeKeyAt(limped, 3)!.action_sequence.at(-1)!.action).toBe('limp');
  });
});
