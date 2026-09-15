import type { NodeKey } from '@poker/core';
import { canonicalNodeKey, nodeKey, step } from '@poker/core';
import { describe, expect, it } from 'vitest';

import { SITUATION_PARAM, openLinkedSituation, situationFromQuery, situationQuery } from './situation';

const BB_RAISES_FLOP: NodeKey = nodeKey('BB', {
  stake: 'NL10',
  eff_stack_bb: 40,
  villain_position: 'CO',
  street: 'flop',
  board_texture: ['monotone', 'paired'],
  action_sequence: [step('CO', 'raise', { size_bb: 2.5 }), step('BB', 'call'), step('BB', 'check'), step('CO', 'bet', { size_pct: 0.33 }), step('BB', 'raise', { size_pct: 1.1 })],
});

describe('situationFromQuery, when the link cannot be read', () => {
  it('says so for text that is not JSON, and names the default', () => {
    const read = situationFromQuery({ node: '{hero:BTN' });
    expect(read.key).toBeNull();
    expect(read.problem).toContain("This link's situation could not be read");
    expect(read.problem).toContain('opened on its default situation');
  });

  it("carries the key parser's own reason for JSON of the wrong shape", () => {
    const read = situationFromQuery({ node: JSON.stringify({ hero_position: 'BTN', street: 'showdown' }) });
    expect(read.key).toBeNull();
    expect(read.problem).toContain('node.street: must be one of preflop, flop, turn, river');
  });

  it('refuses an unknown field rather than dropping it', () => {
    const read = situationFromQuery({ node: JSON.stringify({ hero: 'BTN' }) });
    expect(read.key).toBeNull();
    expect(read.problem).toContain('node.hero: unknown field');
  });

  it('refuses a JSON array, and a bare JSON string', () => {
    expect(situationFromQuery({ node: '["BTN","flop"]' }).problem).toContain('node: must be an object');
    expect(situationFromQuery({ node: '"UTG"' }).problem).toContain('node: must be an object');
  });

  it('refuses a repeated or valueless parameter instead of guessing which one was meant', () => {
    const repeated = situationFromQuery({ node: [canonicalNodeKey(BB_RAISES_FLOP), canonicalNodeKey(BB_RAISES_FLOP)] });
    expect(repeated.key).toBeNull();
    expect(repeated.problem).toContain('one value');
    expect(situationFromQuery({ node: null }).problem).toContain('one value');
  });

  it('never throws, even on an empty value', () => {
    expect(() => situationFromQuery({ node: '' })).not.toThrow();
    expect(situationFromQuery({ node: '' }).key).toBeNull();
    // `?node=` with nothing after it named a situation and failed to: it is a problem, not "no link".
    expect(situationFromQuery({ node: '' }).problem).toContain('could not be read');
  });
});

describe('situationFromQuery, when the link says nothing', () => {
  it('is no key and no problem', () => {
    expect(situationFromQuery({})).toEqual({ key: null, problem: null });
    expect(situationFromQuery({ range: 'r1' })).toEqual({ key: null, problem: null });
  });
});

describe('the round trip', () => {
  it('puts the whole situation in one parameter, as its canonical key', () => {
    expect(situationQuery(BB_RAISES_FLOP)).toEqual({ [SITUATION_PARAM]: canonicalNodeKey(BB_RAISES_FLOP) });
    expect(SITUATION_PARAM).toBe('node');
  });

  it('reads back the same situation after travelling through a real URL', () => {
    const url = new URL(`http://localhost/ranges/compare?${new URLSearchParams(situationQuery(BB_RAISES_FLOP))}`);
    const read = situationFromQuery(Object.fromEntries(url.searchParams));
    expect(read.problem).toBeNull();
    expect(read.key).toEqual(BB_RAISES_FLOP);
  });
});

describe('openLinkedSituation', () => {
  const opens = (answer: () => Promise<{ node_key: NodeKey }>) => {
    const asked: string[] = [];
    return { asked, open: (id: string) => (asked.push(id), answer()) };
  };

  it('says the linked range could not be opened, with why, instead of swallowing it', async () => {
    const { open } = opens(() => Promise.reject({ status: 404, data: { detail: 'range not found' } }));
    const read = await openLinkedSituation({ range: 'gone' }, open);
    expect(read.key).toBeNull();
    expect(read.problem).toContain('The linked range could not be opened');
    expect(read.problem).toContain('opened on its default situation');
    expect(read.problem).toContain('range not found');
  });

  it('reports an unreadable node and does not fall back to the range', async () => {
    const { asked, open } = opens(() => Promise.resolve({ node_key: BB_RAISES_FLOP }));
    const read = await openLinkedSituation({ node: 'garbage', range: 'r1' }, open);
    expect(read.key).toBeNull();
    expect(read.problem).toContain("This link's situation could not be read");
    expect(asked).toEqual([]);
  });

  it('reads the node first and never opens the range beside it', async () => {
    const { asked, open } = opens(() => Promise.resolve({ node_key: nodeKey('UTG') }));
    const read = await openLinkedSituation({ ...situationQuery(BB_RAISES_FLOP), range: 'r1' }, open);
    expect(read).toEqual({ key: BB_RAISES_FLOP, problem: null });
    expect(asked).toEqual([]);
  });

  it("takes a stored range's situation when the link names only the range", async () => {
    const { asked, open } = opens(() => Promise.resolve({ node_key: BB_RAISES_FLOP }));
    expect(await openLinkedSituation({ range: 'r1' }, open)).toEqual({ key: BB_RAISES_FLOP, problem: null });
    expect(asked).toEqual(['r1']);
  });

  it('opens nothing for a link that names neither', async () => {
    const { asked, open } = opens(() => Promise.resolve({ node_key: BB_RAISES_FLOP }));
    expect(await openLinkedSituation({}, open)).toEqual({ key: null, problem: null });
    expect(asked).toEqual([]);
  });
});
