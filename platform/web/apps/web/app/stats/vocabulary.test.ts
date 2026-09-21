import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { BucketRange, Category, DimType, Dimension, Grain, Stat, StatFormat, StatMeta, Table } from './api';
import { APP_TERMS, bucketWords, categoryWords, dimensionEntry, grainWords, statEntry, tableWords, valueWords } from './vocabulary';

/**
 * A tip shows the registry's own words, so the registry is what this suite reads:
 * `stats/registry/*.yaml`, the same contract `families.test.ts` parses and the same one
 * `/v1/definitions` serves. Hand-written copies of the descriptions would go on passing the day
 * the registry rewords one — and a description that quietly stopped reaching the screen is
 * exactly what this file exists to catch.
 */
const REGISTRY = new URL('../../../../../stats/registry/', import.meta.url);
const DIMENSIONS = readFileSync(new URL('dimensions.yaml', REGISTRY), 'utf8');
const STATS = ['money', 'postflop', 'preflop', 'showdown']
  .map((file) => readFileSync(new URL(`stats/${file}.yaml`, REGISTRY), 'utf8'))
  .join('\n');

/** One `- code: x` entry, up to the next one. Nested keys are indented, so they come with it. */
function block(yaml: string, code: string): string {
  const start = yaml.search(new RegExp(`^- code: ${code}$`, 'm'));
  if (start < 0) throw new Error(`the registry has no entry for ${code}`);
  const rest = yaml.slice(start + 1);
  const end = rest.search(/^- code: /m);
  return end < 0 ? rest : rest.slice(0, end);
}

/** One top-level key of an entry. YAML's folded `>-` form is joined back into its sentence. */
function field(entry: string, name: string, fallback?: string): string {
  const match = new RegExp(`^ {2}${name}: (.*)$`, 'm').exec(entry);
  if (match === null) {
    if (fallback === undefined) throw new Error(`the registry entry has no ${name}`);
    return fallback;
  }
  if (match[1] !== '>-') return match[1]!.trim();
  const folded: string[] = [];
  for (const line of entry.slice(match.index + match[0].length).split('\n').slice(1)) {
    if (!/^ {4}\S/.test(line)) break;
    folded.push(line.trim());
  }
  return folded.join(' ');
}

/** `[decisions, player_hands]` and `['', pair, suited]` — a YAML flow list on one line. */
function list(flow: string): string[] {
  const inside = flow.slice(1, -1).trim();
  if (inside === '') return [];
  return inside.split(',').map((item) => item.trim().replace(/^'(.*)'$/, '$1'));
}

const bound = (text: string): number | null => (text.trim() === 'null' ? null : Number(text));

/** `{small: [0, 0.37], overbet: [1.10, null]}` — a flow mapping, which JSON cannot parse. */
function bucketsOf(entry: string): Record<string, BucketRange> {
  const flow = field(entry, 'buckets', '');
  const buckets: Record<string, BucketRange> = {};
  for (const [, name, low, high] of flow.matchAll(/'?([\w.+-]+)'?: \[([^,]+), ([^\]]+)\]/g)) {
    buckets[name!] = [bound(low!), bound(high!)];
  }
  return buckets;
}

/** A stat as `/v1/definitions` serves it, with the server's own defaults for what YAML omits. */
function registryStat(code: string): Stat {
  const entry = block(STATS, code);
  const typical = field(entry, 'typical', '');
  return {
    code,
    label: field(entry, 'label'),
    category: field(entry, 'category') as Category,
    grain: field(entry, 'grain') as Grain,
    format: field(entry, 'format', 'percent') as StatFormat,
    description: field(entry, 'description'),
    typical: typical === '' ? null : (JSON.parse(typical) as [number, number]),
    cached: field(entry, 'cached', 'false') === 'true',
  };
}

function registryDim(code: string): Dimension {
  const entry = block(DIMENSIONS, code);
  return {
    code,
    label: field(entry, 'label'),
    type: field(entry, 'type') as DimType,
    tables: list(field(entry, 'tables')) as Table[],
    description: field(entry, 'description'),
    values: list(field(entry, 'values', '[]')),
    ops: null,
    group_by: true,
    buckets: bucketsOf(entry),
    allowed_ops: [],
  };
}

const VPIP = registryStat('vpip');
const BB100 = registryStat('bb_per_100');
const EV100 = registryStat('ev_bb_per_100');
const HANDS = registryStat('hands');
const CBET = registryStat('cbet_flop');
const SIZE = registryDim('size_pct');
const STACK = registryDim('stack_bb');
const POT_TYPE = registryDim('pot_type');
const POSITION = registryDim('position');
const PLAYER = registryDim('player_key');
const SHAPE = registryDim('hand_shape');

