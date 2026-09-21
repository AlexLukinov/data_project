/**
 * The pool's scope, one failure at a time (plan F.12c).
 *
 * The failure paths are the reason this module exists: both halves used to be joined, so a failed
 * presets call left a page with no reports and nothing to say, and a failed saved-cohorts call was
 * swallowed outright.
 */
import { describe, expect, it } from 'vitest';

import type { PoolPresets, Preset } from '../reports/api';
import type { ReportRequest, Stat } from '../stats/api';
import { createPoolScope } from './scope';
import type { PoolCohort } from './stats';

const PRESET: Preset = { code: 'regs_by_position', label: 'Regs by position', description: '', request: { stats: ['vpip'] } };

const SHIPPED: PoolPresets = {
  reports: [PRESET],
  cohorts: [{ code: 'regs', label: 'Regulars', description: 'Tight, high volume', rules: [{ stat: 'vpip', op: 'lt', value: 25 }] }],
};

const MINE: PoolCohort[] = [{ id: 'a', name: 'Mine', criteria: { rules: [{ stat: 'vpip', op: 'gte', value: 35 }] }, created_at: '', updated_at: '' }];

const STATS = { value: [{ code: 'vpip', label: 'VPIP' } as Stat] };

function scope(presets: () => Promise<PoolPresets>, cohorts: () => Promise<PoolCohort[]>) {
  const opened: ReportRequest[] = [];
  const model = createPoolScope({ reports: { poolPresets: presets }, pool: { cohorts }, stats: STATS, open: (request) => opened.push(request) });
  return { model, opened };
}

const ok = () => scope(async () => SHIPPED, async () => MINE);
const fails = (message: string) => async (): Promise<never> => {
  throw new Error(message);
};

describe('createPoolScope — when a half fails', () => {
  it('says the standard reports and shipped cohorts are gone, with the reason', async () => {
    const { model } = scope(fails('nope'), async () => MINE);
    await model.load();
    expect(model.problem.value).toContain('could not be loaded');
    expect(model.problem.value).toContain('nope');
    expect(model.presets.value).toEqual([]);
  });

  /* The saved ones used to vanish under a catch, leaving a shorter picker and no explanation. */
  it('says the saved cohorts are missing rather than offering the shipped ones in silence', async () => {
    const { model } = scope(async () => SHIPPED, fails('nope'));
    await model.load();
    expect(model.savedProblem.value).toContain('only the shipped ones');
    expect(model.choices.value.map((choice) => choice.key)).toEqual(['preset:regs']);
  });

  it('reports both failures at once and keeps nothing to choose from', async () => {
    const { model } = scope(fails('one'), fails('two'));
    await model.load();
    expect(model.problem.value).not.toBe('');
    expect(model.savedProblem.value).not.toBe('');
    expect(model.choices.value).toEqual([]);
  });

  it('never rejects, so a page awaiting it still renders', async () => {
    const { model } = scope(fails('one'), fails('two'));
    await expect(model.load()).resolves.toBeUndefined();
  });

  it('clears a failure that a retry has answered', async () => {
    let broken = true;
    const { model } = scope(async () => {
      if (broken) throw new Error('nope');
      return SHIPPED;
    }, async () => MINE);
    await model.load();
    broken = false;
    await model.load();
    expect(model.problem.value).toBe('');
    expect(model.presets.value).toEqual([PRESET]);
  });
});

describe('createPoolScope — when both answer', () => {
  it('offers the shipped cohorts before the saved ones', async () => {
    const { model } = ok();
    await model.load();
    expect(model.choices.value.map((choice) => choice.key)).toEqual(['preset:regs', 'a']);
  });

  it('describes a saved cohort in the registry’s labels', async () => {
    const { model } = ok();
    await model.load();
    expect(model.cohortOf('a')?.description).toBe('VPIP is at least 35');
  });

  it('resolves a key that is not on offer to nothing, rather than to the whole field', async () => {
    const { model } = ok();
    await model.load();
    expect(model.cohortOf('deleted-id')).toBeNull();
    expect(model.cohortOf(null)).toBeNull();
  });

  it('remembers which preset is set up, and hands its document to the workbench', () => {
    const { model, opened } = ok();
    model.apply(PRESET);
    expect(model.openPreset.value).toBe(PRESET);
    expect(opened).toEqual([PRESET.request]);
  });
});
