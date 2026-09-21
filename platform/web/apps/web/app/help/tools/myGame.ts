/**
 * My game: the four screens that answer "how am I doing, and what should I change".
 *
 * Read from `~/hero/kpis.ts` and `~/hero/winnings.ts` on the client and, on the server,
 * `analysis/hero/leaks.py`, `analysis/hero/sessions.py`, `stats/service.py` and `stats/router.py`.
 * The thin-sample rule every sentence below refers to is `~/reports/cell.ts`.
 */
import type { Tool } from './types';

const AREA = 'My game' as const;

export const MY_GAME_TOOLS: readonly Tool[] = [
  // Numbers: `hero/kpis.ts` (one ungrouped `POST /v1/reports/run`, `compare_to: 'population'`,
  // `confidence: 95`), then `/v1/hero/winnings`, `/v1/hero/leaks`, `/v1/hero/sessions`.
  {
    id: 'my-game',
    area: AREA,
    route: '/',
    name: 'My game',
    what: 'Your own results and the style that produced them, on one page.',
    how: [
      'The eight headline tiles are a single ungrouped report over your own hands, compared against the whole pool and asked for a 95% confidence interval — so a tile carries a band and the field’s figure, not just a number.',
      'The winnings curve, the leaks and the sittings are three further requests that load on their own. Each panel owns its failure, so a slow pool baseline cannot keep the sittings off the screen.',
      'Only the dates narrow this page. Three of those four routes accept no situation filter, so there is no filter bar here rather than chips that would be silently ignored.',
    ],
    steps: [
      'Set the two dates at the top, or leave them empty for everything you have uploaded.',
      'Read the first three tiles — hands, winrate, all-in adjusted winrate — as the result.',
      'Read the five below them — VPIP, PFR, 3-bet, WTSD, W$SD — as the style that produced it.',
      'Open a leak from the table to reach the hands behind it.',
      'Done when you can name one number you mean to change this month.',
    ],
    needs: ['Sign in.', 'At least one upload of your own hands; with none, the page says so and points at Upload.'],
    limits: [
      'A figure drawn from fewer than 100 observations is marked thin and its difference from the field is withheld — a gap measured on a handful of hands measures the handful.',
      'The comparison is against what the pool did, never against what a solver would do. No solver was asked.',
      '“All-in adjusted” replaces the outcome of all-in pots with their equity. It is still your own sample, not a prediction.',
    ],
    related: ['leaks', 'reports', 'upload'],
    example: 'range-ahead-hand-behind',
    account: 'required',
  },
  // `ingestion/` — upload → MinIO → Kafka → the parser worker → ClickHouse; the client half is
  // `~/upload/api.ts` and `~/upload/status.ts`.
  {
    id: 'upload',
    area: AREA,
    route: '/upload',
    name: 'Upload',
    what: 'Put hand-history files in, and say which of your seats is yours.',
    how: [
      'A dropped file is stored whole, then parsed by a background worker and written to the database hand by hand; the queue follows each file until the server calls it completed or failed.',
      'The dataset is the choice that matters. **My hands** feed My game through the seat recognised as yours; **Pool hands** put every seat into the population. A file belongs to one of them for good — the same bytes sent under the other are refused.',
      'The dataset and the site are locked from the moment a folder starts being read until its last file is sent, so a queue cannot end up half one thing and half the other.',
    ],
    steps: [
      'Choose the dataset and the site before dropping anything.',
      'Drop files or a folder onto the drop zone, or pick them with the buttons.',
      'Watch each row reach completed; a row that sits waiting means the parser worker is not running.',
      'Add your screen names under “Your seats” so My game knows which seat to count.',
      'Done when the recent-uploads table shows your files completed and My game counts them.',
    ],
    needs: ['Sign in.', 'Hand-history text files from a supported site. A zip is refused before it is sent.'],
    limits: [
      'Nothing is analysed at upload time: the numbers appear once the worker has parsed the file, not when the upload finishes.',
      'Hands with no hero seat are counted separately and do not reach My game.',
      'Re-sending a file already stored under the other dataset is refused rather than duplicated.',
    ],
    related: ['my-game', 'hands', 'account'],
    example: 'top-pair-dry-board',
    account: 'required',
  },
  // `analysis/hero/leaks.py`: every stat of the `leaks` preset scored `|delta| * sqrt(n)`.
  {
    id: 'leaks',
    area: AREA,
    route: '/leaks',
    name: 'Leaks',
    what: 'Where your frequencies stray furthest from the field, biggest first.',
    how: [
      'Every stat in the leak preset is measured on your hands and on the baseline, and the gap is scored by its size times the square root of the sample: a large deviation over many chances outranks a larger one over few.',
      'Stats with fewer than 100 opportunities are set aside rather than ranked — a 3-bet frequency over forty chances is noise.',
      'The baseline is the pool, or a cohort of it when one is chosen. It is a description of what other players did, not a recommendation.',
      'Each row links into the hand list at that exact situation, over the same dates, so a leak and its hands always answer the same question.',
    ],
    steps: [
      'Set the dates; they are shared with My game and travel into the links below.',
      'Read down from the top — the ranking is already the priority order.',
      'Open the hands behind a row before believing it.',
      'Done when you have looked at the hands of the top leak and know whether you agree with it.',
    ],
    needs: ['Sign in.', 'Your own hands uploaded.', 'A pool to compare against, which the shipped corpus provides.'],
    limits: [
      'A leak is a difference from the field, not a mistake. The field is not correct; it is only what happened.',
      'Rows held back for a thin sample are shown as blocked rather than ranked, and stay that way until the sample grows.',
      'Dates narrow this page; a situation filter does not — the route takes none.',
    ],
    related: ['my-game', 'hands', 'reports'],
    example: 'range-ahead-hand-behind',
    account: 'required',
  },
  // `stats/service.py` + `stats/router.py`: request → plans → one query per plan → merged cells.
  {
    id: 'reports',
    area: AREA,
    route: '/reports/[[id]]',
    name: 'Reports',
    what: 'Any stat, for any situation, grouped any way — over your own hands or the pool.',
    how: [
      'A report is three choices: which stats, which situation, and what to group by. The engine resolves the stats, picks the cheapest table that can answer all of them, runs one query per table and merges the rows on the group key.',
      'Every cell arrives with its own sample size, and the grid shows it beside the value. A cell under the reading threshold is dimmed and left uncompared.',
      'Saving a report puts it at its own address, so reopening the link reopens the same question rather than a screenshot of its answer.',
    ],
    steps: [
      'Pick the stats you want in the stat picker.',
      'Narrow the situation in the filter bar — dates, dataset, and any of the registry’s dimensions as conditions.',
      'Choose what to group by; leave it empty for one row over the whole situation.',
      'Run it, then adjust the reading threshold if too many cells are dimmed.',
      'Done when the grid answers the question you came with — then save it so you can ask again next month.',
    ],
    needs: ['Sign in.', 'Hands in the dataset you point it at: your own for My hands, the shipped corpus for the pool.'],
    limits: [
      'Not every stat can be asked of every grouping: a once-per-hand stat cannot be split by something that only exists per decision, and the engine says so instead of guessing.',
      'A dimmed cell is not a small number, it is an unknown one.',
      'A count is never compared against the field — your 3,000 hands against the pool’s nine million is arithmetic, not information.',
    ],
    related: ['pool', 'leaks', 'my-game'],
    example: 'top-pair-dry-board',
    account: 'required',
  },
];
