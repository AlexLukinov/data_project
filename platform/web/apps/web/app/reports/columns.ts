/**
 * Which stats a report can actually measure, given what it filters and groups by (plan D.5).
 *
 * `stats/router.py` picks one fact table per stat from its grain — `hand` → `player_hands`,
 * `decision` → `decisions` (its own `TABLE_FOR_GRAIN`) — and then refuses any report whose
 * columns that table does not have. It refuses **before** it validates the leaves, so the
 * message is about the pair and arrives as a 400:
 *
 *     dimension 'facing' is not available for hand-grain stat 'hands' (it is on ['decisions'])
 *
 * D.3 learned this for the *filter* and put the answer in `filter/clause.ts#tablesFor`. The
 * **group-by is the other half of the same rule** and it belongs here, because the workbench owns
 * the group-by while the filter is shared: grouping by `facing` rules out VPIP exactly as
 * filtering on it does. Verified against the running engine — `group_by: ['facing']` with
 * `stats: ['hands']` is the 400 quoted above.
 *
 * So the picker offers only the stats that fit, and drops one when the filter *or the group-by*
 * moves under it — and says which, because a column vanishing without explanation is worse than
 * the 400 it prevents.
 */

import type { Dimension, Grain, Stat } from '../stats/api';
import { MAX_GROUP_BY, MAX_STATS } from '../stats/api';
import { categoryWords, tableWords } from '../stats/vocabulary';

/** The table a stat of each grain is computed on (`stats/definitions.py#TABLE_FOR_GRAIN`). */
export const TABLE_FOR_GRAIN: Record<Grain, string> = { hand: 'player_hands', decision: 'decisions' };

/**
 * The tables left once the group-by has had its say, starting from the filter's own answer.
 *
 * `tablesFor` in `filter/clause.ts` does this for clauses; the rule is identical for a group-by
 * column, so it is applied with the same intersection rather than re-derived.
 */
export function narrowByGroupBy(
  tables: readonly string[],
  groupBy: readonly string[],
  dims: ReadonlyMap<string, Dimension>,
): string[] {
  let left = [...tables];
  for (const code of groupBy) {
    const dim = dims.get(code);
    if (dim !== undefined) left = left.filter((table) => dim.tables.includes(table as Dimension['tables'][number]));
  }
  return left;
}

/** Whether a stat's own table survives the filter and the group-by. */
export function fits(stat: Stat, tables: readonly string[]): boolean {
  return tables.includes(TABLE_FOR_GRAIN[stat.grain]);
}

/** The stats worth offering: those this situation and grouping can answer. */
export function usableStats(stats: readonly Stat[], tables: readonly string[]): Stat[] {
  return stats.filter((stat) => fits(stat, tables));
}

export interface Kept {
  /** The selected codes that still fit, in the order they were chosen. */
  codes: string[];
  /** The labels of the ones that no longer do — what the screen has to say out loud. */
  dropped: string[];
}

/**
 * The selection after the situation moved under it. Codes the registry does not know are dropped
 * silently (a stale link naming a retired stat), but a stat dropped because it *no longer fits*
 * is named, because the person picked it on purpose and is owed the reason.
 */
export function keepFitting(selected: readonly string[], stats: readonly Stat[], tables: readonly string[]): Kept {
  const byCode = new Map(stats.map((stat) => [stat.code, stat] as const));
  const codes: string[] = [];
  const dropped: string[] = [];
  for (const code of selected) {
    const stat = byCode.get(code);
    if (stat === undefined) continue;
    if (fits(stat, tables)) codes.push(code);
    else dropped.push(stat.label);
  }
  return { codes, dropped };
}

/** The dimensions a report may group by: the registry's own flag, nothing more. */
export function groupableDimensions(dims: readonly Dimension[]): Dimension[] {
  return dims.filter((dim) => dim.group_by);
}

/**
 * Why this selection cannot be sent yet, worded for the person holding it rather than as the
 * 422 they would otherwise collect. The server's ceilings are its own (`stats/request.py`).
 */
export function columnProblems(stats: readonly string[], groupBy: readonly string[]): string[] {
  const problems: string[] = [];
  if (stats.length === 0) problems.push('pick at least one stat to measure');
  if (stats.length > MAX_STATS) problems.push(`${stats.length} stats is more than the ${MAX_STATS} one report may ask for`);
  if (groupBy.length > MAX_GROUP_BY) problems.push(`${groupBy.length} group-by columns is more than the ${MAX_GROUP_BY} allowed`);
  return problems;
}

/** The stats grouped the way the registry categorises them — the order `StatPicker` renders in. */
export const CATEGORY_ORDER: readonly Stat['category'][] = ['preflop', 'postflop', 'showdown', 'money'];

export interface StatGroup {
  category: Stat['category'];
  label: string;
  stats: Stat[];
}

/** Stats by category, in reading order, with empty categories left out. */
export function groupByCategory(stats: readonly Stat[]): StatGroup[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    label: categoryWords(category),
    stats: stats.filter((stat) => stat.category === category),
  })).filter((group) => group.stats.length > 0);
}

/** What the picker knows about why it is offering nothing. */
export interface EmptyPickerFacts {
  /** Whether the registry served any stat at all — false when `/v1/definitions` never answered. */
  readonly loaded: boolean;
  /** What is typed in the search box, already trimmed. */
  readonly search: string;
  /** The fact tables the situation and the grouping leave. */
  readonly tables: readonly string[];
}

const REGISTRY_GONE = 'The stat registry did not load, so there is nothing here to choose from. Until it does, no report can name a column.';
const NO_TABLE = 'No stat can be measured on this situation: no single table holds every column it names, so there is nothing to count over. Remove a condition or a row grouping.';

/**
 * Why no stat is on offer — three different reasons that used to share one sentence.
 *
 * The one that mattered was the first: with the registry unread, `usable` is empty for a reason
 * that has nothing to do with the situation, and the picker blamed the situation anyway. A screen
 * that explains an absence with the wrong cause is worse than one that says nothing.
 */
export function noStatsWords(facts: EmptyPickerFacts): string {
  if (!facts.loaded) return REGISTRY_GONE;
  if (facts.search !== '') return `No stat matches “${facts.search}”. Clear the search box to see every stat this situation can measure.`;
  const held = tableWords(facts.tables);
  if (held === '') return NO_TABLE;
  return `No stat can be measured on this situation: it is answered on ${held}, and every stat is counted somewhere else. Remove a condition or a row grouping to bring them back.`;
}

/** How many stats this situation rules out, and where the ones left are counted. */
export function hiddenStatsWords(hidden: number, tables: readonly string[]): string {
  const held = tableWords(tables);
  const where = held === '' ? 'no single table' : held;
  return `${hidden} stat${hidden === 1 ? '' : 's'} hidden: this situation and grouping are answered on ${where}, and those are counted elsewhere.`;
}
