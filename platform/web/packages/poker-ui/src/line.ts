/**
 * Action lines, the registry's own encoding (`stats/registry/dimensions.yaml`, its header).
 *
 * A line is the seat's OWN actions, one letter each, joined by `-` within a street; `line_so_far`
 * joins streets with `/`. So `r/x-c/` is "opened, then checked and called the flop, and is now
 * deciding on the turn", and `''` on `street_line` means "my first decision on this street".
 *
 * Four registry dimensions are lines (`preflop_line`, `street_line`, `line_so_far`,
 * `prev_street_my_action`). Nothing can read them as letters, which is why they were unusable
 * before a control existed that spells them out.
 */

export const ACTION_LETTERS = ['f', 'x', 'l', 'c', 'b', 'r'] as const;
export type ActionLetter = (typeof ACTION_LETTERS)[number];

export const ACTION_WORDS: Record<string, string> = {
  f: 'fold',
  x: 'check',
  l: 'limp',
  c: 'call',
  b: 'bet',
  r: 'raise',
};

const STREET_SEP = '/';
const ACTION_SEP = '-';

/** A line split into streets, each a list of letters. `''` is one street with no actions. */
export function parseLine(line: string): string[][] {
  return line.split(STREET_SEP).map((street) => (street === '' ? [] : street.split(ACTION_SEP)));
}

export function formatLine(streets: readonly (readonly string[])[]): string {
  return streets.map((street) => street.join(ACTION_SEP)).join(STREET_SEP);
}

/** `r/x-c/` → `raise / check-call / …` — the line as words, for a label or a tooltip. */
export function lineWords(line: string): string {
  if (line === '') return 'no action yet';
  const streets = parseLine(line).map((street) =>
    street.length === 0 ? '…' : street.map((letter) => ACTION_WORDS[letter] ?? letter).join('-'),
  );
  return streets.join(' / ');
}

/** Whether every character is one the registry uses, so a typed value is caught before it is sent. */
export function isActionLine(line: string): boolean {
  return /^[fxlcbr]*(?:[-/][fxlcbr]*)*$/.test(line);
}
