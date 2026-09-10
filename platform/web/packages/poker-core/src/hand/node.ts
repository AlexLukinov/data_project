/**
 * The situation a hand is in at a given step (spec §9.3) — the bridge from a replayed hand to
 * everything keyed by `NodeKey`: the stored ranges (F.6) and the pool's frequencies (F.8).
 *
 * The key follows the same convention as everywhere else: **the sequence ends with hero's own
 * action**, so `nodeKeyAt(hand, i)` describes the decision that has just been made, and looking
 * it up answers "which combos take this line". Stepping forward therefore walks the node tree.
 *
 * A hand the parser could not give positions to yields `null` rather than a key with a made-up
 * seat: an invented situation would quietly match the wrong stored range.
 */

import type { ActionStep, NodeAction, NodeKey, Position, Street } from '../node';
import { DEFAULT_STACK_BB, POSITIONS, nodeKey } from '../node';
import type { ActionStreet, ReplayAction, ReplayHand } from './types';
import { DECISIONS } from './types';

const AGGRESSIVE: ReadonlySet<NodeAction> = new Set<NodeAction>(['bet', 'raise', 'allin']);
const MAX_STAKE_CHARS = 16;

/** The betting round of an action; showdown is not one, and shows the river's situation. */
function bettingStreet(street: ActionStreet): Street {
  return street === 'showdown' ? 'river' : street;
}

function asPosition(value: string): Position | null {
  return (POSITIONS as readonly string[]).includes(value) ? (value as Position) : null;
}

function positionsBySeat(hand: ReplayHand): Map<number, Position> {
  const seats = new Map<number, Position>();
  for (const seat of hand.seats) {
    const position = asPosition(seat.position);
    if (position !== null) seats.set(seat.seat, position);
  }
  return seats;
}

/** A preflop call is a limp only while nobody has raised — the distinction the vocabulary keeps. */
function nodeAction(action: ReplayAction, raisesBefore: number): NodeAction {
  if (action.kind === 'allin') return 'allin';
  if (action.kind === 'call') return action.street === 'preflop' && raisesBefore === 0 ? 'limp' : 'call';
  if (action.kind === 'bet' || action.kind === 'raise') return action.isAllIn ? 'allin' : action.kind;
  return action.kind === 'fold' ? 'fold' : 'check';
}

/** Preflop sizes are raise-to in blinds, postflop ones a share of the pot (spec §10.1). */
function sizes(action: ReplayAction, verb: NodeAction, bigBlind: number): Pick<ActionStep, 'size_bb' | 'size_pct'> {
  const none = { size_bb: null, size_pct: null };
  if (!AGGRESSIVE.has(verb)) return none;
  if (bettingStreet(action.street) === 'preflop') {
    const to = action.amountTo > 0 ? action.amountTo : action.amount;
    return bigBlind > 0 ? { ...none, size_bb: round(to / bigBlind, 2) } : none;
  }
  return action.potBefore > 0 ? { ...none, size_pct: round(action.amount / action.potBefore, 3) } : none;
}

function round(value: number, places: number): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

interface Line {
  readonly steps: readonly ActionStep[];
  readonly street: Street;
}

/** The decisions taken before state `index`, as steps, with sizes and the street they ended on. */
function lineBefore(hand: ReplayHand, index: number, seats: Map<number, Position>): Line | null {
  const steps: ActionStep[] = [];
  let raises = 0;
  let street: Street = 'preflop';
  for (const action of hand.actions.slice(0, index)) {
    if (!DECISIONS.has(action.kind)) continue;
    const on = bettingStreet(action.street);
    if (on !== street) {
      street = on;
      raises = 0;
    }
    const position = seats.get(action.seat);
    if (position === undefined) return null;
    const verb = nodeAction(action, raises);
    if (AGGRESSIVE.has(verb)) raises += 1;
    steps.push({ position, action: verb, ...sizes(action, verb, hand.bigBlind) });
  }
  return steps.length === 0 ? null : { steps, street };
}

/**
 * Who hero is up against: the last other seat to bet or raise, else the last one still in the
 * hand. A seat that folded is nobody's villain — an open that everyone folded to faces no one.
 */
function villainOf(steps: readonly ActionStep[], hero: Position): Position | null {
  const others = steps.slice(0, -1).filter((s) => s.position !== hero && s.action !== 'fold');
  for (let i = others.length - 1; i >= 0; i--) {
    const step = others[i]!;
    if (AGGRESSIVE.has(step.action)) return step.position;
  }
  return others.at(-1)?.position ?? null;
}

/** The stack the two of them are actually playing, in big blinds; hero's own when alone. */
function effectiveStackBb(hand: ReplayHand, wanted: ReadonlySet<Position>, seats: Map<number, Position>): number {
  if (hand.bigBlind <= 0) return DEFAULT_STACK_BB;
  const stacks = hand.seats.filter((s) => {
    const position = seats.get(s.seat);
    return position !== undefined && wanted.has(position);
  });
  if (stacks.length === 0) return DEFAULT_STACK_BB;
  return Math.max(1, Math.round(Math.min(...stacks.map((s) => s.stack)) / hand.bigBlind));
}

/**
 * The situation after the decisions in `hand.actions.slice(0, index)`, or `null` when there is
 * none yet (the deal) or the hand has no derived positions.
 *
 * `board_texture` is left empty: the texture tags are the server's (`int_board_texture`), and a
 * guess made here would not match the pool's own bucketing (F.8).
 */
export function nodeKeyAt(hand: ReplayHand, index: number): NodeKey | null {
  const seats = positionsBySeat(hand);
  const line = lineBefore(hand, index, seats);
  const last = line?.steps.at(-1);
  if (line === null || last === undefined) return null;
  const hero = last.position;
  const villain = villainOf(line.steps, hero);
  const pair = new Set<Position>(villain === null ? [hero] : [hero, villain]);
  return nodeKey(hero, {
    stake: hand.stake.slice(0, MAX_STAKE_CHARS),
    table_size: hand.seats.length,
    eff_stack_bb: effectiveStackBb(hand, pair, seats),
    villain_position: villain,
    action_sequence: line.steps,
    street: line.street,
    board_texture: [],
  });
}
