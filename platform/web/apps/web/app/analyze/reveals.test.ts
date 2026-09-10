/**
 * The numbers the analyzer scores you against — every one hand-counted here.
 *
 * The ranges are deliberately tiny: a reveal the user is marked on has to be a number I can
 * check on paper, not one that comes out of a black box.
 */
import { parseCards, parseRange } from '@poker/core';
import { describe, expect, it } from 'vitest';

import {
  asPercent,
  bluffToValue,
  classPercentile,
  combosRemoved,
  flushDrawCombos,
  isDealt,
  roleOf,
  topPairOrBetterShare,
} from './reveals';

const FLOP = parseCards('Ah7d2c');
const TWO_TONE = parseCards('Ah7h2c');
const range = (text: string) => parseRange(text).range;

describe('topPairOrBetterShare', () => {
  it('counts the weighted combos that are top pair or better', () => {
    // On A72: AK is top pair, KQ is king high. Two combos each, so exactly half.
    const combos = range('AsKs: 1,AdKd: 1,KsQs: 1,KdQd: 1');
    expect(topPairOrBetterShare(combos, FLOP)).toBeCloseTo(0.5, 6);
  });

  it('counts a partly-weighted combo by its weight', () => {
    // One full top pair and one half-weighted king high: 1 of 1.5.
    const combos = range('AsKs: 1,KdQd: 0.5');
    expect(topPairOrBetterShare(combos, FLOP)).toBeCloseTo(1 / 1.5, 6);
  });

  it('is zero for an empty range rather than a division by nothing', () => {
    expect(topPairOrBetterShare(range(''), FLOP)).toBe(0);
  });
});

describe('combosRemoved', () => {
  it('counts what two cards make impossible', () => {
    // Holding AsKh kills AsKs, AsQs and AhKh; AdQd survives.
    const villain = range('AsKs: 1,AsQs: 1,AhKh: 1,AdQd: 1');
    expect(combosRemoved(villain, parseCards('AsKh'))).toBe(3);
  });
});

describe('flushDrawCombos', () => {
  it('counts only the flush draws the board can actually make', () => {
    // On Ah7h2c, KhQh is a flush draw; KsQs is not, and neither is a rainbow board's anything.
    const villain = range('KhQh: 1,KsQs: 1');
    expect(flushDrawCombos(villain, TWO_TONE, [])).toBe(1);
    expect(flushDrawCombos(villain, FLOP, [])).toBe(0);
  });

  it('leaves out the draws hero is holding a card of', () => {
    const villain = range('KhQh: 1,JhTh: 1');
    expect(flushDrawCombos(villain, TWO_TONE, parseCards('Kh'))).toBe(1);
  });
});

describe('classPercentile and roleOf', () => {
  it('says what share of its own range a hand beats by class', () => {
    // AsKs (top pair) beats the two king-high combos of a four-combo range: half of it.
    const mine = range('AsKs: 1,AdKd: 1,KsQs: 1,KdQd: 1');
    expect(classPercentile(mine, FLOP, parseCards('AsKs'))).toBeCloseTo(0.5, 6);
    expect(classPercentile(mine, FLOP, parseCards('KsQs'))).toBe(0);
  });

  it('has no answer for a hand that is not in the range', () => {
    expect(classPercentile(range('AsKs: 1'), FLOP, parseCards('2h'))).toBeNull();
    expect(classPercentile(range('AsKs: 1'), FLOP, parseCards('3h3d'))).toBeNull();
  });

  it('reads the top of a range as value and a draw below it as a semi-bluff', () => {
    expect(roleOf(0.9, 'top_pair', ['no_draw'])).toBe('value');
    expect(roleOf(0.2, 'no_pair', ['flush_draw'])).toBe('semi-bluff');
    expect(roleOf(0.5, 'second_pair', ['no_draw'])).toBe('protection');
    expect(roleOf(0.1, 'no_pair', ['no_draw'])).toBe('give-up');
    // A backdoor draw is not a draw worth calling a semi-bluff.
    expect(roleOf(0.1, 'no_pair', ['backdoor_flush_draw'])).toBe('give-up');
  });
});

describe('bluffToValue', () => {
  it('is the ratio the balanced number is compared against', () => {
    expect(bluffToValue(range('AsKs: 1,AdKd: 1'), range('KsQs: 1'))).toBeCloseTo(0.5, 6);
    expect(bluffToValue(range(''), range('KsQs: 1'))).toBeNull();
    expect(bluffToValue(range('AsKs: 1'), null)).toBe(0);
  });
});

describe('a board that is still being dealt', () => {
  it('is not read by the classifier, which throws on anything but three to five cards', () => {
    expect(isDealt(parseCards('Ah7d'))).toBe(false);
    expect(isDealt(FLOP)).toBe(true);
    expect(isDealt(parseCards('Ah7d2c5h3s'))).toBe(true);
  });

  it('costs nothing rather than taking the step down with it', () => {
    // Clicking the flop out one card at a time used to throw here and freeze the whole step.
    const mine = range('AsKs: 1,KdQd: 1');
    const partial = parseCards('Ah');
    expect(topPairOrBetterShare(mine, partial)).toBe(0);
    expect(flushDrawCombos(mine, partial, [])).toBe(0);
    expect(classPercentile(mine, partial, parseCards('AsKs'))).toBeNull();
  });
});

describe('asPercent', () => {
  it('is what the gate compares a percentage answer against', () => {
    expect(asPercent(0.6154)).toBe('61.5');
  });
});
