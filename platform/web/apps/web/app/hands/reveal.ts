/**
 * Your read first, then the pool's (plan H.7, the reveal half; ADR-093).
 *
 * At a node the reader paints the range they believe the acting seat has, and only then asks the
 * pool what it actually turned over there — per group of players, one group after another, as a
 * diff against the read. The order is the decision spec §15 already made for the analyzer (guess,
 * then reveal); this module holds the parts of it that are not a screen: which groups to ask, in
 * what order, the sequencing itself, and the sentences.
 *
 * **Tier 2, deliberately** (ADR-035 read the other way round). A showdown range is what the field
 * *showed* — biased towards hands that reach a showdown, and it says so through `covers` — but it
 * is independent of the read. Tier 3 is not: it reweights the prior it is handed and keeps every
 * class the prior omitted at zero, so a wrong read reconstructed is a wrong read, and its
 * implied-versus-observed check grades a *pre-action* prior, which a read of the range at a
 * decision is not. A reveal that depends on the guess is not a reveal.
 *
 * **What the node's range is.** The pool's filter is everything in front of the acting seat and
 * never the seat's own last step (`node_filter.py`), so the range is the hands that seat *arrives
 * at this decision with*, whatever it then does — which is why the question below is worded as
 * "before they bet", never "after".
 */

import type { NodeKey, WeightedRange } from '@poker/core';
import { canonicalNodeKey } from '@poker/core';

import type { CohortKey, NodeShowdownRange, PoolApi } from '../pool/api';
import { WHOLE_FIELD_KEY, groupKey } from '../pool/api';
import { poolRange } from '../pool/range';
import type { PoolCohort, PoolStatsApi } from '../pool/stats';
import type { PoolGroup } from '../reports/api';
import { revealProblem } from './study';

/** One group of players the pool can be asked about. */
export interface RevealGroup {
  /** `''` for the field, `group:<key>` for a behaviour group, a saved cohort's id — what `PoolApi` sends as it stands. */
  readonly key: CohortKey;
  readonly label: string;
}

export const WHOLE_FIELD: RevealGroup = { key: WHOLE_FIELD_KEY, label: 'the whole field' };

/** The group that is the field under another name (ADR-080's `all`): listed once, as the field. */
const EVERYONE = 'all';

/**
 * The groups on offer: the field, then the pool's behaviour groups (ADR-080's five keys, from
 * `GET /v1/pool/presets`, addressed as `group:<key>` without saving anything), then the reader's
 * saved cohorts (`GET /v1/pool/cohorts`). The labels are the server's; nothing here decides what
 * a group means.
 */
export function revealGroups(groups: readonly PoolGroup[], cohorts: readonly PoolCohort[]): RevealGroup[] {
  const behaviour = groups.filter((group) => group.key !== EVERYONE).map((group) => ({ key: groupKey(group.key), label: group.label }));
  const saved = cohorts.map((cohort) => ({ key: cohort.id, label: cohort.name }));
  return [WHOLE_FIELD, ...behaviour, ...saved];
}

const GROUPS_UNLISTED = 'The pool’s player groups could not be listed, so they cannot be chosen here.';
const COHORTS_UNLISTED = 'Your saved cohorts could not be listed, so they cannot be chosen here. They are kept under Pool → Cohorts.';

/**
 * Both lists, each failing on its own: a pool whose presets cannot be read still offers the
 * reader's cohorts, and the other way round, and the field is always on offer. `problem` says
 * which list is missing, or is `''`.
 */
export async function loadRevealGroups(api: Pick<PoolStatsApi, 'presets' | 'cohorts'>): Promise<{ groups: RevealGroup[]; problem: string }> {
  const [presets, cohorts] = await Promise.allSettled([api.presets(), api.cohorts()]);
  const problems = [presets.status === 'rejected' ? GROUPS_UNLISTED : '', cohorts.status === 'rejected' ? COHORTS_UNLISTED : ''].filter((text) => text !== '');
  return {
    groups: revealGroups(presets.status === 'fulfilled' ? (presets.value.groups ?? []) : [], cohorts.status === 'fulfilled' ? cohorts.value : []),
    problem: problems.join(' '),
  };
}

