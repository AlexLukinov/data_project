/**
 * The grouped combo distribution (spec §7): a tree of groups along one or more axes, every
 * node carrying its raw combo count, weighted combo count and share of the range; comparison
 * of two trees (hero vs villain, or before vs after a board change); CSV and text export.
 */

import type { Card, ComboIndex } from '../cards';
import { COMBO_COUNT, comboToString } from '../cards';
import { classifyCombos } from '../classify';
import type { WeightedRange } from '../range';
import { removeCards } from '../range';
import type { Axis, AxisContext, Thresholds } from './axes';
import { DEFAULT_THRESHOLDS, keyOrder, keysFor, labelFor, requirementsOf } from './axes';

const FLOP = 3;

export interface DistributionGroup {
  readonly axis: Axis;
  readonly key: string;
  readonly label: string;
  readonly combos: number;
  readonly weight: number;
  /** `weight / total weight of the range`. */
  readonly share: number;
  readonly comboList: readonly ComboIndex[];
  readonly children: readonly DistributionGroup[];
}

export interface Distribution {
  readonly axes: readonly Axis[];
  readonly combos: number;
  readonly weight: number;
  readonly thresholds: Thresholds;
  readonly groups: readonly DistributionGroup[];
}

export interface DistributionOptions {
  /** Per-combo equities from the engine; needed by the strategic, equity and nut axes. */
  readonly equities?: Float32Array;
  readonly thresholds?: Partial<Thresholds>;
}

function checkInputs(axes: readonly Axis[], board: readonly Card[], options: DistributionOptions, thresholds: Thresholds): void {
  for (const axis of axes) {
    const needs = requirementsOf(axis);
    if (needs.board && board.length < FLOP) throw new RangeError(`the ${axis} axis needs a board of at least three cards`);
    if (needs.equities && options.equities === undefined) throw new RangeError(`the ${axis} axis needs per-combo equities`);
    if (needs.nut && thresholds.nut === undefined) throw new RangeError('the nut axis needs a nut threshold (see nutThreshold())');
  }
  if (new Set(axes).size !== axes.length) throw new RangeError('an axis may appear once');
}

function build(range: WeightedRange, combos: readonly ComboIndex[], axes: readonly Axis[], depth: number, ctx: AxisContext, total: number): DistributionGroup[] {
  if (depth >= axes.length) return [];
  const axis = axes[depth]!;
  const buckets = new Map<string, ComboIndex[]>();
  for (const combo of combos) for (const key of keysFor(axis, combo, ctx)) (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(combo);
  const groups: DistributionGroup[] = [];
  for (const key of keyOrder(axis, ctx)) {
    const members = buckets.get(key);
    if (members === undefined) continue;
    let weight = 0;
    for (const combo of members) weight += range.weights[combo]!;
    groups.push({ axis, key, label: labelFor(axis, key, ctx), combos: members.length, weight, share: total === 0 ? 0 : weight / total, comboList: members, children: build(range, members, axes, depth + 1, ctx, total) });
  }
  return groups;
}

/** Group a range on a board along `axes`, outermost first. The board is removed from the range first. */
export function distribute(range: WeightedRange, board: readonly Card[], axes: readonly Axis[], options: DistributionOptions = {}): Distribution {
  const thresholds: Thresholds = { ...DEFAULT_THRESHOLDS, ...options.thresholds };
  checkInputs(axes, board, options, thresholds);
  const live = removeCards(range, board);
  const classes = board.length >= FLOP ? classifyCombos(live, board) : new Array<undefined>(COMBO_COUNT).fill(undefined);
  const combos: ComboIndex[] = [];
  let weight = 0;
  for (let combo = 0; combo < COMBO_COUNT; combo++) {
    if (live.weights[combo]! <= 0) continue;
    combos.push(combo);
    weight += live.weights[combo]!;
  }
  const ctx: AxisContext = options.equities === undefined ? { classes, thresholds } : { classes, equities: options.equities, thresholds };
  return { axes, combos: combos.length, weight, thresholds, groups: build(live, combos, axes, 0, ctx, weight) };
}

export interface GroupComparison {
  readonly axis: Axis;
  readonly key: string;
  readonly label: string;
  readonly a: DistributionGroup | null;
  readonly b: DistributionGroup | null;
  /** `share(b) − share(a)`; a missing side counts as 0. */
  readonly deltaShare: number;
  readonly deltaWeight: number;
  readonly children: readonly GroupComparison[];
}

function compareLists(a: readonly DistributionGroup[], b: readonly DistributionGroup[]): GroupComparison[] {
  const keys = [...new Set([...a.map((g) => g.key), ...b.map((g) => g.key)])];
  return keys.map((key) => {
    const ga = a.find((g) => g.key === key) ?? null;
    const gb = b.find((g) => g.key === key) ?? null;
    const any = (ga ?? gb)!;
    return { axis: any.axis, key, label: any.label, a: ga, b: gb, deltaShare: (gb?.share ?? 0) - (ga?.share ?? 0), deltaWeight: (gb?.weight ?? 0) - (ga?.weight ?? 0), children: compareLists(ga?.children ?? [], gb?.children ?? []) };
  });
}

/** Side by side: hero vs villain, or before vs after a board change. Both must use the same axes. */
export function compareDistributions(a: Distribution, b: Distribution): GroupComparison[] {
  if (a.axes.join() !== b.axes.join()) throw new RangeError('distributions to compare must use the same axes');
  return compareLists(a.groups, b.groups);
}

function walk(groups: readonly DistributionGroup[], depth: number, visit: (g: DistributionGroup, depth: number) => void): void {
  for (const g of groups) {
    visit(g, depth);
    walk(g.children, depth + 1, visit);
  }
}

function csvCell(text: string): string {
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV with one row per group at every level: axis, level, label, combos, weighted combos, share. */
export function toCsv(distribution: Distribution): string {
  const lines = ['axis,level,group,combos,weighted_combos,share'];
  walk(distribution.groups, 0, (g, depth) => lines.push([g.axis, String(depth), csvCell(g.label), String(g.combos), g.weight.toFixed(3), (100 * g.share).toFixed(2)].join(',')));
  return lines.join('\n');
}

/** Indented plain text for copy-as-text; combos listed under leaf groups when `withCombos`. */
export function toText(distribution: Distribution, withCombos = false): string {
  const lines = [`${distribution.combos} combos, ${distribution.weight.toFixed(2)} weighted`];
  walk(distribution.groups, 0, (g, depth) => {
    lines.push(`${'  '.repeat(depth)}${g.label}: ${g.combos} combos, ${g.weight.toFixed(2)} weighted, ${(100 * g.share).toFixed(1)}%`);
    if (withCombos && g.children.length === 0) lines.push(`${'  '.repeat(depth + 1)}${g.comboList.map(comboToString).join(' ')}`);
  });
  return lines.join('\n');
}
