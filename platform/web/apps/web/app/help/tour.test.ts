import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { STEPS } from '~/analyze/steps';
import { MODES } from '~/train/modes';

import { exampleById } from './examples';
import { createHelpSession } from './state';
import { TOOLS } from './tools';
import type { TourStop } from './tour';
import { TOUR_CHAPTERS, TOUR_STOPS, chapterAt, chapterStart, goToStop, resumeAt } from './tour';

const WORKSPACE = fileURLToPath(new URL('../../../../', import.meta.url));
const PAGES = join(WORKSPACE, 'apps/web/app/pages');
const MARKUP = ['packages/poker-ui/src/components', 'apps/web/app'];

const STOPS: readonly TourStop[] = [
  { chapter: 'Analyze', route: '/examples', anchor: 'a', where: 'here', title: 'one', lines: ['x'] },
  { chapter: 'Ranges & Lab', route: '/lab', anchor: 'b', where: 'there', title: 'two', lines: ['y'] },
  { chapter: 'Train', route: '/train', anchor: 'c', where: 'elsewhere', title: 'three', lines: ['z'] },
];

function recorder() {
  const paths: string[] = [];
  return { paths, navigate: (path: string) => void paths.push(path) };
}

/** The page file a route renders: `/train` → `train/index.vue`, `/examples/x` → `examples/[id].vue`. */
function pageFor(route: string): string {
  const candidates = [`${route}.vue`, `${route}/index.vue`, `${route.replace(/\/[^/]+$/, '')}/[id].vue`];
  const found = candidates.map((c) => join(PAGES, c)).find((path) => existsSync(path));
  if (found === undefined) throw new Error(`no page renders ${route}`);
  return found;
}