/** A report column: the registry's stat stripped to the five fields a result carries. */
const COLUMN: StatMeta = { code: CBET.code, label: CBET.label, format: CBET.format, grain: CBET.grain, description: CBET.description! };

describe('the registry these words come from', () => {
  it('parses, so nothing below is asserted against an empty file', () => {
    expect(VPIP.description).toBe('Voluntarily put money in the pot preflop, per hand dealt in (blind posts excluded).');
    expect(VPIP.typical).toEqual([18, 28]);
    expect(VPIP.cached).toBe(true);
    expect(Object.keys(SIZE.buckets)).toEqual(['small', 'mid', 'large', 'pot', 'overbet']);
    expect(POT_TYPE.values).toContain('5bet_plus');
    expect(PLAYER.type).toBe('string');
    expect(PLAYER.description).toContain("The seat's screen name as the site shows it");
  });
});

describe('statEntry — the stats a server does not serve', () => {
  it('reads as words when the registry has never heard of the code', () => {
    const entry = statEntry(undefined, 'vpip_v3', 'VPIP v3');
    expect(entry).toEqual({ term: 'VPIP v3', definition: 'This stat is not in the registry this server serves.' });
    expect(entry.definition).not.toContain('undefined');
  });

  it('falls back to the code itself when the screen has no label either', () => {
    expect(statEntry(undefined, 'vpip_v3').term).toBe('vpip_v3');
  });

  it('uses the label the screen already has when the registry serves an empty one', () => {
    expect(statEntry({ ...VPIP, label: '' }, 'vpip', 'VPIP').term).toBe('VPIP');
    expect(statEntry({ ...VPIP, label: '' }, 'vpip').term).toBe('vpip');
  });

  it('says the stat is undescribed rather than showing an empty tip', () => {
    expect(statEntry({ ...HANDS, description: undefined }, 'hands').definition).toBe('The registry names this stat but does not describe it.');
  });
});

describe('statEntry — what a known stat says', () => {
  it('writes a percentage band with no space before the unit', () => {
    expect(statEntry(VPIP, 'vpip').definition).toBe(`${VPIP.description} Usually 18–28%.`);
  });

  it('writes a per-100 band with one, because "0–10bb/100" is not how it is read', () => {
    expect(BB100.description).toBe('Big blinds won per 100 hands.');
    expect(statEntry(BB100, 'bb_per_100').definition).toBe(`${BB100.description} Usually 0–10 bb/100.`);
  });

  it('calls the registry’s EV what it is — the all-in adjusted result, not a solver’s', () => {
    const entry = statEntry(EV100, 'ev_bb_per_100');
    expect(entry.term).toBe('EV bb/100');
    expect(entry.definition).toBe('All-in adjusted big blinds won per 100 hands. Usually 0–10 bb/100.');
  });

  it('leaves a stat with no typical band at its sentence, with no dangling "Usually"', () => {
    expect(statEntry(HANDS, 'hands').definition).toBe('Hands dealt in.');
  });

  it('says where the number is counted, and whether it is cheap to ask for', () => {
    expect(statEntry(VPIP, 'vpip').formula).toBe('Counted once per hand, and answered from the daily statistics, so it is cheap.');
  });

  it('claims nothing about cost for a report column, which carries no such field', () => {
    expect(statEntry(COLUMN, COLUMN.code).formula).toBe('Counted once per decision.');
    expect(statEntry(COLUMN, COLUMN.code).definition).toBe('Bet the flop as the preflop aggressor when checked to or first to act.');
  });
});

describe('dimensionEntry', () => {
  it('reads as words for a column this server no longer serves', () => {
    const entry = dimensionEntry(undefined, 'seat_count');
    expect(entry).toEqual({ term: 'seat_count', definition: 'This column is not in the registry this server serves.' });
  });

  it('gives the registry sentence and says where the column is held', () => {
    expect(dimensionEntry(POSITION, 'position')).toEqual({
      term: 'Position',
      definition: 'The seat relative to the button.',
      formula: 'Held on decisions, hands and the daily statistics.',
    });
  });

  it('joins two tables with "and", in the words the screen uses for them', () => {
    expect(dimensionEntry(POT_TYPE, 'pot_type').formula).toBe('Held on decisions and hands.');
    expect(tableWords(['decisions', 'player_hands'])).toBe('decisions and hands');
    expect(tableWords(['player_hands'])).toBe('hands');
    expect(tableWords([])).toBe('');
  });

  it('says the column is undescribed rather than leaving the tip blank', () => {
    expect(dimensionEntry({ ...POSITION, description: '' }, 'position').definition).toBe('The registry names this column but does not describe it.');
  });
});

