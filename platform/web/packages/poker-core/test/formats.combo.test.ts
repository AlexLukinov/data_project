import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { COMBO_COUNT, parseCombo } from '../src/cards';
import { formatWeight, parseComboFormat, serializeComboFormat } from '../src/formats/combo';
import { RangeParseError } from '../src/formats/errors';
import { totalCombos } from '../src/range';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'full_range_1326.txt');

describe('Format A (combo notation)', () => {
  it('round-trips the 1326-entry fixture byte for byte', () => {
    const text = readFileSync(FIXTURE, 'utf8');
    expect(text.split(',')).toHaveLength(COMBO_COUNT);
    const { range, warnings } = parseComboFormat(text);
    expect(totalCombos(range)).toBe(COMBO_COUNT);
    expect(warnings).toEqual(['1 weight exceeds 1 (largest 1.005); normalize to scale the range to 1']);
    expect(serializeComboFormat(range)).toBe(text);
  });

  it('reads weights as float32 and prints them back shortest', () => {
    expect(formatWeight(1)).toBe('1');
    expect(formatWeight(1.005)).toBe('1.005');
    expect(formatWeight(0.996)).toBe('0.996');
    expect(formatWeight(0.333)).toBe('0.333');
    expect(formatWeight(100)).toBe('100');
    expect(formatWeight(0.1 + 0.2)).toBe('0.3');
  });

  it('tolerates whitespace anywhere, either case, any card order, and an omitted weight', () => {
    const { range } = parseComboFormat(' as kh : 0.5 ,\n KHqd, 2C2d:1 ');
    expect(range.weights[parseCombo('AsKh')]).toBe(0.5);
    expect(range.weights[parseCombo('KhQd')]).toBe(1);
    expect(range.weights[parseCombo('2c2d')]).toBe(1);
    expect(serializeComboFormat(range)).toBe('2d2c: 1,KhQd: 1,AsKh: 0.5');
  });

  it('warns about duplicates (last wins) without failing', () => {
    const { range, warnings } = parseComboFormat('AsKh: 1, AsKh: 0.25');
    expect(range.weights[parseCombo('AsKh')]).toBe(0.25);
    expect(warnings).toEqual(['1 combo was listed more than once; the last weight wins']);
  });

  it('fails with the entry number, the entry, and the reason', () => {
    expect(() => parseComboFormat('AsKh: 1, AsAs: 1')).toThrow(RangeParseError);
    try {
      parseComboFormat('AsKh: 1, AsAs: 1');
    } catch (error) {
      const e = error as RangeParseError;
      expect(e.entryIndex).toBe(2);
      expect(e.entry).toBe('AsAs:1');
      expect(e.message).toBe("Couldn't parse range at entry 2: `AsAs:1` names the same card twice.");
    }
    expect(() => parseComboFormat('AsKh: 1, AKs')).toThrow(/entry 2: `AKs` isn't a combo/);
    expect(() => parseComboFormat('AsKh: -1')).toThrow(RangeParseError);
  });

  it('serializes an empty range as an empty string', () => {
    expect(serializeComboFormat(parseComboFormat('').range)).toBe('');
  });
});
