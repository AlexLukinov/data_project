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

/**
 * Why a weight has to be a finite float32 (ADR-070).
 *
 * The weights are float32, and `Number.parseFloat` is a double: `1e999`, or any literal past
 * 3.4e38, rounds to `Infinity` on the way in. Nothing then complains — the range holds it, and
 * `serializeComboFormat` writes `AsKh: Infinity`, which is not combo notation. The server stores
 * this text without parsing it and refuses anything that is not canonical
 * (`platform/api/schemas_ranges.py`), so the save fails with "entry 1 ('AsKh: Infinity') is not
 * combo notation" — the API accusing the client of garbage the client's own serializer wrote.
 * It is caught here instead, at the box the text was pasted into, and said as a weight problem.
 */
export const NOT_FINITE = 'has a weight too large to hold; weights are between 0 and 1';

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

/** What the entries added up to that the reader should hear about, but not be stopped by. */
interface Tally {
  duplicates: number;
  aboveOne: number;
  largest: number;
  /** Weights written as a positive number that float32 rounds to zero — the combo disappears. */
  vanished: number;
}

/**
 * The weight an entry carries, as the float32 the range holds.
 *
 * `Number.parseFloat` is a double, so a literal past 3.4e38 arrives here as `Infinity`; it is
 * refused rather than stored, because the text it serializes back to is not combo notation.
 */
function entryWeight(written: string | undefined, entry: string, index: number, tally: Tally): number {
  if (written === undefined) return 1;
  const weight = Math.fround(Number.parseFloat(written));
  if (!Number.isFinite(weight)) throw new RangeParseError(index, entry, NOT_FINITE);
  if (weight === 0 && Number.parseFloat(written) > 0) tally.vanished++;
  if (weight > 1) {
    tally.aboveOne++;
    if (weight > tally.largest) tally.largest = weight;
  }
  return weight;
}

function comboWarnings(tally: Tally): string[] {
  const warnings: string[] = [];
  if (tally.vanished > 0) {
    warnings.push(`${tally.vanished} weight${tally.vanished === 1 ? ' is' : 's are'} too small to hold and round to zero; those combos are not in the range`);
  }
  if (tally.duplicates > 0) {
    warnings.push(`${tally.duplicates} combo${tally.duplicates === 1 ? ' was' : 's were'} listed more than once; the last weight wins`);
  }
  if (tally.aboveOne > 0) warnings.push(aboveOneWarning(tally.aboveOne, tally.largest));
  return warnings;
}

export function parseComboFormat(text: string): ParsedComboFormat {
  const range = createRange();
  const seen = new Uint8Array(COMBO_COUNT);
  const tally: Tally = { duplicates: 0, aboveOne: 0, largest: 0, vanished: 0 };
  splitEntries(text).forEach((entry, i) => {
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
    if (seen[combo]) tally.duplicates++;
    seen[combo] = 1;
    range.weights[combo] = entryWeight(m[3], entry, i + 1, tally);
  });
  return { range, warnings: comboWarnings(tally) };
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
