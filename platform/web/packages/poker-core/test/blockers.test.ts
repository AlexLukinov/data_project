/** Blocker analysis on hand-counted examples. */

import { describe, expect, it } from 'vitest';

import { cardToString, parseCard, parseCards, parseCombo } from '../src/cards';
import { boardRemovalEffects, cardRemovalHeatmap, classRemovalBreakdown } from '../src/blockers/cards';
import { rankBluffCandidates, unblockers, valueCandidates } from '../src/blockers/ranking';
import { blockerTable, weightByCard } from '../src/blockers/scores';
import { parseRange } from '../src/formats/index';
import { union } from '../src/range';

const r = (text: string) => parseRange(text).range;

describe('blocker scores', () => {
  it('scores hero combos against villain calls and folds (spec §6.1)', () => {
    const table = blockerTable(r('AhKh,JhTh'), r('AA,KK,QQ'), r('JJ,TT'));
    expect(table.callTotal).toBe(18);
    expect(table.foldTotal).toBe(12);
    const ahkh = table.byCombo.get(parseCombo('AhKh'))!;
    expect(ahkh.blockedCall).toBe(6); // three AA with the Ah, three KK with the Kh
    expect(ahkh.blockedFold).toBe(0);
    expect(ahkh.removalCall).toBeCloseTo(1 / 3, 10);
    expect(ahkh.bluffScore).toBeCloseTo(1 / 3, 10);
    expect(ahkh.valueScore).toBeCloseTo(-1 / 3, 10);
    const jhth = table.byCombo.get(parseCombo('JhTh'))!;
    expect(jhth.blockedCall).toBe(0);
    expect(jhth.blockedFold).toBe(6); // three JJ, three TT
    expect(jhth.removalFold).toBe(0.5);
    expect(jhth.bluffScore).toBe(-0.5);
    expect(jhth.valueScore).toBe(0.5);
  });

  it('counts the combo that shares both cards once', () => {
    const table = blockerTable(r('AhAd'), r('AA'), r('KK'));
    expect(table.byCombo.get(parseCombo('AhAd'))!.blockedCall).toBe(5); // 3 with Ah + 3 with Ad − AhAd itself
    expect(table.byCombo.get(parseCombo('AhAd'))!.removalCall).toBeCloseTo(5 / 6, 10);
  });

  it('removes dead cards from every range first', () => {
    const table = blockerTable(r('AhKh,JhTh'), r('AA,KK,QQ'), r('JJ,TT'), parseCards('Ah 7d 2c'));
    expect(table.rows.map((row) => row.combo)).toEqual([parseCombo('JhTh')]);
    expect(table.callTotal).toBe(15); // AA lost three combos to the ace on board
  });

  it('weights by card', () => {
    expect(weightByCard(r('AA'))[parseCard('As')]).toBe(3);
    expect(weightByCard(r('AA:0.5'))[parseCard('As')]).toBe(1.5);
    expect(weightByCard(r('AA'))[parseCard('Ks')]).toBe(0);
  });
});

