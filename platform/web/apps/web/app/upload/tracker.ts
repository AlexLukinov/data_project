/**
 * Watching accepted uploads until they land (plan D.8).
 *
 * The parser worker takes files from the queue on its own time, one at a time, so the screen asks
 * `GET /v1/uploads/{id}` every couple of seconds and reports each answer. It stops asking about an
 * upload once its row is `completed` or `failed`. A failed read is not the end: it is reported and
 * asked again on the next tick, because an API restarting under a long upload is ordinary.
 *
 * **At most `MAX_ACTIVE` uploads are polled at once**, oldest first; the rest wait for a slot. A
 * folder of hundreds of files would otherwise be hundreds of reads every two seconds against a
 * single API process, to learn that all but one are still queued behind the worker.
 *
 * **The clock is progress, not age.** One worker means a file can wait a long time behind its
 * siblings while everything is healthy, so `waitedMs` is the time since *any* watched row last
 * changed (or a watch started), not since this one was sent. The "is the worker running?" hint and
 * the ten-minute give-up both hang on that: they fire only when nothing at all has moved, and a
 * give-up then covers every watched upload, because the same stall holds them all.
 *
 * The next ask is scheduled only after the previous answer lands, so a slow API never has two
 * reads of one upload in flight. `stop()` is final: nothing is asked, reported or started after it,
 * which is what an unmount — a sign-out, another user on the same tab — needs. Timer and clock are
 * injected so this is tested without waiting.
 */

import { describeApiError } from '../auth/api';
import type { UploadRow, UploadsApi } from './api';

export interface Timer {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const REAL_TIMER: Timer = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export const POLL_MS = 2_000;
export const GIVE_UP_MS = 600_000;
/** How many uploads are polled at once; the rest wait for one of them to settle. */
export const MAX_ACTIVE = 5;
export const GAVE_UP = 'Stopped checking after 10 minutes. Reload the page to check again.';

export type TrackPhase = 'polling' | 'done' | 'gave-up';

/**
 * One report on one upload. `row` is the last row read (null before the first); `waitedMs` is how
 * long nothing watched has moved; `failure` is why the last read failed.
 */
export interface TrackedUpload {
  uploadId: string;
  row: UploadRow | null;
  waitedMs: number;
  phase: TrackPhase;
  failure: string;
}

export interface TrackerOptions {
  intervalMs?: number;
  giveUpMs?: number;
  timer?: Timer;
  now?: () => number;
  onChange: (update: TrackedUpload) => void;
}

export interface UploadTracker {
  /** Start watching an upload; one already watched, or any after `stop()`, is ignored. */
  track(uploadId: string): void;
  /** Stop watching everything for good and clear every timer — what an unmount wants. */
  stop(): void;
}

interface Watch {
  uploadId: string;
  handle: unknown;
  row: UploadRow | null;
}

interface Context {
  api: Pick<UploadsApi, 'get'>;
  intervalMs: number;
  giveUpMs: number;
  timer: Timer;
  now: () => number;
  onChange: (update: TrackedUpload) => void;
  /** The uploads being polled, at most `MAX_ACTIVE`. */
  active: Map<string, Watch>;
  /** Accepted uploads waiting for a polling slot, oldest first. */
  waiting: string[];
  /** When a watched row last changed status or `updated_at`, or a watch last started. */
  lastProgressAt: number;
  stopped: boolean;
}

const SETTLED = new Set<UploadRow['status']>(['completed', 'failed']);

/** Watch accepted uploads until each is completed or failed, reporting every answer through `onChange`. */
export function createUploadTracker(api: Pick<UploadsApi, 'get'>, options: TrackerOptions): UploadTracker {
  const now = options.now ?? Date.now;
  const ctx: Context = {
    api,
    intervalMs: options.intervalMs ?? POLL_MS,
    giveUpMs: options.giveUpMs ?? GIVE_UP_MS,
    timer: options.timer ?? REAL_TIMER,
    now,
    onChange: options.onChange,
    active: new Map(),
    waiting: [],
    lastProgressAt: now(),
    stopped: false,
  };
  return {
    track(uploadId) {
      if (ctx.stopped || ctx.active.has(uploadId) || ctx.waiting.includes(uploadId)) return;
      ctx.waiting.push(uploadId);
      fillSlots(ctx);
    },
    stop() {
      ctx.stopped = true;
      clearAll(ctx);
    },
  };
}

/** Start the oldest waiting uploads while a polling slot is free. */
function fillSlots(ctx: Context): void {
  while (!ctx.stopped && ctx.active.size < MAX_ACTIVE && ctx.waiting.length > 0) {
    const watch: Watch = { uploadId: ctx.waiting.shift()!, handle: null, row: null };
    ctx.active.set(watch.uploadId, watch);
    ctx.lastProgressAt = ctx.now();
    void poll(ctx, watch);
  }
}

/** One read of one upload, then the next one scheduled unless it has settled or nothing has moved for too long. */
async function poll(ctx: Context, watch: Watch): Promise<void> {
  watch.handle = null;
  if (ctx.now() - ctx.lastProgressAt >= ctx.giveUpMs) return giveUpAll(ctx);
  let row = watch.row;
  let failure = '';
  try {
    row = await ctx.api.get(watch.uploadId);
  } catch (error) {
    failure = describeApiError(error);
  }
  // Stopped, or given up, while the read was in flight: nobody is listening for this one any more.
  if (ctx.active.get(watch.uploadId) !== watch) return;
  if (moved(watch.row, row)) ctx.lastProgressAt = ctx.now();
  watch.row = row;
  const settled = failure === '' && row !== null && SETTLED.has(row.status);
  if (settled) ctx.active.delete(watch.uploadId);
  else watch.handle = ctx.timer.set(() => void poll(ctx, watch), ctx.intervalMs);
  ctx.onChange(report(ctx, watch, settled ? 'done' : 'polling', failure));
  if (settled) fillSlots(ctx);
}

/** A row that changed status or was written again since the last read. The first read is not progress; the start was. */
function moved(before: UploadRow | null, after: UploadRow | null): boolean {
  return before !== null && after !== null && (before.status !== after.status || before.updated_at !== after.updated_at);
}

/** Nothing has moved for `giveUpMs`: the same stall holds every upload, so stop watching all of them and say so. */
function giveUpAll(ctx: Context): void {
  const watches = [...ctx.active.values(), ...ctx.waiting.map((uploadId): Watch => ({ uploadId, handle: null, row: null }))];
  clearAll(ctx);
  for (const watch of watches) ctx.onChange(report(ctx, watch, 'gave-up', GAVE_UP));
}

function clearAll(ctx: Context): void {
  for (const watch of ctx.active.values()) if (watch.handle !== null) ctx.timer.clear(watch.handle);
  ctx.active.clear();
  ctx.waiting = [];
}

function report(ctx: Context, watch: Watch, phase: TrackPhase, failure: string): TrackedUpload {
  return { uploadId: watch.uploadId, row: watch.row, waitedMs: ctx.now() - ctx.lastProgressAt, phase, failure };
}
