/**
 * The Worker entry: one `EquityService` per Worker, exposed through Comlink. Bundlers pick this
 * file up via `new Worker(new URL('./equity.worker.ts', import.meta.url), { type: 'module' })`,
 * which `createEquityWorker()` in `client.ts` does.
 */

import { expose } from 'comlink';

import { EquityService } from './equity-service';

expose(new EquityService());
