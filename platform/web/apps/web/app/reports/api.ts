/**
 * The report library on the wire: the presets each analysis area ships, and the reports a user
 * has saved (plan §2.8, §2.10; plan D.5).
 *
 * Both are the **same document** — a preset's `request` and a saved report's `definition` are
 * both a `ReportRequest`, the very thing `POST /v1/reports/run` takes — so opening either needs
 * no translation layer, and the workbench that runs one runs the other. That is why "presets are
 * the standard reports" is a statement about data and not about a special case in the UI.
 *
 * The client holds no preset of its own. A landing report is `analysis/{hero,pool}/presets.yaml`,
 * validated against the registry when the module loads, so a preset that cannot run fails in the
 * server's logs rather than in someone's browser — and inventing one here would put a report in
 * the client that the engine had never agreed to answer.
 */

import type { Fetcher } from '../auth/api';
import type { CohortRule, ReportRequest } from '../stats/api';

/** Which analysis area a report belongs to (`api/schemas_saved.py#Module`). */
export type Module = 'hero' | 'pool';

export const MODULES: readonly Module[] = ['hero', 'pool'];

/** A named report a user can open with one click (`analysis/presets.py#Preset`). */
export interface Preset {
  code: string;
  label: string;
  description: string;
  request: ReportRequest;
}

/** A ready-made cohort the pool area ships (`analysis/pool/cohorts.py#CohortPreset`). */
export interface CohortPreset {
  code: string;
  label: string;
  description: string;
  rules: CohortRule[];
  /** The behaviour group this label folds into (ADR-080), since plan G.4. */
  group?: string;
}

/** One of the five behaviour groups (ADR-080): its key, its label, and the preset codes it folds in. */
export interface PoolGroup {
  key: string;
  label: string;
  cohorts: string[];
}

export interface PoolPresets {
  reports: Preset[];
  cohorts: CohortPreset[];
  /** Since plan G.4; absent from an older API, which is why it is optional here. */
  groups?: PoolGroup[];
}

/** A stored report. `definition` is the engine document, so it loads straight into the workbench. */
export interface SavedReport {
  id: string;
  name: string;
  module: Module;
  definition: ReportRequest;
  created_at: string;
  updated_at: string;
}

export type SavedReportIn = {
  name: string;
  module: Module;
  definition: ReportRequest;
};
/* A type alias, not an interface, for the same reason `ReportRequest` is one: `Fetcher` takes a
   `Record<string, unknown>` body, and only an alias carries the implicit index signature that
   assignment needs. An interface here typechecks everywhere except the one line that sends it. */

export interface ReportsApi {
  heroPresets(): Promise<Preset[]>;
  poolPresets(): Promise<PoolPresets>;
  savedReports(): Promise<SavedReport[]>;
  savedReport(id: string): Promise<SavedReport>;
  createSavedReport(body: SavedReportIn): Promise<SavedReport>;
  updateSavedReport(id: string, body: SavedReportIn): Promise<SavedReport>;
  deleteSavedReport(id: string): Promise<void>;
}

/**
 * Bind the preset and saved-report endpoints to a fetcher (the auth store's, which adds the
 * bearer). A saved report belonging to someone else answers 404, never 403, so a stale link is
 * indistinguishable from a deleted one — which is the intended privacy property, not an oversight.
 */
export function createReportsApi(fetch: Fetcher): ReportsApi {
  return {
    heroPresets: () => fetch<Preset[]>('/v1/hero/presets'),
    poolPresets: () => fetch<PoolPresets>('/v1/pool/presets'),
    savedReports: () => fetch<SavedReport[]>('/v1/saved/reports'),
    savedReport: (id) => fetch<SavedReport>(`/v1/saved/reports/${id}`),
    createSavedReport: (body) => fetch<SavedReport>('/v1/saved/reports', { method: 'POST', body }),
    updateSavedReport: (id, body) => fetch<SavedReport>(`/v1/saved/reports/${id}`, { method: 'PUT', body }),
    deleteSavedReport: (id) => fetch<void>(`/v1/saved/reports/${id}`, { method: 'DELETE' }),
  };
}

/** The cohort a preset names, as the report request carries it. */
export function cohortOf(preset: CohortPreset): { rules: CohortRule[] } {
  return { rules: preset.rules.map((rule) => ({ ...rule })) };
}
