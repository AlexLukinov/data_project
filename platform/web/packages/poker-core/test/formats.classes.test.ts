import { describe, expect, it } from 'vitest';

import { HAND_CLASS_COMBOS, handClassOfName, parseCard, parseCombo } from '../src/cards';
import { isClassExpressible, parseClassFormat, serializeClassFormat } from '../src/formats/classes';
import { RangeParseError } from '../src/formats/errors';
import { detectFormat, parseRange, serializeRange } from '../src/formats/index';
import { removeCards, totalCombos, weightedCombos } from '../src/range';

const classWeight = (text: string, name: string): number => {
  const { range } = parseClassFormat(text);
  const combos = HAND_CLASS_COMBOS[handClassOfName(name)]!;
  const weights = new Set(combos.map((c) => range.weights[c]));
  expect(weights.size, `${name} should be uniform`).toBe(1);
  return [...weights][0]!;
};
describe('Format B (class notation): parsing', () => {
  it('parses the spec example with the right combo counts and weights', () => {
    const text = 'AA,KK,QQ:0.75,JJ,AKs,AKo:0.5,AQs+,A5s-A2s,JTs+,KQo,76s';
    const { range, warnings } = parseClassFormat(text);
    expect(classWeight(text, 'AA')).toBe(1);
    expect(classWeight(text, 'QQ')).toBe(0.75);
    expect(classWeight(text, 'AKo')).toBe(0.5);
    expect(classWeight(text, 'AQs')).toBe(1);
    expect(classWeight(text, 'A3s')).toBe(1);
    expect(classWeight(text, 'QJs')).toBe(1); // JTs+ climbs the connectors
    expect(classWeight(text, 'KQs')).toBe(1);
    expect(classWeight(text, '76s')).toBe(1);
    expect(range.weights[parseCombo('AsAh')]).toBe(1);
    expect(range.weights[parseCombo('7s6h')]).toBe(0);
    // AA KK JJ (18) + QQ (6) + AKs (4) + AKo (12) + AQs (4) + A5s..A2s (16) + JTs QJs KQs (12; AKs already) + KQo (12) + 76s (4)
    expect(totalCombos(range)).toBe(18 + 6 + 4 + 12 + 4 + 16 + 12 + 12 + 4);
    expect(weightedCombos(range)).toBeCloseTo(18 + 6 * 0.75 + 4 + 12 * 0.5 + 4 + 16 + 12 + 12 + 4);
    expect(warnings).toEqual(['2 hand classes were listed more than once; the last weight wins']); // AKs again from AQs+, and again from JTs+
  });

  it('expands plus terms: pairs up, connectors climb, other hands keep the high card', () => {
    expect(totalCombos(parseClassFormat('JJ+').range)).toBe(4 * 6);
    expect(totalCombos(parseClassFormat('T9s+').range)).toBe(5 * 4); // T9s JTs QJs KQs AKs
    expect(totalCombos(parseClassFormat('K9o+').range)).toBe(4 * 12); // K9o KTo KJo KQo
    expect(totalCombos(parseClassFormat('A2s+').range)).toBe(12 * 4);
    expect(totalCombos(parseClassFormat('A2+').range)).toBe(12 * 16);
    expect(classWeight('K9o+', 'KJo')).toBe(1);
  });

  it('warns how an ambiguous gapper plus was read', () => {
    const { range, warnings } = parseClassFormat('T8s+');
    expect(totalCombos(range)).toBe(2 * 4); // T8s, T9s
    expect(warnings[0]).toMatch(/`T8s\+`: read as T8, T9 \(high card kept\)/);
    expect(parseClassFormat('AQs+').warnings).toEqual([]);
    expect(parseClassFormat('K9s+').warnings).toEqual([]);
  });

  it('expands dash ranges by high card, by gap, and between pairs', () => {
    expect(totalCombos(parseClassFormat('A5s-A2s').range)).toBe(16);
    expect(totalCombos(parseClassFormat('A2s-A5s').range)).toBe(16);
    expect(totalCombos(parseClassFormat('99-66').range)).toBe(24);
    expect(totalCombos(parseClassFormat('66-99').range)).toBe(24);
    expect(totalCombos(parseClassFormat('T9s-65s').range)).toBe(5 * 4);
    expect(totalCombos(parseClassFormat('J8o-J4o').range)).toBe(5 * 12);
    expect(classWeight('T9s-65s:0.5', '87s')).toBe(0.5);
  });

  it('reads a bare unpaired name as both suited and offsuit, any case, any order', () => {
    expect(totalCombos(parseClassFormat('AK').range)).toBe(16);
    expect(totalCombos(parseClassFormat('ka').range)).toBe(16);
    expect(totalCombos(parseClassFormat('kas').range)).toBe(4);
  });

  it('applies the last weight when a class is listed twice, with a warning', () => {
    const text = 'AKs:1,AKs:0.25';
    expect(classWeight(text, 'AKs')).toBe(0.25);
    expect(parseClassFormat(text).warnings).toEqual(['1 hand class was listed more than once; the last weight wins']);
  });

  it('fails with the entry number and an actionable suggestion', () => {
    expect(() => parseClassFormat('AA, AKx')).toThrow(RangeParseError);
    expect(() => parseClassFormat('AA, AKx')).toThrow("Couldn't parse range at entry 2: `AKx` isn't valid notation. Did you mean `AKs` or `AKo`?");
    expect(() => parseClassFormat('AAs')).toThrow(/gives a pair a suited\/offsuit suffix. Did you mean `AA`\?/);
    expect(() => parseClassFormat('A10s')).toThrow(/write a ten as T/);
    expect(() => parseClassFormat('A5s-K5s')).toThrow(/share neither the high card nor the gap/);
    expect(() => parseClassFormat('A5s-A2o')).toThrow(/mixes suited, offsuit/);
    expect(() => parseClassFormat(':0.5')).toThrow(/weight but no hand/);
  });

  it('accepts whitespace and an empty text', () => {
    expect(totalCombos(parseClassFormat(' AA , KK ,\n QQ ').range)).toBe(18);
    expect(totalCombos(parseClassFormat('').range)).toBe(0);
  });
});

