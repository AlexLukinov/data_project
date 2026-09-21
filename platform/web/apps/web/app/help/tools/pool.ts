/**
 * The Pool: what the field does, sliced any way, for any slice of players.
 *
 * Read from `analysis/pool/service.py`, `analysis/pool/cohorts.py` and, for the per-player
 * screen, `~/pool/stats.ts#searchPlayers` and `#playerReport`. The gating rule is
 * `analysis/pool/node_query.py`'s `MIN_N` and the client's `~/reports/cell.ts`.
 */
import type { Tool } from './types';

const AREA = 'Pool' as const;

export const POOL_TOOLS: readonly Tool[] = [
  // The reports engine asked of the population dataset, with the dataset locked and cohorts added.
  {
    id: 'pool',
    area: AREA,
    route: '/pool',
    name: 'The pool',
    what: 'What the field does, in the same grid the reports workbench uses.',
    how: [
      'It is the report engine pointed at the population corpus rather than at your hands, with the dataset locked so a pool question cannot accidentally be answered from your own play.',
      'Two cohorts can be put side by side: each is run as its own report over the same situation and the grids are aligned row by row, so a row one cohort never reached is a dash rather than a zero.',
      'Every cell carries its own sample size and a thin one is dimmed and left uncompared — the same rule, in the same file, as My game.',
    ],
    steps: [
      'Pick the stats, then narrow the situation in the filter bar.',
      'Choose what to group by — position, board texture, bet size, anything the registry knows.',
      'Optionally pick a cohort, and a second one to compare against.',
      'Run it, then raise the reading threshold until only the rows you would act on are left undimmed.',
      'Done when you can state what the field does here in one sentence, with the sample it rests on.',
    ],
    needs: ['Sign in.', 'The population corpus, which ships with the platform.'],
    limits: [
      'The pool is a description, never a recommendation: it is the sum of what people did, mistakes included.',
      'Nothing is invented to fill a gap — a bucket nobody reached renders as a dash.',
      'A cell under the threshold shows its value but no comparison; the threshold is yours to set, and zero means “show me everything, I know why”.',
    ],
    related: ['cohorts', 'players', 'reports'],
    example: 'top-pair-dry-board',
    account: 'required',
  },
  // `analysis/pool/cohorts.py`: a cohort is a rule evaluated per player at query time.
  {
    id: 'cohorts',
    area: AREA,
    route: '/pool/cohorts',
    name: 'Cohorts',
    what: 'Slices of the field named by what its players do, not by who they are.',
    how: [
      'A cohort is a rule — VPIP under 25 and at least a thousand hands, say — evaluated against the cached per-player stats every time a report runs. Nothing stores a member list.',
      'That is why “regulars” means whoever is playing like one over the dates you asked about, and why the size shown here is a figure fetched just now rather than a stored count.',
      'Two sources are listed as one: the rules the platform ships, and the ones you have saved. A shipped rule can be copied into a saved one, which is the only way to list the players it names.',
    ],
    steps: [
      'Read the shipped rules first to see the shape of one.',
      'Press New, name it, and add conditions — a stat, a comparison and a number.',
      'Save it; the list is read back from the server, so what you see is what is stored.',
      'Open it to see its current size and its members with their headline stats.',
      'Done when a cohort you wrote picks out the players you meant.',
    ],
    needs: ['Sign in.', 'A stat the engine can evaluate per player — the form says which ones it cannot.'],
    limits: [
      'A cohort can only be built from stats that exist per player; a rule on anything else is refused with the reason.',
      'Membership moves as play moves. The same cohort over different dates is a different set of people.',
      'At most a thousand members are listed, and the list is not the cohort — the rule is.',
    ],
    related: ['pool', 'players', 'leaks'],
    example: 'top-pair-dry-board',
    account: 'required',
  },
  // `~/pool/stats.ts#searchPlayers` — a substring over `player_key` through the ordinary report
  // path; `#playerReport` scopes by `player_key` rather than grouping by it.
  {
    id: 'players',
    area: AREA,
    route: '/pool/players',
    name: 'Player lookup',
    what: 'Find one opponent in the pool and read their game.',
    how: [
      'The search is a substring match over the player column, run through the ordinary report path, because the keys in the corpus are namespaced by site and a prefix search answers “no such player” to everyone.',
      'A player report scopes the query to that one key rather than grouping by it — grouping by player is a question the decision tables cannot answer, and the engine refuses it by design.',
      'This exists for the population corpus only. Your own hands carry session-scoped aliases for opponents, so there is nothing stable to look up there.',
    ],
    steps: [
      'Type part of a screen name and search.',
      'Pick a result; the report below is that player alone.',
      'Read the sample size first — one opponent is a small sample by construction.',
      'Done when you know how that player differs from the cohort you would otherwise have assumed.',
    ],
    needs: ['Sign in.', 'Pool hands that carry screen names, which the population corpus does.'],
    limits: [
      'Anonymised tables give you nothing here: no stable name, no cross-session player.',
      'There is no filter bar — the search and the member routes take no situation.',
      'A single opponent’s numbers are thin almost always; treat them as a hint, not a read.',
    ],
    related: ['pool', 'cohorts', 'hands'],
    example: 'range-ahead-hand-behind',
    account: 'required',
  },
];
