/**
 * The page side: create the Worker, wrap it, start cancellable jobs.
 *
 *   const client = createEquityClient(createEquityWorker());
 *   const job = startEquityJob(client, request, { mode: 'monte-carlo', iterations: 50_000 }, (d, t) => …);
 *   job.cancel();                       // when the user changes the range again
 *   const result = await job.result;    // rejects with EquityCancelled after cancel()
 */

import type { EquityRequest, EquityResult } from '@poker/core';
import type { Remote } from 'comlink';
import { proxy, wrap } from 'comlink';

import type { EquityJobOptions, EquityService, ProgressCallback } from './equity-service';

export type EquityClient = Remote<EquityService>;

/** A module Worker running `equity.worker.ts`; the bundler resolves the URL at build time. */
export function createEquityWorker(): Worker {
  return new Worker(new URL('./equity.worker.ts', import.meta.url), { type: 'module' });
}

export function createEquityClient(worker: Worker): EquityClient {
  return wrap<EquityService>(worker);
}

export interface EquityJob {
  readonly id: string;
  readonly result: Promise<EquityResult>;
  /** Resolves true if the job was still running. */
  cancel(): Promise<boolean>;
}

let counter = 0;

/** Start a job with a fresh id; the Worker relays progress through the proxied callback. */
export function startEquityJob(client: EquityClient, request: EquityRequest, options: EquityJobOptions = {}, onProgress?: ProgressCallback): EquityJob {
  counter++;
  const id = `equity-${counter}`;
  const result = client.compute(request, options, id, onProgress === undefined ? undefined : proxy(onProgress));
  return { id, result, cancel: () => client.cancel(id) };
}
