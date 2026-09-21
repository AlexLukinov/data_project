/**
 * The situation shorthand taken apart (ADR-056). The pieces must join back into exactly what
 * `nodeKeyLabel` prints — for every key the shared fixture holds and for the shapes a player
 * meets — and each piece must carry the row that actually explains it.
 */
import { readFileSync } from 'node:fs';

import type { NodeAction, NodeKey, Street } from '@poker/core';
import { NODE_ACTIONS, STREETS, nodeKey, nodeKeyLabel, parseNodeKey, step } from '@poker/core';
import { describe, expect, it } from 'vitest';

import { nodeLabelParts, partWord } from '../src/nodeWords';
import { AXIS_WORDS, CATEGORY_WORDS, MADE_HAND_WORDS, NODE_WORDS, POSITION_WORDS, groupWord, isPosition } from '../src/vocabulary';

interface Fixture {
  valid: { name: string; label: string; input: unknown }[];
}

/** The fixture both the Python and the TypeScript suites parse (ADR-028). */
const FIXTURE: Fixture = JSON.parse(readFileSync(new URL('../../../../tests/fixtures/nodes.json', import.meta.url), 'utf8'));

const joined = (key: NodeKey): string => nodeLabelParts(key).map((part) => part.text).join('');
const words = (key: NodeKey): string[] => nodeLabelParts(key).map(partWord);

const HAND_BUILT: Record<string, NodeKey> = {
  rfi: nodeKey('UTG', { action_sequence: [step('UTG', 'raise', { size_bb: 2.5 })] }),
  isoAfterLimp: nodeKey('BTN', { action_sequence: [step('HJ', 'limp'), step('BTN', 'raise')] }),
  threeBet: nodeKey('BTN', { action_sequence: [step('UTG', 'raise'), step('BTN', 'raise')] }),
  fourBet: nodeKey('CO', { action_sequence: [step('CO', 'raise'), step('BTN', 'raise', { size_bb: 8 }), step('CO', 'raise')] }),
  fiveBet: nodeKey('BTN', { action_sequence: [step('CO', 'raise'), step('BTN', 'raise'), step('CO', 'raise', { size_bb: 22 }), step('BTN', 'raise')] }),
  sixBet: nodeKey('CO', { action_sequence: [step('CO', 'raise'), step('BTN', 'raise'), step('CO', 'raise'), step('BTN', 'allin', { size_bb: 100 }), step('CO', 'raise')] }),
  callVsSizedRaise: nodeKey('BB', { eff_stack_bb: 40, stake: 'NL5', villain_position: 'CO', action_sequence: [step('CO', 'raise', { size_bb: 2.5 }), step('BB', 'call')] }),
  foldersSkipped: nodeKey('BB', { action_sequence: [step('UTG', 'fold'), step('CO', 'raise', { size_bb: 2.5 }), step('BTN', 'fold'), step('BB', 'call')] }),
  postflopBetPct: nodeKey('BB', { street: 'flop', villain_position: 'CO', action_sequence: [step('BB', 'check'), step('CO', 'bet', { size_pct: 0.33 }), step('BB', 'raise', { size_pct: 3 })] }),
  turnUnsized: nodeKey('BTN', { street: 'turn', stake: 'T22KO', action_sequence: [step('BB', 'check'), step('BTN', 'bet', { size_pct: 0.75 })] }),
  shove: nodeKey('BB', { action_sequence: [step('SB', 'raise', { size_bb: 3 }), step('BB', 'allin')] }),
  toActVsVillain: nodeKey('BB', { villain_position: 'CO', action_sequence: [step('CO', 'raise')] }),
  toActAlone: nodeKey('UTG'),
  seatPrefix: nodeKey('UTG1', { table_size: 9, action_sequence: [step('UTG', 'raise', { size_bb: 3 }), step('UTG1', 'raise')] }),
  stakeLooksLikeShorthand: nodeKey('SB', { stake: 'a · b vs c', action_sequence: [step('SB', 'limp')] }),
};

