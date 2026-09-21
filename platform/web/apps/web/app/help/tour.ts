/**
 * The tutorial as data: where each stop is, what it points at, and what it says.
 *
 * Round 6 shipped this as five stops; F.13 turns it into **chapters, one per tool area**, without
 * changing what a stop is. The list is still flat — a chapter is a run of consecutive stops that
 * name the same area — so one saved index still resumes the whole tutorial, and `TourCard` and
 * `HelpMenu` keep working off `TOUR_STOPS` as they did.
 *
 * Three rules keep it honest and cheap to maintain. **Every anchor is a `data-testid` the page
 * already carries** (the tutorial adds no attribute to another lane's markup), **every stop is on
 * a public page**, because a first visit is not signed in and a stop behind sign-in would open on
 * the login form, and **every word comes from somewhere that already says it** — the analyzer's
 * steps, the trainers' modes, or the tool catalogue. `tour.test.ts` checks all three against the
 * source.
 *
 * That third rule is why the first three chapters stop on `/help`: My game, the Pool and the Hands
 * cannot be shown to a signed-out reader, and inventing a screenshot of them would be a fourth
 * home for a sentence the catalogue already owns. The catalogue's own page is the honest anchor,
 * and each chapter ends with a worked example the reader can actually open.
 */
import { stepDef } from '~/analyze/steps';
import { modeDef } from '~/train/modes';

import { exampleById } from './examples';
import type { ToolArea } from './tools';
import { toolById } from './tools';
import type { HelpSession } from './state';

export interface TourStop {
  /** The area this stop belongs to; a run of stops sharing one is a chapter. */
  readonly chapter: ToolArea;
  /** The page the stop is on — a public route. */
  readonly route: string;
  /** An existing `data-testid` on that page. */
  readonly anchor: string;
  /** A caption for where the reader is: the tutorial's own words, a few of them. */
  readonly where: string;
  readonly title: string;
  readonly lines: readonly string[];
  /** The last stop of a chapter: where to go and try it. */
  readonly tryIt?: { readonly label: string; readonly to: string };
}

/** The areas the tutorial has a chapter for, in order. `Getting around` has none: it is this. */
export const TOUR_CHAPTERS: readonly ToolArea[] = ['My game', 'Pool', 'Hands', 'Analyze', 'Ranges & Lab', 'Train'];

const ANALYZER_EXAMPLE = '/examples/top-pair-dry-board';

/** "Now try it": the worked example a tool's catalogue entry points at. */
function tryIt(id: string): { label: string; to: string } | undefined {
  const example = exampleById(toolById(id)?.example ?? '');
  return example === null ? undefined : { label: `Now try it: ${example.title}`, to: `/examples/${example.id}` };
}

/**
 * A stop on `/help`, reading one catalogue card: the tool's own one-liner and its first step.
 * `last` ends the chapter with the example that tool points at.
 */
function card(id: string, chapter: ToolArea, last = false): TourStop {
  const tool = toolById(id);
  if (tool === null) throw new Error(`the tutorial names a tool the catalogue does not have: ${id}`);
  return {
    chapter,
    route: '/help',
    anchor: `help-tool-${id}`,
    where: chapter,
    title: tool.name,
    lines: [tool.what, tool.steps[0] ?? ''],
    ...(last ? { tryIt: tryIt(id) } : {}),
  };
}

/** A stop on a real screen, saying one of that tool's own "how it works" sentences. */
function live(id: string, chapter: ToolArea, route: string, anchor: string, which: number, last = false): TourStop {
  const tool = toolById(id);
  if (tool === null) throw new Error(`the tutorial names a tool the catalogue does not have: ${id}`);
  return {
    chapter,
    route,
    anchor,
    where: tool.name,
    title: tool.name,
    lines: [tool.how[which] ?? ''],
    ...(last ? { tryIt: tryIt(id) } : {}),
  };
}

const MY_GAME: readonly TourStop[] = [
  card('my-game', 'My game'),
  card('upload', 'My game'),
  card('leaks', 'My game'),
  card('reports', 'My game', true),
];

const POOL: readonly TourStop[] = [card('pool', 'Pool'), card('cohorts', 'Pool'), card('players', 'Pool', true)];

