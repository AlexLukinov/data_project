/**
 * The reference charts the offline training modes drill against (spec §16, §17).
 *
 * **These are rule-of-thumb baselines, not solver output.** No solver was asked; they are the
 * ordinary 6-max 100bb ranges a player would be taught, and every screen that uses one says so.
 * They exist because the trainers must work with no backend at all (spec §17), so they cannot
 * wait on the range library or the pool. Once a chart of your own is imported for the same
 * situation, that is the better reference — the library, not this file, is the record.
 */
export interface ReferenceChart {
  readonly id: string;
  /** The situation, in the shorthand the library and the replayer use. */
  readonly label: string;
  readonly position: string;
  readonly text: string;
}

export const CHARTS: readonly ReferenceChart[] = [
  {
    id: 'utg_rfi',
    label: 'UTG open · 100bb · 6-max',
    position: 'UTG',
    text: '55+,A9s+,A5s-A3s,KTs+,QTs+,JTs,T9s,98s,87s,AJo+,KJo+,QJo',
  },
  {
    id: 'hj_rfi',
    label: 'HJ open · 100bb · 6-max',
    position: 'HJ',
    text: '44+,A7s+,A5s-A2s,K9s+,QTs+,JTs,T9s,98s,87s,76s,ATo+,KJo+,QJo',
  },
  {
    id: 'co_rfi',
    label: 'CO open · 100bb · 6-max',
    position: 'CO',
    text: '22+,A2s+,K7s+,Q9s+,J9s+,T8s+,97s+,86s+,75s+,65s,A9o+,KTo+,QTo+,JTo',
  },
  {
    id: 'btn_rfi',
    label: 'BTN open · 100bb · 6-max',
    position: 'BTN',
    text: '22+,A2s+,K2s+,Q5s+,J7s+,T7s+,96s+,85s+,74s+,64s+,53s+,A2o+,K7o+,Q9o+,J9o+,T9o,98o,87o',
  },
  {
    id: 'sb_rfi',
    label: 'SB open · 100bb · 6-max',
    position: 'SB',
    text: '22+,A2s+,K6s+,Q8s+,J8s+,T8s+,97s+,86s+,75s+,65s,A4o+,K9o+,Q9o+,J9o+,T9o',
  },
  {
    id: 'bb_call_vs_btn',
    label: 'BB call vs BTN open · 100bb',
    position: 'BB',
    text: '22+,A2s+,K2s+,Q5s+,J7s+,T7s+,96s+,85s+,75s+,64s+,54s,A2o+,K7o+,Q8o+,J8o+,T8o+,97o+,87o',
  },
  {
    id: 'btn_3bet_vs_co',
    label: 'BTN 3-bet vs CO open · 100bb',
    position: 'BTN',
    text: 'TT+,AJs+,KQs,A5s-A4s,AKo',
  },
  {
    id: 'bb_3bet_vs_btn',
    label: 'BB 3-bet vs BTN open · 100bb',
    position: 'BB',
    text: '99+,ATs+,KJs+,QJs,JTs,A5s-A3s,76s,65s,AJo+,KQo',
  },
];

const BY_ID = new Map<string, ReferenceChart>(CHARTS.map((chart) => [chart.id, chart]));

/** A chart by id. Throws rather than rendering an empty grid. */
export function chartById(id: string): ReferenceChart {
  const found = BY_ID.get(id);
  if (found === undefined) throw new RangeError(`no such reference chart: ${id}`);
  return found;
}

/** The one sentence every screen showing a reference chart has to print. */
export const CHART_PROVENANCE =
  'A rule-of-thumb reference chart, not a solve — no solver was asked. Import your own chart for this situation and it becomes the better reference.';
