/**
 * When a drilled spot — or a written heuristic — should come back (spec §16: "re-serve missed
 * spots at increasing intervals", and the "still true?" prompt after 14 days).
 *
 * Kept here, pure and clock-injected, because scheduling is the one part of the training modes
 * that is easy to get quietly wrong and impossible to eyeball in a component: every function
 * takes `now` as an argument and returns ISO strings, so a month of review behaviour is a unit
 * test rather than a week of waiting.
 *
 * The scheme is Leitner. A spot lives in a box; answering it correctly promotes it one box and
 * pushes its next showing out by that box's interval, while a miss drops it straight back to box
 * 0, where it is due again at once. Intervals grow roughly geometrically, which is what "at
 * increasing intervals" means in practice:
 *
 *     box     0     1     2     3     4     5
 *     days    0     1     3     7    16    35
 */

/** Days until a spot in each box is due again. Index = box; the last entry is the ceiling. */
export const REVIEW_INTERVALS_DAYS: readonly number[] = [0, 1, 3, 7, 16, 35];

/** Days before a written heuristic is worth questioning again (spec §16). */
export const HEURISTIC_REVIEW_DAYS = 14;

const MS_PER_DAY = 86_400_000;
const FIRST_BOX = 0;

/** What identifies a drilled spot: the mode it belongs to and its content hash. */
export interface ReviewKey {
  readonly spot_hash: string;
  readonly mode: string;
}

/** How well a single spot is known, and when it is next worth serving. */
export interface ReviewState {
  readonly spot_hash: string;
  readonly mode: string;
  /** Leitner box, 0 (just missed) up to `REVIEW_INTERVALS_DAYS.length - 1`. */
  readonly box: number;
  /** ISO instant from which this spot is due again. */
  readonly due_at: string;
  readonly last_seen_at: string;
  readonly hits: number;
  readonly misses: number;
}

const LAST_BOX = REVIEW_INTERVALS_DAYS.length - 1;

/** The interval of a box, clamped into the table so an out-of-range box cannot throw. */
export function intervalOf(box: number): number {
  const at = Math.min(Math.max(Math.trunc(box), FIRST_BOX), LAST_BOX);
  return REVIEW_INTERVALS_DAYS[at]!;
}

function plusDays(now: Date, days: number): string {
  return new Date(now.getTime() + days * MS_PER_DAY).toISOString();
}

/**
 * The state a spot is in after it has just been answered.
 *
 * `previous` is `null` the first time a spot is served. A correct answer promotes one box (a new
 * spot lands in box 1, a day away); a miss returns it to box 0 and makes it due immediately, so
 * the session can serve it again before the user has forgotten what they got wrong.
 */
export function nextReview(
  previous: ReviewState | null,
  key: ReviewKey,
  correct: boolean,
  now: Date,
): ReviewState {
  const from = previous?.box ?? FIRST_BOX;
  const box = correct ? Math.min(from + 1, LAST_BOX) : FIRST_BOX;
  return {
    spot_hash: key.spot_hash,
    mode: key.mode,
    box,
    due_at: plusDays(now, intervalOf(box)),
    last_seen_at: now.toISOString(),
    hits: (previous?.hits ?? 0) + (correct ? 1 : 0),
    misses: (previous?.misses ?? 0) + (correct ? 0 : 1),
  };
}

/** Whether this spot has come round again. */
export function isDue(state: ReviewState, now: Date): boolean {
  return Date.parse(state.due_at) <= now.getTime();
}

/**
 * The spots owed, longest overdue first.
 *
 * The tiebreak on `spot_hash` is not decoration: two spots missed in the same millisecond must
 * come back in a fixed order, or the queue reshuffles itself on every render.
 */
export function dueFirst(states: readonly ReviewState[], now: Date): ReviewState[] {
  return states
    .filter((state) => isDue(state, now))
    .sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at) || a.spot_hash.localeCompare(b.spot_hash));
}

/** When a heuristic last answered at `answered_at` should be questioned again. */
export function heuristicDueAt(answeredAt: string, days = HEURISTIC_REVIEW_DAYS): string {
  const at = Date.parse(answeredAt);
  if (!Number.isFinite(at)) throw new RangeError(`not an instant: ${answeredAt}`);
  return new Date(at + days * MS_PER_DAY).toISOString();
}

/**
 * Whether a heuristic is owed its "still true?" prompt.
 *
 * `confirmedAt` is when the question was last answered; before it ever has been, the clock runs
 * from when the heuristic was written.
 */
export function heuristicIsDue(
  createdAt: string,
  confirmedAt: string | null,
  now: Date,
  days = HEURISTIC_REVIEW_DAYS,
): boolean {
  return Date.parse(heuristicDueAt(confirmedAt ?? createdAt, days)) <= now.getTime();
}