describe('nodeLabelParts', () => {
  it.each(FIXTURE.valid.map((c) => [c.name, c] as const))('%s joins back into the fixture label', (_name, c) => {
    const key = parseNodeKey(c.input);
    expect(joined(key)).toBe(c.label);
  });

  it.each(Object.entries(HAND_BUILT))('%s joins back into nodeKeyLabel exactly', (_name, key) => {
    expect(joined(key)).toBe(nodeKeyLabel(key));
  });

  it('joins back for every action on every street, with and without a stake', () => {
    for (const street of STREETS as readonly Street[]) {
      for (const action of NODE_ACTIONS as readonly NodeAction[]) {
        for (const stake of ['', 'NL10']) {
          const key = nodeKey('BTN', { street, stake, action_sequence: [step('CO', 'raise', { size_bb: 2.5, size_pct: 0.5 }), step('BTN', action)] });
          expect(joined(key), `${street} ${action} ${stake}`).toBe(nodeKeyLabel(key));
        }
      }
    }
  });

  it('cuts the label into the words a player reads', () => {
    expect(words(HAND_BUILT.callVsSizedRaise!)).toEqual(['BB', 'call', 'vs', 'CO', '2.5bb', '40bb', 'NL5']);
    expect(words(HAND_BUILT.postflopBetPct!)).toEqual(['BB', 'raise', 'vs', 'CO', '33%', 'flop', '100bb']);
    expect(words(HAND_BUILT.toActAlone!)).toEqual(['UTG', 'to act', '100bb']);
    expect(words(HAND_BUILT.stakeLooksLikeShorthand!)).toEqual(['SB', 'limp', '100bb', 'a · b vs c']);
  });

  it('explains each word with its own row', () => {
    const entries = (key: NodeKey) => nodeLabelParts(key).map((part) => part.entry);
    expect(entries(HAND_BUILT.callVsSizedRaise!)).toEqual([POSITION_WORDS.BB, NODE_WORDS.call, NODE_WORDS.vs, POSITION_WORDS.CO, NODE_WORDS.raiseTo, NODE_WORDS.stack, NODE_WORDS.stake]);
    expect(entries(HAND_BUILT.postflopBetPct!)).toContain(NODE_WORDS.betPct);
    expect(entries(HAND_BUILT.postflopBetPct!)).toContain(NODE_WORDS.street);
    expect(entries(HAND_BUILT.rfi!)[1]).toBe(NODE_WORDS.rfi);
    expect(entries(HAND_BUILT.isoAfterLimp!)[1]).toBe(NODE_WORDS.iso);
    expect(entries(HAND_BUILT.threeBet!)[1]).toBe(NODE_WORDS.threeBet);
    expect(entries(HAND_BUILT.fourBet!)[1]).toBe(NODE_WORDS.fourBet);
    expect(entries(HAND_BUILT.fiveBet!)[1]).toBe(NODE_WORDS.fiveBet);
    expect(words(HAND_BUILT.sixBet!)[1]).toBe('6-bet');
    expect(entries(HAND_BUILT.sixBet!)[1]).toBe(NODE_WORDS.moreBets);
    expect(entries(HAND_BUILT.shove!)[1]).toBe(NODE_WORDS.allin);
    expect(entries(HAND_BUILT.toActVsVillain!)[1]).toBe(NODE_WORDS.toAct);
    expect(entries(HAND_BUILT.seatPrefix!).slice(0, 4)).toEqual([POSITION_WORDS.UTG1, NODE_WORDS.threeBet, NODE_WORDS.vs, POSITION_WORDS.UTG]);
  });

  it('prints no villain piece when there is nobody to be up against', () => {
    expect(nodeLabelParts(HAND_BUILT.rfi!).map((part) => part.entry)).not.toContain(NODE_WORDS.vs);
    expect(nodeLabelParts(HAND_BUILT.toActAlone!).map((part) => part.entry)).not.toContain(NODE_WORDS.stake);
  });
});

describe('the lookups the components use', () => {
  it('has no row for a band or a key it does not know, rather than a wrong one', () => {
    expect(groupWord('equity', '2')).toBeNull();
    expect(groupWord('nut', 'nut')).toBeNull();
    expect(groupWord('structure', 'pair')).toBeNull();
    expect(groupWord('made', 'flush_draw')).toBeNull();
    expect(groupWord('made', 'top_pair')).toBe(MADE_HAND_WORDS.top_pair);
    expect(groupWord('strategic', 'bluff_catcher')).toBe(CATEGORY_WORDS.bluff_catcher);
  });

  it('tells a seat from the registry’s other position values', () => {
    expect(isPosition('UNKNOWN')).toBe(false);
    expect(isPosition('')).toBe(false);
    expect(isPosition('LJ')).toBe(false);
    expect(isPosition('UTG2')).toBe(true);
  });

  it('keeps the distribution axis names the panel has always shown', () => {
    expect(Object.values(AXIS_WORDS).map((entry) => entry.term)).toEqual(['Made hand', 'Draw', 'Category', 'Equity bucket', 'Structure', 'Nut bucket']);
  });
});