/**
 * The groups one reveal asks, in the order it asks them: the field first, so there is always a
 * baseline, then the chosen cohort if one was chosen. Never more than two, because each group is
 * two ClickHouse queries against a ceiling of four per account (ADR-079).
 */
export function groupsToAsk(groups: readonly RevealGroup[], chosen: string): RevealGroup[] {
  const picked = groups.find((group) => group.key === chosen && group.key !== WHOLE_FIELD.key);
  return picked === undefined ? [WHOLE_FIELD] : [WHOLE_FIELD, picked];
}

/** What one group answered, or why it did not. */
export interface GroupReveal {
  readonly group: RevealGroup;
  readonly answer: NodeShowdownRange | null;
  /** The pool's range as a matrix draws it; null while the answer is thin or missing. */
  readonly range: WeightedRange | null;
  /** A failed ask, as a sentence; `''` when the group answered. */
  readonly problem: string;
}

/** The marker a reveal is checked against: the situation and the group chosen for it. */
export function revealId(key: NodeKey, chosen: string): string {
  return `${canonicalNodeKey(key)}|${chosen}`;
}

async function askOne(api: Pick<PoolApi, 'showdownRange'>, key: NodeKey, group: RevealGroup): Promise<GroupReveal> {
  try {
    const answer = await api.showdownRange(key, group.key);
    const range = answer.enough ? poolRange(answer.classes, `the pool · ${group.label}`) : null;
    return { group, answer, range, problem: '' };
  } catch (error) {
    return { group, answer: null, range: null, problem: revealProblem(group.label, error) };
  }
}

/**
 * Ask the groups **one after another**, never at once: until the cube exists (ADR-079) each group
 * is a pool-wide query of about 1.6 s, and firing them together is how a reader meets the
 * per-account ceiling. `stale()` is read before every ask and after every answer, so a reveal for
 * a situation the reader has since stepped away from stops asking and hands nothing back.
 */
export async function askGroups(
  api: Pick<PoolApi, 'showdownRange'>,
  key: NodeKey,
  groups: readonly RevealGroup[],
  stale: () => boolean,
  onGroup: (found: GroupReveal) => void,
  onAsking: (group: RevealGroup) => void = () => undefined,
): Promise<void> {
  for (const group of groups) {
    if (stale()) return;
    onAsking(group);
    const found = await askOne(api, key, group);
    if (stale()) return;
    onGroup(found);
  }
}

/** Whether anything has been painted: the reveal is offered only once there is a read to reveal against. */
export function hasWeight(range: WeightedRange): boolean {
  return range.weights.some((weight) => weight > 0);
}

const VERB: Record<string, string> = {
  fold: 'fold',
  check: 'check',
  call: 'call',
  limp: 'limp in',
  bet: 'bet',
  raise: 'raise',
  allin: 'move all in',
};

/**
 * The question the read answers. It names the seat and what it then did, and says "before",
 * because the pool's range at a node is the hands the seat arrives with (see the module note).
 */
export function revealQuestion(key: NodeKey): string {
  const last = key.action_sequence.at(-1);
  const then = last === undefined ? '' : ` — before they ${VERB[last.action] ?? last.action}`;
  return `What is ${key.hero_position} holding when the action reaches them here${then}? Paint the range you believe they arrive with.`;
}

/** The withheld state, with the numbers that make it a fact rather than a shrug. */
export function revealThin(answer: NodeShowdownRange, label: string): string {
  const shown = answer.sample_size.toLocaleString('en-US');
  const decisions = answer.decisions_at_node.toLocaleString('en-US');
  const needed = answer.min_n.toLocaleString('en-US');
  return `Too few hands were shown down here to draw a range for ${label}: ${shown} of the ${decisions} decisions at this spot were turned over, and ${needed} are needed.`;
}

/** The ranges the diff view compares: the read is the reference, every answered group beside it. */
export function diffRanges(read: WeightedRange, groups: readonly GroupReveal[]): { label: string; range: WeightedRange }[] {
  const answered = groups.filter((found): found is GroupReveal & { range: WeightedRange } => found.range !== null);
  return [{ label: 'your read', range: read }, ...answered.map((found) => ({ label: found.range.label ?? found.group.label, range: found.range }))];
}