describe('card and class removal', () => {
  const board = parseCards('Kd 9h 4h');

  it('card heatmap: what each card removes overall and per class', () => {
    const heat = cardRemovalHeatmap(r('AA,KK'), board);
    expect(heat).toHaveLength(52);
    const as = heat[parseCard('As')]!;
    expect(as.removedWeight).toBe(3);
    expect(as.fraction).toBeCloseTo(3 / 9, 10); // KK has three live combos, AA six
    expect(as.byClass.overpair).toEqual({ removedWeight: 3, totalWeight: 6, fraction: 0.5 });
    expect(as.byClass.set).toEqual({ removedWeight: 0, totalWeight: 3, fraction: 0 });
    const kh = heat[parseCard('Kh')]!;
    expect(kh.byClass.set!.fraction).toBeCloseTo(2 / 3, 10); // KhKc, KhKs of KhKc, KhKs, KcKs
    const kd = heat[parseCard('Kd')]!;
    expect(kd.onBoard).toBe(true);
    expect(kd.removedWeight).toBe(0);
    expect(heat[parseCard('2c')]!.fraction).toBe(0);
  });

  it('heatmap before the flop has no class breakdown', () => {
    const heat = cardRemovalHeatmap(r('AA'), []);
    expect(heat[parseCard('As')]!.fraction).toBe(0.5);
    expect(heat[parseCard('As')]!.byClass).toEqual({});
  });

  it('class breakdown: "flush draws 5 → 2"', () => {
    const rows = classRemovalBreakdown(r('AQs,AJs,ATs,QJs,76s'), parseCards('Kh 9h 4c'), parseCombo('Ah5s'));
    const row = (cls: string) => rows.find((x) => x.cls === cls)!;
    expect(row('flush_draw').before.combos).toBe(5); // AhQh AhJh AhTh QhJh 7h6h
    expect(row('flush_draw').after.combos).toBe(2); // QhJh 7h6h
    expect(row('gutshot').before.combos).toBe(4); // QJs wants a ten
    expect(row('gutshot').after.combos).toBe(4);
    expect(row('combo_draw').before.combos).toBe(1); // QhJh
    expect(row('backdoor_straight_draw').before.combos).toBe(16);
    expect(row('backdoor_straight_draw').after.combos).toBe(13);
    expect(row('ace_high').before.combos).toBe(12);
    expect(row('ace_high').after.combos).toBe(9);
    expect(row('no_pair').before.combos).toBe(8);
    expect(rows.find((x) => x.cls === 'top_pair')).toBeUndefined(); // only classes villain had are listed
    expect(() => classRemovalBreakdown(r('AA'), [], parseCombo('KhKd'))).toThrow(/at least three/);
  });

  it('board effects, card by card', () => {
    const effects = boardRemovalEffects(r('AA'), parseCards('Ah 7d 2c'));
    expect(effects.before).toEqual({ combos: 6, weight: 6 });
    expect(effects.after).toEqual({ combos: 3, weight: 3 });
    expect(effects.steps.map((s) => [cardToString(s.card), s.before.combos, s.after.combos])).toEqual([
      ['Ah', 6, 3],
      ['7d', 3, 3],
      ['2c', 3, 3],
    ]);
  });
});

describe('bluff ranking and unblockers', () => {
  const table = blockerTable(union(r('AA'), r('JhTh,7h6h,QcJc')), r('KK,QQ'), r('JJ,TT,99'));
  const aces = r('AA');
  const isValue = (combo: number) => aces.weights[combo]! > 0;

  it('ranks non-value combos by bluff score and sizes the bluff count to the bet', () => {
    const ranking = rankBluffCandidates(table, isValue, 100, 100);
    expect(ranking.bluffsPerValue).toBe(0.5);
    expect(ranking.valueWeight).toBe(6);
    expect(ranking.bluffsNeeded).toBe(3);
    expect(ranking.bluffsAvailable).toBe(3);
    expect(ranking.candidates.map((row) => row.combo)).toEqual([parseCombo('QcJc'), parseCombo('7h6h'), parseCombo('JhTh')]);
    expect(ranking.candidates[0]!.bluffScore).toBeCloseTo(3 / 12 - 3 / 18, 10); // blocks three QQ of 12 calls, three JJ of 18 folds
    expect(ranking.selected).toHaveLength(3);
    expect(ranking.shortfall).toBe(0);
    const overbet = rankBluffCandidates(table, isValue, 100, 200);
    expect(overbet.bluffsNeeded).toBeCloseTo(4, 10);
    expect(overbet.shortfall).toBeCloseTo(1, 10);
  });

  it('unblockers avoid the folding range; value candidates block it', () => {
    const un = unblockers(table);
    expect(un[0]!.removalFold).toBe(0);
    expect(un[un.length - 1]!.combo).toBe(parseCombo('JhTh'));
    expect(valueCandidates(table)[0]!.combo).toBe(parseCombo('JhTh')); // removes folds, keeps calls
  });
});
