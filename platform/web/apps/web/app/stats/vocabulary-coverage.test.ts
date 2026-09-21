import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The guard that keeps ADR-057 enforceable.
 *
 * A registry description on a `title=` attribute is invisible to a keyboard and to a finger: no
 * browser shows one on focus, and none shows one on a tap. F.12c moved those descriptions onto
 * `components/reports/RegistryTerm.vue`, which hovers, focuses, taps and carries
 * `aria-describedby` — and a `:title` is one autocomplete away from coming back. So the screens
 * that were converted are named here, and binding anything that mentions the registry's
 * `description` or a `TermEntry`'s `definition` to their `title` fails this test with the file and
 * the line.
 *
 * The second test is the wider net: any other lane-D screen that does the same must record why
 * below, so a description arriving on a new `title` cannot pass unnoticed either.
 */
const APP = fileURLToPath(new URL('../', import.meta.url));

/** Lane D's screens: eight component folders, and the pages listed one by one (F.12c's contract). */
const FOLDERS = [
  'components/charts',
  'components/filter',
  'components/hands',
  'components/hero',
  'components/pool',
  'components/ranges',
  'components/reports',
  'components/upload',
  'pages/hands',
  'pages/pool',
  'pages/reports',
  'pages/upload',
];
const PAGES = ['pages/index.vue', 'pages/leaks.vue', 'pages/account.vue', 'pages/ranges/index.vue', 'pages/ranges/compare.vue', 'pages/ranges/import.vue'];

/**
 * The screens F.12c converts, from the step's contract rather than from what the files say today:
 * every one of them showed a stat's or a dimension's registry description, or is where one is now
 * shown — the KPI tiles and the leak rows, the sessions headers, the report grid and its two
 * pickers, the three filter surfaces and the cohort rule editor.
 */
const CONVERTED = [
  'components/hero/KpiTile.vue',
  'components/hero/LeakTable.vue',
  'components/hero/SessionTable.vue',
  'components/reports/StatGrid.vue',
  'components/reports/StatPicker.vue',
  'components/reports/GroupByPicker.vue',
  'components/filter/ClauseRow.vue',
  'components/filter/ClauseValue.vue',
  'components/filter/FilterBar.vue',
  'components/filter/SituationBuilder.vue',
  'components/pool/CohortForm.vue',
];

/**
 * Descriptions that are not the registry's, and the reason each may stay on a `title`.
 *
 * Empty today, and that is the point: the three files once listed here (WinningsChart, PresetMenu
 * and the pool page) no longer bind any description to a title — the legend goes through
 * `RegistryTerm` and both preset lists through `PresetButton` — so their reasons excused files
 * where the regression could have come back unseen. The last test below keeps this list honest:
 * an entry that stops describing a real `:title` fails, rather than quietly widening the net.
 */
const NOT_THE_REGISTRY: Record<string, string> = {};

