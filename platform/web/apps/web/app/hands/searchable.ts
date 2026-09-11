/**
 * Whether the shared filter can be asked of the hand list at all (plan D.7).
 *
 * D.3 bound every one of the registry's 80 dimensions to this list, and 13 of them cannot answer
 * it. `stats/hands.py` compiles a hand search against `marts.decisions` **alone** — the mart with
 * a row per decision, which is the only table that can say *which seat* a hand matched on — so a
 * clause on a dimension that lives only on `marts.player_hands` (`did_vpip`, `saw_flop`, `won_hand`…)
 * comes back as a 400 from the compiler rather than as a list.
 *
 * The router's own message is `dimension 'saw_flop' is not available …`, which is true and useless
 * to somebody who just clicked a chip. So the page asks here first and says which chip is the
 * problem, in the chip's own words. Nothing is guessed: a dimension's `tables` is registry data
 * served by `/v1/definitions`, so a dimension added to `decisions` tomorrow becomes searchable
 * here with no change to this file.
 */

import type { Dimension } from '../stats/api';
import type { Clause } from '../filter/clause';

/** The one fact table a hand search reads (`stats/hands.py`'s `DECISIONS`). */
export const HAND_SEARCH_TABLE = 'decisions';

/**
 * The labels of the clauses this list cannot search on, in the order they were added. A clause
 * on a dimension the registry has not answered for yet is not reported: it is incomplete, and
 * `clausesToNode` already drops it before anything is sent.
 */
export function unsearchableLabels(clauses: readonly Clause[], dims: ReadonlyMap<string, Dimension>): string[] {
  const labels: string[] = [];
  for (const clause of clauses) {
    const dim = dims.get(clause.dim);
    if (dim !== undefined && !dim.tables.includes(HAND_SEARCH_TABLE)) labels.push(dim.label);
  }
  return labels;
}

/**
 * Why the list cannot answer this situation, or `null` when it can. Worded as the sentence the
 * page shows, so the wording is tested rather than buried in a template.
 */
export function unsearchableReason(clauses: readonly Clause[], dims: ReadonlyMap<string, Dimension>): string | null {
  const labels = unsearchableLabels(clauses, dims);
  if (labels.length === 0) return null;
  const one = labels.length === 1;
  return `${list(labels)} ${one ? 'is counted per hand' : 'are counted per hand'}, not per decision, so ${one ? 'it' : 'they'} cannot pick out hands — a hand list has to name the seat that matched. Remove ${one ? 'that' : 'those'} condition${one ? '' : 's'} to see the hands.`;
}

/** `a`, `a and b`, `a, b and c` — the Oxford-free form the rest of the UI uses. */
function list(labels: readonly string[]): string {
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}
