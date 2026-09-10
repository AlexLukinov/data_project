/** @poker/workers — the equity engine behind a Web Worker (spec §5.3). */

export { EquityService } from './equity-service';
export type { EquityJobOptions, ProgressCallback } from './equity-service';
export { createEquityClient, createEquityWorker, startEquityJob } from './client';
export type { EquityClient, EquityJob } from './client';
