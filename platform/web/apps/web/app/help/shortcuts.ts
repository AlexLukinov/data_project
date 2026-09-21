/**
 * Every keyboard shortcut the app has, in one list (spec §13: "A `?` overlay lists them").
 *
 * The `?` overlay is built from this file and nothing else, so a shortcut that is not written
 * here does not exist as far as the reader can tell. **Append-only**: a change that adds a key
 * binding adds its row here in the same commit. `shortcuts.test.ts` scans the workspace for key
 * handlers and fails when a file that binds keys is not named in any group's `sources`.
 *
 * Keys are written as tokens (`Mod`, `Shift`, `Enter`, `ArrowLeft`, a letter, a span like `1–9`) and rendered per
 * platform by `keyLabel`: `Mod` is ⌘ on a Mac and Ctrl everywhere else, because every binding
 * here accepts either (`useUndoRedo` checks `metaKey || ctrlKey`, `RangeTextIO` binds both).
 */

/** Keys pressed together. */
export type Chord = readonly string[];

export interface Shortcut {
  /** Alternatives: pressing any one of these chords does the same thing. */
  readonly chords: readonly Chord[];
  readonly does: string;
}

export interface ShortcutGroup {
  /** The overlay's heading. */
  readonly title: string;
  /** Where the keys work, and what has to have focus — in the reader's words. */
  readonly where: string;
  readonly shortcuts: readonly Shortcut[];
  /** The files that bind these keys, relative to `platform/web`. Read by the test, not shown. */
  readonly sources: readonly string[];
}

const UI = 'packages/poker-ui/src';
const APP = 'apps/web/app';

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: 'Anywhere',
    where: 'On every page, except while typing in a box.',
    shortcuts: [
      { chords: [['?']], does: 'Show or hide this list of shortcuts' },
      { chords: [['Escape']], does: 'Close this list or a dialog; close what this page is, or a control’s explanation; end the tour, keeping the stop it was on' },
    ],
    sources: [
      `${APP}/components/help/ShortcutsOverlay.vue`,
      `${APP}/components/help/TourCard.vue`,
      `${APP}/components/help/PageHelp.vue`,
      `${APP}/components/help/ControlHelp.vue`,
    ],
  },
  {
    title: 'Undo and redo a range',
    where: 'The Range Lab, a stored range, step 1 of an analysis and the range-drawing trainer — anywhere on the page but a box. One stroke of the brush is one step back; in the trainer the keys stop once the drawing is graded.',
    shortcuts: [
      { chords: [['Mod', 'Z']], does: 'Undo the last change to the range' },
      { chords: [['Mod', 'Shift', 'Z'], ['Mod', 'Y']], does: 'Redo it' },
    ],
    sources: [
      `${UI}/composables/useUndoRedo.ts`,
      `${APP}/pages/lab.vue`,
      `${APP}/pages/ranges/[id].vue`,
      `${APP}/components/analyze/Step1Ranges.vue`,
      `${APP}/components/train/DrawingTrainer.vue`,
    ],
  },
  {
    title: 'An explained word',
    where: 'A word with a dotted underline — a stat, a dimension, a metric — once it has focus (Tab to it). A control that explains itself behaves the same way: Tab to it and its sentence appears.',
    shortcuts: [{ chords: [['Escape']], does: 'Dismiss the explanation, keeping the word focused' }],
    sources: [`${APP}/components/reports/RegistryTerm.vue`],
  },
  {
    title: 'Range matrix',
    where: 'Any 13×13 hand grid, once a cell has focus (Tab to it).',
    shortcuts: [
      { chords: [['ArrowLeft'], ['ArrowRight'], ['ArrowUp'], ['ArrowDown']], does: 'Move to the next cell' },
      { chords: [['Enter'], ['Space']], does: 'Select the cell — and in a grid you can edit, fill it with the brush or empty it if it is filled' },
    ],
    sources: [`${UI}/components/RangeMatrix.vue`],
  },
  {
    title: 'Range text',
    where: 'The text box under a range you can edit.',
    shortcuts: [{ chords: [['Mod', 'Enter']], does: 'Apply the typed range to the grid' }],
    sources: [`${UI}/components/RangeTextIO.vue`],
  },
  {
    title: 'Analyzer steps',
    where: 'The step rail of an analysis or an example, while one of its steps has focus.',
    shortcuts: [
      { chords: [['1–9']], does: 'Go to that step, of the ones the rail shows' },
      { chords: [['ArrowLeft'], ['ArrowRight']], does: 'Previous or next step' },
    ],
    sources: [`${UI}/components/StepperNav.vue`],
  },
  {
    title: 'Hand replayer',
    where: 'A replayed hand, anywhere on the page but a box.',
    shortcuts: [
      { chords: [['ArrowLeft'], ['ArrowRight']], does: 'Back or forward one action' },
      { chords: [['Space']], does: 'Play or pause' },
      { chords: [['1–4']], does: 'Jump to preflop, the flop, the turn or the river' },
    ],
    sources: [`${UI}/components/HandReplayer.vue`],
  },
  {
    title: 'Your call',
    where: 'The prediction box of an analyzer step or a training spot.',
    shortcuts: [{ chords: [['Enter']], does: 'Commit the answer you typed' }],
    sources: [`${UI}/components/PredictionGate.vue`],
  },
  {
    title: 'Number boxes',
    where: 'Any box that takes a number.',
    shortcuts: [{ chords: [['ArrowUp'], ['ArrowDown']], does: 'Nudge the number up or down by one step' }],
    sources: [`${UI}/components/NumberInput.vue`],
  },
];

const APPLE: Readonly<Record<string, string>> = { Mod: '⌘', Shift: '⇧', Alt: '⌥' };
const OTHERS: Readonly<Record<string, string>> = { Mod: 'Ctrl', Shift: 'Shift', Alt: 'Alt' };
const EVERYWHERE: Readonly<Record<string, string>> = {
  Enter: '↵',
  Escape: 'Esc',
  Space: 'Space',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
};

/** One key token as it is printed on the reader's keyboard. */
export function keyLabel(token: string, apple: boolean): string {
  return (apple ? APPLE : OTHERS)[token] ?? EVERYWHERE[token] ?? token.toUpperCase();
}

/** Whether the reader is on an Apple keyboard, from the browser's own report of its platform. */
export function isApplePlatform(platform: string): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform);
}

const TYPING_TAGS: readonly string[] = ['INPUT', 'TEXTAREA', 'SELECT'];

/** Whether a key event came from somewhere the reader is typing, where a shortcut must not fire. */
export function isTyping(target: EventTarget | null): boolean {
  const element = target as Partial<HTMLElement> | null;
  return element?.isContentEditable === true || TYPING_TAGS.includes(element?.tagName ?? '');
}

/** Whether a key event asks for the shortcut list: `?` alone, not while typing. */
export function asksForShortcuts(event: KeyboardEvent): boolean {
  return event.key === '?' && !event.metaKey && !event.ctrlKey && !event.altKey && !isTyping(event.target);
}
