/**
 * The pool-and-chart split (plan H.7, ADR-094): the pool's continue share from tier 1 at the
 * facing node, the chart cut at that share by equity, the two halves adding back to the chart,
 * and one ask per press that stops when the situation has gone stale.
 */
import type { NodeKey } from '@poker/core';
import { COMBO_COUNT, comboIndex, nodeKey, parseCard, parseRange, step } from '@poker/core';
import { describe, expect, it, vi } from 'vitest';

import { facingNode } from '../analyze/facing';
import type { NodeFrequencies } from '../pool/api';

import { continueShare, poolSplit, splitByEquity } from './blockers';

const NODE: NodeKey = nodeKey('CO', {
  villain_position: 'BB',
  street: 'flop',
  action_sequence: [step('CO', 'raise', { size_bb: 2.5 }), step('BB', 'call'), step('CO', 'bet', { size_pct: 0.33 })],
});
const FACING = facingNode(NODE)!;

/** The gate's own fields (plan G.3): none of these tests is about them. */
const GATE = { min_n: 100, intervals: {}, players: 400, design_effect: null, max_half_width: 0.05, min_players: 30 };

function tier1(enough = true, fold = 0.55): NodeFrequencies {
  return {
    ...GATE,
    tier: 1,
    sample_size: enough ? 3988 : 57,
    enough,
    actions: enough ? { fold: 2193, call: 1400, raise: 395 } : {},
    frequencies: enough ? { fold, call: (1 - fold) * 0.78, raise: (1 - fold) * 0.22 } : {},
  };
}

const combo = (text: string) => comboIndex(parseCard(text.slice(0, 2)), parseCard(text.slice(2)));

/** Equities for a chart of AA, KK and 22 only: AA strongest, 22 weakest, everything else absent. */
function equitiesFor(chart: ReturnType<typeof parseRange>['range']): Float32Array {
  const equities = new Float32Array(COMBO_COUNT).fill(Number.NaN);
  for (let index = 0; index < COMBO_COUNT; index += 1) {
    if ((chart.weights[index] ?? 0) <= 0) continue;
    const name = [combo('AsAh'), combo('AsAd'), combo('AsAc'), combo('AhAd'), combo('AhAc'), combo('AdAc')].includes(index) ? 0.9 : [combo('KsKh'), combo('KsKd'), combo('KsKc'), combo('KhKd'), combo('KhKc'), combo('KdKc')].includes(index) ? 0.6 : 0.3;
    equities[index] = name;
  }
  return equities;
}

describe('continueShare', () => {
  it('is one minus the pool’s fold share, and never outside [0, 1]', () => {
    expect(continueShare(tier1(true, 0.55))).toBeCloseTo(0.45);
    expect(continueShare(tier1(false))).toBe(1);
    expect(continueShare({ ...tier1(), frequencies: { fold: 1.2 } })).toBe(0);
  });
});

describe('splitByEquity', () => {
  it('continues with the strongest combos up to the share and folds the rest, with chart weights on both sides', () => {
    const chart = parseRange('AA,KK,22:0.5').range;
    const parts = splitByEquity(chart, equitiesFor(chart), 0.4);
    // 6 + 6 + 3 = 15 weighted combos; 40% is 6, so exactly AA continues.
    expect(parts.set.combos).toHaveLength(6);
    expect(parts.call.weights[combo('AsAh')]).toBe(1);
    expect(parts.fold.weights[combo('AsAh')]).toBe(0);
    expect(parts.call.weights[combo('KsKh')]).toBe(0);
    expect(parts.fold.weights[combo('KsKh')]).toBe(1);
    expect(parts.fold.weights[combo('2s2h')]).toBeCloseTo(0.5);
    expect(parts.set.cutoffEquity).toBeCloseTo(0.9);
    expect(parts.call.label).toBe('continues');
    expect(parts.fold.label).toBe('folds');
  });

  it('leaves a combo the engine gave no equity out of both halves', () => {
    const chart = parseRange('AA,QQ').range;
    const equities = equitiesFor(chart);
    equities[combo('QsQh')] = Number.NaN;
    const parts = splitByEquity(chart, equities, 1);
    expect(parts.call.weights[combo('QsQh')]).toBe(0);
    expect(parts.fold.weights[combo('QsQh')]).toBe(0);
  });
});

describe('poolSplit', () => {
  it('asks tier 1 at the facing node for the chosen group and cuts the chart at the pool’s share', async () => {
    const api = { frequencies: vi.fn().mockResolvedValue(tier1(true, 0.6)) };
    const chart = parseRange('AA,KK,22:0.5').range;
    const split = await poolSplit(api, FACING, chart, equitiesFor(chart), 'c1', () => false);
    expect(api.frequencies).toHaveBeenCalledWith(FACING, 'c1');
    expect(split?.continues).toBeCloseTo(0.4);
    expect(split?.ranges?.set.combos).toHaveLength(6);
  });

  it('keeps the pool’s answer but draws no split while the chart has no equities yet, or no chart', async () => {
    const api = { frequencies: vi.fn().mockResolvedValue(tier1()) };
    expect((await poolSplit(api, FACING, parseRange('AA').range, null, '', () => false))?.ranges).toBeNull();
    expect((await poolSplit(api, FACING, null, null, '', () => false))?.answer.enough).toBe(true);
  });

  it('draws nothing from a withheld frequency', async () => {
    const api = { frequencies: vi.fn().mockResolvedValue(tier1(false)) };
    const chart = parseRange('AA').range;
    const split = await poolSplit(api, FACING, chart, equitiesFor(chart), '', () => false);
    expect(split?.answer.enough).toBe(false);
    expect(split?.ranges).toBeNull();
  });

  it('hands nothing back once the situation has gone stale', async () => {
    let stale = false;
    const api = {
      frequencies: vi.fn(async () => {
        stale = true;
        return tier1();
      }),
    };
    expect(await poolSplit(api, FACING, parseRange('AA').range, null, '', () => stale)).toBeNull();
  });
});
