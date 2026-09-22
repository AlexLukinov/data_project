/**
 * Analyze: the nine-step method, the analyses you have saved, and the worked examples.
 *
 * Read from `~/analyze/steps.ts` (the nine steps as data, each with the question it makes you
 * answer before it shows anything), `~/analyze/spot.ts`, `~/analyze/api.ts` (saves merge by step
 * number, ADR-034) and `~/help/examples.ts` (ADR-050).
 */
import type { Tool } from './types';

const AREA = 'Analyze' as const;

export const ANALYZE_TOOLS: readonly Tool[] = [
  // `~/analyze/api.ts` over `/v1/analyses`.
  {
    id: 'analyses',
    area: AREA,
    route: '/analyze',
    name: 'Analyses',
    what: 'The spots you have worked through, and the way into another.',
    how: [
      'An analysis is nine steps over one situation, each ending in a heuristic you wrote yourself. This page lists them by situation and by day.',
      'One normally begins at a hand rather than at a blank form: the replayer’s “Analyze this node” carries the spot in with it.',
      'Deleting is immediate and the list is re-read afterwards, so what is on screen is what the server holds.',
    ],
    steps: [
      'Open an analysis to carry on where you left it.',
      'Or start one from a hand: replay it and press Analyze at the step you care about.',
      'Done when the spot you meant to study has an entry with a heuristic at the end of it.',
    ],
    needs: ['Sign in.'],
    limits: [
      'It lists analyses; it does not grade them. The judgement in each one is yours.',
      'An analysis is tied to the situation it was started at — it is not a chart that applies everywhere.',
    ],
    related: ['analyzer', 'examples', 'hand'],
    example: 'top-pair-dry-board',
    account: 'required',
  },
  // The nine steps: `~/analyze/steps.ts`; the spot the earlier steps build: `~/analyze/spot.ts`;
  // the prediction gate is `@poker/ui`'s `prediction.ts` — the truth is fetched after the commit.
  {
    id: 'analyzer',
    area: AREA,
    route: '/analyze/[id]',
    name: 'The analyzer',
    what: 'Nine steps that take a spot apart, each one asking for your answer before showing its own.',
    how: [
      'The steps build on each other: ranges, then what continues, then what each range hit on this board, the nut combos, your blockers, the decision, where your hand sits inside your own range, your value-to-bluff ratio, and finally the defence theory demands against what your pool actually does.',
      'Every step is gated. You commit a number or a choice, and only then is the computed answer revealed and the difference scored — nothing asks the engine for the truth until the gate is closed, so there is nothing to peek at.',
      'The work is kept in this browser as you type and on the server shortly after. Saves merge step by step, so a partial autosave cannot overwrite an earlier step you had finished.',
    ],
    steps: [
      'Start from a hand, or from an example.',
      'Give every seat a range in step 1 — from your library, or drawn by hand.',
      'Answer each step’s question before looking. The guess is the exercise.',
      'Move with the rail on the left; it shows which steps are committed.',
      'Done when step 9 ends in a heuristic in your own words that you would recognise at the table.',
    ],
    needs: [
      'Sign in.',
      'A situation — from a hand, or a spot you set up yourself.',
      'Ranges for both seats before the board steps can say anything.',
      'For the pool steps, a hundred observations at that node; below it they stay blank.',
    ],
    limits: [
      'No solver is consulted anywhere in the nine steps. The arithmetic is exact; the ranges going in are your assumption.',
      'Steps that compare against the pool are silent when the pool has not seen the node enough times — silence there is the honest answer.',
      'The heuristic at the end is yours. Nothing checks it.',
    ],
    related: ['analyses', 'examples', 'lab', 'hand'],
    example: 'top-pair-dry-board',
    account: 'required',
  },
  // `~/help/examples.ts` — spots that ship as data, opened in the analyzer's own step components.
  {
    id: 'examples',
    area: AREA,
    route: '/examples',
    name: 'Examples',
    what: 'Worked spots that need no account, no upload and no server.',
    how: [
      'Each example is a situation that ships with the app as data: the two reference charts, the flop, the hand and the bet. It opens in the analyzer’s own step components over a copy that lives in this tab only.',
      'It opens all nine steps. Five are answered by arithmetic in this browser; the four scored against your pool say, where the number would be, that an example has no pool.',
      'The four spots share one pair of ranges — the button opens, the big blind calls — so the same two ranges tell four different stories on four flops.',
    ],
    steps: [
      'Pick the spot whose lesson you want.',
      'Work the steps in order and commit each answer before looking.',
      'Compare the four examples: the ranges never change; the board and the hand you hold do.',
      'Done when you can say why the same two ranges behave differently on each flop.',
    ],
    needs: [],
    limits: [
      'Nothing you do in an example is saved, anywhere.',
      'The charts are references, not solver output, and not your own play.',
      'Four of the nine steps cannot be scored here — they need a pool of your own hands.',
    ],
    related: ['example', 'analyzer', 'train'],
    example: 'top-pair-dry-board',
    account: 'none',
  },
  {
    id: 'example',
    area: AREA,
    route: '/examples/[id]',
    name: 'One example',
    what: 'A single worked spot, in the analyzer’s own steps.',
    how: [
      'The spot is already set up: both ranges, the board, your two cards and the bet size. What is left is the thinking.',
      'Each step asks for your answer first and reveals the computed one after — the same gate the real analyzer uses.',
      'Everything is computed in this browser. The page is correct with the API stopped.',
    ],
    steps: [
      'Read the story at the top so you know what has happened.',
      'Commit an answer at each step, then read the reveal.',
      'Move through the steps with the rail; leaving the page throws the work away.',
      'Done when your guesses and the reveals stop surprising you.',
    ],
    needs: [],
    limits: [
      'Nothing is stored — reopening the example starts it fresh.',
      'The two ranges are reference charts, which is an assumption like any other.',
      'No pool, so the steps that read the field say so rather than faking a number.',
    ],
    related: ['examples', 'analyzer', 'lab'],
    example: 'top-pair-dry-board',
    account: 'none',
  },
];
