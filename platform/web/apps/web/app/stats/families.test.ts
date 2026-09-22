import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { CLASSIFIED_CODES, FAMILIES, familyOf, groupByFamily } from './families';
import type { Dimension } from './api';

/**
 * The registry is the column contract (`stats/registry/dimensions.yaml`), and D.3's done-means
 * is that every dimension it declares is reachable from the builder. Read the contract itself
 * rather than a copy of it — the same trick `poker-core/test/node.test.ts` uses to parse the
 * shared `tests/fixtures/nodes.json` (ADR-028). Only the top-level `- code:` entries are
 * dimensions; enum values are indented list items.
 */
const YAML = readFileSync(new URL('../../../../../stats/registry/dimensions.yaml', import.meta.url), 'utf8');
const REGISTRY_CODES = [...YAML.matchAll(/^- code: (\w+)$/gm)].map((match) => match[1]!);

function dim(code: string, over: Partial<Dimension> = {}): Dimension {
  return {
    code,
    label: code,
    type: 'enum',
    tables: ['decisions'],
    description: '',
    values: ['a'],
    value_labels: {},
    ops: null,
    group_by: true,
    buckets: {},
    allowed_ops: ['eq'],
    ...over,
  };
}

describe('the registry itself', () => {
  it('parses', () => {
    // A parse that silently matched nothing would make every assertion below vacuous. The exact
    // count is not asserted here — `tests/test_api_v2.py` pins it server-side, and this suite
    // should fail when a new dimension is *unclassified*, not merely when one is added.
    expect(REGISTRY_CODES.length).toBeGreaterThan(50);
    expect(REGISTRY_CODES).toContain('street');
    expect(new Set(REGISTRY_CODES).size).toBe(REGISTRY_CODES.length);
  });
});

describe('every dimension is reachable from the builder', () => {
  it('classifies every code the registry declares', () => {
    const unclassified = REGISTRY_CODES.filter((code) => familyOf(code) === null);
    expect(unclassified).toEqual([]);
  });

  it('classifies nothing the registry does not declare', () => {
    const stale = CLASSIFIED_CODES.filter((code) => !REGISTRY_CODES.includes(code));
    expect(stale).toEqual([]);
  });

  it('puts each dimension in exactly one family', () => {
    const all = FAMILIES.flatMap((family) => family.codes);
    expect(all.length).toBe(new Set(all).size);
    expect(all.length).toBe(REGISTRY_CODES.length);
  });

  it('gives every family a name and a hint', () => {
    for (const family of FAMILIES) {
      expect(family.name).not.toBe('');
      expect(family.hint).not.toBe('');
      expect(family.codes.length).toBeGreaterThan(0);
    }
  });
});

describe('groupByFamily', () => {
  it('drops families the server did not serve, and keeps family order', () => {
    const groups = groupByFamily([dim('position'), dim('site'), dim('street')]);
    expect(groups.map((g) => g.name)).toEqual(['Table', 'Seat', 'Street']);
    expect(groups[0]!.dimensions.map((d) => d.code)).toEqual(['site']);
  });

  it('orders within a family the way the family lists them, not the way the server did', () => {
    const groups = groupByFamily([dim('stake_level'), dim('site')]);
    expect(groups[0]!.dimensions.map((d) => d.code)).toEqual(['site', 'stake_level']);
  });

  it('surfaces an unclassified dimension under Other rather than hiding it', () => {
    const groups = groupByFamily([dim('site'), dim('brand_new_column')]);
    const other = groups.find((g) => g.name === 'Other');
    expect(other?.dimensions.map((d) => d.code)).toEqual(['brand_new_column']);
  });
});
