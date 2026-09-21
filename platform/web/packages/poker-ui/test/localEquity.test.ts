/**
 * `createLocalEquityService` — the in-process `EquityServiceLike` the package ships so a
 * consuming app can mount `EquityCalculator` with one import (spec §18, acceptance 12).
 */
import { EquityCancelled, parseCards, parseRange } from '@poker/core';
import { describe, expect, it } from 'vitest';

import { createLocalEquityService } from '../src/localEquity';

const aces = parseRange('AA').range;
const kings = parseRange('KK').range;
/** A river board where the answer needs no arithmetic: villain has trip kings, hero a pair of aces. */
const river = parseCards('Kh 7d 2c 9s 3h');
/** Long enough that it is still running one tick later, so a cancel has something to abort. */
const LONG_RUN = { mode: 'monte-carlo', iterations: 5_000_000 } as const;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('createLocalEquityService', () => {
  it('computes a known equity', async () => {
    const service = createLocalEquityService();
    const result = await service.compute({ ranges: [aces, kings], board: river });
    expect(result.exact).toBe(true);
    expect(result.equities).toEqual([0, 1]);
  });

  it('reports progress straight through to the caller', async () => {
    const service = createLocalEquityService();
    const seen: [number, number][] = [];
    await service.compute({ ranges: [aces, kings], board: river }, {}, 'job', (done, total) => void seen.push([done, total]));
    expect(seen.length).toBeGreaterThan(0);
    const last = seen[seen.length - 1]!;
    expect(last[0]).toBe(last[1]);
  });

  it('aborts a running job on cancel, and the promise rejects with EquityCancelled', async () => {
    const service = createLocalEquityService();
    const running = service.compute({ ranges: [aces, kings], board: [] }, LONG_RUN, 'job');
    const rejected = expect(running).rejects.toBeInstanceOf(EquityCancelled);
    await wait(5);
    expect(await service.cancel('job')).toBe(true);
    await rejected;
  });

  it('supersedes a job started again under the same id', async () => {
    const service = createLocalEquityService();
    const first = service.compute({ ranges: [aces, kings], board: [] }, LONG_RUN, 'job');
    const superseded = expect(first).rejects.toBeInstanceOf(EquityCancelled);
    await wait(5);
    const second = await service.compute({ ranges: [aces, kings], board: river }, {}, 'job');
    await superseded;
    expect(second.equities).toEqual([0, 1]);
  });

  it('answers false for an unknown id, and for one whose job has settled', async () => {
    const service = createLocalEquityService();
    expect(await service.cancel('never-started')).toBe(false);
    await service.compute({ ranges: [aces, kings], board: river }, {}, 'job');
    expect(await service.cancel('job')).toBe(false);
  });
});
