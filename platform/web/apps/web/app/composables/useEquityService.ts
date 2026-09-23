/**
 * The app owns the Worker; components receive the service through a prop (spec §3.2: poker-ui
 * depends on poker-core only). One Worker per page lifetime, created lazily on the client.
 *
 * **A Worker that cannot start must say so** (ADR-069's "left, and said plainly"; plan round 9).
 * A module Worker whose script fails to load fires `error` on the Worker object and then answers
 * nothing, ever — and a Comlink call over it never settles. Every job here therefore races the
 * Worker's own failure, so `EquityCalculator` prints a sentence instead of "Computing…" for ever,
 * and the replayer's EQR column, the defending set and the trainers' gates all stop waiting on an
 * answer that is not coming.
 */
import type { EquityServiceLike } from '@poker/ui';
import { createEquityClient, createEquityWorker } from '@poker/workers';
import { proxy } from 'comlink';
import { onBeforeUnmount, shallowRef } from 'vue';

/**
 * The reader's sentence. The browser's own `ErrorEvent` for a module that would not load usually
 * carries no message at all (a cross-origin script error is deliberately blank), so the words
 * are this composable's, and they name what stops working and what to do — never the class of
 * what threw (ADR-069).
 */
export const WORKER_UNREACHABLE =
  'The equity engine could not be started in this browser: its background worker failed to load, so equities, EQR and the defending set cannot be worked out on this page. Reload the page to try again.';

/**
 * A promise that rejects the moment the Worker reports it cannot run. It is created once, so a
 * job started after the failure fails at once rather than waiting for a second event that will
 * not come. The rejection is observed here so that a Worker failing with no job in flight is not
 * an unhandled rejection of its own.
 */
function failureOf(worker: Worker): Promise<never> {
  const failed = new Promise<never>((_, reject) => {
    worker.addEventListener('error', () => reject(new Error(WORKER_UNREACHABLE)), { once: true });
  });
  failed.catch(() => undefined);
  return failed;
}

export function useEquityService(): { service: EquityServiceLike } {
  const worker = createEquityWorker();
  const client = createEquityClient(worker);
  const failed = failureOf(worker);
  const service: EquityServiceLike = {
    compute: (request, options, jobId, onProgress) =>
      Promise.race([client.compute(request, options, jobId, onProgress === undefined ? undefined : proxy(onProgress)), failed]),
    // A cancel settles rather than rejects: `EquityCalculator` fires it and forgets it for every
    // job on each input change, and after a Worker failure nothing was running to cancel — so the
    // answer is `false`, not a second copy of the sentence the compute already delivered.
    cancel: (jobId) => Promise.race([client.cancel(jobId), failed]).catch(() => false),
  };
  const ref = shallowRef(service);
  onBeforeUnmount(() => worker.terminate());
  return { service: ref.value };
}
