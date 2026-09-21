/**
 * An `EquityServiceLike` built on `@poker/core` alone, so `EquityCalculator` can be mounted in
 * any app with one import and no wiring (spec §18, acceptance 12).
 *
 * It is the same job bookkeeping the Worker's service does — one `AbortController` per job id, a
 * new job with the same id superseding the old one — without the Worker.
 */

import type { EquityRequest, EquityResult } from '@poker/core';
import { computeEquity } from '@poker/core';

import type { EquityServiceLike, EquityServiceOptions } from './service';

/**
 * An equity service that **runs on the calling thread**: every chunk of the computation happens
 * on the same event loop as the UI, so a big exact enumeration will make the page stutter.
 *
 * Good for tests, scripts, small ranges, and a page whose bundler is not set up for Workers.
 * For anything heavier, give `EquityCalculator` the Worker-backed service instead — the three
 * lines that build one are in this package's README ("Using it in another app").
 *
 * Jobs are keyed by the `jobId` the caller passes: starting a job with an id that is already
 * running cancels the running one (the range editor's case, where the reader is still dragging),
 * `cancel(jobId)` aborts it and says whether there was one, and the controller is dropped as soon
 * as the job settles. A job started without an id cannot be cancelled.
 */
export function createLocalEquityService(): EquityServiceLike {
  const jobs = new Map<string, AbortController>();

  function cancel(jobId: string): boolean {
    const controller = jobs.get(jobId);
    if (controller === undefined) return false;
    controller.abort();
    jobs.delete(jobId);
    return true;
  }

  async function compute(
    request: EquityRequest,
    options: EquityServiceOptions = {},
    jobId?: string,
    onProgress?: (done: number, total: number) => void,
  ): Promise<EquityResult> {
    const controller = new AbortController();
    if (jobId !== undefined) {
      cancel(jobId);
      jobs.set(jobId, controller);
    }
    try {
      return await computeEquity(request, { ...options, signal: controller.signal, onProgress });
    } finally {
      if (jobId !== undefined && jobs.get(jobId) === controller) jobs.delete(jobId);
    }
  }

  return { compute, cancel };
}
