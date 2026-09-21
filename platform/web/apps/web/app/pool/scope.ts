/**
 * What `/pool` and `/pool/cohorts` are allowed to measure: the standard reports the pool area
 * ships, the cohorts it ships, and the founder's own saved ones (plan D.6, F.12c's §2.13 half).
 *
 * The two calls behind it fail differently, and joining them made both failures look like emptiness:
 *
 *  - **the presets fail** and there is no standard report and no shipped cohort at all, so the
 *    page has nothing to offer and must say so;
 *  - **the saved cohorts fail** and the picker is merely *short* — which is the one state nobody
 *    can see. It used to be a `.catch(() => [])`, and the only trace was the scope line counting
 *    fewer cohorts than the founder had saved.
 *
 * So they are settled rather than joined, and each carries its own sentence. Framework-free apart
 * from `ref`, so the branching above is tested against two fake calls rather than a mounted page.
 */

import type { Ref } from 'vue';
import { ref, shallowRef } from 'vue';

import { describeApiError } from '../auth/api';
import type { Preset, ReportsApi } from '../reports/api';
import type { ReportRequest, Stat } from '../stats/api';
import type { CohortChoice, PoolStatsApi } from './stats';
import { cohortChoices } from './stats';
import { savedCohortsErrorWords, scopeErrorWords } from './words';

/** Anything with a current value — the seam `reports/model.ts` takes the registry through too. */
export interface Readable<T> {
  readonly value: T;
}

export interface ScopeDeps {
  readonly reports: Pick<ReportsApi, 'poolPresets'>;
  readonly pool: Pick<PoolStatsApi, 'cohorts'>;
  /** The registry, so a saved cohort's rules read in the registry's labels rather than its codes. */
  readonly stats: Readable<readonly Stat[]>;
  /** Put a preset's whole document into the workbench — `columns.apply`. */
  readonly open: (request: ReportRequest) => void;
}

export interface PoolScope {
  readonly presets: Ref<Preset[]>;
  /** The preset that is set up, so the state before a run can name what Run report would run. */
  readonly openPreset: Ref<Preset | null>;
  readonly choices: Ref<CohortChoice[]>;
  /**
   * Whether a load is in flight (plan F.12). The page reads it because it no longer *waits* for
   * this call: with the load lazy, "no cohorts yet" and "no cohorts at all" reach the screen at
   * the same time and look identical, and only this tells them apart.
   */
  readonly loading: Ref<boolean>;
  /** The presets call's failure, in words; empty when it answered. */
  readonly problem: Ref<string>;
  /** The saved cohorts' failure, in words; empty when they answered. */
  readonly savedProblem: Ref<string>;
  /** Load both. Never rejects: each half's failure is a sentence, not an exception. */
  load(): Promise<void>;
  apply(preset: Preset): void;
  cohortOf(key: string | null): CohortChoice | null;
}

export function createPoolScope(deps: ScopeDeps): PoolScope {
  const presets = ref<Preset[]>([]);
  /* A document, not state to poke at — the same reason `reports/model.ts` keeps a request in a
     `shallowRef`: Vue's deep unwrap mangles the recursive `FilterNode` inside `Preset.request`. */
  const openPreset = shallowRef<Preset | null>(null);
  const choices = ref<CohortChoice[]>([]);
  const problem = ref('');
  const savedProblem = ref('');
  const loading = ref(false);

  async function load(): Promise<void> {
    problem.value = '';
    savedProblem.value = '';
    loading.value = true;
    try {
      const [shipped, saved] = await Promise.allSettled([deps.reports.poolPresets(), deps.pool.cohorts()]);
      if (shipped.status === 'rejected') problem.value = scopeErrorWords(describeApiError(shipped.reason));
      if (saved.status === 'rejected') savedProblem.value = savedCohortsErrorWords(describeApiError(saved.reason));
      presets.value = shipped.status === 'fulfilled' ? shipped.value.reports : [];
      const cohorts = shipped.status === 'fulfilled' ? shipped.value.cohorts : [];
      choices.value = cohortChoices(cohorts, saved.status === 'fulfilled' ? saved.value : [], deps.stats.value);
    } finally {
      loading.value = false;
    }
  }

  return {
    presets,
    openPreset,
    choices,
    loading,
    problem,
    savedProblem,
    load,
    apply: (preset) => {
      openPreset.value = preset;
      deps.open(preset.request);
    },
    cohortOf: (key) => choices.value.find((choice) => choice.key === key) ?? null,
  };
}
