/**
 * The reveal's rules (plan H.7): the field is always asked and asked first, groups are asked one
 * after another and never together, a stale reveal stops, and the question says "before".
 */
import type { NodeKey } from '@poker/core';
import { createRange, nodeKey, parseRange, step } from '@poker/core';
import { describe, expect, it, vi } from 'vitest';

import type { NodeShowdownRange } from '../pool/api';
import type { PoolCohort } from '../pool/stats';

import { WHOLE_FIELD, askGroups, diffRanges, groupsToAsk, hasWeight, loadRevealGroups, revealGroups, revealId, revealQuestion, revealThin } from './reveal';

const NODE: NodeKey = nodeKey('CO', {
  villain_position: 'BB',
  street: 'flop',
  action_sequence: [step('CO', 'raise', { size_bb: 2.5 }), step('BB', 'call'), step('CO', 'bet', { size_pct: 0.33 })],
});

function cohort(id: string, name: string): PoolCohort {
  return { id, name, criteria: { rules: [] }, created_at: '', updated_at: '' };
}

function shown(enough: boolean, sample = 400): NodeShowdownRange {
  return {
    tier: 2,
    sample_size: sample,
    enough,
    min_n: 100,
    decisions_at_node: 20_000,
    covers: sample / 20_000,
    classes: enough ? { AA: 60, AKs: 40 } : {},
    weights: enough ? { AA: 0.6, AKs: 0.4 } : {},
  };
}