/** Every `data-testid` the markup declares: literal ones, and the fixed prefix of templated ones. */
function declaredTestIds(): { exact: Set<string>; prefixes: string[] } {
  const exact = new Set<string>();
  const prefixes: string[] = [];
  for (const root of MARKUP) {
    for (const file of readdirSync(join(WORKSPACE, root), { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.vue'))) {
      const text = readFileSync(join(WORKSPACE, root, file), 'utf8');
      for (const m of text.matchAll(/\sdata-testid="([^"`$]+)"/g)) exact.add(m[1]!);
      for (const m of text.matchAll(/:data-testid="`([^`$]*)\$\{/g)) prefixes.push(m[1]!);
    }
  }
  return { exact, prefixes };
}

/** Every sentence the tutorial is allowed to repeat, and the three places that already say them. */
function saidElsewhere(): Set<string> {
  return new Set([
    ...STEPS.flatMap((s) => [s.title, s.purpose, s.question, s.hint]),
    ...MODES.flatMap((m) => [m.title, m.purpose, m.blurb]),
    ...TOOLS.flatMap((t) => [t.name, t.what, ...t.how, ...t.steps]),
  ]);
}

function stopsOf(area: string): TourStop[] {
  return TOUR_STOPS.filter((stop) => stop.chapter === area);
}

describe('the tutorial', () => {
  it('has one chapter per tool area, each reachable and three to six stops long', () => {
    expect([...new Set(TOUR_STOPS.map((stop) => stop.chapter))]).toEqual([...TOUR_CHAPTERS]);
    for (const area of TOUR_CHAPTERS) {
      expect(chapterStart(TOUR_STOPS, area), area).not.toBeNull();
      expect(stopsOf(area).length, area).toBeGreaterThanOrEqual(3);
      expect(stopsOf(area).length, area).toBeLessThanOrEqual(6);
    }
  });

  it('keeps every chapter in one run, so one saved index resumes the whole thing', () => {
    const seen: string[] = [];
    for (const stop of TOUR_STOPS) if (seen[seen.length - 1] !== stop.chapter) seen.push(stop.chapter);
    expect(seen).toEqual([...new Set(seen)]);
  });

  it('ends every chapter with a worked example to go and try', () => {
    for (const area of TOUR_CHAPTERS) {
      const chapter = stopsOf(area);
      const last = chapter[chapter.length - 1]!;
      expect(last.tryIt, area).toBeDefined();
      expect(exampleById(last.tryIt!.to.replace('/examples/', '')), area).not.toBeNull();
      for (const earlier of chapter.slice(0, -1)) expect(earlier.tryIt, `${area}: ${earlier.anchor}`).toBeUndefined();
    }
  });

  it('says only what the analyzer, the trainers or the catalogue already say', () => {
    const existing = saidElsewhere();
    for (const stop of TOUR_STOPS) for (const words of [stop.title, ...stop.lines]) expect(existing.has(words), words).toBe(true);
  });

  it('stops only on public pages, so a first visit is never sent to sign in', () => {
    for (const stop of TOUR_STOPS) {
      expect(readFileSync(pageFor(stop.route), 'utf8'), stop.route).toMatch(/definePageMeta\(\{\s*public: true/);
      if (stop.route.startsWith('/examples/')) expect(exampleById(stop.route.slice('/examples/'.length)), stop.route).not.toBeNull();
    }
  });

  it('points only at data-testids the pages already carry', () => {
    const { exact, prefixes } = declaredTestIds();
    for (const stop of TOUR_STOPS) {
      const declared = exact.has(stop.anchor) || prefixes.some((prefix) => prefix !== '' && stop.anchor.startsWith(prefix));
      expect(declared, stop.anchor).toBe(true);
    }
  });
});

describe('chapterAt', () => {
  it('says which chapter of how many, and which stop of how many inside it', () => {
    expect(chapterAt(STOPS, 0)).toEqual({ area: 'Analyze', chapter: 1, chapters: 3, step: 1, steps: 1 });
    expect(chapterAt(TOUR_STOPS, 0)?.chapter).toBe(1);
    const lastIndex = TOUR_STOPS.length - 1;
    const last = chapterAt(TOUR_STOPS, lastIndex)!;
    expect(last.chapter).toBe(TOUR_CHAPTERS.length);
    expect(last.step).toBe(last.steps);
  });

  it('answers null past the last stop', () => {
    expect(chapterAt(STOPS, STOPS.length)).toBeNull();
  });
});

describe('chapterStart', () => {
  it('answers null for an area the tutorial has no chapter for', () => {
    expect(chapterStart(TOUR_STOPS, 'Getting around')).toBeNull();
  });
});

describe('goToStop', () => {
  it('runs the tour at the stop, answers the first-visit offer and opens the stop’s page', async () => {
    const help = createHelpSession(null);
    const { paths, navigate } = recorder();
    await goToStop(help, STOPS, 1, navigate);
    expect(help.state.value).toMatchObject({ welcomed: true, tour: 'running', stop: 1 });
    expect(paths).toEqual(['/lab']);
  });

  it('finishes past the last stop without opening anything', async () => {
    const help = createHelpSession(null);
    const { paths, navigate } = recorder();
    await goToStop(help, STOPS, STOPS.length, navigate);
    expect(help.state.value).toMatchObject({ welcomed: true, tour: 'finished', stop: 0 });
    expect(paths).toEqual([]);
  });

  it('stays on the first stop when asked to go back from it', async () => {
    const help = createHelpSession(null);
    const { paths, navigate } = recorder();
    await goToStop(help, STOPS, -1, navigate);
    expect(help.state.value.stop).toBe(0);
    expect(paths).toEqual(['/examples']);
  });
});

describe('resumeAt', () => {
  it('resumes a stopped tour where it was left, and starts a finished or unseen one from the top', () => {
    const help = createHelpSession(null);
    expect(resumeAt(help, STOPS)).toBe(0);
    help.update({ tour: 'stopped', stop: 2 });
    expect(resumeAt(help, STOPS)).toBe(2);
    help.update({ tour: 'finished', stop: 2 });
    expect(resumeAt(help, STOPS)).toBe(0);
  });

  it('starts from the top when the saved stop no longer exists (the tour got shorter)', () => {
    const help = createHelpSession(null);
    help.update({ tour: 'stopped', stop: 99 });
    expect(resumeAt(help, STOPS)).toBe(0);
  });
});
