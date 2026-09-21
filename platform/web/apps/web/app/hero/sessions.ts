/**
 * Sessions, as a table reads them (plan D.4).
 *
 * Every figure here is the server's — `analysis/hero/sessions.py` already splits the hands on a
 * gap and totals each sitting, `bb_per_100` included. Nothing is recomputed: a second winrate
 * derived in the browser is a second source of truth, and the one on screen would be the one
 * nobody tested. This module only *words* them.
 *
 * **The one judgement it does make is about thin sessions**, and it is the same judgement the
 * rest of the platform makes about thin anything. A sitting of eleven hands that lost 14.5 bb
 * is a real fact; `−131.82 bb/100` is that fact wearing a rate's clothing, and a column of rates
 * invites reading down it. So a session under `THIN_HANDS` keeps its hands and its big blinds —
 * those are counts, and counts are exact — and its **rate is withheld**, with the reason on the
 * row. The threshold is `stats/interval.py`'s own `MIN_N_MEAN`: the sample below which the
 * engine refuses to put an interval on a per-100 mean at all. Using a second number here would
 * make the same eleven hands "enough" on this screen and "not enough" on every other.
 */

import type { Dimension, Stat } from '../stats/api';
import type { TermEntry } from '../stats/vocabulary';
import { dimensionEntry, statEntry } from '../stats/vocabulary';
import type { Session, SessionsResult } from './api';

/**
 * Hands below which a session's per-100 rate is not shown.
 *
 * 30 is `MIN_N_MEAN` in `platform/stats/interval.py`, where it is justified against Student's
 * *t*: below thirty the normal quantile understates a per-100 band badly (6.5x at n = 2), which
 * is why the engine sends no interval there. A rate the engine will not put an error bar on is
 * a rate this table will not print.
 */
export const THIN_HANDS = 30;

const LOCALE = 'en-US';
const MINUTES_PER_HOUR = 60;
const DASH = '—';

export interface SessionRow {
  /** `started_at` verbatim: a session is derived from a gap, so it has no id but is unique by start. */
  key: string;
  /** `18 Aug, 16:46` — date and clock, because two sittings a day is the normal case. */
  when: string;
  /** `1h 24m`, or `18m` under an hour. */
  duration: string;
  hands: number;
  handsText: string;
  /** Big blinds won, signed. Exact whatever the sample: it is a sum, not a rate. */
  netText: string;
  /** All-in adjusted big blinds, signed. */
  evText: string;
  /** The rate, or `''` when the sitting is too short to carry one. */
  rateText: string;
  /** Whether the sitting was won, lost, or exactly flat — for colour, from an exact number. */
  sense: 'good' | 'bad' | '';
  thin: boolean;
  /** Why the rate is missing — the sentence `thinRateTerm` puts behind the word on the row. */
  note: string;
  /** `ggpoker · NL10`, or both lists joined where a sitting spanned more than one. */
  where: string;
}