/** A promise settled from outside, so a test can prove the second ask waits for the first. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const GROUPS = [
  { key: 'all', label: 'everyone', cohorts: ['reg', 'fish'] },
  { key: 'reg', label: 'regs', cohorts: ['reg'] },
  { key: 'fish', label: 'fish', cohorts: ['fish'] },
];

describe('the groups', () => {
  it('offers the field first, then the behaviour groups as `group:` keys with the server’s labels, then every saved cohort by id', () => {
    const groups = revealGroups(GROUPS, [cohort('c1', 'my regs')]);
    expect(groups).toEqual([WHOLE_FIELD, { key: 'group:reg', label: 'regs' }, { key: 'group:fish', label: 'fish' }, { key: 'c1', label: 'my regs' }]);
  });

  it('lists `all` once, as the field, rather than as a second name for everyone', () => {
    expect(revealGroups(GROUPS, []).filter((group) => group.label === 'everyone')).toEqual([]);
  });

  it('asks the field alone when nothing else is chosen, and the field then the group otherwise — never more', () => {
    const groups = revealGroups(GROUPS, [cohort('c2', 'mine')]);
    expect(groupsToAsk(groups, '')).toEqual([WHOLE_FIELD]);
    expect(groupsToAsk(groups, 'group:fish')).toEqual([WHOLE_FIELD, { key: 'group:fish', label: 'fish' }]);
    expect(groupsToAsk(groups, 'c2')).toEqual([WHOLE_FIELD, { key: 'c2', label: 'mine' }]);
    expect(groupsToAsk(groups, 'no-such')).toEqual([WHOLE_FIELD]);
  });

  it('loads both lists, each failing on its own, and says which one is missing', async () => {
    const both = await loadRevealGroups({ presets: async () => ({ reports: [], cohorts: [], groups: GROUPS }), cohorts: async () => [cohort('c1', 'mine')] });
    expect(both.groups.map((group) => group.key)).toEqual(['', 'group:reg', 'group:fish', 'c1']);
    expect(both.problem).toBe('');

    const noPresets = await loadRevealGroups({ presets: async () => Promise.reject(new Error('down')), cohorts: async () => [cohort('c1', 'mine')] });
    expect(noPresets.groups.map((group) => group.key)).toEqual(['', 'c1']);
    expect(noPresets.problem).toContain('player groups could not be listed');

    const older = await loadRevealGroups({ presets: async () => ({ reports: [], cohorts: [] }), cohorts: async () => Promise.reject(new Error('down')) });
    expect(older.groups).toEqual([WHOLE_FIELD]);
    expect(older.problem).toContain('saved cohorts could not be listed');
  });

  it('marks a reveal by the situation and the group, so a late answer to another is dropped', () => {
    expect(revealId(NODE, 'c1')).not.toBe(revealId(NODE, ''));
    expect(revealId(NODE, 'c1')).toBe(revealId({ ...NODE }, 'c1'));
  });
});

describe('askGroups', () => {
  it('asks the second group only after the first has answered, with each group’s own id', async () => {
    const first = deferred<NodeShowdownRange>();
    const showdownRange = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce(shown(true));
    const seen: string[] = [];
    const done = askGroups({ showdownRange }, NODE, [WHOLE_FIELD, { key: 'c1', label: 'regs' }], () => false, (found) => seen.push(found.group.key));

    await Promise.resolve();
    expect(showdownRange).toHaveBeenCalledTimes(1);
    expect(showdownRange).toHaveBeenCalledWith(NODE, '');
    first.resolve(shown(true));
    await done;
    expect(showdownRange).toHaveBeenCalledTimes(2);
    expect(showdownRange).toHaveBeenLastCalledWith(NODE, 'c1');
    expect(seen).toEqual(['', 'c1']);
  });

  it('stops asking, and hands nothing back, once the situation has gone stale', async () => {
    const first = deferred<NodeShowdownRange>();
    const showdownRange = vi.fn().mockReturnValueOnce(first.promise);
    let stale = false;
    const onGroup = vi.fn();
    const done = askGroups({ showdownRange }, NODE, [WHOLE_FIELD, { key: 'c1', label: 'regs' }], () => stale, onGroup);
    stale = true;
    first.resolve(shown(true));
    await done;
    expect(onGroup).not.toHaveBeenCalled();
    expect(showdownRange).toHaveBeenCalledTimes(1);
  });

  it('turns a refused group into a sentence and goes on to the next, keeping the rest of the answer', async () => {
    // ClickHouse code 202 as `stats/tenancy.py` classifies it since plan H.0.
    const refused = Object.assign(new Error('FetchError'), {
      name: 'FetchError',
      status: 429,
      data: { detail: 'The account is already running as many queries at once as it may; ask again in a moment.' },
    });
    const showdownRange = vi.fn().mockRejectedValueOnce(refused).mockResolvedValueOnce(shown(true));
    const found: string[] = [];
    await askGroups({ showdownRange }, NODE, [WHOLE_FIELD, { key: 'c1', label: 'regs' }], () => false, (group) => found.push(group.problem));
    expect(found[0]).toContain('The pool could not be asked what the whole field has here.');
    expect(found[0]).toContain('only a few of them are answered at a time');
    expect(found[0]).toContain('Press Reveal again to ask afresh.');
    expect(found[1]).toBe('');
  });

  it('draws a range only from an answer with enough shown hands', async () => {
    const showdownRange = vi.fn().mockResolvedValueOnce(shown(false, 57)).mockResolvedValueOnce(shown(true));
    const ranges: (string | null)[] = [];
    await askGroups({ showdownRange }, NODE, [WHOLE_FIELD, { key: 'c1', label: 'regs' }], () => false, (group) => ranges.push(group.range?.label ?? null));
    expect(ranges).toEqual([null, 'the pool · regs']);
  });
});

describe('the sentences', () => {
  it('asks what the seat arrives with, before its action, because the node’s range is the hands in front of the decision', () => {
    const question = revealQuestion(NODE);
    expect(question).toContain('What is CO holding when the action reaches them here — before they bet?');
    expect(question).not.toContain('after');
  });

  it('says how many were shown, of how many, and how many are needed, when the range is withheld', () => {
    expect(revealThin(shown(false, 57), 'regs')).toBe(
      'Too few hands were shown down here to draw a range for regs: 57 of the 20,000 decisions at this spot were turned over, and 100 are needed.',
    );
  });

  it('puts the read first as the reference and every answered group beside it', () => {
    const read = parseRange('AA,KK').range;
    const answered = { group: WHOLE_FIELD, answer: shown(true), range: parseRange('AA:0.6,AKs:0.4').range, problem: '' };
    const thin = { group: { key: 'c1', label: 'regs' }, answer: shown(false), range: null, problem: '' };
    expect(diffRanges(read, [answered, thin]).map((entry) => entry.label)).toEqual(['your read', 'the whole field']);
    expect(hasWeight(read)).toBe(true);
    expect(hasWeight(createRange())).toBe(false);
  });
});
