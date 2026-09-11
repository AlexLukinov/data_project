/**
 * `/v1/heuristics` — the heuristic log's sync endpoint (plan F.11).
 *
 * Field names are the API's own snake_case, so a row and a request body are the same shape and
 * neither has to be translated. Nothing here decides anything: the log's rules live in `log.ts`,
 * which is tested against a fake of this interface.
 */
import type { Fetcher } from '../auth/api';

const BASE = '/v1/heuristics';

export type HeuristicStatus = 'open' | 'confirmed' | 'retired';

/** One row as the server keeps it. */
export interface Heuristic {
  readonly id: string;
  readonly analysis_id: string | null;
  readonly text: string;
  readonly street: string;
  readonly position: string;
  readonly texture: string;
  readonly tags: readonly string[];
  readonly status: HeuristicStatus;
  readonly confirmed_at: string | null;
  readonly review_due_at: string;
  readonly is_due: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

/** What a write sends. Everything but the lesson itself is optional. */
export interface HeuristicBody {
  readonly text?: string;
  readonly analysis_id?: string | null;
  readonly street?: string;
  readonly position?: string;
  readonly texture?: string;
  readonly tags?: readonly string[];
  readonly status?: HeuristicStatus;
}

/** A step-9 takeaway sitting in an analysis that the log has not adopted yet. */
export interface HeuristicCandidate {
  readonly analysis_id: string;
  readonly title: string;
  readonly heuristic: string;
  readonly node_key: Record<string, unknown> | null;
  readonly created_at: string;
}

export interface HeuristicsApi {
  list(due?: boolean): Promise<Heuristic[]>;
  create(body: HeuristicBody): Promise<Heuristic>;
  update(id: string, body: HeuristicBody): Promise<Heuristic>;
  remove(id: string): Promise<void>;
  candidates(): Promise<HeuristicCandidate[]>;
}

/** A body as the plain record the fetcher takes, with the readonly tag list copied out. */
function wire(body: HeuristicBody): Record<string, unknown> {
  return { ...body, ...(body.tags === undefined ? {} : { tags: [...body.tags] }) };
}

/** Bind the endpoints to the session's authorized fetcher. */
export function createHeuristicsApi(fetch: Fetcher): HeuristicsApi {
  return {
    list: (due = false) => fetch<Heuristic[]>(due ? `${BASE}?due=true` : BASE),
    create: (body) => fetch<Heuristic>(BASE, { method: 'POST', body: wire(body) }),
    update: (id, body) => fetch<Heuristic>(`${BASE}/${id}`, { method: 'PUT', body: wire(body) }),
    remove: (id) => fetch<void>(`${BASE}/${id}`, { method: 'DELETE' }),
    candidates: () => fetch<HeuristicCandidate[]>(`${BASE}/candidates`),
  };
}
