/**
 * A situation in a URL, and back (ADR-053). A `NodeKey` is eight fields and an action sequence,
 * so no pair of readable parameters can name one: `hero` and `street` alone would open a page on
 * a different situation from the one the link came from. It travels whole instead, as its
 * canonical key in one parameter —
 *
 *     /ranges/compare?node={"stake":"NL10","table_size":6,…}
 *
 * — the same string that already decides whether two keys are the same situation, so a link and
 * the library can never disagree about which situation it names.
 *
 * Reading is strict where `filter/url.ts` is lenient: a clause dropped from a filter leaves a
 * wider filter, but a situation read halfway is a different situation. An unreadable key opens
 * the page on its default and says so, in a sentence the page shows.
 */
import type { NodeKey } from '@poker/core';
import { canonicalNodeKey, parseNodeKey } from '@poker/core';

import { describeApiError } from '../auth/api';

export const SITUATION_PARAM = 'node';
/** The older link into the compare page: a stored range, whose situation the page adopts. */
export const RANGE_PARAM = 'range';

/** What a link says about the situation: a key, a sentence on why it could not be read, or neither. */
export interface LinkedSituation {
  key: NodeKey | null;
  problem: string | null;
}

const NOTHING: LinkedSituation = { key: null, problem: null };

/** The query that names this situation. */
export function situationQuery(key: NodeKey): Record<string, string> {
  return { [SITUATION_PARAM]: canonicalNodeKey(key) };
}

function unreadable(reason: string): LinkedSituation {
  return { key: null, problem: `This link's situation could not be read (${reason}), so the page opened on its default situation.` };
}

/** The situation `?node=` names. Absent is no key and no problem; anything unreadable is a problem, never a throw. */
export function situationFromQuery(query: Record<string, unknown>): LinkedSituation {
  const value = query[SITUATION_PARAM];
  if (value === undefined) return NOTHING;
  if (typeof value !== 'string') return unreadable('the node parameter must carry exactly one value');
  let json: unknown;
  try {
    json = JSON.parse(value);
  } catch {
    return unreadable('the node parameter is not JSON');
  }
  try {
    return { key: parseNodeKey(json, SITUATION_PARAM), problem: null };
  } catch (error) {
    return unreadable(error instanceof Error ? error.message : String(error));
  }
}

/**
 * The situation a link into the compare page opens on: `?node=` when it is there (even when it
 * cannot be read — a link that named a situation is not quietly swapped for another one), else
 * the situation of the stored range `?range=` names. A range that cannot be opened is a problem
 * sentence carrying the API's reason, not a silent default.
 */
export async function openLinkedSituation(query: Record<string, unknown>, open: (id: string) => Promise<{ node_key: NodeKey }>): Promise<LinkedSituation> {
  if (query[SITUATION_PARAM] !== undefined) return situationFromQuery(query);
  const id = query[RANGE_PARAM];
  if (typeof id !== 'string') return NOTHING;
  try {
    return { key: (await open(id)).node_key, problem: null };
  } catch (error) {
    return { key: null, problem: `The linked range could not be opened, so the page opened on its default situation. ${describeApiError(error)}` };
  }
}
