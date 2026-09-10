/**
 * The equity service that lives inside the Worker: a result cache keyed on the inputs, one
 * cancellable job per id (a new job with the same id supersedes the old one, which is what a
 * range editor wants while the user drags), and progress relayed to the caller.
 *
 * It is a plain class so it can be unit-tested in Node; `equity.worker.ts` exposes an instance
 * through Comlink, and `client.ts` talks to it from the page.
 */

import type { EquityMode, EquityRequest, EquityResult } from '@poker/core';
import { computeEquity, equityKey, isExactlySolvable } from '@poker/core';

/** The options that cross the Worker boundary (everything serializable in `EquityOptions`). */
export interface EquityJobOptions {
  readonly mode?: EquityMode;
  readonly iterations?: number;
  readonly seed?: number;
  readonly chunk?: number;
}

export type ProgressCallback = (done: number, total: number) => void;

const DEFAULT_CACHE_SIZE = 64;

export class EquityService {
  private readonly cache = new Map<string, EquityResult>();
  private readonly jobs = new Map<string, AbortController>();

  constructor(private readonly maxCached = DEFAULT_CACHE_SIZE) {}

  /**
   * Compute, or answer from the cache. A `jobId` makes the job cancellable and supersedes any
   * running job with the same id. Monte Carlo without a seed is never cached: it would never
   * be the same twice.
   */
  async compute(request: EquityRequest, options: EquityJobOptions = {}, jobId?: string, onProgress?: ProgressCallback): Promise<EquityResult> {
    const key = equityKey(request, options);
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      onProgress?.(1, 1);
      return cached;
    }
    const controller = new AbortController();
    if (jobId !== undefined) {
      this.cancel(jobId);
      this.jobs.set(jobId, controller);
    }
    try {
      const result = await computeEquity(request, { ...options, signal: controller.signal, onProgress });
      if (isCacheable(request, options)) this.remember(key, result);
      return result;
    } finally {
      if (jobId !== undefined && this.jobs.get(jobId) === controller) this.jobs.delete(jobId);
    }
  }

  /** Abort a running job; true if there was one. */
  cancel(jobId: string): boolean {
    const controller = this.jobs.get(jobId);
    if (controller === undefined) return false;
    controller.abort();
    this.jobs.delete(jobId);
    return true;
  }

  cacheSize(): number {
    return this.cache.size;
  }

  clearCache(): void {
    this.cache.clear();
  }

  private remember(key: string, result: EquityResult): void {
    this.cache.set(key, result);
    while (this.cache.size > this.maxCached) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}

function isCacheable(request: EquityRequest, options: EquityJobOptions): boolean {
  const exact = options.mode === 'exact' || ((options.mode ?? 'auto') === 'auto' && isExactlySolvable(request));
  return exact || options.seed !== undefined;
}
