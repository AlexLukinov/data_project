/** The grouped combo distribution on a hand-counted range. */

import { describe, expect, it } from 'vitest';

import { COMBO_COUNT, HAND_CLASS_COMBOS, handClassOfName, parseCards, parseCombo } from '../src/cards';
import type { DistributionGroup } from '../src/distribution/tree';
import { compareDistributions, distribute, toCsv, toText } from '../src/distribution/tree';
import { parseRange } from '../src/formats/index';

const board = parseCards('Kd 9h 4h');
const range = parseRange('AA,KK,AK,76s').range;

/** Made-up equities: pairs high, AK good, 76s low except the flush draw. */
function equities(): Float32Array {
  const eq = new Float32Array(COMBO_COUNT).fill(Number.NaN);
  const set = (cls: string, value: number) => {
    for (const combo of HAND_CLASS_COMBOS[handClassOfName(cls)]!) eq[combo] = value;
  };
  set('AA', 0.9);
  set('KK', 0.85);
  set('AKs', 0.7);
  set('AKo', 0.7);
  set('76s', 0.4);
  eq[parseCombo('7h6h')] = 0.3;
  return eq;
}

const counts = (groups: readonly DistributionGroup[]): Record<string, number> => Object.fromEntries(groups.map((g) => [g.key, g.combos]));

describe('distribute', () => {
  it('made-hand classes, relative to the board', () => {
    const d = distribute(range, board, ['made']);
    expect(d.combos).toBe(25); // 6 AA + 3 KK (Kd is out) + 12 AK + 4 76s
    expect(d.weight).toBe(25);
    expect(counts(d.groups)).toEqual({ overpair: 6, set: 3, top_pair: 12, no_pair: 4 });
    expect(d.groups.find((g) => g.key === 'top_pair')!.share).toBeCloseTo(12 / 25, 10);
    expect(d.groups.map((g) => g.label)).toEqual(['Set', 'Overpair', 'Top pair', 'No pair']);
  });

  it('draw classes, a combo in every group it belongs to', () => {
    const d = distribute(range, board, ['draw']);
    // Backdoor flush draws: one heart with the two on board (3 AA, 2 KK, 5 AKo) plus 7d6d with the Kd.
    expect(counts(d.groups)).toEqual({ flush_draw: 2, backdoor_flush_draw: 11, backdoor_straight_draw: 4, combo_draw: 1, no_draw: 10 });
    const flush = d.groups.find((g) => g.key === 'flush_draw')!;
    expect(flush.comboList).toEqual([parseCombo('7h6h'), parseCombo('AhKh')].sort((a, b) => a - b));
  });

  it('nests axes: draws inside top pair', () => {
    const d = distribute(range, board, ['made', 'draw']);
    const topPair = d.groups.find((g) => g.key === 'top_pair')!;
    expect(counts(topPair.children)).toEqual({ flush_draw: 1, backdoor_flush_draw: 5, combo_draw: 1, no_draw: 6 });
  });

  it('structure works before the flop', () => {
    const d = distribute(parseRange('AA,AKs').range, [], ['structure']);
    expect(counts(d.groups)).toEqual({ pair: 6, suited: 4 });
    expect(d.groups[0]!.label).toMatch(/6 combos per class/);
  });

  it('strategic categories, equity buckets and the nut bucket from per-combo equities', () => {
    const eq = equities();
    const d = distribute(range, board, ['strategic', 'equity', 'nut'], { equities: eq, thresholds: { nut: 0.8 } });
    expect(counts(d.groups)).toEqual({ value: 21, draw: 1, bluff_catcher: 3 });
    expect(d.thresholds.value).toBe(0.6);
    const value = d.groups.find((g) => g.key === 'value')!;
    expect(counts(value.children)).toEqual({ '3': 12, '4': 9 }); // 60–80: AK; 80–100: AA, KK
    expect(value.children.map((g) => g.label)).toEqual(['60–80%', '80–100%']);
    const top = value.children.find((g) => g.key === '4')!;
    expect(counts(top.children)).toEqual({ nut: 9 });
    expect(top.children[0]!.label).toBe('Nutted (equity ≥ 80%)');
    const draw = d.groups.find((g) => g.key === 'draw')!;
    expect(draw.comboList).toEqual([parseCombo('7h6h')]);
  });

  it('refuses an axis without what it needs', () => {
    expect(() => distribute(range, [], ['made'])).toThrow(/board of at least three/);
    expect(() => distribute(range, board, ['strategic'])).toThrow(/per-combo equities/);
    expect(() => distribute(range, board, ['nut'], { equities: equities() })).toThrow(/nut threshold/);
    expect(() => distribute(range, board, ['made', 'made'])).toThrow(/once/);
  });
});

describe('compare and export', () => {
  it('compares hero with villain group by group', () => {
    const hero = distribute(range, board, ['made']);
    const villain = distribute(parseRange('QQ,AKs').range, board, ['made']); // 6 underpairs, 3 top pairs (AdKd is out)
    const rows = compareDistributions(hero, villain);
    const overpair = rows.find((x) => x.key === 'overpair')!;
    expect(overpair.a!.combos).toBe(6);
    expect(overpair.b).toBeNull();
    expect(overpair.deltaShare).toBeCloseTo(-6 / 25, 10);
    const under = rows.find((x) => x.key === 'under_pair')!;
    expect(under.a).toBeNull();
    expect(under.b!.combos).toBe(6);
    expect(under.deltaShare).toBeCloseTo(6 / 9, 10);
    const top = rows.find((x) => x.key === 'top_pair')!;
    expect(top.deltaShare).toBeCloseTo(3 / 9 - 12 / 25, 10);
    expect(() => compareDistributions(hero, distribute(range, board, ['draw']))).toThrow(/same axes/);
  });

  it('exports CSV and text', () => {
    const d = distribute(range, board, ['made', 'draw']);
    const csv = toCsv(d).split('\n');
    expect(csv[0]).toBe('axis,level,group,combos,weighted_combos,share');
    expect(csv).toContain('made,0,Top pair,12,12.000,48.00');
    expect(csv).toContain('draw,1,Flush draw,1,1.000,4.00');
    const text = toText(d, true);
    expect(text.split('\n')[0]).toBe('25 combos, 25.00 weighted');
    expect(text).toContain('Top pair: 12 combos, 12.00 weighted, 48.0%');
    expect(text).toContain('  Flush draw: 1 combos');
    expect(text).toContain('AhKh');
  });
});
