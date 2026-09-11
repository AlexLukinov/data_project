/**
 * What `/progress` shows (spec §16): "accuracy per mode over time, and per hand class or texture
 * where applicable" — and acceptance 11's "train for 10 minutes and see my accuracy trend over
 * the past month".
 *
 * Pure aggregation over the scoring rows, clock injected. A day with no practice in it is kept in
 * the series as a gap rather than dropped, because a trend line that silently closes up over the
 * days you did nothing flatters you.
 */
import type { ScoreRow, TrainMode } from './types';

const PERCENT = 100;
const MS_PER_DAY = 86_400_000;
export const TREND_DAYS = 30;
/** Below this many answers a day's accuracy is noise; the chart draws it, muted. */
export const THIN_SAMPLE = 3;

export interface DayPoint {
  /** `YYYY-MM-DD`, in the viewer's own timezone — practice is a local-calendar thing. */
  readonly date: string;
  readonly served: number;
  readonly right: number;
  /** Share in 0..1, or `null` on a day with nothing in it. */
  readonly accuracy: number | null;
}

export interface BucketRow {
  readonly bucket: string;
  readonly served: number;
  readonly right: number;
  readonly accuracy: number;
}

export interface ModeProgress {
  readonly mode: TrainMode;
  readonly served: number;
  readonly right: number;
  /** Share in 0..1; `null` when the mode has never been practised. */
  readonly accuracy: number | null;
  readonly days: readonly DayPoint[];
  readonly buckets: readonly BucketRow[];
  readonly lastAt: string;
}

/** The local calendar day a row belongs to. */
export function dayOf(iso: string): string {
  const at = new Date(iso);
  const local = new Date(at.getTime() - at.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/** The last `days` calendar days ending today, oldest first. */
export function calendarDays(now: Date, days = TREND_DAYS): string[] {
  const out: string[] = [];
  for (let back = days - 1; back >= 0; back -= 1) {
    out.push(dayOf(new Date(now.getTime() - back * MS_PER_DAY).toISOString()));
  }
  return out;
}

function share(right: number, served: number): number | null {
  return served === 0 ? null : right / served;
}

/** One point per calendar day in the window, whether or not anything was answered on it. */
export function trend(rows: readonly ScoreRow[], now: Date, days = TREND_DAYS): DayPoint[] {
  const served = new Map<string, number>();
  const right = new Map<string, number>();
  for (const row of rows) {
    const day = dayOf(row.created_at);
    served.set(day, (served.get(day) ?? 0) + 1);
    if (row.correct) right.set(day, (right.get(day) ?? 0) + 1);
  }
  return calendarDays(now, days).map((date) => {
    const total = served.get(date) ?? 0;
    const hits = right.get(date) ?? 0;
    return { date, served: total, right: hits, accuracy: share(hits, total) };
  });
}

/**
 * Accuracy per hand class, texture or bet size — the "where applicable" breakdown.
 *
 * Rows with no bucket are dropped rather than pooled under an empty label: a mode that does not
 * classify its spots should show no table at all, not a single meaningless line.
 */
export function buckets(rows: readonly ScoreRow[]): BucketRow[] {
  const served = new Map<string, number>();
  const right = new Map<string, number>();
  for (const row of rows) {
    if (row.bucket === '') continue;
    served.set(row.bucket, (served.get(row.bucket) ?? 0) + 1);
    if (row.correct) right.set(row.bucket, (right.get(row.bucket) ?? 0) + 1);
  }
  return [...served.entries()]
    .map(([bucket, total]) => ({
      bucket,
      served: total,
      right: right.get(bucket) ?? 0,
      accuracy: (right.get(bucket) ?? 0) / total,
    }))
    .sort((a, b) => b.served - a.served || a.bucket.localeCompare(b.bucket));
}

/** Everything `/progress` needs about one mode. */
export function progressOf(
  mode: TrainMode,
  all: readonly ScoreRow[],
  now: Date,
  days = TREND_DAYS,
): ModeProgress {
  const rows = all.filter((row) => row.mode === mode);
  const right = rows.filter((row) => row.correct).length;
  const last = rows.reduce((latest, row) => (row.created_at > latest ? row.created_at : latest), '');
  return {
    mode,
    served: rows.length,
    right,
    accuracy: share(right, rows.length),
    days: trend(rows, now, days),
    buckets: buckets(rows),
    lastAt: last,
  };
}

/**
 * The runs of consecutive days that were actually practised, as indices into `points`.
 *
 * This is what keeps a gap a gap: the trend is drawn as one line per run, so the days you did
 * nothing are a break rather than a straight segment sloping through them. A run of one day has
 * no line to draw and is left out — its dot still gets drawn on its own.
 */
export function practisedRuns(points: readonly DayPoint[]): number[][] {
  const runs: number[][] = [];
  let run: number[] = [];
  points.forEach((point, at) => {
    if (point.accuracy === null) {
      if (run.length > 1) runs.push(run);
      run = [];
      return;
    }
    run.push(at);
  });
  if (run.length > 1) runs.push(run);
  return runs;
}

/** The percentage a share prints as, or an em dash when there is nothing to print. */
export function accuracyText(value: number | null): string {
  return value === null ? '—' : `${(value * PERCENT).toFixed(0)}%`;
}
