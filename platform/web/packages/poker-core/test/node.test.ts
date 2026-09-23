import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { NodeKey } from '../src/node';
import { NodeKeyError, POSITIONS, POT_TYPES, SIZE_BUCKETS, canonicalNodeKey, nodeKey, nodeKeyEquals, nodeKeyJson, nodeKeyLabel, ownLine, parseNodeKey, sizeBucketOf, step } from '../src/node';

interface Fixture {
  positions: string[];
  pot_types: string[];
  size_buckets: string[];
  valid: { name: string; label: string; input: unknown; canonical: Record<string, unknown> }[];
  invalid: { reason: string; input: unknown }[];
}

/** The fixture the Python suite parses too (ADR-028): tests/fixtures/nodes.json. */
const FIXTURE: Fixture = JSON.parse(readFileSync(new URL('../../../../tests/fixtures/nodes.json', import.meta.url), 'utf8'));

/** Typed the way `Dimension.buckets` arrives from `/v1/definitions`; the boundaries are the registry's, quoted here as data. */
const REGISTRY_BUCKETS: Record<string, [number | null, number | null]> = { small: [0, 0.37], mid: [0.37, 0.6], large: [0.6, 0.85], pot: [0.85, 1.1], overbet: [1.1, null] };

describe('NodeKey against the shared fixture', () => {
  it('lists the same positions as the Python definition', () => {
    expect(FIXTURE.positions).toEqual([...POSITIONS]);
  });

  it('lists the same pot types and size buckets as the Python definition (ADR-078)', () => {
    expect(FIXTURE.pot_types).toEqual([...POT_TYPES]);
    expect(FIXTURE.size_buckets).toEqual([...SIZE_BUCKETS]);
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

  it('spells hero\'s own steps in the registry alphabet, an all-in as a raise', () => {
    expect(ownLine([step('CO', 'raise'), step('BTN', 'raise'), step('CO', 'allin')], 'CO')).toBe('r-r');
    expect(ownLine([step('BB', 'check'), step('CO', 'bet'), step('BB', 'call')], 'BB')).toBe('x-c');
    expect(ownLine([step('CO', 'raise')], 'BB')).toBe('');
  });

  it('reads a chart cached before ADR-078 as the same situation as a fresh key', () => {
    const cached = { stake: '', table_size: 6, eff_stack_bb: 100, hero_position: 'UTG', villain_position: null, action_sequence: [step('UTG', 'raise', { size_bb: 2.5 })], street: 'preflop', board_texture: [] };
    // What Dexie hands back from an earlier build: eight fields, and nothing to say the other three exist.
    const stored = cached as unknown as NodeKey;
    expect(nodeKeyEquals(parseNodeKey(cached), stored)).toBe(true);
    expect(canonicalNodeKey(stored)).toBe(canonicalNodeKey(parseNodeKey(cached)));
  });

  it("refuses a line on a preflop key, where the sequence is the whole line, before counting its streets", () => {
    const opened = {
      hero_position: 'CO',
      villain_position: 'BTN',
      line_so_far: 'r',
      action_sequence: [
        { position: 'CO', action: 'raise', size_bb: 2.5 },
        { position: 'BTN', action: 'raise', size_bb: 8 },
        { position: 'CO', action: 'call' },
      ],
    };
    expect(() => parseNodeKey(opened)).toThrow("node.line_so_far: is postflop only: a preflop key's sequence is its whole line");
    expect(() => parseNodeKey({ hero_position: 'CO', line_so_far: '' })).toThrow('node.line_so_far: is postflop only');
  });

  it('refuses a line that reaches the wrong street, naming the field', () => {
    expect(() => parseNodeKey({ hero_position: 'BTN', street: 'river', line_so_far: 'r/b/' })).toThrow("node.line_so_far: 'r/b/' has 3 street(s) but the key is on the river (needs 4)");
    expect(() => parseNodeKey({ hero_position: 'BTN', street: 'flop', line_so_far: 'r/b/b/' }, 'ranges[0].node_key')).toThrow("ranges[0].node_key.line_so_far: 'r/b/b/' has 4 street(s) but the key is on the flop (needs 2)");
  });

  it('refuses a line whose last street contradicts the sequence, naming the field', () => {
    const contradicted = {
      hero_position: 'BB',
      villain_position: 'CO',
      street: 'flop',
      line_so_far: 'c/x',
      action_sequence: [
        { position: 'BB', action: 'bet', size_pct: 0.5 },
        { position: 'CO', action: 'raise', size_pct: 1 },
        { position: 'BB', action: 'call' },
      ],
    };
    expect(() => parseNodeKey(contradicted)).toThrow("node.line_so_far: ends in 'x' but the sequence says hero's line this street is 'b'; a key carries one account of a street");
    expect(() => parseNodeKey({ hero_position: 'BB', street: 'flop', line_so_far: 'c/q' })).toThrow('node.line_so_far: must be letters f/x/l/c/b/r');
  });

  it('refuses a size bucket on a preflop key, naming the field', () => {
    expect(() => parseNodeKey({ hero_position: 'BB', size_bucket: 'small' })).toThrow('node.size_bucket: is a fraction of the pot and postflop only; a preflop size is a raise-to in big blinds on the step (size_bb)');
    expect(parseNodeKey({ hero_position: 'BB', street: 'flop', size_bucket: 'small' }).size_bucket).toBe('small');
  });
});

describe('sizeBucketOf', () => {
  it('names the first bucket whose range holds the size, low inclusive and high exclusive', () => {
    expect(sizeBucketOf(0.2, REGISTRY_BUCKETS)).toBe('small');
    expect(sizeBucketOf(0.37, REGISTRY_BUCKETS)).toBe('mid');
    expect(sizeBucketOf(0.6, REGISTRY_BUCKETS)).toBe('large');
    expect(sizeBucketOf(1, REGISTRY_BUCKETS)).toBe('pot');
  });

  it('reads a null high as open and a null low as zero', () => {
    expect(sizeBucketOf(2.5, REGISTRY_BUCKETS)).toBe('overbet');
    expect(sizeBucketOf(0, { small: [null, 0.37] })).toBe('small');
  });

  it('is nothing below zero, outside every range, or in a bucket the key does not name', () => {
    expect(sizeBucketOf(-0.1, REGISTRY_BUCKETS)).toBeNull();
    expect(sizeBucketOf(0.5, { small: [0, 0.37] })).toBeNull();
    expect(sizeBucketOf(0.5, { huge: [0, null] })).toBeNull();
    expect(sizeBucketOf(0.5, {})).toBeNull();
  });
});
