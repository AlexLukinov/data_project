/**
 * Format B — hand-class notation as PioSOLVER, Equilab and PokerStove write it (spec §4.3):
 * `AA,KK,QQ:0.75,JJ,AKs,AKo:0.5,AQs+,A5s-A2s,JTs+,KQo,76s`
 *
 * Terms: a pair (`QQ`), suited (`AKs`), offsuit (`AKo`) or both (`AK`); a plus (`JJ+`, `AQs+`);
 * a dash range (`99-66`, `A5s-A2s`, `T9s-65s`); an optional `:weight` on any term.
 *
 * The plus convention, which tools do not all share, is:
 *   pairs        `99+`  → 99, TT, …, AA
 *   connectors   `T9s+` → T9s, JTs, QJs, KQs, AKs  (both cards climb)
 *   anything else `K9s+` → K9s, KTs, KJs, KQs       (the high card stays, the low card climbs)
 * The third rule read on a one- or two-gapper below broadway (`T8s+`) is ambiguous between
 * tools — some climb the gap (T8s, J9s, QTs …) — so that case parses with a warning that says
 * how it was read.
 *
 * Dash ranges keep the high card (`A5s-A2s`, `J8o-J4o`) or keep the gap (`T9s-65s`); pairs
 * run between the two (`99-66`, either order).
 *
 * Serializing is lossy on purpose: a class whose combos carry different weights, or some of
 * which are gone (card removal), can only be written as one class with one weight; those are
 * reported as warnings so the UI can say "copy as combo format to keep every weight".
 */

import type { HandClass } from '../cards';
import { ACE, HAND_CLASS_COMBOS, RANK_CHARS, RANK_COUNT, handClassName, isPairClass, isSuitedClass } from '../cards';
import { formatWeight } from '../numbers';
import type { WeightedRange } from '../range';
import { createRange, toHandClassMatrix } from '../range';
import { splitEntries } from './combo';
import { RangeParseError } from './errors';

type Kind = 'pair' | 's' | 'o' | 'both';

interface ClassTerm {
  readonly high: number;
  readonly low: number;
  readonly kind: Kind;
}

const NAME = /^([2-9TJQKA])([2-9TJQKA])([SO]?)$/i;
const WEIGHT = /^(.*?)(?::([0-9]*\.?[0-9]+(?:E[+-]?[0-9]+)?))?$/i;

function suggestion(entry: string): string | undefined {
  const base = entry.replace(/[:+-].*$/, '');
  if (base.length >= 2 && RANK_CHARS.includes(base[0]!.toUpperCase()) && RANK_CHARS.includes(base[1]!.toUpperCase())) {
    const two = base.slice(0, 2).toUpperCase();
    return two[0] === two[1] ? `\`${two}\`` : `\`${two}s\` or \`${two}o\``;
  }
  if (/10/.test(entry)) return `\`${entry.replace(/10/g, 'T')}\` (write a ten as T)`;
  return undefined;
}

function parseName(name: string, entryIndex: number, entry: string): ClassTerm {
  const m = NAME.exec(name);
  if (m === null) {
    throw new RangeParseError(entryIndex, entry, "isn't valid notation", suggestion(entry));
  }
  const a = RANK_CHARS.indexOf(m[1]!.toUpperCase());
  const b = RANK_CHARS.indexOf(m[2]!.toUpperCase());
  const suffix = m[3]!.toLowerCase();
  const high = Math.max(a, b);
  const low = Math.min(a, b);
  if (high === low) {
    if (suffix !== '') {
      throw new RangeParseError(entryIndex, entry, 'gives a pair a suited/offsuit suffix', `\`${m[1]!.toUpperCase()}${m[2]!.toUpperCase()}\``);
    }
    return { high, low, kind: 'pair' };
  }
  return { high, low, kind: suffix === '' ? 'both' : (suffix as Kind) };
}

function classId(high: number, low: number, kind: 's' | 'o' | 'pair'): HandClass {
  if (kind === 'pair') return (ACE - high) * RANK_COUNT + (ACE - high);
  return kind === 's' ? (ACE - high) * RANK_COUNT + (ACE - low) : (ACE - low) * RANK_COUNT + (ACE - high);
}