/** `+412` / `−272`, with a real minus sign, matching `reports/cell.ts`. */
function signed(value: number, digits: number): string {
  const text = Math.abs(value).toLocaleString(LOCALE, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  if (value > 0) return `+${text}`;
  return value < 0 ? `−${text}` : text;
}

export function duration(minutes: number): string {
  if (minutes < MINUTES_PER_HOUR) return `${minutes}m`;
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const rest = minutes % MINUTES_PER_HOUR;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * `2026-08-18T16:46:10` → `18 Aug, 16:46`.
 *
 * Split rather than parsed through `Date`: ClickHouse sends these without a zone, and handing a
 * zone-less string to `new Date` invites the browser to apply the reader's offset and move a
 * late-night session onto the next day. The clock shown is the one the hand history recorded.
 */
export function when(iso: string): string {
  const [date, time] = iso.split('T');
  if (date === undefined) return iso;
  const [, month, day] = date.split('-').map(Number);
  const clock = (time ?? '').slice(0, 5);
  if (month === undefined || day === undefined || Number.isNaN(month + day)) return iso;
  const stamp = `${day} ${MONTHS[month - 1] ?? '?'}`;
  return clock === '' ? stamp : `${stamp}, ${clock}`;
}

function where(session: Session): string {
  const parts = [session.sites.join(', '), session.stakes.join(', ')].filter((part) => part !== '');
  return parts.length === 0 ? DASH : parts.join(' · ');
}

export function sessionRow(session: Session): SessionRow {
  const thin = session.hands < THIN_HANDS;
  return {
    key: session.started_at,
    when: when(session.started_at),
    duration: duration(session.minutes),
    hands: session.hands,
    handsText: session.hands.toLocaleString(LOCALE),
    netText: signed(session.net_bb, 2),
    evText: signed(session.ev_bb, 2),
    rateText: thin ? '' : signed(session.bb_per_100, 2),
    sense: session.net_bb > 0 ? 'good' : session.net_bb < 0 ? 'bad' : '',
    thin,
    note: thin
      ? `${session.hands} hands is too few for a per-100 rate to mean anything — the big blinds beside it are exact.`
      : '',
    where: where(session),
  };
}

/** Newest first: the sitting a player wants is almost always the last one. */
export function sessionRows(sessions: readonly Session[]): SessionRow[] {
  return [...sessions].reverse().map(sessionRow);
}

export interface SessionTotals {
  sessions: number;
  hands: number;
  handsText: string;
  netText: string;
  /** How many sittings finished up, and the share as a percentage of those with any hands. */
  winning: number;
  winningText: string;
  /** The gap the split used, worded, because it decides what a "session" even is. */
  gapText: string;
}

/** The three money columns, each explained by the registry entry it is a total of (ADR-057). */
export interface SessionHeaders {
  net: TermEntry;
  ev: TermEntry;
  rate: TermEntry;
}

/** The codes behind the three columns: two sums over `player_hands`, and the rate itself. */
const NET_CODE = 'net_won_bb';
const EV_CODE = 'ev_won_bb';
const RATE_CODE = 'bb_per_100';

/**
 * What `bb`, `EV bb` and `bb/100` mean, in the registry's own words.
 *
 * The three headings were bare abbreviations with nothing behind them, and the middle one is the
 * app's worst ambiguity: "EV" here is the **all-in adjusted** total, while the poker glossary's
 * EV is a solver's. Naming the dimension it sums (`ev_won_bb`, "All-in adjusted won (bb)") settles
 * which of the two a reader is looking at without renaming the column they already know.
 */
export function sessionHeaders(stats: readonly Stat[], dims: ReadonlyMap<string, Dimension>): SessionHeaders {
  return {
    net: dimensionEntry(dims.get(NET_CODE), NET_CODE),
    ev: dimensionEntry(dims.get(EV_CODE), EV_CODE),
    rate: statEntry(stats.find((stat) => stat.code === RATE_CODE), RATE_CODE),
  };
}

/**
 * Why a sitting's rate is missing, as a word that can be hovered, tabbed to and tapped.
 *
 * The reason was on the cell's `title`, which is a mouse affordance on an element no keyboard can
 * reach — so the one reader most likely to misread `—` as "nothing happened" never saw it.
 */
export function thinRateTerm(note: string): TermEntry {
  return { term: 'too few hands', definition: note };
}

/**
 * The line under the table. `hands` and `net_bb` are the server's own totals rather than a sum
 * of the rows — if the two ever disagree, the disagreement is worth seeing, not hiding.
 */
export function sessionTotals(result: SessionsResult): SessionTotals {
  const played = result.sessions.filter((session) => session.hands > 0);
  const winning = played.filter((session) => session.net_bb > 0).length;
  const share = played.length === 0 ? null : (winning / played.length) * 100;
  return {
    sessions: result.sessions.length,
    hands: result.hands,
    handsText: result.hands.toLocaleString(LOCALE),
    netText: signed(result.net_bb, 2),
    winning,
    winningText: share === null ? DASH : `${winning} of ${played.length} (${share.toFixed(0)}%)`,
    gapText: `split where play paused for more than ${duration(result.gap_minutes)}`,
  };
}
