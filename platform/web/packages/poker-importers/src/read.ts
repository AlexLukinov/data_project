/** The one path every text importer takes: strip comments, parse, scale percentages, infer the situation. */
import type { NodeKey, RangeFormat, WeightedRange } from '@poker/core';
import { RangeParseError, createRange, maxWeight, parseRange } from '@poker/core';

import { ImportError } from './errors';
import type { Inference } from './filename';
import { inferFromName } from './filename';
import type { ImportedRange, RangeSource } from './types';

const PERCENT_SCALE = 100;
/** Below this a weight above 1 is a rounding artefact (SPH exports carry 1.005), not a percentage. */
const PERCENT_MIN = 1.5;
const COMMENT = /^\s*(#|\/\/)/;
const ABOVE_ONE = /exceeds? 1/;

export interface ReadOptions {
  readonly source: RangeSource;
  readonly sourceTool: string;
  /** Force a notation instead of detecting it. */
  readonly format?: RangeFormat;
  /** The situation, when the file states it; otherwise it is inferred from `name`. */
  readonly nodeKey?: NodeKey | null;
  readonly tags?: readonly string[];
  /** Named in errors. */
  readonly file?: string;
}

/** Drop comment lines and join the rest with commas, so one entry per line parses too. */
export function joinLines(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '' && !COMMENT.test(line))
    .join(',');
}

/** Weights written as percentages (largest in [1.5, 100]) become fractions; anything else passes through. */
export function normalizePercentWeights(range: WeightedRange): { range: WeightedRange; warning: string | null } {
  const largest = maxWeight(range);
  if (largest < PERCENT_MIN || largest > PERCENT_SCALE) return { range, warning: null };
  const scaled = createRange(undefined, range.label);
  for (let i = 0; i < range.weights.length; i++) scaled.weights[i] = range.weights[i]! / PERCENT_SCALE;
  return { range: scaled, warning: `weights looked like percentages (largest ${largest}); divided by 100` };
}

/** Parse one range's text into a library entry. Parse errors become `ImportError`s naming the file. */
export function readRange(text: string, name: string, options: ReadOptions): ImportedRange {
  let parsed;
  try {
    parsed = parseRange(joinLines(text), options.format);
  } catch (error) {
    if (error instanceof RangeParseError) throw new ImportError(error.message, options.file ?? name);
    throw error;
  }
  const { range, warning } = normalizePercentWeights(parsed.range);
  const warnings = warning === null ? [...parsed.warnings] : [warning, ...parsed.warnings.filter((w) => !ABOVE_ONE.test(w))];
  const inference = options.nodeKey === undefined ? inferFromName(name) : null;
  return {
    name,
    range: { weights: range.weights, label: name },
    format: parsed.format,
    nodeKey: options.nodeKey === undefined ? inference!.key : options.nodeKey,
    inference,
    source: options.source,
    sourceTool: options.sourceTool,
    tags: options.tags ?? [],
    warnings,
  };
}

export type { Inference };
