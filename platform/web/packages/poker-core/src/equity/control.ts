/**
 * Cooperative scheduling for long computations: yield to the event loop between chunks so a
 * cancel message can arrive (in a Worker, Comlink delivers it on the same loop), report
 * progress, and stop when asked.
 */

import { EquityCancelled } from './types';

export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new EquityCancelled();
}

/** Progress, cancellation and yielding, once per chunk. */
export async function checkpoint(
  done: number,
  total: number,
  signal: AbortSignal | undefined,
  onProgress: ((done: number, total: number) => void) | undefined,
): Promise<void> {
  throwIfCancelled(signal);
  onProgress?.(done, total);
  await yieldToEventLoop();
  throwIfCancelled(signal);
}
