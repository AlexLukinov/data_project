/**
 * The range text front door (spec §4.3): detect the notation, parse, serialize.
 * Every paste box calls `parseRange`; every "copy as …" button calls `serializeRange`.
 */

import type { WeightedRange } from '../range';
import { weightWarnings } from '../range';
import { parseClassFormat, serializeClassFormat } from './classes';
import { isComboEntry, parseComboFormat, serializeComboFormat, splitEntries } from './combo';

export type RangeFormat = 'combo' | 'class';

export interface ParsedRange {
  readonly range: WeightedRange;
  readonly format: RangeFormat;
  /** Non-blocking: weights above 1, duplicates, ambiguous plus terms, … */
  readonly warnings: string[];
}

/** Combo notation when the first entry spells two cards (`AsKh`), class notation otherwise. */
export function detectFormat(text: string): RangeFormat {
  const first = splitEntries(text)[0];
  return first !== undefined && isComboEntry(first) ? 'combo' : 'class';
}

/** Parse either notation. Throws `RangeParseError` with the entry number and a suggestion. */
export function parseRange(text: string, format: RangeFormat = detectFormat(text)): ParsedRange {
  const parsed = format === 'combo' ? parseComboFormat(text) : parseClassFormat(text);
  const warnings = [...parsed.warnings];
  if (format === 'class') warnings.push(...weightWarnings(parsed.range));
  return { range: parsed.range, format, warnings };
}

/** Serialize to a notation. Class notation is lossy for uneven cells; see `serializeClassFormat`. */
export function serializeRange(range: WeightedRange, format: RangeFormat): string {
  return format === 'combo' ? serializeComboFormat(range) : serializeClassFormat(range).text;
}

export { RangeParseError } from './errors';
export { formatWeight, parseComboFormat, serializeComboFormat } from './combo';
export { isClassExpressible, parseClassFormat, serializeClassFormat } from './classes';
export type { ParsedClassFormat, SerializedClassFormat } from './classes';
export type { ParsedComboFormat } from './combo';
