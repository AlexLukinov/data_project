/**
 * Where practice is kept (spec §16's scoring store, and the review schedule beside it).
 *
 * **The browser is the record here, not a cache.** Every other module in this app treats Dexie as
 * a copy of something the server owns; scores do not work that way. They are per-device practice
 * with no server shape to sync to, the trainers must run with no API at all (spec §17), and
 * nothing else in the platform wants to read them. If that changes, this is the module that
 * grows an `api.ts` beside it — see ADR-036.
 *
 * Rows are plain objects: a Vue reactive proxy cannot cross into IndexedDB (`DataCloneError`),
 * which is the lesson F.6 and F.9 both learned the hard way.
 */
import type { ReviewState } from '@poker/core';
import Dexie from 'dexie';
import type { EntityTable } from 'dexie';

import { plain } from '../analyze/api';

import type { ScoreRow, TrainMode } from './types';

/** A spot's review state, plus the seed that rebuilds it. */
export interface ReviewRow extends ReviewState {
  /** What `generateSpot(mode, seed)` needs to serve this spot again. */
  readonly seed: number;
}

export interface TrainingCache {
  addScore(row: ScoreRow): Promise<void>;
  scores(): Promise<ScoreRow[]>;
  scoresOf(mode: TrainMode): Promise<ScoreRow[]>;
  putReview(row: ReviewRow): Promise<void>;
  reviews(mode: TrainMode): Promise<ReviewRow[]>;
  clear(): Promise<void>;
}

type TrainingDb = Dexie & {
  scores: EntityTable<ScoreRow, 'id'>;
  reviews: EntityTable<ReviewRow, 'spot_hash'>;
};

export const CACHE_NAME = 'poker-training';

/** Open (or create) the store. `name` varies only in tests. */
export function createTrainingCache(name = CACHE_NAME): TrainingCache {
  const db = new Dexie(name) as TrainingDb;
  db.version(1).stores({
    scores: 'id, mode, spot_hash, created_at',
    reviews: 'spot_hash, mode, due_at',
  });

  return {
    addScore: (row) => db.scores.put(plain(row)).then(() => undefined),
    scores: () => db.scores.orderBy('created_at').toArray(),
    scoresOf: (mode) => db.scores.where('mode').equals(mode).sortBy('created_at'),
    putReview: (row) => db.reviews.put(plain(row)).then(() => undefined),
    reviews: (mode) => db.reviews.where('mode').equals(mode).toArray(),
    clear: () => Promise.all([db.scores.clear(), db.reviews.clear()]).then(() => undefined),
  };
}
