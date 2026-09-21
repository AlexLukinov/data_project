/**
 * Ranges & Lab: the library, one stored chart, the folder import, the three-way comparison, and
 * the calculator everything else is built on.
 *
 * Read from `packages/poker-core` (the evaluator, the equity engine, `metrics/`, `blockers/`,
 * `distribution/`), `packages/poker-importers`, `~/ranges/review.ts`, `~/pool/range.ts` (showdown
 * counts per combo, scaled) and `~/pool/estimate.ts` with `analysis/pool/reconstruct.py` (ADR-035).
 */
import type { Tool } from './types';

const AREA = 'Ranges & Lab' as const;

export const RANGE_TOOLS: readonly Tool[] = [
  // `~/stores/ranges.ts` over `/v1/ranges`, with a Dexie copy that answers when the API is away.
  {
    id: 'ranges',
    area: AREA,
    route: '/ranges',
    name: 'Ranges',
    what: 'Every chart you have stored, searchable by name, source and seat.',
    how: [
      'The library lives on the server; this browser keeps a copy so the list still opens when the API does not answer, and says which of the two you are reading.',
      'A chart is stored against a situation — the seats, the stack, the table size, the stake, the texture and every step of the action — and that whole key is what makes two charts the same chart.',
      'The backup button writes the library out as our own JSON, which the importers read back.',
    ],
    steps: [
      'Search by name, or narrow by source and seat.',
      'Open a chart to edit it, or press Import to add a folder of them.',
      'Use Compare to put a chart against a solver’s and against the field.',
      'Done when the charts you actually play are all in here, labelled by source.',
    ],
    needs: ['Sign in.', 'At least one imported or drawn chart — the list says so when there is none.'],
    limits: [
      'Reading offline works; saving does not. A chart saved since the copy was last filled may be missing from it.',
      'A chart is only found at the situation it was stored against, matched exactly.',
    ],
    related: ['range', 'import', 'compare'],
    example: 'top-pair-dry-board',
    account: 'required',
  },
  {
    id: 'range',
    area: AREA,
    route: '/ranges/[id]',
    name: 'One range',
    what: 'Edit a stored chart, its situation and its history.',
    how: [
      'The grid is painted with a brush; the text box under it takes the same range written out, and applying it redraws the grid.',
      'Saving a changed body makes a new version rather than overwriting the old one, so the history below is a real record and any version can be reverted to.',
      'Undo and redo work on the drawing, in the browser, before a save. The version history is the server’s record after one.',
    ],
    steps: [
      'Paint cells with the brush, or type the range into the text box and apply it.',
      'Set the situation with the editor — a chart at the wrong situation will never be found.',
      'Save. A body change makes a version; renaming does not.',
      'Done when the chart matches what you actually play from that seat.',
    ],
    needs: ['Sign in.', 'A stored chart to open.'],
    limits: [
      'Editing a chart does not change any analysis already saved against the old one.',
      'A version is the whole body, not a diff — reverting replaces, it does not merge.',
    ],
    related: ['ranges', 'lab', 'compare'],
    example: 'top-pair-dry-board',
    account: 'required',
  },
  // `@poker/importers` + `~/ranges/review.ts`: files in, rows out, nothing saved before the review.
  {
    id: 'import',
    area: AREA,
    route: '/ranges/import',
    name: 'Import ranges',
    what: 'Drop a folder of range files and check every inferred situation before anything is saved.',
    how: [
      'The importers read the formats one at a time — our own JSON, GTO Wizard, PioSOLVER, Equilab, plain text and CSV — and produce one row per range they could read.',
      'The situation is inferred from the file name and path, with a confidence and notes saying what to check. Nothing is saved until you commit, because a wrong situation is a chart that will never be found again.',
      'Source, tool and tags can be set on every row at once; the report afterwards says what landed, what was versioned and what was skipped.',
    ],
    steps: [
      'Drop the folder, or pick the files.',
      'Set “source for all” and any shared tags, then press Apply to all — the boxes alone change nothing.',
      'Work down the table fixing every row that says it needs a situation.',
      'Choose what to do with names already in the library, then commit.',
      'Done when the report shows no failures and the library holds what you dropped.',
    ],
    needs: ['Sign in.', 'The API running — the save is the server’s.', 'Range files in one of the supported formats.'],
    limits: [
      'Inference reads names, not contents: a folder named badly produces rows that need correcting by hand.',
      'A file the browser cannot open is reported rather than guessed at.',
      'Nothing is saved before the commit, so leaving the page loses the review.',
    ],
    related: ['ranges', 'range', 'compare'],
    example: 'top-pair-dry-board',
    account: 'required',
  },
  // `~/pool/range.ts` (tier 2 as a range) and `~/pool/estimate.ts` + `analysis/pool/reconstruct.py`
  // (tier 3: a prior reweighted by a per-class likelihood ratio, ADR-035).
  {
    id: 'compare',
    area: AREA,
    route: '/ranges/compare',
    name: 'Compare ranges',
    what: 'Your chart, a solver’s range and the field’s, side by side at one situation.',
    how: [
      'The first two columns come from your own library, matched on the situation exactly. The third is the field’s, and it is a different kind of object: the hands the pool actually turned over at this node, counted per combo so a twelve-combo class is not flattered by being twelve combos, and scaled so the most frequent class sits at 1.',
      'The heatmap between them is the per-cell difference, and the table under it is the biggest disagreements first.',
      'There is also a reconstruction: starting from your chart as a prior and reweighting it by how over-represented each class is among the hands that took this action. It is a reweighting of your assumption, not a reading of their range.',
    ],
    steps: [
      'Set the situation with the editor at the top.',
      'Pick a chart of yours for the first column, and a solver export for the second.',
      'Ask for the pool column; it answers only where it has seen enough.',
      'Read the disagreement table before the heatmap — it is already ordered by how much it matters.',
      'Done when you know which cells you and the field disagree about, and why.',
    ],
    needs: [
      'Sign in.',
      'A chart of yours stored at this exact situation for the first column.',
      'A solver export imported with its source set to solver for the second.',
      'A hundred observations at the node before the pool column says anything.',
    ],
    limits: [
      'Showdown data is what was *shown*: a seat that folds is almost never revealed, so the pool column describes the hands that got to the end, not the range that started.',
      'The reconstruction works per hand class, not per combo, so the shape inside a class is your prior’s and never the pool’s.',
      'A solver column is only as good as the export you imported. Nothing here solves anything.',
    ],
    related: ['ranges', 'lab', 'hand'],
    example: 'flush-draw-their-board',
    account: 'required',
  },
  // `packages/poker-core`: `equity/` (exact heads-up or Monte Carlo), `metrics/`, `blockers/`,
  // `distribution/`; the work runs in the equity Worker (`packages/poker-workers`).
  {
    id: 'lab',
    area: AREA,
    route: '/lab',
    name: 'Range Lab',
    what: 'Two ranges and a board: equity, what each range hit, blockers, pot odds and MDF.',
    how: [
      'Everything on this page is computed in your browser from the cards themselves — a hand evaluator, exact enumeration heads-up where that is affordable and a sampled estimate where it is not. No server is asked anything.',
      'The panels answer different questions about the same two ranges: how the pot splits, what each range is made of on this board, which of their combos your own cards make impossible, and the pot odds and minimum defence the bet size implies.',
      'Undo and redo track the drawing, so experimenting with a range costs nothing.',
    ],
    steps: [
      'Type or paint the two ranges — the defaults are a reasonable place to start.',
      'Set the board, and any dead cards.',
      'Read equity first, then the distribution: the second explains the first.',
      'Change one thing at a time — a card, a size, a slice of range — and watch what moves.',
      'Done when you understand why the number changed.',
    ],
    needs: [],
    limits: [
      'Sampled equity is an estimate; a figure that keeps moving on a rerun is telling you its own precision.',
      'Nothing here is stored. Save a range from the library if you want to keep it.',
      'It answers what is true of two ranges on a board. It does not tell you what to do — that is the analyzer’s nine steps.',
    ],
    related: ['compare', 'analyzer', 'train'],
    example: 'flush-draw-their-board',
    account: 'none',
  },
];
