/**
 * The node on the *other* side of a bet (plan F.9, step 9).
 *
 * A `NodeKey` always ends with hero's own action, so a key for "BB bets the turn" reports what
 * the field does *as the BB* — where nobody ever folds. "How often does my pool fold to this
 * bet?" is a question about the seat that has to answer it, which is a different node: the same
 * street and the same actions so far, with the two seats swapped and villain's own answer as the
 * last step.
 */
import type { NodeAction, NodeKey } from '@poker/core';
import { nodeKey, step } from '@poker/core';

/** The actions a seat can be facing — anything that puts money in. */
const AGGRESSIVE: ReadonlySet<NodeAction> = new Set<NodeAction>(['bet', 'raise', 'allin']);
/** Villain's own action closes the sequence; the pool reports every action at that point. */
const VILLAIN_ANSWER: NodeAction = 'fold';

/**
 * The node villain is in once hero has taken the last step of `key`, or `null` when nobody is
 * facing anything: hero checked or folded, or the key names no opponent.
 */
export function facingNode(key: NodeKey | null): NodeKey | null {
  const villain = key?.villain_position ?? null;
  const last = key?.action_sequence.at(-1) ?? null;
  if (key === null || villain === null || last === null) return null;
  if (!AGGRESSIVE.has(last.action) || last.position !== key.hero_position) return null;
  return nodeKey(villain, {
    stake: key.stake,
    table_size: key.table_size,
    eff_stack_bb: key.eff_stack_bb,
    villain_position: key.hero_position,
    action_sequence: [...key.action_sequence, step(villain, VILLAIN_ANSWER)],
    street: key.street,
    board_texture: [...key.board_texture],
  });
}
