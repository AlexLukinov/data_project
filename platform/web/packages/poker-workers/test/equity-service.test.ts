import { EquityCancelled, fullRange, parseCards, parseRange } from '@poker/core';
import type { EquityRequest } from '@poker/core';
import { describe, expect, it } from 'vitest';

import { EquityService } from '../src/equity-service';

const small: EquityRequest = { ranges: [parseRange('AA,KK').range, parseRange('QQ,AKs').range], board: parseCards('Kh 7d 2c 9s') };
const big: EquityRequest = { ranges: [fullRange(), fullRange()], board: parseCards('Kh 7d 2c') };

describe('EquityService', () => {
  it('answers a repeated exact request from the cache', async () => {
    const service = new EquityService();
    const first = await service.compute(small);
    const second = await service.compute(small);
    expect(second).toBe(first);
    expect(service.cacheSize()).toBe(1);
  });

  it('does not cache unseeded Monte Carlo, but does cache a seeded one', async () => {
    const service = new EquityService();
    const preflop: EquityRequest = { ranges: [parseRange('AA').range, parseRange('KK').range], board: [] };
    await service.compute(preflop, { iterations: 2000 });
    expect(service.cacheSize()).toBe(0);
    await service.compute(preflop, { iterations: 2000, seed: 4 });
    expect(service.cacheSize()).toBe(1);
  });

  it('cancels a running job by id and leaves nothing in the cache', async () => {
    const service = new EquityService();
    const progress: number[] = [];
    const job = service.compute(big, {}, 'job-1', (done) => {
      progress.push(done);
      if (done > 0) service.cancel('job-1');
    });
    await expect(job).rejects.toBeInstanceOf(EquityCancelled);
    expect(progress.length).toBeGreaterThan(1);
    expect(service.cacheSize()).toBe(0);
    expect(service.cancel('job-1')).toBe(false);
  });

  it('supersedes a running job when a new one takes its id', async () => {
    const service = new EquityService();
    const first = service.compute(big, {}, 'editor');
    const second = service.compute(small, {}, 'editor');
    await expect(first).rejects.toBeInstanceOf(EquityCancelled);
    expect((await second).exact).toBe(true);
  });

  it('bounds the cache', async () => {
    const service = new EquityService(2);
    for (const board of ['Kh 7d 2c 9s 3h', 'Kh 7d 2c 9s 4h', 'Kh 7d 2c 9s 5h']) {
      await service.compute({ ...small, board: parseCards(board) });
    }
    expect(service.cacheSize()).toBe(2);
    service.clearCache();
    expect(service.cacheSize()).toBe(0);
  });
});
