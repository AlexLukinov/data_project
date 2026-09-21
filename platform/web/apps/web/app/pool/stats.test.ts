import { describe, expect, it } from 'vitest';

import type { CohortPreset } from '../reports/api';
import type { CohortSpec, FilterNode, Leaf, Stat } from '../stats/api';
import { PLAYER_LIMIT, cohortChoices, createPoolStatsApi, describeRules, playerReport, poolRequest, searchPlayers } from './stats';

const REGS: CohortPreset = {
  code: 'regs',
  label: 'Regulars',
  description: 'Tight, high volume',
  rules: [
    { stat: 'vpip', op: 'lt', value: 25 },
    { stat: 'hands', op: 'gte', value: 1000 },
  ],
};

const SPEC: CohortSpec = { rules: [{ stat: 'vpip', op: 'gte', value: 35 }] };

const FOUR_OPS: CohortSpec = {
  rules: [
    { stat: 'vpip', op: 'lt', value: 25 },
    { stat: 'pfr', op: 'lte', value: 20 },
    { stat: 'wtsd', op: 'gt', value: 1 },
    { stat: 'hands', op: 'gte', value: 1000 },
  ],
};

/** Only the two fields a sentence reads; the registry serves a dozen more. */
const VPIP = { code: 'vpip', label: 'VPIP' } as Stat;

describe('poolRequest', () => {
  it('sets the dataset and hero_only together, because either alone is a 422', () => {
    expect(poolRequest({ stats: ['vpip'] })).toEqual({ stats: ['vpip'], dataset: 'population', hero_only: false });
  });

  it('overrides a hero dataset that arrived from the shared filter', () => {
    const body = poolRequest({ dataset: 'hero', hero_only: true });
    expect(body.dataset).toBe('population');
    expect(body.hero_only).toBe(false);
  });

  it('attaches a preset cohort inline', () => {
    const [preset] = cohortChoices([REGS], []);
    expect(poolRequest({}, preset).cohort).toEqual({ rules: REGS.rules });
  });

  it('clears the body cohort for a saved one, because ?cohort_id= wins and would discard it anyway', () => {
    const saved = { key: 'id-1', label: 'Mine', description: '', id: 'id-1', spec: null };
    expect(poolRequest({ cohort: SPEC }, saved).cohort).toBeNull();
  });

  it('leaves the cohort alone when none was chosen', () => {
    expect(poolRequest({ stats: ['vpip'] }, null).cohort).toBeUndefined();
  });
});

describe('cohortChoices', () => {
  it('offers the shipped cohorts before the saved ones', () => {
    const saved = [{ id: 'a', name: 'Mine', criteria: SPEC, created_at: '', updated_at: '' }];
    expect(cohortChoices([REGS], saved).map((choice) => choice.key)).toEqual(['preset:regs', 'a']);
  });

  it('gives a preset rules to send and no id; a saved row an id and no rules', () => {
    const saved = [{ id: 'a', name: 'Mine', criteria: SPEC, created_at: '', updated_at: '' }];
    const [preset, mine] = cohortChoices([REGS], saved);
    expect(preset?.id).toBeNull();
    expect(preset?.spec).toEqual({ rules: REGS.rules });
    expect(mine?.id).toBe('a');
    expect(mine?.spec).toBeNull();
  });

  it('copies a preset’s rules rather than sharing them, so a request cannot mutate the library', () => {
    const [choice] = cohortChoices([REGS], []);
    expect(choice?.spec?.rules[0]).not.toBe(REGS.rules[0]);
  });

  it('describes a saved cohort by its own rules', () => {
    const saved = [{ id: 'a', name: 'Mine', criteria: SPEC, created_at: '', updated_at: '' }];
    expect(cohortChoices([], saved)[0]?.description).toBe('vpip is at least 35');
  });

  it('describes it in the registry’s labels when the registry is to hand', () => {
    const saved = [{ id: 'a', name: 'Mine', criteria: SPEC, created_at: '', updated_at: '' }];
    expect(cohortChoices([], saved, [VPIP])[0]?.description).toBe('VPIP is at least 35');
  });
});

describe('describeRules', () => {
  it('words the four ops the engine allows, as the cohort form words them', () => {
    expect(describeRules(FOUR_OPS)).toBe('vpip is below 25 and pfr is at most 20 and wtsd is above 1 and hands is at least 1,000');
  });

  it('prints the registry’s label rather than the stat code', () => {
    expect(describeRules(SPEC, [VPIP])).toBe('VPIP is at least 35');
  });

  /* A saved cohort outlives a registry entry: the rule is still sent, so it must still read. */
  it('falls back to the code for a stat this registry does not name', () => {
    expect(describeRules(SPEC, [{ code: 'pfr', label: 'PFR' } as Stat])).toBe('vpip is at least 35');
  });

  it('keeps every digit of a threshold — it is a rule, not a reading', () => {
    const spec: CohortSpec = { rules: [{ stat: 'bb_per_100', op: 'gte', value: 2.755 }] };
    expect(describeRules(spec)).toBe('bb_per_100 is at least 2.755');
  });
});

