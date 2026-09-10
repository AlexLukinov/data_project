/**
 * What every step component is handed, and the one helper they all use to write back.
 *
 * A step reads the whole analysis (the spot the earlier steps built, the hand, what the pool
 * says) and writes only its own square of it — which is what keeps the autosave a merge and the
 * nine components independent of each other.
 */
import type { NodeKey, ReplayHand } from '@poker/core';

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
  readonly hand: ReplayHand | null;
  /** The field's frequencies at this node, fetched only once a prediction has been committed. */
  readonly pool: NodeFrequencies | null;
  /** The same, at the node villain is in once hero has acted — where folding is possible. */
  readonly poolFacing: NodeFrequencies | null;
  /** The analysis's heuristic — step 9 writes it, and it outlives the analysis (F.11). */
  readonly heuristic: string;
}

/**
 * Why a pool-backed step has no number to show. Empty while there is one — or while the answer
 * is still on its way, which the gate says in its own words.
 */
export function poolGap(pool: NodeFrequencies | null): string {
  if (pool === null || pool.enough) return '';
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
