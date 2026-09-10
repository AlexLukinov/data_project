/**
 * The table state at every point in a hand (spec §9.2).
 *
 * `replayStates(hand)` returns one state per step, `actions.length + 1` of them: state 0 is the
 * deal and state *i* is the table after `actions[i-1]`. Stepping is then an index, which is what
 * makes seeking, the action log and keyboard control the same operation.
 *
 * Chips are tracked in two places on purpose — `committed` in front of a seat on this street,
 * and the settled pot behind it — because pot odds are quoted against what is actually in the
 * middle, and a street that has not been collected yet is still in front of the players.
 */

import type { Street } from '../node';
import type { ActionStreet, HandState, ReplayAction, ReplayHand, SeatState } from './types';
import { CONTRIBUTING } from './types';

const STREET_CARDS: Record<Street, number> = { preflop: 0, flop: 3, turn: 4, river: 5 };
const BETTING: readonly Street[] = ['preflop', 'flop', 'turn', 'river'];

/** The betting round an action belongs to; `showdown` shows the river's board. */
function bettingStreet(street: ActionStreet): Street {
  return street === 'showdown' ? 'river' : street;
}

interface Chips {
  stack: number;
  committed: number;
  invested: number;
  folded: boolean;
  allIn: boolean;
}

function start(hand: ReplayHand): Map<number, Chips> {
  return new Map(hand.seats.map((s) => [s.seat, { stack: s.stack, committed: 0, invested: 0, folded: false, allIn: false }]));
}

function frozen(chips: Map<number, Chips>): SeatState[] {
  return [...chips.entries()].map(([seat, c]) => ({ seat, stack: c.stack, committed: c.committed, invested: c.invested, folded: c.folded, allIn: c.allIn }));
}

/** Move this action's chips between the seat's stack and what it has in front of it. */
function applyChips(action: ReplayAction, seat: Chips): void {
  if (CONTRIBUTING.has(action.kind)) {
    seat.stack -= action.amount;
    seat.committed += action.amount;
    seat.invested += action.amount;
    if (action.isAllIn || seat.stack <= 0) seat.allIn = true;
    return;
  }
  if (action.kind === 'uncalled_return') {
    seat.stack += action.amount;
    seat.committed = Math.max(0, seat.committed - action.amount);
    seat.invested = Math.max(0, seat.invested - action.amount);
    return;
  }
  if (action.kind === 'fold') seat.folded = true;
}

/** Push what is in front of every seat into the pot; returns how much moved. */
function collect(chips: Map<number, Chips>): number {
  let moved = 0;
  for (const seat of chips.values()) {
    moved += seat.committed;
    seat.committed = 0;
  }
  return moved;
}

function potOf(settled: number, chips: Map<number, Chips>): number {
  let total = settled;
  for (const seat of chips.values()) total += seat.committed;
  return round(total);
}

/** Chips are decimal money; a long sum of them drifts without this. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function toCallFor(actor: number | null, chips: Map<number, Chips>): number {
  if (actor === null) return 0;
  let highest = 0;
  for (const seat of chips.values()) highest = Math.max(highest, seat.committed);
  return round(Math.max(0, highest - (chips.get(actor)?.committed ?? 0)));
}

/** Which street the table is showing before `actions[index]` — the deal happens between actions. */
function streetAt(hand: ReplayHand, index: number): Street {
  const next = hand.actions[index];
  if (next !== undefined) return bettingStreet(next.street);
  const last = hand.actions.at(-1);
  return last === undefined ? 'preflop' : bettingStreet(last.street);
}

function stateAt(hand: ReplayHand, index: number, settled: number, chips: Map<number, Chips>): HandState {
  const street = streetAt(hand, index);
  const actor = hand.actions[index]?.seat ?? null;
  return {
    index,
    street,
    board: hand.board.slice(0, STREET_CARDS[street]),
    pot: potOf(settled, chips),
    actor,
    toCall: toCallFor(actor, chips),
    last: hand.actions[index - 1] ?? null,
    seats: frozen(chips),
  };
}

/**
 * Every state of one hand, in order. Pure: the same hand always yields the same states, which is
 * why the replayer can hand any of them straight to the analysis panels.
 *
 * Awards are **not** actions in this model — no parser emits one, because who won which pot is
 * its own table (`core.pot_winners`) and reaches the replayer as `ReplaySeat.wonHand`. So the
 * pot stands until the hand ends, and the last state shows it next to the seat that took it.
 */
export function replayStates(hand: ReplayHand): HandState[] {
  const chips = start(hand);
  let settled = 0;
  const states: HandState[] = [stateAt(hand, 0, settled, chips)];

  for (const [i, action] of hand.actions.entries()) {
    const seat = chips.get(action.seat);
    if (seat !== undefined) applyChips(action, seat);
    // The street's bets go to the middle when the street is over, which is exactly when the
    // next card is dealt — so the board and the chips move in the same step, as at a table.
    const next = hand.actions[i + 1];
    if (next === undefined || bettingStreet(next.street) !== bettingStreet(action.street)) {
      settled = round(settled + collect(chips));
    }
    states.push(stateAt(hand, i + 1, settled, chips));
  }
  return states;
}

/** The betting rounds this hand actually reached, in order — what the street buttons offer. */
export function streetsPlayed(hand: ReplayHand): Street[] {
  const reached = new Set(hand.actions.map((a) => bettingStreet(a.street)));
  return BETTING.filter((s) => reached.has(s));
}

/** The first state on a street, for `1`–`4` and the street buttons. */
export function firstIndexOfStreet(hand: ReplayHand, street: Street): number {
  const at = hand.actions.findIndex((a) => bettingStreet(a.street) === street);
  return at === -1 ? 0 : at;
}
