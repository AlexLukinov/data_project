/**
 * The population area on the wire: reports over the field, its cohorts, and its players
 * (plan D.6; `api/routers/pool.py`).
 *
 * Deliberately separate from `pool/api.ts`, which is phase F's **node** surface — tiers 1-3 at one
 * `NodeKey`. These are the **aggregate** routes, and the two answer different questions: a node
 * asks "what does the field do *here*", a report asks "what does the field do, sliced this way".
 *
 * Three things about these endpoints that the types cannot say, and that a screen gets wrong once
 * each if they are not written down:
 *
 *  1. **The dataset lock is the server's, not ours.** `analysis/pool/service.py` refuses any body
 *     whose `dataset` is not `population`, and `stats/request.py` refuses `population` together
 *     with `hero_only`. `poolRequest()` is the one place that pairing is made, so a screen cannot
 *     forget half of it and earn a 422 nobody can read.
 *  2. **`cohort_id` is a query parameter and it *wins*.** The service does
 *     `request.model_copy(update={'cohort': cohort})`, silently discarding whatever `cohort` the
 *     body carried. Send the saved cohort's id **or** an inline spec, never both — `run()` takes
 *     them as one argument so that is not expressible.
 *  3. **`POST /v1/pool/players` is the purpose-built route and it now works** (ADR-062). It could
 *     not answer a typed name until then, which is why the search here still goes through the
 *     ordinary report path; moving it over is plan step F.14. See `searchPlayers`.
 *  4. **A refused write is the server's sentence, not ours** (plan D.6b). A duplicate name is a 409
 *     whose detail names the cohort (`uq_cohorts_user_name`); a rule on an uncached stat is a 400 at
 *     *create* (`stats/query.py`), never at query time; an eleventh rule is a 422. Nothing here
 *     rewrites any of them — `pool/rules.ts#describeCohortError` shows each in the server's words.
 */

import type { Fetcher } from '../auth/api';
import type { CohortPreset, PoolPresets } from '../reports/api';
import type { CohortSpec, ReportRequest, ReportResult, Stat } from '../stats/api';
import { OPS } from './rules';

/** How many matching players a search shows. */
export const PLAYER_LIMIT = 200;

/** The headline stats a player is read by — all hand-grain, because the report is `stats_daily`. */
export const PLAYER_STATS: readonly string[] = ['hands', 'vpip', 'pfr', 'threebet', 'wtsd', 'wwsf', 'bb_per_100'];

/** What `analysis/pool/cohorts.py` allows for a cohort's member list. */
export const MEMBER_LIMIT = 1000;

/** A saved cohort (`api/schemas_pool.py#CohortOut`). */
export interface PoolCohort {
  id: string;
  name: string;
  criteria: CohortSpec;
  created_at: string;
  updated_at: string;
}

/** One cohort with the count of players it names right now (`CohortDetailOut`). */
export interface PoolCohortDetail extends PoolCohort {
  players: number;
}

/** What `POST /v1/pool/cohorts` and `PUT /v1/pool/cohorts/{id}` take (`CohortIn`): a name and the rules. */
export type CohortIn = {
  name: string;
  criteria: CohortSpec;
};
/* A type alias, not an interface, for the reason `reports/api.ts#SavedReportIn` gives: `Fetcher`
   takes a `Record<string, unknown>` body, and only an alias carries the implicit index signature. */

/** A cohort a report can be scoped to, from either source: the shipped presets or a saved row. */
export interface CohortChoice {
  /** `preset:<code>` or the saved row's uuid, unique across both lists. */
  key: string;
  label: string;
  description: string;
  /** Set for a saved row; the id the server wants as `?cohort_id=`. */
  id: string | null;
  /** Set for a preset; the rules to send inline. */
  spec: CohortSpec | null;
}

export interface PoolStatsApi {
  presets(): Promise<PoolPresets>;
  run(request: ReportRequest, cohort?: CohortChoice | null): Promise<ReportResult>;
  cohorts(): Promise<PoolCohort[]>;
  cohort(id: string): Promise<PoolCohortDetail>;
  members(id: string, limit?: number): Promise<ReportResult>;
  /** 201 with the row; 409 for a name this user already has; 400 for a rule the engine cannot compile. */
  createCohort(body: CohortIn): Promise<PoolCohort>;
  /** Replaces the name and every rule; the same refusals as a create, and 404 for another tenant's id. */
  updateCohort(id: string, body: CohortIn): Promise<PoolCohort>;
  /** 204; 404 for another tenant's id, so a stale link and a stranger's cohort look the same. */
  deleteCohort(id: string): Promise<void>;
}

/**
 * A body the population routes will accept: the dataset and `hero_only` are set together here and
 * nowhere else, and an inline cohort is attached only when one was chosen without an id.
 */
export function poolRequest(request: ReportRequest, cohort?: CohortChoice | null): ReportRequest {
  const body: ReportRequest = { ...request, dataset: 'population', hero_only: false };
  if (cohort?.spec != null) return { ...body, cohort: cohort.spec };
  if (cohort?.id != null) return { ...body, cohort: null };
  return body;
}