describe('createPoolStatsApi', () => {
  function recorder(): { calls: { path: string; init?: unknown }[]; fetch: <T>(path: string, init?: unknown) => Promise<T> } {
    const calls: { path: string; init?: unknown }[] = [];
    return { calls, fetch: async <T,>(path: string, init?: unknown): Promise<T> => (calls.push({ path, init }), {} as T) };
  }

  it('posts a saved cohort as ?cohort_id= and not in the body', async () => {
    const spy = recorder();
    await createPoolStatsApi(spy.fetch).run({ stats: ['vpip'] }, { key: 'a', label: '', description: '', id: 'a', spec: null });
    expect(spy.calls[0]?.path).toBe('/v1/pool/stats?cohort_id=a');
    expect((spy.calls[0]?.init as { body: { cohort: unknown } }).body.cohort).toBeNull();
  });

  it('posts a preset cohort in the body, with no query parameter', async () => {
    const spy = recorder();
    const [preset] = cohortChoices([REGS], []);
    await createPoolStatsApi(spy.fetch).run({}, preset);
    expect(spy.calls[0]?.path).toBe('/v1/pool/stats');
    expect((spy.calls[0]?.init as { body: { cohort: CohortSpec } }).body.cohort).toEqual({ rules: REGS.rules });
  });

  /* The write half (plan D.6b): the body is `CohortIn` exactly, and the id travels in the path. */
  it('creates a cohort with a POST of the name and the rules', async () => {
    const spy = recorder();
    await createPoolStatsApi(spy.fetch).createCohort({ name: 'Regs', criteria: SPEC });
    expect(spy.calls[0]?.path).toBe('/v1/pool/cohorts');
    expect(spy.calls[0]?.init).toEqual({ method: 'POST', body: { name: 'Regs', criteria: SPEC } });
  });

  it('replaces a cohort with a PUT to its id', async () => {
    const spy = recorder();
    await createPoolStatsApi(spy.fetch).updateCohort('a', { name: 'Regs', criteria: SPEC });
    expect(spy.calls[0]?.path).toBe('/v1/pool/cohorts/a');
    expect(spy.calls[0]?.init).toEqual({ method: 'PUT', body: { name: 'Regs', criteria: SPEC } });
  });

  it('deletes a cohort by its id and sends no body', async () => {
    const spy = recorder();
    await createPoolStatsApi(spy.fetch).deleteCohort('a');
    expect(spy.calls[0]?.path).toBe('/v1/pool/cohorts/a');
    expect(spy.calls[0]?.init).toEqual({ method: 'DELETE' });
  });
});

/** The one leaf a player search compiles to — `FilterNode` is a union, so it is narrowed once here. */
function onlyLeaf(node: FilterNode | undefined): Leaf {
  if (node === undefined || !('all' in node)) throw new Error('expected an all-node');
  const [leaf] = node.all;
  if (leaf === undefined || !('dim' in leaf)) throw new Error('expected a leaf');
  return leaf;
}

describe('searchPlayers', () => {
  /* Every key in the corpus is `ggpoker:<name>`, so a prefix match finds no opponent by name. */
  it('matches a fragment anywhere in the key, so a namespaced key is still found', () => {
    const leaf = onlyLeaf(searchPlayers('mango').filter);
    expect(leaf).toEqual({ dim: 'player_key', op: 'like', value: '%mango%' });
  });

  it('lowers what was typed, because every stored key is already lower-case', () => {
    expect(onlyLeaf(searchPlayers('Villain').filter).value).toBe('%villain%');
  });

  it('trims, so a stray space does not become part of the name', () => {
    expect(onlyLeaf(searchPlayers('  mango  ').filter).value).toBe('%mango%');
  });

  it('treats a typed wildcard as text: % and _ are LIKE syntax and were meant literally', () => {
    expect(onlyLeaf(searchPlayers('50%_off').filter).value).toBe('%50\\%\\_off%');
  });

  it('escapes a backslash before it can escape something else', () => {
    expect(onlyLeaf(searchPlayers('a\\b').filter).value).toBe('%a\\\\b%');
  });

  it('groups by player so each match is its own row, and caps the list', () => {
    const request = searchPlayers('a');
    expect(request.group_by).toEqual(['player_key']);
    expect(request.limit).toBe(PLAYER_LIMIT);
  });
});

describe('playerReport', () => {
  /* `player_key` lives on `stats_daily` alone: grouping a report by it is a 400 by design. */
  it('scopes by player rather than grouping by it', () => {
    const request = playerReport('ggpoker:example_reg');
    expect(request.player_key).toBe('ggpoker:example_reg');
    expect(request.group_by).toEqual([]);
  });
});
