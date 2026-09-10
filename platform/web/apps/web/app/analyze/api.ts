/**
 * The analyzer's transport (plan F.9): `/v1/analyses` on top of the session's fetcher. Field
 * names are the API's (snake_case), exactly as `api/schemas_analyses.py` sends them.
 *
 * A save is a **merge**: the steps in the body replace those step numbers and nothing else, so
 * autosaving the step being worked on can never wipe the steps before it.
 */
import type { NodeKey } from '@poker/core';
import { nodeKeyJson } from '@poker/core';

import type { Fetcher } from '../auth/api';

export type AnalysisSource = 'stored' | 'pasted' | 'manual';
export type AnswerType = 'number' | 'percent' | 'choice' | 'text';

export interface Prediction {
  question: string;
  answer_type: AnswerType;
  answer: string;
  actual: string;
  error: number | null;
  within_tolerance: boolean | null;
  committed_at: string;
}

export interface RangeAssignment {
  position: string;
  weights: string;
  label: string;
}

export interface RangeSplit {
  position: string;
  action: string;
  weights: string;
}

/** Everything the nine steps put on the table, in one shape (see `StepWork` in Python). */
export interface StepWork {
  ranges: RangeAssignment[];
  splits: RangeSplit[];
  board: string;
  hero_cards: string;
  choice: string;
  frequency: number | null;
  size_pct: number | null;
  value_weights: string;
  bluff_weights: string;
  pot_bb: number | null;
  bet_bb: number | null;
}

export interface AnalysisStep {
  step: number;
  prediction: Prediction | null;
  takeaway: string;
  work: StepWork;
}

export interface AnalysisSummary {
  id: string;
  title: string;
  source: AnalysisSource;
  hand_uid: string;
  node_key: NodeKey | null;
  current_step: number;
  completed_steps: number[];
  heuristic: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface Analysis extends AnalysisSummary {
  hand_text: string;
  action_index: number;
  steps: AnalysisStep[];
}

export interface AnalysisIn {
  title: string;
  source: AnalysisSource;
  hand_uid?: string;
  hand_text?: string;
  node_key?: NodeKey | null;
  action_index?: number;
  tags?: string[];
}

export interface AnalysisUpdate {
  title?: string;
  node_key?: NodeKey;
  current_step?: number;
  steps?: AnalysisStep[];
  heuristic?: string;
  tags?: string[];
}

export interface AnalysesApi {
  list(): Promise<AnalysisSummary[]>;
  get(id: string): Promise<Analysis>;
  create(body: AnalysisIn): Promise<Analysis>;
  update(id: string, body: AnalysisUpdate): Promise<Analysis>;
  remove(id: string): Promise<void>;
}

const BASE = '/v1/analyses';

/**
 * A plain structural copy. Everything leaving the app -- the request body and the Dexie row --
 * must be free of Vue's reactive proxies, which neither `structuredClone` nor IndexedDB accepts
 * (the `DataCloneError` the range library hit in F.6).
 */
export function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** An empty step, which is what a step the user has not reached looks like. */
export function emptyWork(): StepWork {
  return {
    ranges: [],
    splits: [],
    board: '',
    hero_cards: '',
    choice: '',
    frequency: null,
    size_pct: null,
    value_weights: '',
    bluff_weights: '',
    pot_bb: null,
    bet_bb: null,
  };
}

export function emptyStep(step: number): AnalysisStep {
  return { step, prediction: null, takeaway: '', work: emptyWork() };
}

/** The body as the API wants it: the key as plain JSON, everything else as is. */
function wire(body: AnalysisIn | AnalysisUpdate): Record<string, unknown> {
  const { node_key, ...rest } = body;
  return node_key === undefined || node_key === null ? { ...rest } : { ...rest, node_key: nodeKeyJson(node_key) };
}

/** Bind the analyzer's endpoints to a fetcher (the auth store's, which adds the bearer header). */
export function createAnalysesApi(fetch: Fetcher): AnalysesApi {
  return {
    list: () => fetch<AnalysisSummary[]>(BASE),
    get: (id) => fetch<Analysis>(`${BASE}/${id}`),
    create: (body) => fetch<Analysis>(BASE, { method: 'POST', body: wire(body) }),
    update: (id, body) => fetch<Analysis>(`${BASE}/${id}`, { method: 'PUT', body: wire(body) }),
    remove: (id) => fetch<void>(`${BASE}/${id}`, { method: 'DELETE' }),
  };
}
