/**
 * The report library: the presets each area ships and the reports this user has saved (plan D.5).
 *
 * Both kinds open the same way — a preset's `request` and a saved report's `definition` are both a
 * `ReportRequest` — so they are held together and offered together. A preset is the platform's
 * idea of a standard report; a saved report is the founder's. Nothing here is authored in the
 * client.
 *
 * Presets are fetched once per session, like the registry and for the same reason: they are
 * validated server-side when the module loads, they never change while the tab is open, and they
 * sit behind the same bearer token, so a session that cannot reach the server cannot be signed in
 * either. Saved reports are refetched after every write, because they are the one part a user
 * changes.
 */

import type { Ref } from 'vue';
import { ref, shallowRef } from 'vue';

import type { Module, Preset, ReportsApi, SavedReport, SavedReportIn } from './api';

export type LibraryStatus = 'idle' | 'loading' | 'ready' | 'error';

/** A preset with the area it came from, since the two lists are served separately. */
export interface ModulePreset extends Preset {
  module: Module;
}

export interface Library {
  readonly presets: Ref<ModulePreset[]>;
  readonly saved: Ref<SavedReport[]>;
  readonly status: Ref<LibraryStatus>;
  readonly error: Ref<string>;
  /** Fetch presets and saved reports once. Concurrent callers share the one request. */
  load(): Promise<void>;
  /** A preset by its code, or a saved report by its id — whichever a link names. */
  preset(code: string): ModulePreset | undefined;
  savedReport(id: string): SavedReport | undefined;
  save(body: SavedReportIn): Promise<SavedReport>;
  update(id: string, body: SavedReportIn): Promise<SavedReport>;
  remove(id: string): Promise<void>;
}

interface Cells {
  presets: Ref<ModulePreset[]>;
  saved: Ref<SavedReport[]>;
  status: Ref<LibraryStatus>;
  error: Ref<string>;
}

export function createLibrary(api: ReportsApi): Library {
  const cells: Cells = {
    presets: shallowRef<ModulePreset[]>([]),
    saved: shallowRef<SavedReport[]>([]),
    status: ref<LibraryStatus>('idle'),
    error: ref(''),
  };
  let inflight: Promise<void> | null = null;

  return {
    ...cells,
    load: () => {
      if (cells.status.value === 'ready') return Promise.resolve();
      inflight ??= fetchAll(api, cells).catch((cause: unknown) => {
        inflight = null;
        throw cause;
      });
      return inflight;
    },
    preset: (code) => cells.presets.value.find((entry) => entry.code === code),
    savedReport: (id) => cells.saved.value.find((entry) => entry.id === id),
    ...writes(api, cells.saved),
  };
}

/** Both preset lists and the saved list in one round, so a screen has everything or nothing. */
async function fetchAll(api: ReportsApi, cells: Cells): Promise<void> {
  cells.status.value = 'loading';
  cells.error.value = '';
  try {
    const [hero, pool, mine] = await Promise.all([api.heroPresets(), api.poolPresets(), api.savedReports()]);
    cells.presets.value = [...tag(hero, 'hero'), ...tag(pool.reports, 'pool')];
    cells.saved.value = mine;
    cells.status.value = 'ready';
  } catch (cause) {
    cells.status.value = 'error';
    cells.error.value = 'The standard reports could not be loaded. Build a report by hand, or try again.';
    throw cause;
  }
}

/**
 * The three writes, each refetching the saved list afterwards. The list is the one part a user
 * changes, so it is read back from the server rather than patched locally: two tabs editing the
 * same library should not be able to disagree about what is in it.
 */
function writes(api: ReportsApi, saved: Ref<SavedReport[]>): Pick<Library, 'save' | 'update' | 'remove'> {
  const refresh = async (): Promise<void> => {
    saved.value = await api.savedReports();
  };
  return {
    save: async (body) => {
      const row = await api.createSavedReport(body);
      await refresh();
      return row;
    },
    update: async (id, body) => {
      const row = await api.updateSavedReport(id, body);
      await refresh();
      return row;
    },
    remove: async (id) => {
      await api.deleteSavedReport(id);
      await refresh();
    },
  };
}

/** The two preset lists, each carrying the area that served it. */
function tag(entries: readonly Preset[], module: Module): ModulePreset[] {
  return entries.map((entry) => ({ ...entry, module }));
}

/** Presets grouped by area, in the order a person meets them: their own game, then the field. */
export function byModule(presets: readonly ModulePreset[]): { module: Module; label: string; presets: ModulePreset[] }[] {
  const labels: Record<Module, string> = { hero: 'My game', pool: 'The pool' };
  return (['hero', 'pool'] as const)
    .map((module) => ({ module, label: labels[module], presets: presets.filter((entry) => entry.module === module) }))
    .filter((group) => group.presets.length > 0);
}

/**
 * Whether a name is already taken, so the dialog can say so before the server's 409 does. The 409
 * is still the authority — another tab may have taken it — this only saves a round trip.
 */
export function nameTaken(saved: readonly SavedReport[], name: string, exceptId: string | null = null): boolean {
  const wanted = name.trim().toLowerCase();
  return saved.some((row) => row.name.trim().toLowerCase() === wanted && row.id !== exceptId);
}
