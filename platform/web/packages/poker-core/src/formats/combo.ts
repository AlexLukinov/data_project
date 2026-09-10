/**
 * Format A — combo-level notation (spec §4.3): `2d2c: 1,2h2c: 1,…,Tc9d: 1.005,…,AsAh: 1`.
 *
 * Parse accepts whitespace anywhere, either case, entries in any order, and an omitted weight
 * (= 1). Serialize emits the canonical form — ascending combo index, uppercase rank, lowercase
 * suit, higher card first, `combo: weight`, comma-separated, no spaces except the one after the
 * colon — so that parsing an export and serializing it again reproduces it byte for byte.
 */

import { COMBO_COUNT, comboIndex, comboToString, parseCard } from '../cards';
import { formatWeight } from '../numbers';
import type { WeightedRange } from '../range';
import { aboveOneWarning, createRange } from '../range';
import { RangeParseError } from './errors';

const ENTRY = /^([2-9TJQKA][CDHS])([2-9TJQKA][CDHS])(?::([0-9]*\.?[0-9]+(?:E[+-]?[0-9]+)?))?$/i;
const LOOKS_LIKE_COMBO = /^[2-9TJQKA][CDHS][2-9TJQKA][CDHS](:.*)?$/i;

export interface ParsedComboFormat {
  readonly range: WeightedRange;
  readonly warnings: string[];
}

/** Whether a single stripped entry is in combo notation (used by the format detector). */
export function isComboEntry(entry: string): boolean {
  return LOOKS_LIKE_COMBO.test(entry);
}

/** Split a range text into its non-empty entries with all whitespace removed. */
export function splitEntries(text: string): string[] {
  return text
    .split(',')
    .map((e) => e.replace(/\s+/g, ''))
    .filter((e) => e.length > 0);
}

export function parseComboFormat(text: string): ParsedComboFormat {
  const range = createRange();
  const warnings: string[] = [];
  const seen = new Uint8Array(COMBO_COUNT);
  let duplicates = 0;
  let aboveOne = 0;
  let largest = 0;
  const entries = splitEntries(text);
  entries.forEach((entry, i) => {
    const m = ENTRY.exec(entry);
    if (m === null) {
      throw new RangeParseError(i + 1, entry, "isn't a combo like AsKh or AsKh: 0.5");
    }
    const a = parseCard(m[1]!);
    const b = parseCard(m[2]!);
    if (a === b) {
      throw new RangeParseError(i + 1, entry, 'names the same card twice');
    }
    const combo = comboIndex(a, b);
    const weight = m[3] === undefined ? 1 : Math.fround(Number.parseFloat(m[3]));
    if (seen[combo]) duplicates++;
    seen[combo] = 1;
    if (weight > 1) {
      aboveOne++;
      if (weight > largest) largest = weight;
    }
    range.weights[combo] = weight;
  });
  if (duplicates > 0) warnings.push(`${duplicates} combo${duplicates === 1 ? ' was' : 's were'} listed more than once; the last weight wins`);
  if (aboveOne > 0) warnings.push(aboveOneWarning(aboveOne, largest));
  return { range, warnings };
}

export { formatWeight };

export function serializeComboFormat(range: WeightedRange): string {
  const parts: string[] = [];
  for (let combo = 0; combo < COMBO_COUNT; combo++) {
    const w = range.weights[combo]!;
    if (w > 0) parts.push(`${comboToString(combo)}: ${formatWeight(w)}`);
  }
  return parts.join(',');
}
