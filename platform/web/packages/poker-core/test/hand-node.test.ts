/**
 * Stepping through a hand walks the node tree (spec §9.3).
 *
 * Every assertion is the situation a player would say out loud at that point in the hand, so a
 * wrong key is visible as a wrong sentence rather than as a wrong object.
 */

import { describe, expect, it } from 'vitest';

import type { BucketRanges, ReplayHand } from '../src/index';
import { nodeKeyAt, nodeKeyLabel } from '../src/index';
import { GG_HAND } from './fixtures/hand';

function labelAt(hand: ReplayHand, index: number): string {
  const key = nodeKeyAt(hand, index);
  return key === null ? '' : nodeKeyLabel(key);
}

/** The registry's `facing_size_pct` buckets as `/v1/definitions` would hand them over — data here, never a rule. */
const REGISTRY_BUCKETS: BucketRanges = { small: [0, 0.37], mid: [0.37, 0.6], large: [0.6, 0.85], pot: [0.85, 1.1], overbet: [1.1, null] };

describe('nodeKeyAt', () => {
  it('has no situation before anyone has acted', () => {
    expect(nodeKeyAt(GG_HAND, 0)).toBeNull();
    // Blinds are not decisions: posting one does not make a node.
    expect(nodeKeyAt(GG_HAND, 2)).toBeNull();
  });

  it('names the situation each decision creates', () => {
    // The stack is the fact's: hero's chips behind against the most any live seat has behind,
    // before the decision. UTG's 61.05 is capped by the button's 52.30 at 0.50 blinds.
    expect(labelAt(GG_HAND, 3)).toBe('UTG fold · 105bb · NL50');
    // Three have folded; the button's 52.30 is capped by the small blind's 49.75 behind its post.
    expect(labelAt(GG_HAND, 6)).toBe('BTN RFI · 100bb · NL50');
    expect(labelAt(GG_HAND, 7)).toBe('SB 3-bet vs BTN 3bb · 100bb · NL50');
    // The 3-bettor has 44.00 behind by the time the button answers: 88bb, not the 100 at the deal.
    expect(labelAt(GG_HAND, 9)).toBe('BTN call vs SB 12bb · 88bb · NL50');
    expect(labelAt(GG_HAND, 10)).toBe('SB bet vs BTN · flop · 88bb · NL50');
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

  it('takes the effective stack from the chips behind before the decision, as the fact does', () => {
    // Before the 3-bet hero has 49.75 behind and the button 50.80 at 0.50 blinds: 100bb, not 105.
    expect(nodeKeyAt(GG_HAND, 7)!.eff_stack_bb).toBe(100);
    expect(nodeKeyAt(GG_HAND, 7)!.table_size).toBe(6);
    // Before the flop bet the small blind has 44.00 behind and the button 46.30: 88bb.
    expect(nodeKeyAt(GG_HAND, 10)!.eff_stack_bb).toBe(88);
  });

  it('tags the board face up at the step, and nothing before the flop', () => {
    expect(nodeKeyAt(GG_HAND, 7)!.board_texture).toEqual([]);
    const flop = nodeKeyAt(GG_HAND, 10)!;
    expect(flop.street).toBe('flop');
    // 8h 5d 2s: the four flop classes, suitedness first.
    expect(flop.board_texture).toHaveLength(4);
    expect(flop.board_texture[0]).toBe('rainbow');
  });

  it("carries hero's own earlier streets as the line, this street's steps as the sequence (ADR-078)", () => {
    // Preflop the sequence is the whole line, and a stored preflop key spells that null.
    expect(nodeKeyAt(GG_HAND, 7)!.line_so_far).toBeNull();
    expect(nodeKeyAt(GG_HAND, 9)!.line_so_far).toBeNull();
    // The SB bets the flop: it 3-bet preflop and has not acted on the flop yet.
    expect(nodeKeyAt(GG_HAND, 10)!.line_so_far).toBe('r/');
    // The button folds to the c-bet: opened, called the 3-bet, first flop decision.
    const fold = nodeKeyAt(GG_HAND, 11)!;
    expect(fold.hero_position).toBe('BTN');
    expect(fold.line_so_far).toBe('r-c/');
    expect(fold.action_sequence.map((s) => `${s.position} ${s.action}`)).toEqual(['SB bet', 'BTN fold']);
  });

  it('names how the pot was built once there is a flop, not while it is still being built', () => {
    expect(nodeKeyAt(GG_HAND, 7)!.pot_type).toBeNull();
    expect(nodeKeyAt(GG_HAND, 9)!.pot_type).toBeNull();
    expect(nodeKeyAt(GG_HAND, 10)!.pot_type).toBe('3bet');
    expect(nodeKeyAt(GG_HAND, 11)!.pot_type).toBe('3bet');
  });

  it('buckets the bet hero is facing only when handed the registry\'s buckets', () => {
    // Action 9 is the SB's 7 into 12.5 — 0.56 of the pot — and action 10 the button's answer to it.
    expect(nodeKeyAt(GG_HAND, 11)!.size_bucket).toBeNull();
    expect(nodeKeyAt(GG_HAND, 11, { sizeBuckets: REGISTRY_BUCKETS })!.size_bucket).toBe('mid');
    // The bettor faces nothing, and a preflop raise-to is not a share of the pot.
    expect(nodeKeyAt(GG_HAND, 10, { sizeBuckets: REGISTRY_BUCKETS })!.size_bucket).toBeNull();
    expect(nodeKeyAt(GG_HAND, 9, { sizeBuckets: REGISTRY_BUCKETS })!.size_bucket).toBeNull();
  });

  it('buckets the exact share of the pot, not the rounded size on the step', () => {
    // 0.85 into 2.30 is 0.3696 of the pot: 'small' by the registry's [0, 0.37), though the step says 0.37.
    const thin: ReplayHand = { ...GG_HAND, actions: GG_HAND.actions.map((a) => (a.index === 9 ? { ...a, amount: 0.85, amountTo: 0.85, potBefore: 2.3 } : a)) };
    const key = nodeKeyAt(thin, 11, { sizeBuckets: REGISTRY_BUCKETS })!;
    expect(key.action_sequence[0]).toMatchObject({ position: 'SB', action: 'bet', size_pct: 0.37 });
    expect(key.size_bucket).toBe('small');
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
