/**
 * What a *tool* is, in the help layer's sense: one screen of the app, described well enough that
 * a player landing on it cold can answer "what is this", "how does it work" and "how do I use it"
 * without asking anyone (plan F.13, ADR-058).
 *
 * **One sentence has exactly one home.** The app now writes three kinds of sentence and each has
 * an owner, so nothing is copied between them:
 *
 *  - a **stat or dimension** is described by the registry, and reaches the screen through
 *    `~/stats/vocabulary` and `components/reports/RegistryTerm.vue` (ADR-057);
 *  - a **word that names a set** — a hand class, a draw, a position, a node — belongs to
 *    `@poker/ui`'s `vocabulary.ts` and `glossary.ts` (ADR-056);
 *  - a sentence about **a tool** belongs here.
 *
 * The rule that decides which: if the sentence would still be true with this screen deleted, it is
 * not the catalogue's. A tool entry may *link* to a term by name; it never restates its definition.
 */

/** The six areas the app is read in, plus the one that is not a tool area at all. */
export const AREAS = [
  'My game',
  'Pool',
  'Hands',
  'Analyze',
  'Ranges & Lab',
  'Train',
  'Getting around',
] as const;

export type ToolArea = (typeof AREAS)[number];

/** Whether a screen can be read signed out. Checked against the page's own `definePageMeta`. */
export type AccountNeed = 'none' | 'required';

export interface Tool {
  /** Stable id, used by `related`, by the tutorial and by the tests. */
  readonly id: string;
  readonly area: ToolArea;
  /** The route, spelled exactly as `app/pages/` spells the file: `/hands/[id]`, `/reports/[[id]]`. */
  readonly route: string;
  /** What a player would call it — the nav's word wherever the nav has one. */
  readonly name: string;
  /** What it is, in one line. Never how it works, never what to click. */
  readonly what: string;
  /** How it works: 2–4 sentences, written from the module named in the comment above the entry. */
  readonly how: readonly string[];
  /** How to use it: the first thing to do, then the rest, ending in what "done" looks like. */
  readonly steps: readonly string[];
  /** What has to be true before it can answer. Empty only where nothing at all is needed. */
  readonly needs: readonly string[];
  /** The honest limits. At least one on every tool: a screen with no stated limit is a claim. */
  readonly limits: readonly string[];
  /** Other tools, by id. */
  readonly related: readonly string[];
  /** The worked example that demonstrates the idea behind it (`~/help/examples`). */
  readonly example: string;
  /** Whether the screen needs an account. */
  readonly account: AccountNeed;
}
