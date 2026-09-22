/**
 * What a report grid says before it has run, and when it ran and counted nothing (audit §2.4).
 *
 * Those are the two moments somebody meets a report before they have ever seen a number from it,
 * and both used to say almost nothing: no grid at all, or "No rows." So the words live here
 * rather than in a template, for the reason `hands/searchable.ts` gives — a sentence nailed into
 * a template is a sentence no test reads, and each of these has to stay true of this app.
 *
 * Every function takes plain facts the page already holds: the dataset, the situation sentence,
 * the date bounds, whether a stat is chosen, which cohort is being measured. An action is a key
 * and a label, never a handler. One with a `to` is a link the component renders itself; every
 * other one comes back to the page as `act(key)`, because only the page can clear its own filter
 * or run its own report. `~/components/reports/EmptyState.vue` renders all of this and owns none
 * of the words.
 */

import type { Dataset } from '../stats/api';

/** One way out of an empty state: a link when `to` is set, otherwise a button the page handles. */
export interface EmptyAction {
  readonly key: string;
  readonly label: string;
  readonly to?: string;
}

/** What an empty area says: what it is for, what to do about it, and the ways out. */
export interface EmptyStateView {
  readonly lead: string;
  readonly body: string;
  readonly actions: readonly EmptyAction[];
}

/**
 * Every action any empty state offers, so two screens cannot label the same way out differently.
 * The key is what a page handles; `other-dataset` is one key under two labels, because which
 * dataset is the other one depends on where you are standing.
 */
export const EMPTY_ACTIONS = {
  upload: { key: 'upload', label: 'Upload hand histories', to: '/upload' },
  paste: { key: 'paste', label: 'Paste a hand', to: '/hands/paste' },
  /**
   * The one way out that needs neither an account nor a hand (ADR-050, ADR-073). It names a
   * particular spot rather than the index, because `/examples` is already a permanent nav item
   * and an empty state repeating it would be offering the chrome. `top-pair-dry-board` is the
   * example the `hands` and `analyses` tools already declare, so the two agree.
   */
  example: { key: 'example', label: 'Try an example', to: '/examples/top-pair-dry-board' },
  clearSituation: { key: 'clear-situation', label: 'Clear the situation' },
  clearDates: { key: 'clear-dates', label: 'Clear the dates' },
  clearTag: { key: 'clear-tag', label: 'Any tag' },
  lookInPool: { key: 'other-dataset', label: 'Look in the pool' },
  lookInMine: { key: 'other-dataset', label: 'Look in My hands' },
  wholeField: { key: 'whole-field', label: 'Measure the whole field' },
  run: { key: 'run', label: 'Run report' },
  runAgain: { key: 'run', label: 'Run again' },
} as const satisfies Record<string, EmptyAction>;

/** What is narrowing a body of hands: the situation sentence, the dates, and on `/hands` a tag. */
export interface Narrowing {
  /** `filter.sentence` — "every hand" when no condition is set, which narrows nothing. */
  readonly sentence: string;
  readonly hasClauses: boolean;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly tag?: string;
}

/**
 * Why a cohort can lag the numbers printed beside it: membership is counted from the daily
 * statistics only (ADR-051), so an upload moves a pool report before it moves the cohort.
 */
export const COHORT_REBUILD_NOTE =
  'Who is in a cohort is recounted when the daily statistics are next rebuilt, so a hand uploaded today can move these numbers before it changes who the cohort holds.';

const GRID_LEAD = 'A report is a grid: one row per group, one column per stat, and the sample each cell counted under it.';
const POOL_LEAD = 'This grid is what the field does: one row per group, one column per stat, and the sample each cell counted under it.';
const NOT_RUN = 'Nothing has run yet: a report reads every hand it covers, so it waits until you ask for it.';
const CHOOSE_A_STAT = 'Nothing has run yet. The stats you pick above become the columns, so choose at least one, then press Run report.';
const PICK_A_COHORT = 'Every report here reads the pool; to count one slice of the players instead of all of them, pick a cohort above.';
const HERO_UPLOAD =
  'Upload the hand histories your poker site exports and they are counted here seconds after they land. If you have uploaded already, the Upload page says when a file had no seat recognised as yours — those hands are stored, but nothing counts them as your play.';
const POOL_UPLOAD =
  'Pool hands are the tables you observed rather than played. Upload their hand histories on the Upload page and mark them Pool hands.';
const WIDEN = 'Each condition narrows what is counted, and enough of them leave nothing.';
const STORED_SITUATION = 'the situation this report has stored';
const CANNOT_WIDEN = 'That situation uses a condition the filter bar cannot show, so it cannot be widened here.';
const BLOCKED_FIRST = 'It cannot run as it stands: put right what the warning above says, then press Run report.';
const BLOCKED_AGAIN = 'It cannot be run again as it stands: put right what the warning above says first.';
/** What scopes a pool report that carries a cohort of its own while the picker names none. */
const STORED_SCOPE = 'the players this report scopes to';
const STORED_RULE_NOTE = 'This report carries a rule of its own, so choosing a cohort under “Which players” replaces it.';
const AGAINST_RESET = 'This is the second grid: set “against” back to “nothing — one grid” under “Which players” to read the pool without it.';
const WHOLE_FIELD_NOTE = 'Measure the whole field to see what the pool holds at all.';

