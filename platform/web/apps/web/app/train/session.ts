/**
 * A training run (spec §16): serve a spot, take a committed answer, reveal the truth, record it,
 * and decide what comes next.
 *
 * Two rules it exists to keep. **The truth is fetched after the commit** (ADR-034): nothing asks
 * for an answer until every question on the spot has one, so a user who opens the devtools before
 * answering finds nothing to find. And **what comes next is the schedule's choice, not chance**:
 * the queue serves whatever is overdue before it invents a new spot, which is what makes the
 * intervals in `@poker/core`'s `nextReview` mean anything.
 *
 * Framework-free apart from `ref`, dependencies injected as interfaces, so the whole flow —
 * including the answer failing to arrive — is tested against fakes.
 */
import type { EquityServiceLike, PredictionOutcome } from '@poker/ui';
import type { ReviewState } from '@poker/core';
import { dueFirst, nextReview, randomSeed } from '@poker/core';
import type { Ref } from 'vue';
import { ref, shallowRef } from 'vue';

import { describeApiError } from '../auth/api';

import type { ReviewRow, TrainingCache } from './cache';
import { answersOf, generateSpot } from './spot';
import type { ScoreRow, SpotAnswers, TrainMode, TrainSpot } from './types';

export type TrainerStatus = 'idle' | 'asking' | 'checking' | 'revealed';

const CANNOT_ANSWER = 'That answer could not be worked out here — skip on to the next spot.';

export interface TrainerDeps {
  readonly cache: TrainingCache;
  readonly service: EquityServiceLike;
  /** Injected so a test can freeze the clock, the seeds and the ids. */
  readonly now?: () => Date;
  readonly seed?: () => number;
  readonly id?: () => string;
}

export interface Trainer {
  readonly spot: Ref<TrainSpot | null>;
  readonly given: Ref<Record<string, string>>;
  readonly truth: Ref<SpotAnswers>;
  readonly status: Ref<TrainerStatus>;
  readonly unavailable: Ref<string>;
  readonly served: Ref<number>;
  readonly right: Ref<number>;
  readonly due: Ref<number>;
  /** True when this spot is owed a review rather than being new. */
  readonly repeat: Ref<boolean>;
  start(): Promise<void>;
  commit(key: string, answer: string): void;
  settle(key: string, outcome: PredictionOutcome, weightError?: number | null): Promise<void>;
  next(): Promise<void>;
}

interface Wired {
  readonly cache: TrainingCache;
  readonly service: EquityServiceLike;
  readonly now: () => Date;
  readonly seed: () => number;
  readonly id: () => string;
}

interface State {
  spot: Ref<TrainSpot | null>;
  given: Ref<Record<string, string>>;
  truth: Ref<SpotAnswers>;
  status: Ref<TrainerStatus>;
  unavailable: Ref<string>;
  served: Ref<number>;
  right: Ref<number>;
  due: Ref<number>;
  repeat: Ref<boolean>;
}

interface Context {
  readonly mode: TrainMode;
  readonly deps: Wired;
  readonly state: State;
  /** `hash#key` of every question already written down, so a repeated reveal cannot double-count. */
  readonly settled: Set<string>;
  reviews: ReviewRow[];
}

/** Everything overdue, longest first, minus the spot already on screen. */
function owed(ctx: Context, exclude: string): ReviewRow[] {
  const byHash = new Map(ctx.reviews.map((row) => [row.spot_hash, row]));
  return dueFirst(ctx.reviews, ctx.deps.now())
    .filter((row) => row.spot_hash !== exclude)
    .map((row) => byHash.get(row.spot_hash))
    .filter((row): row is ReviewRow => row !== undefined);
}

function serve(ctx: Context, spot: TrainSpot, repeat: boolean): void {
  // The guard is per *serving*, not per spot. It exists because `PredictionGate` emits `reveal`
  // from a watcher and may emit it more than once for one answer; it must not also swallow the
  // second answer to a spot that came back for review, which is the whole point of the schedule.
  ctx.settled.clear();
  ctx.state.spot.value = spot;
  ctx.state.given.value = {};
  ctx.state.truth.value = {};
  ctx.state.unavailable.value = '';
  ctx.state.status.value = 'asking';
  ctx.state.repeat.value = repeat;
  ctx.state.due.value = owed(ctx, spot.hash).length;
}

/** Ask for the truth — only ever called once every question has an answer. */
async function reveal(ctx: Context, spot: TrainSpot): Promise<void> {
  ctx.state.status.value = 'checking';
  try {
    const answers = await answersOf(spot, { service: ctx.deps.service });
    if (ctx.state.spot.value?.hash !== spot.hash) return; // moved on while it was working
    ctx.state.truth.value = answers;
  } catch (error) {
    if (ctx.state.spot.value?.hash === spot.hash) {
      ctx.state.unavailable.value = describeApiError(error, CANNOT_ANSWER);
    }
  } finally {
    if (ctx.state.spot.value?.hash === spot.hash) ctx.state.status.value = 'revealed';
  }
}