const HANDS: readonly TourStop[] = [card('hands', 'Hands'), card('hand', 'Hands'), card('paste', 'Hands', true)];

/** The analyzer's chapter is the only one that can run on the real thing: an example is public. */
const ANALYZE: readonly TourStop[] = [
  { chapter: 'Analyze', route: ANALYZER_EXAMPLE, anchor: 'step-purpose', where: 'A worked example', title: stepDef(3).title, lines: [stepDef(3).purpose] },
  { chapter: 'Analyze', route: ANALYZER_EXAMPLE, anchor: 'prediction-gate', where: 'Your call, before the answer', title: stepDef(3).question, lines: [stepDef(3).hint] },
  { chapter: 'Analyze', route: ANALYZER_EXAMPLE, anchor: 'stepper-7', where: 'The steps', title: stepDef(7).title, lines: [stepDef(7).purpose], tryIt: tryIt('analyzer') },
];

const RANGES: readonly TourStop[] = [
  live('lab', 'Ranges & Lab', '/lab', 'equity-explain', 0),
  live('lab', 'Ranges & Lab', '/lab', 'compare-mean', 1),
  live('lab', 'Ranges & Lab', '/lab', 'bluff-ranking', 2),
  card('ranges', 'Ranges & Lab', true),
];

const TRAIN: readonly TourStop[] = [
  { chapter: 'Train', route: '/train', anchor: 'mode-advantage', where: 'Train', title: modeDef('advantage').title, lines: [modeDef('advantage').purpose, modeDef('advantage').blurb] },
  { chapter: 'Train', route: '/train', anchor: 'mode-equity', where: 'Train', title: modeDef('equity').title, lines: [modeDef('equity').purpose, modeDef('equity').blurb] },
  live('train', 'Train', '/train', 'train-progress', 1, true),
];

export const TOUR_STOPS: readonly TourStop[] = [...MY_GAME, ...POOL, ...HANDS, ...ANALYZE, ...RANGES, ...TRAIN];

/** How long a stop waits for its anchor: pages load their data lazily. */
export const ANCHOR_WAIT_MS = 5000;
export const ANCHOR_POLL_MS = 100;

/** The first stop of a chapter, or `null` when no chapter of that name is in the list. */
export function chapterStart(stops: readonly TourStop[], area: string): number | null {
  const at = stops.findIndex((stop) => stop.chapter === area);
  return at < 0 ? null : at;
}

export interface ChapterPlace {
  readonly area: ToolArea;
  /** Which chapter of how many, and which stop of how many inside it — all one-based. */
  readonly chapter: number;
  readonly chapters: number;
  readonly step: number;
  readonly steps: number;
}

/** Where a stop sits in the tutorial, for the card's progress line. `null` past the last stop. */
export function chapterAt(stops: readonly TourStop[], index: number): ChapterPlace | null {
  const stop = stops[index];
  if (stop === undefined) return null;
  const areas = [...new Set(stops.map((each) => each.chapter))];
  const mine = stops.filter((each) => each.chapter === stop.chapter);
  const start = chapterStart(stops, stop.chapter) ?? 0;
  return {
    area: stop.chapter,
    chapter: areas.indexOf(stop.chapter) + 1,
    chapters: areas.length,
    step: index - start + 1,
    steps: mine.length,
  };
}

/**
 * Move the tutorial to stop `to`: past the last stop finishes it, before the first stays on the
 * first. Taking the tutorial answers the first-visit offer too.
 */
export async function goToStop(help: HelpSession, stops: readonly TourStop[], to: number, navigate: (path: string) => unknown): Promise<void> {
  if (to >= stops.length) {
    help.update({ welcomed: true, tour: 'finished', stop: 0 });
    return;
  }
  const index = Math.max(0, to);
  help.update({ welcomed: true, tour: 'running', stop: index });
  await navigate(stops[index]!.route);
}

/** Resume from the stop the reader left, or start at the first once the tutorial was finished. */
export function resumeAt(help: HelpSession, stops: readonly TourStop[]): number {
  const { tour, stop } = help.state.value;
  return tour === 'stopped' && stop < stops.length ? stop : 0;
}