/** The narrowings as one phrase a reader recognises, or `''` when nothing is narrowing anything. */
export function narrowingWords(narrowing: Narrowing): string {
  const parts: string[] = [];
  if (narrowing.hasClauses) parts.push(narrowing.sentence);
  if (narrowing.tag !== undefined && narrowing.tag !== '') parts.push(`tagged “${narrowing.tag}”`);
  const dates = dateWords(narrowing.dateFrom, narrowing.dateTo);
  if (dates !== '') parts.push(dates);
  return list(parts);
}

function dateWords(from: string, to: string): string {
  if (from !== '' && to !== '') return `played between ${from} and ${to}`;
  if (from !== '') return `played on ${from} or later`;
  if (to !== '') return `played on ${to} or earlier`;
  return '';
}

/** `a`, `a and b`, `a, b and c` — the same form `hands/searchable.ts` uses. */
function list(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/**
 * The ways out that actually widen this question. A stored situation is sent exactly as it was
 * saved, so clearing the builder would change nothing and is not offered; the dates are the
 * page's own either way.
 */
export function widenActions(narrowing: Narrowing): EmptyAction[] {
  const actions: EmptyAction[] = [];
  if (narrowing.hasClauses) actions.push(EMPTY_ACTIONS.clearSituation);
  if (narrowing.dateFrom !== '' || narrowing.dateTo !== '') actions.push(EMPTY_ACTIONS.clearDates);
  if (narrowing.tag !== undefined && narrowing.tag !== '') actions.push(EMPTY_ACTIONS.clearTag);
  return actions;
}

/** What a workbench knows before it has run anything. */
export interface IdleFacts {
  /** The report on screen, if one was opened; its name is what pressing Run would run. */
  readonly reportName: string | null;
  readonly hasStat: boolean;
  /** False while the page refuses to run: an incomplete condition, or a cohort it cannot resolve. */
  readonly canRun: boolean;
}

/** `/reports`, before Run report has been pressed for the first time. */
export function reportIdleView(facts: IdleFacts): EmptyStateView {
  if (!facts.hasStat) return { lead: GRID_LEAD, body: CHOOSE_A_STAT, actions: [] };
  return {
    lead: GRID_LEAD,
    body: `${subject(facts.reportName)} is set up. ${facts.canRun ? NOT_RUN : BLOCKED_FIRST}`,
    actions: runActions(facts, EMPTY_ACTIONS.run),
  };
}

function subject(name: string | null): string {
  return name === null ? 'The report above' : `“${name}”`;
}

/**
 * Run, offered only when pressing it would do something. Both workbenches' `run()` returns early
 * while a condition above is incomplete, and their own Run report is visibly disabled for it, so
 * an empty state offering the same run would be a live button that answers a click with nothing.
 */
function runActions(facts: { readonly canRun: boolean }, action: EmptyAction): EmptyAction[] {
  return facts.canRun ? [action] : [];
}

/** The body with the reason a run is refused appended, where one is. */
function blocked(facts: { readonly canRun: boolean }, body: string): string {
  return facts.canRun ? body : `${body} ${BLOCKED_AGAIN}`;
}

/** The same, for `/pool`, where the dataset is locked and the cohort is what there is to change. */
export interface PoolIdleFacts extends IdleFacts {
  /** The cohort the picker chose, or `null` — which is not by itself the whole field. */
  readonly cohortLabel: string | null;
  /** The open report carries a cohort of its own, which scopes it while the picker names none. */
  readonly storedRule: boolean;
}

/**
 * `/pool` before Run report has been pressed; the cohort is what there is to change.
 *
 * "the whole field" holds only when nothing scopes the report at all. Two of the shipped pool
 * reports carry a cohort of their own, and saying it anyway contradicted the note beside the
 * picker on the same screen — the lie `pool/words.ts#gridHeading` was written to remove.
 */
export function poolIdleView(facts: PoolIdleFacts): EmptyStateView {
  if (!facts.hasStat) return { lead: POOL_LEAD, body: CHOOSE_A_STAT, actions: [] };
  const scope = facts.cohortLabel !== null || facts.storedRule ? COHORT_REBUILD_NOTE : PICK_A_COHORT;
  return {
    lead: POOL_LEAD,
    body: `${subject(facts.reportName)} is set up over ${measuredWords(facts)}. ${facts.canRun ? NOT_RUN : BLOCKED_FIRST} ${scope}`,
    actions: runActions(facts, EMPTY_ACTIONS.run),
  };
}

function measuredWords(facts: PoolIdleFacts): string {
  if (facts.cohortLabel !== null) return `“${facts.cohortLabel}”`;
  return facts.storedRule ? STORED_SCOPE : 'the whole field';
}

/** What the workbench knows about a report that ran and came back with no rows. */
export interface ReportEmptyFacts extends Narrowing {
  readonly dataset: Dataset;
  /** The situation came from a stored report and is not editable here (`columns.editable`). */
  readonly rawFilter: boolean;
  /** False while the page refuses to run, so Run again is not offered as a way out of this. */
  readonly canRun: boolean;
}

/** A report on `/reports` with no rows: nothing is stored, or the situation is too narrow. */
export function reportEmptyView(facts: ReportEmptyFacts): EmptyStateView {
  const hero = facts.dataset === 'hero';
  const words = facts.rawFilter ? STORED_SITUATION : narrowingWords(facts);
  if (words === '') return nothingStored(hero);
  const elsewhere = hero ? EMPTY_ACTIONS.lookInPool : EMPTY_ACTIONS.lookInMine;
  const tail = facts.rawFilter
    ? `${CANNOT_WIDEN} Open another report above to ask something wider.`
    : `${WIDEN} Drop one and run the report again, or ask the same question of ${hero ? 'the pool' : 'your own hands'}.`;
  return {
    lead: hero ? `None of your hands match ${words}.` : `No hand in the pool matches ${words}.`,
    body: blocked(facts, tail),
    actions: [...widenActions(editable(facts)), elsewhere, ...runActions(facts, EMPTY_ACTIONS.runAgain)],
  };
}

/** A stored situation cannot be cleared from the bar that cannot show it; the dates still can. */
function editable<T extends Narrowing & { rawFilter: boolean }>(facts: T): Narrowing {
  return facts.rawFilter ? { ...facts, hasClauses: false } : facts;
}

function nothingStored(hero: boolean): EmptyStateView {
  if (hero) {
    return { lead: 'This report read every hand you have and counted none.', body: HERO_UPLOAD, actions: [EMPTY_ACTIONS.upload] };
  }
  return {
    lead: 'This report read every hand in the pool and counted none.',
    body: POOL_UPLOAD,
    actions: [EMPTY_ACTIONS.upload, EMPTY_ACTIONS.lookInMine],
  };
}

/** What `/pool` knows about a grid with no rows. Its dataset is locked; its cohort is not. */
export interface PoolEmptyFacts extends Narrowing {
  readonly rawFilter: boolean;
  readonly cohortLabel: string | null;
  /** The open report carries a cohort of its own, so this grid is not the whole field either. */
  readonly storedRule: boolean;
  readonly canRun: boolean;
  /** Which of the two grids this is. Only the left one can be widened to the whole field. */
  readonly side: 'left' | 'right';
}

/**
 * A pool grid with no rows, worded for whatever scoped *that* grid.
 *
 * Three different answers share one blank grid: the pool holds nothing, the situation is too
 * narrow, or the players asked about have no hand in it. The third is the one a reader cannot see,
 * and it is also true when the report's own rule is what scopes it and the picker named nobody.
 */
export function poolEmptyView(facts: PoolEmptyFacts): EmptyStateView {
  const words = facts.rawFilter ? STORED_SITUATION : narrowingWords(facts);
  if (words === '') return poolNothingStored(facts);
  const tail = facts.rawFilter ? `${CANNOT_WIDEN} Pick another report above to ask something wider.` : `${WIDEN} Drop one and run the report again.`;
  const scoped = facts.cohortLabel !== null || facts.storedRule;
  return {
    lead: `No hand ${whose(facts)} matches ${words}.`,
    body: blocked(facts, scoped ? `${tail} ${COHORT_REBUILD_NOTE}` : tail),
    actions: [...widenActions(editable(facts)), ...wholeField(facts), ...runActions(facts, EMPTY_ACTIONS.runAgain)],
  };
}

function whose(facts: PoolEmptyFacts): string {
  if (facts.cohortLabel !== null) return `from the players in “${facts.cohortLabel}”`;
  return facts.storedRule ? `from ${STORED_SCOPE}` : 'in the pool';
}

/**
 * Measuring the whole field is the left grid's way out alone: it clears the cohort the left grid
 * asked about, and the picker's "against" has no whole field to offer — its only nothing is one
 * grid rather than two. Under the right grid the same button silently changed the left one.
 */
function wholeField(facts: PoolEmptyFacts): EmptyAction[] {
  return facts.cohortLabel !== null && facts.side === 'left' ? [EMPTY_ACTIONS.wholeField] : [];
}

function poolNothingStored(facts: PoolEmptyFacts): EmptyStateView {
  if (facts.cohortLabel === null && !facts.storedRule) {
    return { lead: 'This report read every hand in the pool and counted none.', body: POOL_UPLOAD, actions: [EMPTY_ACTIONS.upload] };
  }
  const who = facts.cohortLabel === null ? 'this report scopes to' : `in “${facts.cohortLabel}”`;
  return {
    lead: `No player ${who} has a hand here to count.`,
    body: `${COHORT_REBUILD_NOTE} ${widerWords(facts)}`,
    actions: [...wholeField(facts), EMPTY_ACTIONS.upload],
  };
}

/** How this particular grid is widened — which is not the same thing on both sides. */
function widerWords(facts: PoolEmptyFacts): string {
  if (facts.cohortLabel === null) return STORED_RULE_NOTE;
  return facts.side === 'right' ? AGAINST_RESET : WHOLE_FIELD_NOTE;
}
