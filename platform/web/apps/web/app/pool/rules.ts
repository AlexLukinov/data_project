/**
 * The cohort rule builder (plan D.6b): the words a rule may use, and what to tell the person when
 * the server refuses a cohort.
 *
 * Deliberately **not** `filter/clause.ts` and its `ClauseRow`. A cohort rule is a smaller language
 * than a filter clause — a *stat* rather than a dimension, four comparisons rather than eleven ops,
 * a number and nothing else, at most ten of them — and it is refused by different code for
 * different reasons: `stats/request.py` for the shape, `stats/query.py` for the stat. Teaching the
 * 80-dimension builder this dialect would have meant hiding most of what it knows.
 *
 * Which stats may appear is the registry's to say, not this file's. A cohort is evaluated on the
 * daily rollup, so only a **cached** stat can define one, and `Stat.cached` is already on the wire;
 * a picker offers those and shows the rest as what they are. The ceilings below are copies of the
 * server's so a form can stop before earning a 422 — the server still checks every one, and when
 * it refuses, its sentence is shown, not ours.
 */

import { describeApiError } from '../auth/api';
import type { CohortOp, CohortRule, CohortSpec, Stat } from '../stats/api';

/** `MAX_COHORT_RULES` in `stats/request.py`. */
export const MAX_RULES = 10;

/** `CohortIn.name` in `api/schemas_pool.py`. */
export const NAME_MAX = 120;

/** The four comparisons a rule may make, in the words the filter bar uses for the same ops. */
export const OPS: readonly { op: CohortOp; label: string }[] = [
  { op: 'gte', label: 'is at least' },
  { op: 'gt', label: 'is above' },
  { op: 'lte', label: 'is at most' },
  { op: 'lt', label: 'is below' },
];

/** A rule as a form holds it: the value stays text until it is sent, so a half-typed number is not a rule yet. */
export interface RuleDraft {
  stat: string;
  op: CohortOp;
  value: string;
}

/** The stats a rule may name and the ones it may not, so a picker can show both and offer one. */
export function splitByCached(stats: readonly Stat[]): { cached: Stat[]; uncached: Stat[] } {
  return {
    cached: stats.filter((stat) => stat.cached === true),
    uncached: stats.filter((stat) => stat.cached !== true),
  };
}

/** A fresh row: the first cached stat, "at least", no value yet. */
export function emptyRule(cached: readonly Stat[]): RuleDraft {
  return { stat: cached[0]?.code ?? '', op: 'gte', value: '' };
}

/** A saved spec back into rows the form can edit. */
export function draftsOf(spec: CohortSpec): RuleDraft[] {
  return spec.rules.map((rule) => ({ stat: rule.stat, op: rule.op, value: String(rule.value) }));
}

/** The rows as the engine's document — a new object, never the form's own. Call once `draftProblems` is empty. */
export function toSpec(rules: readonly RuleDraft[]): CohortSpec {
  return { rules: rules.map((rule): CohortRule => ({ stat: rule.stat, op: rule.op, value: Number(rule.value) })) };
}

/**
 * Why the draft cannot be sent yet, one sentence each; empty when it can. Only the shape is checked
 * here. Whether a stat may define a cohort is the server's call, and its refusal is shown in its
 * own words by `describeCohortError`.
 */
export function draftProblems(name: string, rules: readonly RuleDraft[]): string[] {
  const problems: string[] = [];
  const trimmed = name.trim();
  if (trimmed === '') problems.push('Give the cohort a name.');
  if (trimmed.length > NAME_MAX) problems.push(`The name is longer than ${NAME_MAX} characters.`);
  if (rules.length === 0) problems.push('A cohort needs at least one rule.');
  if (rules.length > MAX_RULES) problems.push(`At most ${MAX_RULES} rules — the server refuses more.`);
  rules.forEach((rule, index) => {
    if (rule.stat === '') problems.push(`Rule ${index + 1} names no stat.`);
    if (rule.value.trim() === '' || !Number.isFinite(Number(rule.value))) problems.push(`Rule ${index + 1} needs a number.`);
  });
  return problems;
}

interface ValidationItem {
  loc?: unknown;
  msg?: unknown;
}

/** FastAPI's 422 `detail` is a list of `{loc, msg}`; each becomes "where: what", in the server's words. */
function validationMessages(error: unknown): string[] {
  if (typeof error !== 'object' || error === null) return [];
  const data = (error as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null) return [];
  const detail = (data as { detail?: unknown }).detail;
  if (!Array.isArray(detail)) return [];
  return (detail as unknown[]).map((raw) => {
    const item = (typeof raw === 'object' && raw !== null ? raw : {}) as ValidationItem;
    const where = Array.isArray(item.loc) ? item.loc.filter((part) => part !== 'body').join('.') : '';
    const what = typeof item.msg === 'string' ? item.msg : 'invalid';
    return where === '' ? what : `${where}: ${what}`;
  });
}

/**
 * One sentence for a refused save, in the server's words wherever it has any: a duplicate name is
 * its 409 ("a cohort named 'regs' already exists"), a rule on an uncached stat is its 400 at
 * create, and an eleventh rule is its 422 — whose detail is a list, which `describeApiError` alone
 * cannot read and would have reported as a bare status.
 */
export function describeCohortError(error: unknown): string {
  const messages = validationMessages(error);
  return messages.length > 0 ? messages.join(' · ') : describeApiError(error);
}
