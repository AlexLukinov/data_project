/**
 * Train: the six drills, one run of one of them, and what the drills have taught so far.
 *
 * Read from `~/train/modes.ts` (the six, as data), `~/train/session.ts` (the truth is fetched
 * after the commit, and the queue serves what is overdue before it invents a spot),
 * `~/train/progress.ts` and `packages/poker-core/src/training/` for the review intervals.
 */
import type { Tool } from './types';

const AREA = 'Train' as const;

export const TRAIN_TOOLS: readonly Tool[] = [
  {
    id: 'train',
    area: AREA,
    route: '/train',
    name: 'Train',
    what: 'Six drills on the arithmetic that range thinking rests on.',
    how: [
      'Each card is one mode — equity, combo counting, range drawing, blockers, range and nut advantage, pot odds and MDF — with what it drills and why it is worth the ten minutes.',
      'The number beside a mode is how many spots it is owed today. Spots you got wrong come back sooner than spots you got right, on a spacing that widens each time you are right again.',
      'Your accuracy per mode is kept in this browser, so the page is as honest with the API stopped as with it running.',
    ],
    steps: [
      'Start with whichever mode owes you the most.',
      'Answer before looking; the drill is the guess, not the reveal.',
      'Do ten minutes, not an hour — the spacing does the rest.',
      'Done when every mode is at zero owed for the day.',
    ],
    needs: [],
    limits: [
      'Scores live in this browser only: another browser starts from nothing.',
      'Accuracy is measured against exact arithmetic, not against what a solver would do.',
      'Drilling the arithmetic is not the same as playing well with it.',
    ],
    related: ['trainer', 'progress', 'lab'],
    example: 'flush-draw-their-board',
    account: 'none',
  },
  {
    id: 'trainer',
    area: AREA,
    route: '/train/[mode]',
    name: 'One drill',
    what: 'A run of one mode: a spot, your answer, the truth, and the next spot.',
    how: [
      'A spot is drawn, you commit every answer it asks for, and only then is the computed truth revealed and the difference scored — nothing asks for the answer until the gate is closed.',
      'What comes next is the schedule’s choice, not chance: whatever is overdue is served before a new spot is invented.',
      'Every number revealed is computed here, from the cards, by the same engine the Range Lab uses.',
    ],
    steps: [
      'Read the spot, then commit your answer.',
      'Read the reveal, and the difference from your guess.',
      'Carry on to the next spot; the mode decides which one.',
      'Done when the reveals stop surprising you — that is the signal to widen the mode.',
    ],
    needs: [],
    limits: [
      'A score is per browser. Clearing site data clears it.',
      'The reveal is arithmetic, not strategy: knowing the equity is not knowing the play.',
      'An unknown mode name in the address is refused rather than guessed at.',
    ],
    related: ['train', 'progress', 'lab'],
    example: 'flush-draw-their-board',
    account: 'none',
  },
  {
    id: 'progress',
    area: AREA,
    route: '/progress',
    name: 'Progress',
    what: 'Accuracy per mode over the last month, and the heuristics you have written.',
    how: [
      'Everything but the log is read from this browser’s own scoring store, so the page reads correctly with no backend at all.',
      'The breakdown splits accuracy by what the spot was about — hand class, or board texture — so a weak spot shows up as a category rather than as a bad day.',
      'The heuristic log collects the sentences you wrote at the end of your analyses and asks you to revisit each one a fortnight later. It says for itself which rows have reached the server.',
    ],
    steps: [
      'Read the overall trend first, then the per-mode rows.',
      'Look for a category that is consistently worse rather than for a bad session.',
      'Work through the heuristics that are due for review.',
      'Done when you have retired or rewritten the heuristics that turned out to be wrong.',
    ],
    needs: ['Nothing for the drills.', 'Sign in for the heuristic log to sync; the browser copy shows either way.'],
    limits: [
      'Drill scores are this browser’s. They are not an account-wide record.',
      'Accuracy over a handful of spots is not a trend.',
      'A heuristic is yours; nothing here checks whether it is true.',
    ],
    related: ['train', 'analyzer', 'trainer'],
    example: 'range-ahead-hand-behind',
    account: 'none',
  },
];
