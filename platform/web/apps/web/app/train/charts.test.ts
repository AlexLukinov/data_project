/** Every reference chart must parse as written, and be the width its label implies. */

import { COMBO_COUNT, parseRange, weightedCombos } from '@poker/core';
import { describe, expect, it } from 'vitest';

import { CHARTS, chartById } from './charts';

const PERCENT = 100;

/** How wide a chart is, as a share of all 1326 combos. */
function openPct(id: string): number {
  return (weightedCombos(parseRange(chartById(id).text).range) / COMBO_COUNT) * PERCENT;
}

describe('the reference charts', () => {
  it('all parse into a non-empty range', () => {
    for (const chart of CHARTS) {
      expect(weightedCombos(parseRange(chart.text).range), chart.id).toBeGreaterThan(0);
    }
  });

  it('warn about nothing but gapped shorthand, which they mean exactly as the parser reads it', () => {
    // `Q9s+` is Q9, QT, QJ — the high card is kept (formats/classes.ts). The parser says so every
    // time; that note is the only one a chart here is allowed to produce.
    for (const chart of CHARTS) {
      for (const warning of parseRange(chart.text).warnings) {
        expect(warning, `${chart.id}: ${warning}`).toContain('high card kept');
      }
    }
  });

  it('have unique ids and a labelled position', () => {
    expect(new Set(CHARTS.map((c) => c.id)).size).toBe(CHARTS.length);
    for (const chart of CHARTS) expect(chart.position, chart.id).not.toBe('');
  });

  it('open wider the later the seat, which is the whole lesson of a preflop chart', () => {
    expect(openPct('utg_rfi')).toBeLessThan(openPct('hj_rfi'));
    expect(openPct('hj_rfi')).toBeLessThan(openPct('co_rfi'));
    expect(openPct('co_rfi')).toBeLessThan(openPct('btn_rfi'));
  });

  it('sit in the width a human would expect, so a mistyped chart fails loudly', () => {
    expect(openPct('utg_rfi')).toBeGreaterThan(12);
    expect(openPct('utg_rfi')).toBeLessThan(18);
    expect(openPct('hj_rfi')).toBeGreaterThan(15);
    expect(openPct('hj_rfi')).toBeLessThan(22);
    expect(openPct('co_rfi')).toBeGreaterThan(22);
    expect(openPct('co_rfi')).toBeLessThan(31);
    expect(openPct('btn_rfi')).toBeGreaterThan(38);
    expect(openPct('btn_rfi')).toBeLessThan(52);
    expect(openPct('bb_call_vs_btn')).toBeGreaterThan(35);
    expect(openPct('btn_3bet_vs_co')).toBeGreaterThan(3);
    expect(openPct('btn_3bet_vs_co')).toBeLessThan(9);
    expect(openPct('bb_3bet_vs_btn')).toBeGreaterThan(7);
    expect(openPct('bb_3bet_vs_btn')).toBeLessThan(14);
  });

  it('3-bet ranges are much tighter than the opens they face', () => {
    expect(openPct('btn_3bet_vs_co')).toBeLessThan(openPct('co_rfi'));
    expect(openPct('bb_3bet_vs_btn')).toBeLessThan(openPct('btn_rfi'));
  });

  it('names an unknown chart rather than returning nothing', () => {
    expect(() => chartById('no_such_chart')).toThrow(RangeError);
  });
});