/**
 * The report that finds a player by a fragment of their name.
 *
 * **Why not the purpose-built route.** It answers this question as of ADR-062; until then it could
 * not, and this is the workaround that stood in for it. Moving the page onto `POST /v1/pool/players`
 * is plan step F.14, and it deletes this function and `likeLiteral` with it.
 *
 * What was wrong with it, kept because it is why the dimension's own description changed: it
 * compiled to `startsWith(player_key, …)`, but a `player_key` is **namespaced** —
 * every one of the 94,276 in the corpus reads `ggpoker:<name>`. So a prefix search for "Vill"
 * matches nothing, for any real opponent, and the page would answer "no such player" to every name
 * the founder typed — an assertion of absence that is not true, which is the §17 failure wearing
 * its least obvious disguise. Measured, not assumed: `prefix=A`, `V`, `Vill`, `P` and `1` each
 * returned 0 rows from the live route, while `player_key LIKE '%mango%'` returned five real names.
 *
 * So the search is a `like` over the same dimension, through the ordinary report path. That keeps
 * the site namespace out of the client — nothing here knows the string "ggpoker", and a second
 * site would need no change — and the wildcards are the engine's own `like` semantics rather than
 * vocabulary invented for poker.
 *
 * **The lower-casing is a fact about the data, not a guess.** Of all 94,276 distinct keys, **none**
 * contains an upper-case character: the pipeline stores them lowered. `LIKE` is case-sensitive, so
 * lowering what was typed makes the search case-insensitive *in effect* — and would simply stop
 * matching, rather than match wrongly, if that ever changed.
 */
export function searchPlayers(text: string, limit = PLAYER_LIMIT): ReportRequest {
  return {
    filter: { all: [{ dim: 'player_key', op: 'like', value: `%${likeLiteral(text.trim().toLowerCase())}%` }] },
    group_by: ['player_key'],
    stats: [...PLAYER_STATS],
    limit,
  };
}

/** A typed fragment as a literal: `%`, `_` and `\` are wildcards to `LIKE` and are meant as text. */
function likeLiteral(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** One player's own numbers: scoped by `player_key`, never grouped by it (it is `stats_daily`-only). */
export function playerReport(key: string): ReportRequest {
  return { player_key: key, stats: [...PLAYER_STATS], group_by: [] };
}

/**
 * The shipped cohorts and the saved ones as one list to choose from. A shipped cohort arrives with
 * the server's own prose; a saved one is described from its rules, which is where `stats` is spent.
 */
export function cohortChoices(presets: readonly CohortPreset[], saved: readonly PoolCohort[], stats: readonly Stat[] = []): CohortChoice[] {
  const shipped = presets.map((preset) => ({
    key: `preset:${preset.code}`,
    label: preset.label,
    description: preset.description,
    id: null,
    spec: { rules: preset.rules.map((rule) => ({ ...rule })) },
  }));
  const mine = saved.map((row) => ({
    key: row.id,
    label: row.name,
    description: describeRules(row.criteria, stats),
    id: row.id,
    spec: null,
  }));
  return [...shipped, ...mine];
}

/** The four comparisons in the words the cohort form's own picker offers, and nothing else. */
const OP_WORDS: Record<string, string> = Object.fromEntries(OPS.map((choice) => [choice.op, choice.label]));

/**
 * A cohort's rules as a sentence: "VPIP is below 25 and Hands is at least 1,000".
 *
 * It used to read "vpip < 25 and hands ≥ 1000" — the stat's code and a mathematical symbol — on the
 * picker, the cohorts list and the workbench's scope note alike, which is the registry's vocabulary
 * arriving on screen untranslated (ADR-057). The labels are the registry's own and the comparisons
 * are `rules.ts`'s `OPS`, so a rule reads in exactly the words it was built with.
 *
 * `stats` is optional because a caller without the registry — one whose load failed, or a test —
 * should still get a readable sentence rather than nothing; the stat's code stands in for its label.
 */
export function describeRules(spec: CohortSpec, stats: readonly Stat[] = []): string {
  const labels = new Map(stats.map((stat) => [stat.code, stat.label]));
  return spec.rules.map((rule) => `${labels.get(rule.stat) ?? rule.stat} ${OP_WORDS[rule.op] ?? rule.op} ${threshold(rule.value)}`).join(' and ');
}

/** A threshold as a reader counts it: 1000 hands is "1,000". Every digit is kept — it is a rule. */
function threshold(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 20 });
}

/** Bind the population routes to a fetcher (the auth store's, which adds the bearer). */
export function createPoolStatsApi(fetch: Fetcher): PoolStatsApi {
  return {
    presets: () => fetch<PoolPresets>('/v1/pool/presets'),
    run: (request, cohort) => {
      const path = cohort?.id == null ? '/v1/pool/stats' : `/v1/pool/stats?cohort_id=${encodeURIComponent(cohort.id)}`;
      return fetch<ReportResult>(path, { method: 'POST', body: poolRequest(request, cohort) });
    },
    cohorts: () => fetch<PoolCohort[]>('/v1/pool/cohorts'),
    cohort: (id) => fetch<PoolCohortDetail>(`/v1/pool/cohorts/${id}`),
    members: (id, limit = 100) => fetch<ReportResult>(`/v1/pool/cohorts/${id}/members?limit=${limit}`),
    createCohort: (body) => fetch<PoolCohort>('/v1/pool/cohorts', { method: 'POST', body }),
    updateCohort: (id, body) => fetch<PoolCohort>(`/v1/pool/cohorts/${id}`, { method: 'PUT', body }),
    deleteCohort: (id) => fetch<void>(`/v1/pool/cohorts/${id}`, { method: 'DELETE' }),
  };
}
