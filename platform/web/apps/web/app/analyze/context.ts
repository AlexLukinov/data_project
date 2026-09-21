/**
 * What every step component is handed, and the one helper they all use to write back.
 *
 * A step reads the whole analysis (the spot the earlier steps built, what the pool says — and why
 * it cannot say it, when it cannot) and writes only its own square of it, which is what keeps the
 * autosave a merge and the nine components independent of each other.
 */
import type { NodeKey } from '@poker/core';

import type { AnalysisStep, StepWork } from './api';
import type { NodeFrequencies } from '~/pool/api';
import type { Spot } from './spot';

export interface StepContext {
  readonly step: AnalysisStep;
  /** Every step, so a later one can read what an earlier one recorded (the size, the hand). */
  readonly steps: readonly AnalysisStep[];
  readonly node: NodeKey | null;
  /** Everything steps 1–5 have established: the ranges, the board, hero's cards. */
  readonly spot: Spot;
  /** The field's frequencies at this node, fetched only once a prediction has been committed. */
  readonly pool: NodeFrequencies | null;
  /** The same, at the node villain is in once hero has acted — where folding is possible. */
  readonly poolFacing: NodeFrequencies | null;
  /**
   * Why `pool` is `null` and never coming — the request failed, or this analysis has no pool
   * behind it at all (an example). Empty while an answer is still on its way, which is the only
   * state in which the gate is right to say it is working the number out (ADR-061).
   */
  readonly poolMissing?: string;
  /** The same for `poolFacing`: the two are separate requests and fail separately. */
  readonly poolFacingMissing?: string;
  /** Why this analysis cannot reach the reader's own range library, so step 1 does not offer it. */
  readonly libraryMissing?: string;
  /** The analysis's heuristic — step 9 writes it, and it outlives the analysis (F.11). */
  readonly heuristic: string;
}

/**
 * Why a pool-backed step has no number to show. Empty while there is one — or while the answer
 * is still on its way, which the gate says in its own words.
 *
 * `missing` is what to say when there is no pool answer at all: an empty string leaves the gate
 * waiting, which is right only while a request is in flight. Every caller passes the context's
 * own reason, so a failed fetch and an example both end the wait with a sentence (ADR-061).
 */
export function poolGap(pool: NodeFrequencies | null, missing = ''): string {
  if (pool === null) return missing;
  if (pool.enough) return '';
  return `The pool has played this ${pool.sample_size} times — too few to put a number on; ${pool.min_n} are needed.`;
}

/** What an earlier step wrote, for a later one to read. */
export function workOf(steps: readonly AnalysisStep[], step: number): StepWork | null {
  return steps.find((s) => s.step === step)?.work ?? null;
}

/** A patch that changes part of a step's work and nothing else. */
export function workPatch(step: AnalysisStep, patch: Partial<StepWork>): Partial<AnalysisStep> {
  return { work: { ...step.work, ...patch } };
}
