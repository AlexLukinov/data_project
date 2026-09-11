/**
 * The replay engine against a real hand.
 *
 * The strongest assertion here is the agreement test: for every action, the pot and the amount
 * to call the engine has built up from scratch must equal what the parser reckoned when it read
 * the text. Two independent computations of the same money are what make a wrong one visible.
 */

import { describe, expect, it } from 'vitest';

import { firstIndexOfStreet, replayStates, streetsPlayed } from '../src/index';
import { GG_HAND, TO_CALL } from './fixtures/hand';

const STATES = replayStates(GG_HAND);

describe('replayStates', () => {
  it('gives one state per step, the deal included', () => {
    expect(STATES).toHaveLength(GG_HAND.actions.length + 1);
    expect(STATES[0]!.index).toBe(0);
    expect(STATES[0]!.last).toBeNull();
    expect(STATES[0]!.pot).toBe(0);
    expect(STATES[0]!.actor).toBe(2);
  });

  it('agrees with the parser about the pot before every action', () => {
    for (const action of GG_HAND.actions) {
      expect(STATES[action.index]!.pot, `pot before action ${action.index}`).toBeCloseTo(action.potBefore, 2);
    }
  });

  it('agrees with the parser about what it costs to continue', () => {
    for (const action of GG_HAND.actions) {
      expect(STATES[action.index]!.toCall, `to call at action ${action.index}`).toBeCloseTo(TO_CALL[action.index]!, 2);
    }
  });

  it('deals the flop before the first action on it, not after', () => {
    expect(STATES[8]!.board).toEqual([]);
    expect(STATES[9]!.board).toEqual(['8h', '5d', '2s']);
    expect(STATES[9]!.street).toBe('flop');
  });

  it('collects the street into the pot when the street turns', () => {
    const beforeFlop = STATES[9]!.seats.find((s) => s.seat === 2)!;
    expect(beforeFlop.committed).toBe(0);
    expect(beforeFlop.invested).toBe(6);
    expect(STATES[9]!.pot).toBe(12.5);
  });

  it('returns an uncalled bet to the seat that made it', () => {
    const betting = STATES[10]!.seats.find((s) => s.seat === 2)!;
    const returned = STATES[12]!.seats.find((s) => s.seat === 2)!;
    expect(betting.stack).toBe(37);
    expect(betting.committed).toBe(7);
    expect(returned.stack).toBe(44);
    expect(returned.committed).toBe(0);
    expect(STATES[12]!.pot).toBe(12.5);
  });

  it('marks a seat folded and stops offering it as the actor', () => {
    expect(STATES[3]!.seats.find((s) => s.seat === 4)!.folded).toBe(true);
    expect(STATES.at(-1)!.actor).toBeNull();
    expect(STATES.at(-1)!.toCall).toBe(0);
  });

  it('names nobody to act while the blinds are posted or the hand is being settled', () => {
    // The four bookkeeping steps of this hand: post_sb, post_bb, uncalled_return, muck. The ring
    // used to sit on a player through all of them, because `actor` is the next action's seat
    // whatever kind it is — which is still what `toCall` is reckoned for, and still 0.25 at
    // step 1, so the two live side by side rather than one replacing the other.
    expect(STATES[0]!.toAct).toBeNull();
    expect(STATES[1]!.toAct).toBeNull();
    expect(STATES[11]!.toAct).toBeNull();
    expect(STATES[12]!.toAct).toBeNull();
    expect(STATES[0]!.actor).toBe(2);
    expect(STATES[1]!.toCall).toBeCloseTo(0.25, 2);
  });

  it('names the seat facing a decision at every other step', () => {
    const decisions = [2, 3, 4, 5, 6, 7, 8, 9, 10];
    for (const index of decisions) {
      expect(STATES[index]!.toAct, `step ${index}`).toBe(GG_HAND.actions[index]!.seat);
      expect(STATES[index]!.toAct, `step ${index} agrees with actor`).toBe(STATES[index]!.actor);
    }
    expect(STATES.at(-1)!.toAct).toBeNull();
  });

  it('never invents chips: stack plus invested is the starting stack', () => {
    for (const state of STATES) {
      for (const seat of state.seats) {
        const start = GG_HAND.seats.find((s) => s.seat === seat.seat)!.stack;
        expect(seat.stack + seat.invested, `seat ${seat.seat} at step ${state.index}`).toBeCloseTo(start, 2);
      }
    }
  });
});

describe('street navigation', () => {
  it('offers only the streets the hand reached', () => {
    expect(streetsPlayed(GG_HAND)).toEqual(['preflop', 'flop']);
  });

  it('seeks to the first action of a street', () => {
    expect(firstIndexOfStreet(GG_HAND, 'preflop')).toBe(0);
    expect(firstIndexOfStreet(GG_HAND, 'flop')).toBe(9);
    expect(firstIndexOfStreet(GG_HAND, 'river')).toBe(0);
  });
});
