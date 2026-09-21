/**
 * The registry in words a reader can use (ADR-057).
 *
 * The app has two vocabularies. One is `@poker/ui`'s `GLOSSARY`: hand-written, static, about
 * poker itself. The other is this one — 65 stats and 80 dimensions that arrive from
 * `GET /v1/definitions` at runtime, each with a one-line `description` written next to the SQL it
 * compiles to. Copying the second into the first would put words a server serves into a file that
 * ships a week later, so registry text reaches the screen through this module and
 * `components/reports/RegistryTerm.vue`, and nowhere else.
 *
 * What a tip says is deliberately short: the registry's own sentence, the band the stat usually
 * falls in, and where the number is counted. What it does **not** say is `notes` — 42 of the 65
 * stats carry one and 40 of those are v1-parity arithmetic written for whoever ported the stat.
 * Those stay in `DefinitionPanel`'s "Caveat" line, which is where someone asking what a number
 * counts is already reading. A tip is one sentence and a band.
 *
 * Everything here is pure text from registry data, so the wording is tested as text rather than
 * through a rendered component.
 */

import type { BucketRange, Category, Dimension, Grain, Stat, StatFormat, StatMeta } from './api';

/** What a tip shows: the word, one sentence, and where the number comes from. */
export interface TermEntry {
  readonly term: string;
  readonly definition: string;
  readonly formula?: string;
}

const DASH = '—';

/**
 * The grouping locale, stated rather than inherited, for the same reason `reports/cell.ts` states
 * it: `toLocaleString()` with no argument follows the browser, so a test would assert a rendering
 * the founder never sees.
 */
const LOCALE = 'en-US';

/** The unit a typical band is read in. The space before `bb/100` is part of the unit. */
const UNITS: Record<string, string> = { percent: '%', per100: ' bb/100', ratio: '', count: '' };

/** What each fact table holds, said as the screen says it rather than as the table is named. */
const TABLE_WORDS: Record<string, string> = {
  player_hands: 'hands',
  decisions: 'decisions',
  stats_daily: 'the daily statistics',
};

const GRAIN_WORDS: Record<string, string> = {
  hand: 'counted once per hand',
  decision: 'counted once per decision',
};

const CATEGORY_WORDS: Record<string, string> = {
  preflop: 'Preflop',
  postflop: 'Postflop',
  showdown: 'Showdown',
  money: 'Money',
};

/** What the registry serves for a stat it names but never described. */
const NO_STAT_SENTENCE = 'The registry names this stat but does not describe it.';
const NO_DIMENSION_SENTENCE = 'The registry names this column but does not describe it.';

/**
 * The category words a stat list groups by. `reports/columns.ts` reads them from here so that the
 * picker's headings and a tip cannot drift into two spellings of the same four words.
 */
export function categoryWords(category: Category): string {
  return CATEGORY_WORDS[category] ?? category;
}

/** Whether a number is one per hand or one per decision — the distinction that rules stats out. */
export function grainWords(grain: Grain): string {
  return GRAIN_WORDS[grain] ?? grain;
}

/**
 * Where a column is held, in the words the screen uses. The raw table names are the engine's
 * (`decisions`, `player_hands`, `stats_daily`) and mean nothing to whoever is reading a report.
 */
export function tableWords(tables: readonly string[]): string {
  const words = [...new Set(tables.map((table) => TABLE_WORDS[table] ?? table))];
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]!}`;
}

/**
 * The words a bucket bound is read in, taken from the dimension's own label: F.12a relabelled the
 * two size columns "(fraction of pot)", and 0.37 with no unit beside it reads as a number of big
 * blinds to anyone who has met a pot-size bet.
 */
function unitWords(dim: Dimension): string {
  if (/fraction of pot/i.test(dim.label)) return 'of the pot';
  if (/\(bb\)/i.test(dim.label)) return 'bb';
  return '';
}

/** `[0, 0.37]` → "under 0.37 of the pot"; `[1.10, null]` → "1.10 of the pot and up". */
function boundWords([low, high]: BucketRange, unit: string): string {
  const tail = unit === '' ? '' : ` ${unit}`;
  if (high === null) return low === null ? '' : `${low}${tail} and up`;
  if (low === null || low === 0) return `under ${high}${tail}`;
  return `${low}–${high}${tail}`;
}

/** A bucket whose name is already its range: `75-125` → `75–125`, `200+` unchanged. */
function rangeName(name: string): string {
  return name.replace(/^(\d[\d.]*)-(\d[\d.]*)$/, '$1–$2');
}

/**
 * A presentation bucket in words: `small (under 0.37 of the pot)`.
 *
 * The bounds are in the client already and never reached a screen, which is why `small` and `mid`
 * on a bet-size column were unreadable — the registry's five names are only meaningful once the
 * numbers behind them are shown. A bucket named after its own range keeps that name, because
 * `0–40 (under 40 bb)` says the same thing twice.
 */
export function bucketWords(dim: Dimension, name: string): string {
  const readable = rangeName(name);
  // Own properties only: `buckets` is parsed from the server's JSON, so a value that happens to
  // be spelled `constructor` or `toString` would otherwise read a function off the prototype and
  // throw when `boundWords` destructures it — and a bucket name is a screen name half the time.
  const range = Object.hasOwn(dim.buckets, name) ? dim.buckets[name] : undefined;
  if (range === undefined || /^\d/.test(name)) return readable;
  const bounds = boundWords(range, unitWords(dim));
  return bounds === '' ? readable : `${readable} (${bounds})`;
}

/**
 * One value of a grouped or filtered column, as it reads.
 *
 * Two registry conventions need translating, and **only for an enum**: `5bet_plus` is written
 * `5bet+`, and `''` — "not applicable / unknown" on nine dimensions — is written out rather than
 * rendered as nothing. The enum guard is the point: `filter/label.ts#valueLabel` runs on every
 * type, so a pool player named `a_plus_b` currently reads `a+b`. A bucket name goes through
 * `bucketWords`; anything else, an action line included, is the caller's own business and comes
 * back untouched. "Is it a bucket" asks the object itself, never the prototype behind it: a pool
 * player may be called `constructor`, and `'constructor' in {}` is true.
 */