describe('valueWords', () => {
  it('writes the empty value out, because nothing on screen reads as nothing', () => {
    expect(valueWords(SHAPE, '')).toBe('not applicable');
  });

  it('has a dash for a missing value and groups the digits of a number', () => {
    expect(valueWords(POSITION, null)).toBe('—');
    expect(valueWords(STACK, 12345)).toBe('12,345');
  });

  it('writes 5bet_plus the way a player does', () => {
    expect(valueWords(POT_TYPE, '5bet_plus')).toBe('5bet+');
  });

  /** The reason the enum guard exists: a pool player is a name, and names contain anything. */
  it('leaves a player named sun_plus_moon alone', () => {
    expect(valueWords(PLAYER, 'sun_plus_moon')).toBe('sun_plus_moon');
  });

  /**
   * Names contain anything, including the keys every object already answers to. `'constructor' in
   * {}` is true, so asking `in` handed `bucketWords` the `Object` function and the destructuring
   * inside `boundWords` threw — one opponent with that screen name took down the whole grid.
   */
  it('does not mistake an Object.prototype key for a bucket of this dimension', () => {
    expect(valueWords(PLAYER, 'constructor')).toBe('constructor');
    expect(valueWords(PLAYER, '__proto__')).toBe('__proto__');
    expect(valueWords(SIZE, 'hasOwnProperty')).toBe('hasOwnProperty');
  });

  it('leaves a value alone when the dimension is unknown, rather than guessing at it', () => {
    expect(valueWords(undefined, '5bet_plus')).toBe('5bet_plus');
    expect(valueWords(POSITION, 'BTN')).toBe('BTN');
  });

  it('sends a bucket through the bucket words', () => {
    expect(valueWords(SIZE, 'small')).toBe('small (under 0.37 of the pot)');
  });
});

describe('bucketWords', () => {
  it('puts the numbers behind all five bet sizes, in the unit the label names', () => {
    const named = Object.keys(SIZE.buckets).map((name) => bucketWords(SIZE, name));
    expect(named).toEqual([
      'small (under 0.37 of the pot)',
      'mid (0.37–0.6 of the pot)',
      'large (0.6–0.85 of the pot)',
      'pot (0.85–1.1 of the pot)',
      'overbet (1.1 of the pot and up)',
    ]);
  });

  it('says a bucket that is already named after its range once, not twice', () => {
    expect(bucketWords(STACK, '75-125')).toBe('75–125');
    expect(bucketWords(STACK, '200+')).toBe('200+');
  });

  it('keeps the name when the dimension has no such bucket', () => {
    expect(bucketWords(SIZE, 'huge')).toBe('huge');
    expect(bucketWords(SIZE, 'constructor')).toBe('constructor');
    expect(bucketWords(SIZE, 'toString')).toBe('toString');
  });
});

describe('the words that are ours, not the registry’s', () => {
  it('reads the four categories as headings rather than as codes', () => {
    expect(categoryWords(VPIP.category)).toBe('Preflop');
    expect(categoryWords(CBET.category)).toBe('Postflop');
    expect(categoryWords('money')).toBe('Money');
  });

  it('says grain without saying "grain"', () => {
    expect(grainWords('hand')).toBe('counted once per hand');
    expect(grainWords('decision')).toBe('counted once per decision');
  });

  it('gives every app word a term and one finished sentence', () => {
    for (const [key, entry] of Object.entries(APP_TERMS)) {
      expect(entry.term, key).not.toBe('');
      expect(entry.definition.endsWith('.'), key).toBe(true);
    }
    expect(APP_TERMS.field.term).toBe('the field');
    expect(APP_TERMS.sample.term).toBe('n');
  });

  /**
   * The one app word that can be wrong about the number beside it. Every hero comparison is
   * `compare_to: 'population'` — `PopulationBaseline`, "every seat of the population dataset" —
   * so the field is what was uploaded as Pool hands, not the opponents inside a My-hands file.
   * Someone who has uploaded only their own hands has an empty field; the tip must not promise
   * otherwise.
   */
  it('defines the field as the tables uploaded as Pool hands, which is what the baseline reads', () => {
    expect(APP_TERMS.field.definition).toBe('Every seat at the tables you uploaded as Pool hands, asked the same question over the same dates.');
    expect(APP_TERMS.field.definition).not.toMatch(/everyone else/i);
  });
});
