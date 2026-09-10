import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { NodeKey } from '../src/node';
import { NodeKeyError, POSITIONS, canonicalNodeKey, nodeKey, nodeKeyEquals, nodeKeyJson, nodeKeyLabel, parseNodeKey, step } from '../src/node';

interface Fixture {
  positions: string[];
  valid: { name: string; label: string; input: unknown; canonical: Record<string, unknown> }[];
  invalid: { reason: string; input: unknown }[];
}

/** The fixture the Python suite parses too (ADR-028): tests/fixtures/nodes.json. */
const FIXTURE: Fixture = JSON.parse(readFileSync(new URL('../../../../tests/fixtures/nodes.json', import.meta.url), 'utf8'));

describe('NodeKey against the shared fixture', () => {
  it('lists the same positions as the Python definition', () => {
    expect(FIXTURE.positions).toEqual([...POSITIONS]);
  });

  it.each(FIXTURE.valid.map((c) => [c.name, c] as const))('%s validates to its canonical form', (_name, c) => {
    const key = parseNodeKey(c.input);
    expect(nodeKeyJson(key)).toEqual(c.canonical);
    expect(nodeKeyJson(parseNodeKey(c.canonical))).toEqual(c.canonical);
    expect(nodeKeyLabel(key)).toBe(c.label);
  });

  it.each(FIXTURE.invalid.map((c) => [c.reason, c] as const))('rejects %s', (_reason, c) => {
    expect(() => parseNodeKey(c.input)).toThrow(NodeKeyError);
  });
});

describe('NodeKey helpers', () => {
  it('names the failing field', () => {
    expect(() => parseNodeKey({ hero_position: 'UTG', action_sequence: [{ position: 'UTG', action: 'raise', size_bb: -2 }] })).toThrow('node.action_sequence[0].size_bb: must be a positive number');
    expect(() => parseNodeKey({ hero_position: 'UTG', heroPosition: 'UTG' })).toThrow('node.heroPosition: unknown field');
    expect(() => parseNodeKey({ hero_position: 'LJ' }, 'ranges[2].node_key')).toThrow('ranges[2].node_key.hero_position: must be one of UTG, UTG1');
  });

  it('compares situations by value, whatever the key order or spelling of the defaults', () => {
    const a: NodeKey = nodeKey('CO', { action_sequence: [step('CO', 'raise', { size_bb: 2.5 })] });
    const b = parseNodeKey({ action_sequence: [{ action: 'raise', position: 'CO', size_bb: 2.5 }], hero_position: 'CO', eff_stack_bb: 100 });
    expect(nodeKeyEquals(a, b)).toBe(true);
    expect(canonicalNodeKey(a)).toBe(canonicalNodeKey(b));
    expect(nodeKeyEquals(a, nodeKey('CO', { eff_stack_bb: 40, action_sequence: a.action_sequence }))).toBe(false);
  });

  it('labels the common preflop shapes', () => {
    expect(nodeKeyLabel(nodeKey('BTN', { action_sequence: [step('UTG', 'raise'), step('BTN', 'raise')] }))).toBe('BTN 3-bet vs UTG · 100bb');
    expect(nodeKeyLabel(nodeKey('CO', { action_sequence: [step('CO', 'raise'), step('BTN', 'raise', { size_bb: 8 }), step('CO', 'raise')] }))).toBe('CO 4-bet vs BTN 8bb · 100bb');
    expect(nodeKeyLabel(nodeKey('BTN', { action_sequence: [step('HJ', 'limp'), step('BTN', 'raise')] }))).toBe('BTN iso vs HJ · 100bb');
    expect(nodeKeyLabel(nodeKey('BB', { action_sequence: [step('SB', 'raise', { size_bb: 3 }), step('BB', 'allin')] }))).toBe('BB shove vs SB 3bb · 100bb');
    expect(nodeKeyLabel(nodeKey('BB', { villain_position: 'CO', action_sequence: [step('CO', 'raise')] }))).toBe('BB to act vs CO · 100bb');
    expect(nodeKeyLabel(nodeKey('UTG'))).toBe('UTG to act · 100bb');
  });
});
