/**
 * One analysis being worked on (plan F.9): the state the nine steps read and write, the Dexie
 * copy, and the debounced save to the server.
 *
 * Two rules shape it. **Nothing is lost**: every change lands in the browser copy immediately
 * and the server save is a retry-safe merge of only the steps that changed. **Nothing is
 * silently wrong**: a save the server refuses leaves the status `offline` and the local copy
 * marked unsaved, rather than pretending the work is stored.
 *
 * The logic lives here, with fakes in the tests; `~/stores/analysis` only binds it to the real
 * fetcher and the real cache.
 */
import { ref } from 'vue';
import type { Ref } from 'vue';

import type { AnalysesApi, Analysis, AnalysisStep } from './api';
import { emptyStep, plain } from './api';
import type { AnalysisCache } from './cache';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'offline';

export interface AnalysisSession {
  readonly analysis: Ref<Analysis | null>;
  readonly status: Ref<SaveStatus>;
  /** Load an analysis, from the server when it answers and from the browser copy when it does not. */
  open(id: string): Promise<void>;
  /** The step being worked on. */
  goTo(step: number): void;
  /** Change one step; the rest of the analysis is untouched. */
  patchStep(step: number, patch: Partial<AnalysisStep>): void;
  setHeuristic(text: string): void;
  /** Write everything outstanding now (leaving the page, or a test). */
  flush(): Promise<void>;
}

export interface SessionOptions {
  /** How long to wait for the typing to stop before saving. */
  delayMs?: number;
}

const DEFAULT_DELAY_MS = 1200;

/** The analysis's step `n`, as stored or as an empty one. */
export function stepOf(analysis: Analysis | null, step: number): AnalysisStep {
  return analysis?.steps.find((s) => s.step === step) ?? emptyStep(step);
}

/** The steps whose prediction has been committed — what the rail marks as done. */
export function completedSteps(analysis: Analysis | null): number[] {
  return (analysis?.steps ?? []).filter((s) => s.prediction !== null).map((s) => s.step);
}

/** What has changed since the last successful save. */
interface Pending {
  readonly steps: Set<number>;
  fields: boolean;
}

interface Saving {
  readonly api: AnalysesApi;
  readonly cache: AnalysisCache;
  readonly analysis: Ref<Analysis | null>;
  readonly status: Ref<SaveStatus>;
  readonly pending: Pending;
}

/** Write the browser copy. Plain, never the reactive object: IndexedDB refuses a proxy. */
function put(ctx: Saving, unsaved: boolean): void {
  const current = ctx.analysis.value;
  if (current !== null) void ctx.cache.put(plain(current), unsaved).catch(() => undefined);
}

/** Take the queued steps off the queue, as plain objects ready to send. */
function take(ctx: Saving): AnalysisStep[] {
  const steps = [...ctx.pending.steps].map((step) => plain(stepOf(ctx.analysis.value, step)));
  ctx.pending.steps.clear();
  ctx.pending.fields = false;
  return steps;
}

/** Put work back on the queue after a failed save, so the next change retries it. */
function requeue(ctx: Saving, steps: readonly AnalysisStep[]): void {
  for (const step of steps) ctx.pending.steps.add(step.step);
  ctx.pending.fields = true;
}

/** Send what is queued. A refusal keeps the work and says so, rather than losing it quietly. */
async function push(ctx: Saving): Promise<void> {
  const current = ctx.analysis.value;
  if (current === null || (ctx.pending.steps.size === 0 && !ctx.pending.fields)) return;
  const steps = take(ctx);
  ctx.status.value = 'saving';
  try {
    const saved = await ctx.api.update(current.id, {
      current_step: current.current_step,
      heuristic: current.heuristic,
      ...(steps.length > 0 ? { steps } : {}),
    });
    if (ctx.analysis.value?.id === saved.id) ctx.analysis.value.updated_at = saved.updated_at;
    ctx.status.value = 'saved';
    put(ctx, false);
  } catch {
    requeue(ctx, steps);
    ctx.status.value = 'offline';
    put(ctx, true);
  }
}

/** Load an analysis. A local copy the server has not confirmed is the newer one; keep it. */
async function load(ctx: Saving, id: string): Promise<void> {
  const cached = await ctx.cache.get(id).catch(() => undefined);
  try {
    const fresh = await ctx.api.get(id);
    ctx.analysis.value = cached?.unsaved === true ? cached : fresh;
    if (cached?.unsaved !== true) void ctx.cache.put(fresh, false).catch(() => undefined);
  } catch (error) {
    if (cached === undefined) throw error;
    ctx.analysis.value = cached;
    ctx.status.value = 'offline';
  }
}

/**
 * The debounce: every change writes the browser copy at once and restarts the clock on the
 * server save, so a burst of typing costs one request.
 */
function createScheduler(ctx: Saving, delayMs: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> = Promise.resolve();

  function change(mutate: (current: Analysis) => void): void {
    if (ctx.analysis.value === null) return;
    mutate(ctx.analysis.value);
    put(ctx, true);
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      running = push(ctx);
    }, delayMs);
  }

  async function flush(): Promise<void> {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    await running;
    await push(ctx);
  }

  return { change, flush };
}

export function createAnalysisSession(
  api: AnalysesApi,
  cache: AnalysisCache,
  options: SessionOptions = {},
): AnalysisSession {
  const analysis = ref<Analysis | null>(null);
  const status = ref<SaveStatus>('idle');
  const ctx: Saving = { api, cache, analysis, status, pending: { steps: new Set(), fields: false } };
  const { change, flush } = createScheduler(ctx, options.delayMs ?? DEFAULT_DELAY_MS);

  return {
    analysis,
    status,
    flush,
    open: (id) => load(ctx, id),
    goTo: (step) =>
      change((current) => {
        current.current_step = step;
        ctx.pending.fields = true;
      }),
    patchStep: (step, patch) =>
      change((current) => {
        const merged = { ...stepOf(current, step), ...patch, step };
        current.steps = [...current.steps.filter((s) => s.step !== step), merged].sort((a, b) => a.step - b.step);
        ctx.pending.steps.add(step);
      }),
    setHeuristic: (text) =>
      change((current) => {
        current.heuristic = text;
        ctx.pending.fields = true;
      }),
  };
}
