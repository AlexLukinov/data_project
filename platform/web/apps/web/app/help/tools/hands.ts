/**
 * Hands: the list, the replayer, and a hand pasted from anywhere.
 *
 * Read from `~/hands/api.ts`, `~/hands/replay.ts`, `packages/poker-core/src/hand/` (the replay
 * state machine and `nodeKeyAt`, ADR-032) and `components/hands/HandStudy.vue` for the panels.
 */
import type { Tool } from './types';

const AREA = 'Hands' as const;

export const HAND_TOOLS: readonly Tool[] = [
  // `~/hands/api.ts` over the shared filter store; the tag narrowing is an intersection in
  // Postgres rather than a compiled condition (ADR-048).
  {
    id: 'hands',
    area: AREA,
    route: '/hands',
    name: 'Hands',
    what: 'Every hand that matches a situation — yours, or the pool’s.',
    how: [
      'The list is driven by the same filter the reports use, so any of the registry’s dimensions can narrow it and the address it produces opens the same situation on any other screen.',
      'Tags are the one narrowing that is not a condition: they live beside the hands rather than inside them, so the server intersects the list with the tagged hands instead of compiling a clause. That is why a tag travels in its own part of the address.',
      'Switching between your hands and the pool changes which corpus is read, not which question is asked.',
    ],
    steps: [
      'Set the dataset and the dates in the filter bar.',
      'Press Edit to add conditions — position, street, bet size, board texture.',
      'Narrow further by tag if you have tagged hands.',
      'Open a row to replay it.',
      'Done when the list holds the spot you wanted to study and nothing else.',
    ],
    needs: ['Sign in.', 'Hands in the dataset you are pointing at.'],
    limits: [
      'Some dimensions cannot narrow a hand list at all; the page names them rather than returning a wrong list.',
      'The list is capped at a hundred rows — it is for reading hands, not for exporting them.',
      'A filter narrows which hands are listed; it does not change what any of them were.',
    ],
    related: ['hand', 'paste', 'reports'],
    example: 'top-pair-dry-board',
    account: 'required',
  },
  // `poker-core/src/hand/`: states derived per step, `nodeKeyAt` giving the situation of each step;
  // the panels rebind to that node (ADR-032).
  {
    id: 'hand',
    area: AREA,
    route: '/hands/[id]',
    name: 'The replayer',
    what: 'One hand, stepped through, with every panel bound to the spot you are standing in.',
    how: [
      'The hand is replayed as a sequence of states derived from the actions — who is in, what the pot is, what the board shows — and each step knows the situation it is in.',
      'The panels beside the table follow that situation. Step forward and the pot odds, the range matrices and the pool’s numbers all rebind to the new node; they are not one fixed reading of the whole hand.',
      'The range panels ask your own library what you have written down for this exact situation, so stepping through a hand walks your charts at the same time.',
      'Notes and tags are stored against the hand, which is why they appear here and not on a pasted hand.',
    ],
    steps: [
      'Use back, next and play to move through the hand, or drag the slider.',
      'Jump straight to a street with the street buttons.',
      'Watch the panels change as you step — that is the point of the screen.',
      'Write a note or add a tag if the hand is worth coming back to.',
      'Send the spot to the analyzer when a step deserves nine steps of thought.',
    ],
    needs: ['Sign in.', 'A hand in the database. Use Paste a hand for one that is not.'],
    limits: [
      'A pool hand has no hero, so the seat being watched comes from the link rather than from the hand.',
      'A panel can only compare against a chart you have actually stored for that exact situation — seats, stack, table size, stake and every step of the action.',
      'The pool’s numbers at a node are withheld entirely under a hundred observations.',
    ],
    related: ['hands', 'analyzer', 'compare'],
    example: 'top-pair-dry-board',
    account: 'required',
  },
  // `POST /v1/hands/parse` — the server's own parser; nothing is stored (ADR-029).
  {
    id: 'paste',
    area: AREA,
    route: '/hands/paste',
    name: 'Paste a hand',
    what: 'Replay a hand history you paste in, without storing anything.',
    how: [
      'The text goes to the same parser the uploads use and comes back in the same shape a stored hand has, so the replayer and its panels behave identically.',
      'Nothing is written anywhere. That is deliberate: it makes the screen usable for a hand from a table you do not track, and it keeps other people’s hands out of your database.',
      'Because nothing is stored, there is no note and no tag here.',
    ],
    steps: [
      'Copy the hand history text from your client or from a forum post.',
      'Paste it into the box and press Replay.',
      'Step through it exactly as you would a stored hand.',
      'Done when you have read the spot; nothing is kept when you leave.',
    ],
    needs: ['Sign in.', 'The API running — the parser is the server’s.', 'Hand-history text from a supported site.'],
    limits: [
      'Nothing is saved, so nothing can be found again later.',
      'A format the parser does not know is refused with the parser’s own reason.',
      'It does not enter your statistics: a pasted hand is not an upload.',
    ],
    related: ['hand', 'upload', 'analyzer'],
    example: 'flush-draw-their-board',
    account: 'required',
  },
];