function classesOf(high: number, low: number, kind: Kind): HandClass[] {
  if (kind === 'pair') return [classId(high, high, 'pair')];
  if (kind === 'both') return [classId(high, low, 's'), classId(high, low, 'o')];
  return [classId(high, low, kind)];
}

function expandPlus(term: ClassTerm, entryIndex: number, entry: string, warnings: string[]): HandClass[] {
  const out: HandClass[] = [];
  if (term.kind === 'pair') {
    for (let r = term.high; r <= ACE; r++) out.push(...classesOf(r, r, 'pair'));
    return out;
  }
  const gap = term.high - term.low;
  if (gap === 1) {
    for (let k = 0; term.high + k <= ACE; k++) out.push(...classesOf(term.high + k, term.low + k, term.kind));
    return out;
  }
  if (gap <= 3 && term.high < ACE - 1) {
    const read = [];
    for (let l = term.low; l < term.high; l++) read.push(RANK_CHARS[term.high]! + RANK_CHARS[l]!);
    warnings.push(
      `entry ${entryIndex} \`${entry}\`: read as ${read.join(', ')} (high card kept); ` +
        'list the hands explicitly if you meant the gap to climb',
    );
  }
  for (let l = term.low; l < term.high; l++) out.push(...classesOf(term.high, l, term.kind));
  return out;
}

function expandDash(from: ClassTerm, to: ClassTerm, entryIndex: number, entry: string): HandClass[] {
  if (from.kind !== to.kind) {
    throw new RangeParseError(entryIndex, entry, 'mixes suited, offsuit or pair ends of a range');
  }
  const out: HandClass[] = [];
  if (from.kind === 'pair') {
    const hi = Math.max(from.high, to.high);
    const lo = Math.min(from.high, to.high);
    for (let r = hi; r >= lo; r--) out.push(...classesOf(r, r, 'pair'));
    return out;
  }
  if (from.high === to.high) {
    const hi = Math.max(from.low, to.low);
    const lo = Math.min(from.low, to.low);
    for (let l = hi; l >= lo; l--) out.push(...classesOf(from.high, l, from.kind));
    return out;
  }
  if (from.high - from.low === to.high - to.low) {
    const top = from.high >= to.high ? from : to;
    const bottom = from.high >= to.high ? to : from;
    for (let k = 0; top.high - k >= bottom.high; k++) out.push(...classesOf(top.high - k, top.low - k, from.kind));
    return out;
  }
  throw new RangeParseError(
    entryIndex,
    entry,
    'is a range whose ends share neither the high card nor the gap',
    `\`${RANK_CHARS[from.high]}${RANK_CHARS[from.low]}${from.kind === 'both' ? '' : from.kind}-${RANK_CHARS[from.high]}2${from.kind === 'both' ? '' : from.kind}\``,
  );
}

function expandTerm(text: string, entryIndex: number, entry: string, warnings: string[]): HandClass[] {
  if (text.endsWith('+')) {
    return expandPlus(parseName(text.slice(0, -1), entryIndex, entry), entryIndex, entry, warnings);
  }
  const dash = text.indexOf('-');
  if (dash > 0) {
    const from = parseName(text.slice(0, dash), entryIndex, entry);
    const to = parseName(text.slice(dash + 1), entryIndex, entry);
    return expandDash(from, to, entryIndex, entry);
  }
  const term = parseName(text, entryIndex, entry);
  return classesOf(term.high, term.low, term.kind);
}

export interface ParsedClassFormat {
  readonly range: WeightedRange;
  readonly warnings: string[];
}

export function parseClassFormat(text: string): ParsedClassFormat {
  const range = createRange();
  const warnings: string[] = [];
  const seen = new Set<HandClass>();
  let repeated = 0;
  splitEntries(text).forEach((entry, i) => {
    const m = WEIGHT.exec(entry)!;
    const term = m[1]!;
    if (term === '') throw new RangeParseError(i + 1, entry, 'has a weight but no hand');
    const weight = m[2] === undefined ? 1 : Math.fround(Number.parseFloat(m[2]));
    for (const cls of expandTerm(term, i + 1, entry, warnings)) {
      if (seen.has(cls)) repeated++;
      seen.add(cls);
      for (const combo of HAND_CLASS_COMBOS[cls]!) range.weights[combo] = weight;
    }
  });
  if (repeated > 0) warnings.push(`${repeated} hand class${repeated === 1 ? ' was' : 'es were'} listed more than once; the last weight wins`);
  return { range, warnings };
}

