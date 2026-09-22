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
 *  3. **A player is looked up by name through `POST /v1/pool/players`, and by nothing else**
 *     (ADR-062). It is a POST because a screen name is personal data and a query string is written
 *     into every access log the request passes through (ADR-058). What it matches, how short a
 *     name it refuses and how the matches are ranked are all the server's, measured on the real
 *     pool; nothing here holds a second copy of any of it. See `findPlayers`.
 *  4. **A refused write is the server's sentence, not ours** (plan D.6b). A duplicate name is a 409
 *     whose detail names the cohort (`uq_cohorts_user_name`); a rule on an uncached stat is a 400 at
 *     *create* (`stats/query.py`), never at query time; an eleventh rule is a 422. Nothing here
 *     rewrites any of them — `pool/rules.ts#describeCohortError` shows each in the server's words.
 */

import type { Fetcher } from '../auth/api';
import type { CohortPreset, PoolPresets } from '../reports/api';
import type { CohortSpec, ReportRequest, ReportResult, Stat, StatMeta } from '../stats/api';
import { OPS } from './rules';

/** What `analysis/pool/cohorts.py` allows for a cohort's member list. */
export const MEMBER_LIMIT = 1000;

/**
 * Who a typed name matched (`analysis/pool/service.py#PlayerMatches`).
 *
 * A `ReportResult` with the two facts a list of names needs and a grid of numbers does not, so
 * `StatGrid` and `reports/cell.ts` bind to it unchanged: `rows` is the busiest of the matches,
 * `matched` is how many there were in all, and `matched_capped` says that count is a floor rather
 * than a count. All three are the server's own — the page reports them and computes none of them.
 */
export interface PlayerMatches extends ReportResult {
  matched: number;
  matched_capped: boolean;
}

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
  /**
   * Players matching part of a screen name, or a whole key pasted back (`<site>:<part of a name>`).
   * The route lower-cases what it is given and matches inside the name half, so this is not a
   * substring test on the text as typed; too short a name is a 400 whose detail is the reason.
   */
  findPlayers(name: string): Promise<PlayerMatches>;
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
 * One player's own numbers: scoped by `player_key`, never grouped by it (it is `stats_daily`-only).
 *
 * **The stats are the ones the lookup answered with, not a list kept here.** They used to be a
 * `PLAYER_STATS` constant, written when the search was a hand-rolled report and the client had to
 * choose the columns; the route chooses them now (`analysis/pool/service.py#PLAYER_STATS`), and a
 * second copy here could only ever be the same seven or the wrong seven. So the row that was
 * clicked brings its own `StatMeta`s with it, and this report asks for exactly what that row was
 * already showing.
 */
export function playerReport(key: string, shown: readonly StatMeta[]): ReportRequest {
  /* Refused rather than sent empty: `stats/resolve.py` reads `request.stats or DEFAULT_STATS`, so
     an empty list is not an error there — it silently becomes five other stats, and the grid would
     show numbers the lookup never named while `playerIntroWords` promised the seven it did. A
     silent fallback on a value this client no longer chooses is the thing F.14 set out to remove. */
  if (shown.length === 0) throw new Error('the lookup named no stats to read this player by');
  return { player_key: key, stats: shown.map((stat) => stat.code), group_by: [] };
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
    /* No `limit`: how many of the matches come back is the route's own default, and the answer
       says how many matched in all, so a number chosen here could only disagree with it. */
    findPlayers: (name) => fetch<PlayerMatches>('/v1/pool/players', { method: 'POST', body: { name } }),
    cohorts: () => fetch<PoolCohort[]>('/v1/pool/cohorts'),
    cohort: (id) => fetch<PoolCohortDetail>(`/v1/pool/cohorts/${id}`),
    members: (id, limit = 100) => fetch<ReportResult>(`/v1/pool/cohorts/${id}/members?limit=${limit}`),
    createCohort: (body) => fetch<PoolCohort>('/v1/pool/cohorts', { method: 'POST', body }),
    updateCohort: (id, body) => fetch<PoolCohort>(`/v1/pool/cohorts/${id}`, { method: 'PUT', body }),
    deleteCohort: (id) => fetch<void>(`/v1/pool/cohorts/${id}`, { method: 'DELETE' }),
  };
}
