/**
 * Whose fold frequency step 9 is asking about.
 *
 * A key ends with hero's own action, so asking it for a fold rate asks the seat that just bet —
 * and the answer is always zero. This is the node that can actually fold.
 */
import { nodeKey, step } from '@poker/core';
import { describe, expect, it } from 'vitest';

import { facingNode } from './facing';

const TURN_BET = nodeKey('BB', {
  villain_position: 'CO',
  street: 'turn',
  stake: 'NL10',
  eff_stack_bb: 40,
  pot_type: 'srp',
  board_texture: ['two_tone'],
  action_sequence: [step('BB', 'check'), step('CO', 'check'), step('BB', 'bet', { size_pct: 0.5 })],
});

describe('facingNode', () => {
  it('swaps the seats and lets the other one answer', () => {
    const facing = facingNode(TURN_BET);
    expect(facing).not.toBeNull();
    expect(facing!.hero_position).toBe('CO');
    expect(facing!.villain_position).toBe('BB');
    expect(facing!.action_sequence.at(-1)).toMatchObject({ position: 'CO', action: 'fold' });
    // Everything else about the situation is the same one.
    expect(facing!.street).toBe('turn');
    expect(facing!.stake).toBe('NL10');
    expect(facing!.eff_stack_bb).toBe(40);
    expect(facing!.board_texture).toEqual(['two_tone']);
    // The pot was built the same way for both seats; the rest of ADR-078 is villain's own to fill.
    expect(facing!.pot_type).toBe('srp');
    expect(facing!.line_so_far).toBeNull();
    expect(facing!.size_bucket).toBeNull();
  });

  it('keeps the actions that came before, so it is the same point in the hand', () => {
    const facing = facingNode(TURN_BET)!;
    expect(facing.action_sequence.slice(0, -1)).toEqual(TURN_BET.action_sequence);
  });

  it('is nothing when nobody is facing anything', () => {
    const checked = nodeKey('BB', { villain_position: 'CO', street: 'turn', action_sequence: [step('BB', 'check')] });
    expect(facingNode(checked)).toBeNull();

    const folded = nodeKey('BB', { villain_position: 'CO', action_sequence: [step('BB', 'fold')] });
    expect(facingNode(folded)).toBeNull();

    const alone = nodeKey('UTG', { action_sequence: [step('UTG', 'raise', { size_bb: 3 })] });
    expect(facingNode(alone)).toBeNull();

    expect(facingNode(null)).toBeNull();
  });
});