// ---- serialize ----------------------------------------------------------------------------

interface CellOut {
  readonly cls: HandClass;
  readonly weight: number;
}

function cellWeights(range: WeightedRange, warnings: string[]): Map<HandClass, number> {
  const out = new Map<HandClass, number>();
  for (const cell of toHandClassMatrix(range)) {
    if (cell.comboCount === 0) continue;
    const weights = HAND_CLASS_COMBOS[cell.cls]!.map((c) => range.weights[c]!).filter((w) => w > 0);
    const uniform = cell.comboCount === cell.possibleCombos && weights.every((w) => w === weights[0]);
    if (!uniform) warnings.push(`${handClassName(cell.cls)}: combos differ in weight or some are removed; written as one class at ${formatWeight(cell.averageWeight)}`);
    out.set(cell.cls, uniform ? weights[0]! : cell.averageWeight);
  }
  return out;
}

function withWeight(term: string, weight: number): string {
  return weight === 1 ? term : `${term}:${formatWeight(weight)}`;
}

/** Compress a descending run of cells (same high card and kind, or pairs) into `X+`, `X-Y` or a list. */
function runTerms(cells: CellOut[], name: (cls: HandClass) => string, reachesTop: (cls: HandClass) => boolean, adjacent: (a: HandClass, b: HandClass) => boolean): string[] {
  const terms: string[] = [];
  let i = 0;
  while (i < cells.length) {
    let j = i;
    while (j + 1 < cells.length && cells[j + 1]!.weight === cells[i]!.weight && adjacent(cells[j]!.cls, cells[j + 1]!.cls)) j++;
    const first = cells[i]!;
    const last = cells[j]!;
    const length = j - i + 1;
    if (length >= 2 && reachesTop(first.cls)) terms.push(withWeight(`${name(last.cls)}+`, first.weight));
    else if (length >= 3) terms.push(withWeight(`${name(first.cls)}-${name(last.cls)}`, first.weight));
    else for (let k = i; k <= j; k++) terms.push(withWeight(name(cells[k]!.cls), first.weight));
    i = j + 1;
  }
  return terms;
}

export interface SerializedClassFormat {
  readonly text: string;
  readonly warnings: string[];
}

export function serializeClassFormat(range: WeightedRange): SerializedClassFormat {
  const warnings: string[] = [];
  const weights = cellWeights(range, warnings);
  const cell = (cls: HandClass): CellOut | undefined => (weights.has(cls) ? { cls, weight: weights.get(cls)! } : undefined);
  const present = (list: (CellOut | undefined)[]): CellOut[] => list.filter((c): c is CellOut => c !== undefined);
  const terms: string[] = [];

  const pairs = present(Array.from({ length: RANK_COUNT }, (_, i) => cell(i * RANK_COUNT + i)));
  terms.push(...runTerms(pairs, handClassName, (cls) => cls === 0, (a, b) => b === a + RANK_COUNT + 1));

  for (const kind of ['s', 'o'] as const) {
    for (let row = 0; row < RANK_COUNT; row++) {
      const high = ACE - row;
      const cells = present(
        Array.from({ length: high }, (_, k) => {
          const low = high - 1 - k;
          return cell(classId(high, low, kind));
        }),
      );
      const step = kind === 's' ? 1 : RANK_COUNT;
      terms.push(
        ...runTerms(
          cells,
          handClassName,
          (cls) => (kind === 's' ? cls % RANK_COUNT === row + 1 : Math.floor(cls / RANK_COUNT) === row + 1),
          (a, b) => b === a + step,
        ),
      );
    }
  }
  return { text: terms.join(','), warnings };
}

/** Whether every combo of the range sits in uniformly weighted, complete classes (class notation is lossless). */
export function isClassExpressible(range: WeightedRange): boolean {
  const warnings: string[] = [];
  cellWeights(range, warnings);
  return warnings.length === 0;
}

export { isPairClass, isSuitedClass };
