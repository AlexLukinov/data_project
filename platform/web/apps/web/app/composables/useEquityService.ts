/**
 * The app owns the Worker; components receive the service through a prop (spec §3.2: poker-ui
 * depends on poker-core only). One Worker per page lifetime, created lazily on the client.
 */
import type { EquityServiceLike } from '@poker/ui';
import { createEquityClient, createEquityWorker } from '@poker/workers';
import { proxy } from 'comlink';
import { onBeforeUnmount, shallowRef } from 'vue';

export function useEquityService(): { service: EquityServiceLike } {
  const worker = createEquityWorker();
  const client = createEquityClient(worker);
  const service: EquityServiceLike = {
    compute: (request, options, jobId, onProgress) => client.compute(request, options, jobId, onProgress === undefined ? undefined : proxy(onProgress)),
    cancel: (jobId) => client.cancel(jobId),
  };
  const ref = shallowRef(service);
  onBeforeUnmount(() => worker.terminate());
  return { service: ref.value };
}
