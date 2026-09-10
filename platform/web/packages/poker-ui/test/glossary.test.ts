import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { NutAdvantage, RangeAdvantage } from '@poker/core';
import { potOdds } from '@poker/core';
import { describe, expect, it } from 'vitest';

import { explainEqr, explainMdf, explainNutAdvantage, explainPotOdds, explainRangeAdvantage } from '../src/explain';
import { GLOSSARY, GLOSSARY_KEYS, REQUIRED_TERMS } from '../src/glossary';

const COMPONENTS = fileURLToPath(new URL('../src/components/', import.meta.url));

describe('glossary', () => {
  it('has the terms spec §13 names, each with one sentence and a formula', () => {
    for (const key of REQUIRED_TERMS) expect(GLOSSARY_KEYS).toContain(key);
    for (const key of GLOSSARY_KEYS) {
      const entry = GLOSSARY[key];
      expect(entry.term.length, key).toBeGreaterThan(0);
      expect(entry.definition.endsWith('.'), `${key} ends with a full stop`).toBe(true);
      expect(entry.definition.slice(0, -1).includes('. '), `${key} is one sentence`).toBe(false);
      expect(entry.formula.length, key).toBeGreaterThan(0);
    }
  });

  it('every static metric label in the components is a glossary key', () => {
    const used = new Set<string>();
    for (const file of readdirSync(COMPONENTS)) {
      if (!file.endsWith('.vue') || file === 'MetricLabel.vue') continue;
      for (const match of readFileSync(`${COMPONENTS}${file}`, 'utf8').matchAll(/\bterm="([a-zA-Z]+)"/g)) used.add(match[1]!);
    }
    for (const key of used) expect(GLOSSARY_KEYS, key).toContain(key);
    // The pot-odds rows bind `:term="row.key"`, typed as GlossaryKey; the rest are static.
    for (const key of ['mdf', 'alpha', 'eqr', 'nutAdvantage', 'rangeAdvantage', 'equityDistribution', 'equity', 'defendingSet']) expect(used).toContain(key);
  });
});

describe('explain the number', () => {
  const f = potOdds(100, 50).raw;

  it('pot odds and MDF', () => {
    expect(explainPotOdds(f)).toBe('Calling 50 to win 150 is 3 : 1: the call breaks even with 25.0% equity. Facing this bet, defend 66.7% of your range so a bluff has to work 33.3% of the time to break even.');
    expect(explainPotOdds(potOdds(100, 0).raw)).toContain('Nobody has bet');
    expect(explainMdf(f, null)).toContain('continue with 66.7% of the range');
    expect(explainMdf(f, { combos: [1, 2], weight: 2, totalWeight: 3, cutoffEquity: 0.4 })).toContain('the 2 combos (2 weighted) with at least 40.0% equity');
    expect(explainMdf(potOdds(100, 0).raw, null)).toContain('nothing to defend');
  });

  it('EQR from an entered EV', () => {
    expect(explainEqr(0.45, 100, null, 'entered')).toContain('worth 45');
    expect(explainEqr(0.45, 100, 38, 'entered')).toContain('84% of the 45');
    expect(explainEqr(0.45, 100, 38, 'entered')).toContain('under-realizes');
    expect(explainEqr(0.45, 100, 50, 'entered')).toContain('over-realizes');
    expect(explainEqr(0.5, 100, 50, 'pool')).toContain('The pool EV of 50 is 100% of the 50');
  });

  it('range advantage', () => {
    const even: RangeAdvantage = { heroMean: 0.51, villainMean: 0.49, difference: 0.02, heroMedian: 0.5, villainMedian: 0.5, buckets: { edges: [], hero: [], villain: [] } };
    expect(explainRangeAdvantage(even, 'Hero', 'Villain')).toContain('within 2.0 points: no real range advantage');
    expect(explainRangeAdvantage({ ...even, heroMean: 0.4, villainMean: 0.6, difference: -0.2 }, 'Hero', 'Villain')).toBe('Villain has the range advantage: 60.0% average equity against 40.0% for Hero, 20.0 points more.');
    expect(explainRangeAdvantage({ ...even, difference: Number.NaN }, 'Hero', 'Villain')).toContain('Run the equity calculation');
  });

  it('nut advantage', () => {
    const nut = (hero: number, villain: number): NutAdvantage => {
      const both = hero + villain || 1;
      return { mode: 'cutoff', threshold: 0.8, hero: { nutWeight: hero, share: 0 }, villain: { nutWeight: villain, share: 0 }, split: { hero: hero / both, villain: villain / both } };
    };
    expect(explainNutAdvantage(nut(78, 22), 'Hero', 'Villain')).toBe('Hero holds 78% of the nutted combos (equity ≥ 80%) — that supports a larger bet size.');
    expect(explainNutAdvantage(nut(30, 70), 'Hero', 'Villain')).toContain('Hero should size down or check more');
    expect(explainNutAdvantage(nut(50, 50), 'Hero', 'Villain')).toContain('split 50% / 50%');
    expect(explainNutAdvantage(nut(0, 0), 'Hero', 'Villain')).toContain('Neither range has a nutted combo');
    expect(explainNutAdvantage({ ...nut(78, 22), mode: 'topPercent', threshold: 0.912 }, 'Hero', 'Villain')).toContain('the top of both ranges, equity ≥ 91.2%');
  });
});
