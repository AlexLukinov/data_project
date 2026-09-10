# @poker/workers

The `@poker/core` equity engine behind a Web Worker (spec §5.3): the page never blocks, jobs are
cancellable, results are cached, progress is relayed.

```ts
import { createEquityClient, createEquityWorker, startEquityJob } from '@poker/workers';

const client = createEquityClient(createEquityWorker());

// Progressive refinement: a fast Monte Carlo answer first, the exact one when it lands.
const fast = startEquityJob(client, request, { mode: 'monte-carlo', iterations: 50_000 });
const exact = startEquityJob(client, request, { mode: 'exact' }, (done, total) => bar.value = done / total);
show(await fast.result, 'Monte Carlo');
show(await exact.result, 'exact');

// The user dragged the range again: drop both, start over.
await fast.cancel();
await exact.cancel();
```

| Piece | What it is |
|---|---|
| `EquityService` | plain class: cache keyed on `equityKey(request, options)` (never for unseeded Monte Carlo), one `AbortController` per job id, a new job with the same id supersedes the old one; unit-tested in Node |
| `equity.worker.ts` | `expose(new EquityService())` — one service per Worker |
| `createEquityWorker()` / `createEquityClient()` | the `new Worker(new URL(…), { type: 'module' })` pattern Vite and Nuxt bundle, wrapped with Comlink |
| `startEquityJob()` | fresh job id, proxied progress callback, `cancel()` |

A cancelled job rejects with `EquityCancelled` from `@poker/core`. Results cross the boundary by
structured clone, so the `Float32Array`s in an `EquityResult` arrive as copies.
