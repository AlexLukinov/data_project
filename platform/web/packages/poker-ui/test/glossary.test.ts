import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { AxisContext, NutAdvantage, RangeAdvantage } from '@poker/core';
import { AXES, DEFAULT_THRESHOLDS, DRAW_CLASSES, MADE_HAND_CLASSES, NODE_ACTIONS, POSITIONS, STRATEGIC_CATEGORIES, labelFor, potOdds } from '@poker/core';
import { describe, expect, it } from 'vitest';

import { explainEqr, explainMdf, explainNutAdvantage, explainPotOdds, explainRangeAdvantage } from '../src/explain';
import type { TermEntry } from '../src/glossary';
import { GLOSSARY, GLOSSARY_KEYS, POOL_TERMS, REQUIRED_TERMS, TIER_TERMS } from '../src/glossary';
import { AXIS_WORDS, CATEGORY_WORDS, DRAW_WORDS, MADE_HAND_WORDS, NODE_WORDS, POSITION_WORDS, VOCABULARY } from '../src/vocabulary';

const COMPONENTS = fileURLToPath(new URL('../src/components/', import.meta.url));
const APP = fileURLToPath(new URL('../../../apps/web/app/', import.meta.url));

/** The `term="…"` of every `<MetricLabel …>` tag in the .vue files under `dir`; another component's `term` prop is not read. */
function staticMetricTerms(dir: string, recursive: boolean): string[] {
  const terms: string[] = [];
  for (const file of readdirSync(dir, { recursive }) as string[]) {
    if (!file.endsWith('.vue') || file.endsWith('MetricLabel.vue')) continue;
    for (const tag of readFileSync(`${dir}${file}`, 'utf8').matchAll(/<MetricLabel\b[^>]*>/g)) {
      const term = /\sterm="([a-zA-Z]+)"/.exec(tag[0]);
      if (term !== null) terms.push(term[1]!);
    }
  }
  return terms;
}

/** One sentence ending in a full stop, and a rule or formula beside it. */
function expectOneSentenceWithRule(entry: TermEntry, name: string): void {
  expect(entry.term.length, name).toBeGreaterThan(0);
  expect(entry.definition.endsWith('.'), `${name} ends with a full stop`).toBe(true);
  expect(entry.definition.slice(0, -1).includes('. '), `${name} is one sentence`).toBe(false);
  expect(entry.formula?.length ?? 0, `${name} has a rule`).toBeGreaterThan(0);
}

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
    const used = new Set(staticMetricTerms(COMPONENTS, false));
    for (const key of used) expect(GLOSSARY_KEYS, key).toContain(key);
    // The pot-odds rows bind `:term="row.key"`, typed as GlossaryKey; the rest are static.
    for (const key of ['mdf', 'alpha', 'eqr', 'nutAdvantage', 'rangeAdvantage', 'equityDistribution', 'equity', 'defendingSet', 'sampleSize', 'observedFrequencies']) expect(used).toContain(key);
  });

  it('every static metric label in the app is a glossary key too', () => {
    // Nuxt compiles the app without vue-tsc seeing a string attribute as a GlossaryKey, so this is the guard.
    const used = staticMetricTerms(APP, true);
    expect(used.length).toBeGreaterThan(0);
    for (const key of used) expect(GLOSSARY_KEYS, key).toContain(key);
  });

  it('has an entry for every pool tier and for the sampling words beside them', () => {
    expect(Object.values(TIER_TERMS)).toEqual(['observedFrequencies', 'showdownRange', 'reconstructedRange']);
    for (const key of POOL_TERMS) expect(GLOSSARY_KEYS, key).toContain(key);
    expect(POOL_TERMS).toEqual([...Object.values(TIER_TERMS), 'sampleSize', 'showdownCoverage']);
  });
});

describe('the category vocabulary', () => {
  it('has exactly one row per value of each of core’s types, in core’s order', () => {
    expect(Object.keys(POSITION_WORDS)).toEqual([...POSITIONS]);
    expect(Object.keys(MADE_HAND_WORDS)).toEqual([...MADE_HAND_CLASSES]);
    expect(Object.keys(DRAW_WORDS)).toEqual([...DRAW_CLASSES]);
    expect(Object.keys(CATEGORY_WORDS)).toEqual([...STRATEGIC_CATEGORIES]);
    expect(Object.keys(AXIS_WORDS)).toEqual([...AXES]);
    for (const action of NODE_ACTIONS) expect(Object.keys(NODE_WORDS)).toContain(action);
  });

  it('gives every row one sentence and the rule that places it', () => {
    for (const [name, table] of Object.entries(VOCABULARY)) {
      for (const [key, entry] of Object.entries<TermEntry>(table)) expectOneSentenceWithRule(entry, `${name}.${key}`);
      expect(new Set(Object.values<TermEntry>(table).map((entry) => entry.term)).size, `${name} terms are distinct`).toBe(Object.keys(table).length);
    }
  });

  it('names a hand class, a draw and a category exactly as core’s distribution labels them', () => {
    const ctx: AxisContext = { classes: [], thresholds: DEFAULT_THRESHOLDS };
    for (const made of MADE_HAND_CLASSES) expect(MADE_HAND_WORDS[made].term).toBe(labelFor('made', made, ctx));
    for (const draw of DRAW_CLASSES) expect(DRAW_WORDS[draw].term).toBe(labelFor('draw', draw, ctx));
    for (const category of STRATEGIC_CATEGORIES) expect(CATEGORY_WORDS[category].term).toBe(labelFor('strategic', category, ctx));
  });

  it('states the category thresholds from core’s defaults rather than its own copy', () => {
    const percent = (share: number): string => `${Math.round(share * 100)}%`;
    expect(CATEGORY_WORDS.value.formula).toContain(`≥ ${percent(DEFAULT_THRESHOLDS.value)}`);
    expect(CATEGORY_WORDS.bluff_catcher.formula).toContain(`${percent(DEFAULT_THRESHOLDS.bluffCatcher)} ≤ equity < ${percent(DEFAULT_THRESHOLDS.value)}`);
    expect(CATEGORY_WORDS.air.formula).toContain(`under ${percent(DEFAULT_THRESHOLDS.bluffCatcher)}`);
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