/**
 * Whether the mode counts this as known.
 *
 * Every mode but the range drawing takes the gate's verdict. The drawing mode scores on total
 * absolute weight error instead (spec §16), because a range of the right width made of the wrong
 * hands is not a range you know.
 */
function verdict(spot: TrainSpot, outcome: PredictionOutcome, weightError: number | null): boolean {
  if (spot.mode === 'drawing' && weightError !== null) return weightError <= spot.weightTolerance;
  return outcome.withinTolerance;
}

function scoreRow(
  ctx: Context,
  spot: TrainSpot,
  key: string,
  outcome: PredictionOutcome,
  weightError: number | null,
): ScoreRow {
  return {
    id: ctx.deps.id(),
    mode: spot.mode,
    spot_hash: spot.hash,
    question_key: key,
    question: spot.questions.find((q) => q.key === key)?.question ?? '',
    prediction: outcome.answer,
    actual: outcome.actual,
    error: outcome.error,
    correct: verdict(spot, outcome, weightError),
    weight_error: weightError,
    bucket: spot.bucket,
    created_at: ctx.deps.now().toISOString(),
  };
}

/** Move a question's review state on. A two-question spot schedules each half on its own. */
async function schedule(ctx: Context, spot: TrainSpot, key: string, correct: boolean): Promise<void> {
  const hash = key === '' ? spot.hash : `${spot.hash}#${key}`;
  const previous: ReviewState | undefined = ctx.reviews.find((row) => row.spot_hash === hash);
  const next: ReviewRow = {
    ...nextReview(previous ?? null, { spot_hash: hash, mode: spot.mode }, correct, ctx.deps.now()),
    seed: spot.seed,
  };
  ctx.reviews = [...ctx.reviews.filter((row) => row.spot_hash !== hash), next];
  await ctx.deps.cache.putReview(next);
}

async function record(
  ctx: Context,
  key: string,
  outcome: PredictionOutcome,
  weightError: number | null,
): Promise<void> {
  const spot = ctx.state.spot.value;
  if (spot === null) return;
  const once = `${spot.hash}#${key}`;
  if (ctx.settled.has(once)) return;
  ctx.settled.add(once);

  const row = scoreRow(ctx, spot, key, outcome, weightError);
  ctx.state.served.value += 1;
  if (row.correct) ctx.state.right.value += 1;
  await ctx.deps.cache.addScore(row);
  await schedule(ctx, spot, key, row.correct);
  ctx.state.due.value = owed(ctx, spot.hash).length;
}

/** The overdue spot if there is one, else a brand-new seed. */
function advance(ctx: Context): void {
  const first = owed(ctx, ctx.state.spot.value?.hash ?? '')[0];
  if (first !== undefined) serve(ctx, generateSpot(ctx.mode, first.seed), true);
  else serve(ctx, generateSpot(ctx.mode, ctx.deps.seed()), false);
}

function commit(ctx: Context, key: string, answer: string): void {
  ctx.state.given.value = { ...ctx.state.given.value, [key]: answer };
  const spot = ctx.state.spot.value;
  if (spot === null) return;
  if (spot.questions.every((q) => (ctx.state.given.value[q.key] ?? '') !== '')) {
    void reveal(ctx, spot);
  }
}

function makeState(): State {
  // The spot and its answers are replaced whole, never edited in place, and they must be able to
  // reach IndexedDB and the Worker — so they are shallow: a deep `ref` would hand out proxies
  // that `structuredClone` refuses (F.6's `DataCloneError`).
  return {
    spot: shallowRef<TrainSpot | null>(null),
    given: shallowRef<Record<string, string>>({}),
    truth: shallowRef<SpotAnswers>({}),
    status: ref<TrainerStatus>('idle'),
    unavailable: ref(''),
    served: ref(0),
    right: ref(0),
    due: ref(0),
    repeat: ref(false),
  };
}

function wire(deps: TrainerDeps): Wired {
  return {
    cache: deps.cache,
    service: deps.service,
    now: deps.now ?? ((): Date => new Date()),
    seed: deps.seed ?? randomSeed,
    id: deps.id ?? ((): string => crypto.randomUUID()),
  };
}

/** Start a run of one mode. The returned object is the page's whole surface. */
export function createTrainer(mode: TrainMode, deps: TrainerDeps): Trainer {
  const state = makeState();
  const ctx: Context = { mode, deps: wire(deps), state, settled: new Set<string>(), reviews: [] };

  return {
    ...state,
    async start(): Promise<void> {
      ctx.reviews = await ctx.deps.cache.reviews(mode);
      advance(ctx);
    },
    commit: (key, answer) => commit(ctx, key, answer),
    settle: (key, outcome, weightError = null) => record(ctx, key, outcome, weightError),
    next: () => Promise.resolve(advance(ctx)),
  };
}
