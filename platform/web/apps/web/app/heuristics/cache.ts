/**
 * The heuristic log's browser copy (plan F.11, spec §16).
 *
 * Unlike the scoring store, the log is **not** browser-owned: the server is the record, because a
 * lesson is worth having on every device and it points back at an analysis the server already
 * holds. Dexie is what makes it usable with the API away — a heuristic written offline is kept
 * here, marked unsaved, and pushed the next time the server answers.
 *
 * The row keeps its own `local_id` as the primary key and the server's id beside it, so a
 * heuristic written offline keeps its identity when the server later gives it one.
 */
import Dexie from 'dexie';
import type { EntityTable } from 'dexie';

import { plain } from '../analyze/api';

import type { Heuristic, HeuristicStatus } from './api';

export interface LocalHeuristic {
  /** This browser's id for the row; stable whether or not the server has seen it. */
  readonly local_id: string;
  /** The server's id, once it has one. */
  readonly server_id: string | null;
  readonly text: string;
  readonly analysis_id: string | null;
  readonly street: string;
  readonly position: string;
  readonly texture: string;
  readonly tags: readonly string[];
  readonly status: HeuristicStatus;
  readonly confirmed_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  /** True while the server has not confirmed the latest local change. */
  readonly unsaved: boolean;
}

export interface HeuristicCache {
  all(): Promise<LocalHeuristic[]>;
  put(row: LocalHeuristic): Promise<void>;
  remove(localId: string): Promise<void>;
  clear(): Promise<void>;
}

type HeuristicDb = Dexie & { heuristics: EntityTable<LocalHeuristic, 'local_id'> };

export const CACHE_NAME = 'poker-heuristics';

/** Open (or create) the log's browser copy. `name` varies only in tests. */
export function createHeuristicCache(name = CACHE_NAME): HeuristicCache {
  const db = new Dexie(name) as HeuristicDb;
  db.version(1).stores({ heuristics: 'local_id, server_id, updated_at, status' });

  return {
    all: () => db.heuristics.orderBy('updated_at').reverse().toArray(),
    put: (row) => db.heuristics.put(plain(row)).then(() => undefined),
    remove: (localId) => db.heuristics.delete(localId),
    clear: () => db.heuristics.clear(),
  };
}

/** A server row as this browser keeps it, adopting the server's id and clearing `unsaved`. */
export function fromServer(row: Heuristic, localId: string): LocalHeuristic {
  return {
    local_id: localId,
    server_id: row.id,
    text: row.text,
    analysis_id: row.analysis_id,
    street: row.street,
    position: row.position,
    texture: row.texture,
    tags: [...row.tags],
    status: row.status,
    confirmed_at: row.confirmed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    unsaved: false,
  };
}
