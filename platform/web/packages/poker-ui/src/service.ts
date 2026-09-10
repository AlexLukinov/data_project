/**
 * What `EquityCalculator` needs from the outside: something that computes and can cancel.
 * `@poker/workers`' `EquityService` satisfies it directly (in-process) and its Comlink client
 * does through a two-line wrapper in the app; this package never imports either (spec §3.2).
 */

import type { EquityMode, EquityRequest, EquityResult } from '@poker/core';

export interface EquityServiceOptions {
  readonly mode?: EquityMode;
  readonly iterations?: number;
  readonly seed?: number;
  readonly chunk?: number;
}

export interface EquityServiceLike {
  compute(request: EquityRequest, options?: EquityServiceOptions, jobId?: string, onProgress?: (done: number, total: number) => void): Promise<EquityResult>;
  cancel(jobId: string): boolean | Promise<boolean>;
}