/** A `title` bound to an expression — the only form a description can arrive in. */
const TITLE_BINDING = /(?::|v-bind:)title=(["'])([\s\S]*?)\1/g;

/**
 * The two field names one of these sentences arrives under: `description` is what the registry
 * calls it on the wire, `definition` is what `stats/vocabulary.ts` calls it in a `TermEntry`, and
 * every converted screen now holds the second — `:title="row.term.definition"` is the regression
 * an autocomplete writes. `notes` and `formula` are deliberately not in here: a `CellView.note` on
 * a data cell is a legitimate title that says how a number was counted, not an explanation of a
 * word, and catching it would turn this guard into a ban on `title` itself.
 */
const EXPLAINS = /\b(description|definition)\b/i;

interface Hit {
  readonly file: string;
  readonly line: number;
  readonly expression: string;
}

/**
 * Whether a bound expression puts a term's own sentence on screen. `:title="explain(tile)"` hides
 * one a single call away, so a helper declared in the same file is read too — one level, and only
 * a `function name(…)`, which is how every one of these files declares its helpers.
 */
function mentionsAnExplanation(expression: string, source: string): boolean {
  if (EXPLAINS.test(expression)) return true;
  return [...expression.matchAll(/\b([a-zA-Z_$][\w$]*)\s*\(/g)].some(([, name]) => {
    const body = new RegExp(`^function ${name}\\b[\\s\\S]*?\\n}`, 'm').exec(source);
    return body !== null && EXPLAINS.test(body[0]);
  });
}

/** Every `:title` in one file whose expression reaches a `description` or a `definition`. */
function describedTitles(file: string, source: string): Hit[] {
  const hits: Hit[] = [];
  for (const match of source.matchAll(TITLE_BINDING)) {
    if (!mentionsAnExplanation(match[2]!, source)) continue;
    hits.push({ file, line: source.slice(0, match.index).split('\n').length, expression: match[2]!.trim() });
  }
  return hits;
}

const where = (hit: Hit) => `${hit.file}:${hit.line} — :title="${hit.expression}"`;

function laneFiles(): string[] {
  const walked = FOLDERS.flatMap((folder) =>
    readdirSync(join(APP, folder), { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.vue'))
      .map((file) => `${folder}/${file}`),
  );
  return [...walked, ...PAGES];
}

const OFFENDERS = laneFiles().flatMap((file) => describedTitles(file, readFileSync(join(APP, file), 'utf8')));

describe('the scan itself', () => {
  /* `row.term.definition` is the form the regression takes now that every converted screen holds
     a TermEntry rather than the raw registry row: same sentence, different field name. */
  it('sees a bound title in either spelling, under either field name', () => {
    const source = [
      '<span :title="dim.description">x</span>',
      '<b v-bind:title="`${meta.description} — what it counts`">y</b>',
      '<i :title="row.note">z</i>',
      '<em :title="row.term.definition">w</em>',
    ].join('\n');
    expect(describedTitles('sample.vue', source).map(where)).toEqual([
      'sample.vue:1 — :title="dim.description"',
      'sample.vue:2 — :title="`${meta.description} — what it counts`"',
      'sample.vue:4 — :title="row.term.definition"',
    ]);
  });

  it('follows a title through a helper declared in the same file', () => {
    const source = ['function explain(tile) {', '  return [tile.description, tile.notes].join(" ");', '}', '<h3 :title="explain(props.tile)">VPIP</h3>'].join('\n');
    expect(describedTitles('sample.vue', source).map(where)).toEqual(['sample.vue:4 — :title="explain(props.tile)"']);
    const entry = ['function head(meta) {', '  return statEntry(meta).definition;', '}', '<th :title="head(meta)">VPIP</th>'].join('\n');
    expect(describedTitles('sample.vue', entry).map(where)).toEqual(['sample.vue:4 — :title="head(meta)"']);
    const innocent = ['function note(row) {', '  return row.note;', '}', '<td :title="note(row)">3</td>'].join('\n');
    expect(describedTitles('sample.vue', innocent)).toEqual([]);
  });

  it('reads the whole of lane D, so an empty walk cannot pass for a clean one', () => {
    expect(laneFiles().length).toBeGreaterThan(30);
    expect(laneFiles()).toContain('components/reports/StatGrid.vue');
  });
});

describe('ADR-057: a registry description is not a title', () => {
  it('points only at screens that exist', () => {
    const named = [...CONVERTED, ...Object.keys(NOT_THE_REGISTRY)];
    expect(named.filter((file) => !existsSync(join(APP, file)))).toEqual([]);
  });

  it('finds none on the screens F.12c converted', () => {
    const back = OFFENDERS.filter((hit) => CONVERTED.includes(hit.file)).map(where);
    expect(back, 'a registry description must reach the screen through RegistryTerm, not a title').toEqual([]);
  });

  it('finds none anywhere else in lane D without a reason recorded here', () => {
    const rest = OFFENDERS.filter((hit) => !CONVERTED.includes(hit.file) && NOT_THE_REGISTRY[hit.file] === undefined);
    expect(rest.map(where), 'either use RegistryTerm, or record here whose description this is').toEqual([]);
  });

  /**
   * An excuse outlives the line it excuses. All three original entries had, by the end of the
   * step, stopped binding any description to a title — so each was silently excusing a file the
   * regression could walk back into. A reason is only allowed to exist while the `:title` it
   * describes does.
   */
  it('excuses only files that still bind one', () => {
    const excused = Object.keys(NOT_THE_REGISTRY);
    const stale = excused.filter((file) => !OFFENDERS.some((hit) => hit.file === file));
    expect(stale, 'this file no longer binds a description to a title; drop its entry').toEqual([]);
  });

  /**
   * The other way this guard could go green: the title was deleted and nothing took its place.
   * A converted screen has to get its words from somewhere shared — the term component, or the
   * vocabulary module directly where the words are inline (a bucket bound, a value).
   */
  it('shows that the descriptions moved rather than disappeared', () => {
    const silent = CONVERTED.filter((file) => !/RegistryTerm|stats\/vocabulary/.test(readFileSync(join(APP, file), 'utf8')));
    expect(silent, 'this screen shows neither a RegistryTerm nor a word from stats/vocabulary').toEqual([]);
  });
});