describe('Format B: serializing', () => {
  it('writes pairs, suited and offsuit runs compactly and round-trips them', () => {
    const cases = [
      'QQ+,AKs,AKo',
      'TT+,A5s-A2s',
      'AA,KK,QQ:0.75,JJ,AKs,AKo:0.5,A5s-A2s,KQo,76s',
      'K9o+,T9s-65s',
      'AQs+:0.5,55-33',
    ];
    for (const text of cases) {
      const { range } = parseClassFormat(text);
      const { text: out, warnings } = serializeClassFormat(range);
      expect(warnings).toEqual([]);
      expect(totalCombos(parseClassFormat(out).range)).toBe(totalCombos(range));
      expect(weightedCombos(parseClassFormat(out).range)).toBeCloseTo(weightedCombos(range));
    }
    expect(serializeClassFormat(parseClassFormat('QQ+,AKs,AKo').range).text).toBe('QQ+,AKs,AKo');
    expect(serializeClassFormat(parseClassFormat('TT+,A5s-A2s').range).text).toBe('TT+,A5s-A2s');
    expect(serializeClassFormat(parseClassFormat('K9o+').range).text).toBe('K9o+');
    expect(serializeClassFormat(parseClassFormat('55-33,KK').range).text).toBe('KK,55-33');
  });

  it('reports the classes it cannot express exactly', () => {
    const { range } = parseClassFormat('AKs');
    const partial = removeCards(range, [parseCard('As')]);
    expect(isClassExpressible(range)).toBe(true);
    expect(isClassExpressible(partial)).toBe(false);
    const { text, warnings } = serializeClassFormat(partial);
    expect(text).toBe('AKs:0.75');
    expect(warnings).toEqual(['AKs: combos differ in weight or some are removed; written as one class at 0.75']);
  });
});

describe('the front door', () => {
  it('detects the notation from the first entry', () => {
    expect(detectFormat('AsKh: 1, AsKd: 1')).toBe('combo');
    expect(detectFormat(' askh ')).toBe('combo');
    expect(detectFormat('AA,KK')).toBe('class');
    expect(detectFormat('')).toBe('class');
  });

  it('parses either and serializes to either', () => {
    const fromClass = parseRange('AKs:0.5');
    expect(fromClass.format).toBe('class');
    expect(serializeRange(fromClass.range, 'combo')).toBe('AcKc: 0.5,AdKd: 0.5,AhKh: 0.5,AsKs: 0.5');
    const fromCombo = parseRange('AcKc: 0.5,AdKd: 0.5,AhKh: 0.5,AsKs: 0.5');
    expect(fromCombo.format).toBe('combo');
    expect(serializeRange(fromCombo.range, 'class')).toBe('AKs:0.5');
  });

  it('carries the weight warning for class notation too', () => {
    expect(parseRange('AA:1.2').warnings).toEqual(['6 weights exceed 1 (largest 1.2); normalize to scale the range to 1']);
  });

  it('explains a combo entry inside class notation', () => {
    expect(() => parseRange('AA, AsKh')).toThrow(/entry 2: `AsKh` isn't valid notation/);
  });
});