export function valueWords(dim: Dimension | undefined, value: string | number | null): string {
  if (value === null) return DASH;
  if (typeof value === 'number') return value.toLocaleString(LOCALE);
  if (value === '') return 'not applicable';
  if (dim === undefined) return value;
  if (Object.hasOwn(dim.buckets, value)) return bucketWords(dim, value);
  return dim.type === 'enum' ? value.replace('_plus', '+') : value;
}

/** `Usually 18–28%.` · `Usually 0–10 bb/100.` — the band as a sentence, never as a gate. */
function typicalWords(band: readonly [number, number], format: StatFormat): string {
  return `Usually ${band[0]}–${band[1]}${UNITS[format] ?? ''}.`;
}

/** Where the number comes from: its grain, and whether the daily statistics already hold it. */
function countedWords(stat: Stat | StatMeta): string {
  const grain = grainWords(stat.grain);
  const cached = 'cached' in stat && stat.cached === true;
  const line = cached ? `${grain}, and answered from the daily statistics, so it is cheap` : grain;
  return `${line.charAt(0).toUpperCase()}${line.slice(1)}.`;
}

/**
 * What a stat's tip says. `code` and `label` are what the screen already has — a leak row and a
 * report column both carry a label the server sent — so a stat this server's registry does not
 * serve still reads as the word it is, and says plainly that it is unknown rather than rendering
 * `undefined` or throwing inside a table cell.
 */
export function statEntry(stat: Stat | StatMeta | undefined, code: string, label?: string): TermEntry {
  if (stat === undefined) {
    return { term: label ?? code, definition: 'This stat is not in the registry this server serves.' };
  }
  const typical = 'typical' in stat ? stat.typical : null;
  const parts = [stat.description ?? '', typical ? typicalWords(typical, stat.format) : ''];
  const definition = parts.filter((part) => part !== '').join(' ');
  return {
    term: stat.label === '' ? (label ?? code) : stat.label,
    definition: definition === '' ? NO_STAT_SENTENCE : definition,
    formula: countedWords(stat),
  };
}

/**
 * What a column's tip says. A dimension the server no longer serves still reads — a saved report
 * or a pasted link can name one — so the tip explains the absence instead of leaving a bare code.
 */
export function dimensionEntry(dim: Dimension | undefined, code: string): TermEntry {
  if (dim === undefined) {
    return { term: code, definition: 'This column is not in the registry this server serves.' };
  }
  const entry: TermEntry = {
    term: dim.label === '' ? code : dim.label,
    definition: dim.description === '' ? NO_DIMENSION_SENTENCE : dim.description,
  };
  const held = tableWords(dim.tables);
  return held === '' ? entry : { ...entry, formula: `Held on ${held}.` };
}

/**
 * The words that are ours rather than the registry's.
 *
 * Seven of them, and they carry as much weight as any stat: "the field" is the comparison every
 * hero screen is built on, and "thin" is the difference between a number worth reading and a
 * number worth ignoring. They use the same component as a registry word, so the affordance is one
 * affordance. Poker's own vocabulary — tiers, hand classes, positions, the node shorthand — is
 * `@poker/ui`'s `GLOSSARY` (ADR-056) and is deliberately not repeated here.
 */
export const APP_TERMS: Record<'field' | 'sample' | 'thin' | 'gap' | 'spots' | 'grain' | 'cached', TermEntry> = {
  field: {
    term: 'the field',
    // Not "everyone else in the hands you have uploaded": the baseline is the population dataset
    // (`PopulationBaseline`, `pool/stats.ts` sends `dataset: 'population', hero_only: false`), and
    // the opponents sitting in a My-hands file never enter it. Someone who has only uploaded their
    // own hands has an empty field, and the old sentence promised them the opposite.
    definition: 'Every seat at the tables you uploaded as Pool hands, asked the same question over the same dates.',
  },
  sample: {
    term: 'n',
    definition: 'How many times this number was actually measured.',
    formula: 'A row of 2,219 hands can hold a cell of n = 3: a stat counts only the spots its own situation came up in.',
  },
  thin: {
    term: 'thin',
    definition: 'Measured too few times to compare. The number is still shown, but its difference from the field is withheld.',
  },
  gap: {
    term: 'gap',
    definition: 'How far your number sits from the field’s, in percentage points.',
  },
  spots: {
    term: 'spots',
    definition: 'How many times the situation came up for you — the sample behind the gap, not the hands behind the report.',
  },
  grain: {
    term: 'grain',
    definition: 'Whether a number is counted once per hand or once per decision. A per-hand stat cannot be split by something only a decision has.',
  },
  cached: {
    term: 'cached',
    definition: 'Answered from the daily statistics rather than from every stored hand, so it comes back quickly.',
  },
};
