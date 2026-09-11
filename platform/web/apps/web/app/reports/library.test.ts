import { describe, expect, it, vi } from 'vitest';

import type { Preset, ReportsApi, SavedReport } from './api';
import { byModule, createLibrary, nameTaken } from './library';

function preset(code: string): Preset {
  return { code, label: code, description: '', request: { stats: ['vpip'] } };
}

function saved(id: string, name: string): SavedReport {
  return { id, name, module: 'hero', definition: { stats: ['vpip'] }, created_at: '', updated_at: '' };
}

function api(over: Partial<ReportsApi> = {}): ReportsApi {
  return {
    heroPresets: () => Promise.resolve([preset('preflop_overview')]),
    poolPresets: () => Promise.resolve({ reports: [preset('pool_by_position')], cohorts: [] }),
    savedReports: () => Promise.resolve([saved('id-1', 'Blind defence, deep')]),
    savedReport: (id) => Promise.resolve(saved(id, 'one')),
    createSavedReport: (body) => Promise.resolve({ ...saved('new', body.name), definition: body.definition }),
    updateSavedReport: (id, body) => Promise.resolve({ ...saved(id, body.name), definition: body.definition }),
    deleteSavedReport: () => Promise.resolve(),
    ...over,
  };
}

describe('the report library', () => {
  it('holds presets from both areas, each tagged with the one that served it', async () => {
    const library = createLibrary(api());
    await library.load();
    expect(library.status.value).toBe('ready');
    expect(library.presets.value.map((p) => [p.code, p.module])).toEqual([
      ['preflop_overview', 'hero'],
      ['pool_by_position', 'pool'],
    ]);
  });

  it('fetches once, however many screens ask', async () => {
    const heroPresets = vi.fn(() => Promise.resolve([preset('preflop_overview')]));
    const library = createLibrary(api({ heroPresets }));
    await Promise.all([library.load(), library.load()]);
    await library.load();
    expect(heroPresets).toHaveBeenCalledTimes(1);
  });

  it('says what is missing when the presets cannot be loaded, and can be retried', async () => {
    let fail = true;
    const library = createLibrary(
      api({
        heroPresets: () => (fail ? Promise.reject(new Error('boom')) : Promise.resolve([preset('preflop_overview')])),
      }),
    );
    await expect(library.load()).rejects.toThrow('boom');
    expect(library.status.value).toBe('error');
    expect(library.error.value).toContain('standard reports could not be loaded');
    fail = false;
    await library.load();
    expect(library.status.value).toBe('ready');
  });

  it('finds a preset by code and a saved report by id', async () => {
    const library = createLibrary(api());
    await library.load();
    expect(library.preset('pool_by_position')?.module).toBe('pool');
    expect(library.savedReport('id-1')?.name).toBe('Blind defence, deep');
    expect(library.preset('nope')).toBeUndefined();
  });

  it('refetches the saved list after every write, so two screens cannot disagree', async () => {
    const rows = [saved('id-1', 'one')];
    const savedReports = vi.fn(() => Promise.resolve([...rows]));
    const library = createLibrary(
      api({
        savedReports,
        createSavedReport: (body) => {
          rows.push(saved('id-2', body.name));
          return Promise.resolve(saved('id-2', body.name));
        },
      }),
    );
    await library.load();
    expect(library.saved.value).toHaveLength(1);
    await library.save({ name: 'two', module: 'hero', definition: { stats: ['vpip'] } });
    expect(library.saved.value.map((r) => r.name)).toEqual(['one', 'two']);
    expect(savedReports).toHaveBeenCalledTimes(2);
  });

  it('drops a deleted report from the list', async () => {
    const rows = [saved('id-1', 'one'), saved('id-2', 'two')];
    const library = createLibrary(
      api({
        savedReports: () => Promise.resolve([...rows]),
        deleteSavedReport: (id) => {
          rows.splice(rows.findIndex((r) => r.id === id), 1);
          return Promise.resolve();
        },
      }),
    );
    await library.load();
    await library.remove('id-1');
    expect(library.saved.value.map((r) => r.id)).toEqual(['id-2']);
  });
});

describe('byModule', () => {
  it('reads in the order a person meets them: their own game, then the field', async () => {
    const library = createLibrary(api());
    await library.load();
    expect(byModule(library.presets.value).map((g) => g.label)).toEqual(['My game', 'The pool']);
  });

  it('leaves out an area that shipped no presets', () => {
    expect(byModule([{ ...preset('a'), module: 'pool' }]).map((g) => g.module)).toEqual(['pool']);
  });
});

describe('nameTaken', () => {
  it('catches a clash before the server’s 409 has to', () => {
    const rows = [saved('id-1', 'Blind defence')];
    expect(nameTaken(rows, 'Blind defence')).toBe(true);
    expect(nameTaken(rows, '  blind DEFENCE ')).toBe(true);
    expect(nameTaken(rows, 'Something else')).toBe(false);
  });

  it('lets a report keep its own name when it is being replaced', () => {
    const rows = [saved('id-1', 'Blind defence')];
    expect(nameTaken(rows, 'Blind defence', 'id-1')).toBe(false);
  });
});
