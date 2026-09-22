import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GLOSSARY, VOCABULARY } from '@poker/ui';
import { describe, expect, it } from 'vitest';

import { exampleById } from '../examples';

import { TOOLS, toolById, toolForPath, toolsByArea } from './index';
import { AREAS } from './types';

const APP = fileURLToPath(new URL('../../', import.meta.url));
const PAGES = join(APP, 'pages');

/**
 * Screens that are deliberately not tools: the component gallery is for developing this app, and
 * the two auth forms are the way in rather than something to use. Anything else added under
 * `app/pages/` fails the first test until it is described.
 */
const NOT_TOOLS = ['/dev/components', '/dev/filter', '/login', '/register'];

/** The route a page file renders: `index.vue` → `/`, `pool/index.vue` → `/pool`, brackets kept. */
function routeOf(file: string): string {
  const path = file.replace(/\.vue$/, '').replace(/(^|\/)index$/, '$1');
  const trimmed = path.replace(/\/$/, '');
  return trimmed === '' ? '/' : `/${trimmed}`;
}

function pageRoutes(): string[] {
  return readdirSync(PAGES, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.vue'))
    .map(routeOf)
    .filter((route) => !NOT_TOOLS.includes(route));
}

function pageFileOf(route: string): string {
  const found = readdirSync(PAGES, { recursive: true, encoding: 'utf8' }).find(
    (file) => file.endsWith('.vue') && routeOf(file) === route,
  );
  if (found === undefined) throw new Error(`no page renders ${route}`);
  return join(PAGES, found);
}

/**
 * The file with its prose taken out. `pages/index.vue` explains in its own doc comment why
 * `definePageMeta({ public: true })` *is gone* from it, and a regex over the raw text reads that
 * sentence as the call it is describing.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/** Every sentence the two other homes own, so the catalogue cannot quietly restate one. */
function otherHomes(): Set<string> {
  const entries = [...Object.values(GLOSSARY), ...Object.values(VOCABULARY).flatMap((group) => Object.values(group))];
  return new Set(entries.map((entry) => entry.definition));
}

describe('the tool catalogue', () => {
  it('describes every page the app has, and points only at pages that exist', () => {
    const described = TOOLS.map((tool) => tool.route);
    expect([...pageRoutes()].sort()).toEqual([...described].sort());
    for (const route of described) expect(() => pageFileOf(route), route).not.toThrow();
  });

  it('gives every tool a name, one line of what, how it works, steps and at least one limit', () => {
    for (const tool of TOOLS) {
      expect(tool.name, tool.id).not.toBe('');
      expect(tool.what, tool.id).not.toBe('');
      expect(tool.how.length, tool.id).toBeGreaterThanOrEqual(2);
      expect(tool.how.length, tool.id).toBeLessThanOrEqual(4);
      expect(tool.steps.length, tool.id).toBeGreaterThanOrEqual(3);
      expect(tool.limits.length, tool.id).toBeGreaterThanOrEqual(1);
      for (const line of [tool.what, ...tool.how, ...tool.steps, ...tool.limits]) expect(line.trim(), tool.id).not.toBe('');
    }
  });

  it('has unique ids, known areas, resolvable related tools and a real example each', () => {
    expect(new Set(TOOLS.map((tool) => tool.id)).size).toBe(TOOLS.length);
    expect(new Set(TOOLS.map((tool) => tool.route)).size).toBe(TOOLS.length);
    for (const tool of TOOLS) {
      expect(AREAS, tool.id).toContain(tool.area);
      expect(exampleById(tool.example), tool.id).not.toBeNull();
      for (const id of tool.related) expect(toolById(id), `${tool.id} → ${id}`).not.toBeNull();
      expect(tool.related, tool.id).not.toContain(tool.id);
    }
  });

  it('agrees with each page about whether it can be read signed out', () => {
    for (const tool of TOOLS) {
      const source = code(readFileSync(pageFileOf(tool.route), 'utf8'));
      const isPublic = /definePageMeta\(\{[^)]*public: true/.test(source);
      expect(tool.account, `${tool.id} (${tool.route})`).toBe(isPublic ? 'none' : 'required');
    }
  });

  it('keeps its sentences to itself: a term’s definition belongs to the vocabulary, not here', () => {
    const owned = otherHomes();
    for (const tool of TOOLS) for (const line of [tool.what, ...tool.how]) expect(owned.has(line), `${tool.id}: ${line}`).toBe(false);
  });

  it('groups into the areas the tutorial has chapters for, in order, with nothing orphaned', () => {
    const groups = toolsByArea();
    expect(groups.map((group) => group.area)).toEqual([...AREAS]);
    expect(groups.flatMap((group) => group.tools).length).toBe(TOOLS.length);
  });
});

/**
 * The README's route table (ADR-050 follow-up 4, ADR-068).
 *
 * It had drifted nineteen routes behind the app, and said `/` was a health check that needed no
 * account when it is My game and needs one. Nothing read it, which is how. This does: the
 * enumeration is the same `readdirSync` the catalogue is checked against, so a page added without
 * a row here fails beside the page added without an entry there.
 */
describe('the README’s route table', () => {
  const README = readFileSync(join(APP, '..', 'README.md'), 'utf8');
  /** `[id]`/`[[id]]` are how Nuxt spells a parameter; `:id` is how a reader does. */
  const asWritten = (route: string): string => route.replace(/\[+([a-z]+)\]+/gi, ':$1');

  it('lists every route the app serves, including the ones that are not tools', () => {
    const missing = [...pageRoutes(), ...NOT_TOOLS].map(asWritten).filter((route) => !README.includes(`\`${route}\``));
    expect(missing).toEqual([]);
  });

  it('says of each route what its page says about needing an account', () => {
    for (const route of [...pageRoutes(), ...NOT_TOOLS]) {
      const row = README.split('\n').find((line) => line.startsWith(`| \`${asWritten(route)}\``));
      if (row === undefined) continue; // the test above owns the missing-row failure
      const isPublic = /definePageMeta\(\{[^)]*public: true/.test(code(readFileSync(pageFileOf(route), 'utf8')));
      expect(row.split('|').at(-2)?.trim().startsWith(isPublic ? 'no' : 'yes'), route).toBe(true);
    }
  });
});

describe('toolForPath', () => {
  it('finds the tool a live path is on', () => {
    expect(toolForPath('/')?.id).toBe('my-game');
    expect(toolForPath('/pool')?.id).toBe('pool');
    expect(toolForPath('/pool/cohorts')?.id).toBe('cohorts');
    expect(toolForPath('/hands/9f2ab')?.id).toBe('hand');
    expect(toolForPath('/reports')?.id).toBe('reports');
    expect(toolForPath('/reports/abc')?.id).toBe('reports');
    expect(toolForPath('/ranges/import')?.id).toBe('import');
    expect(toolForPath('/ranges/abc')?.id).toBe('range');
    expect(toolForPath('/train/equity')?.id).toBe('trainer');
    expect(toolForPath('/examples/top-pair-dry-board')?.id).toBe('example');
  });

  it('claims nothing that is not a tool', () => {
    for (const path of [...NOT_TOOLS, '/nowhere', '/pool/cohorts/deeper']) expect(toolForPath(path), path).toBeNull();
  });
});
