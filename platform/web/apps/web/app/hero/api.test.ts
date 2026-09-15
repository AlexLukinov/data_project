import { describe, expect, it } from 'vitest';

import type { Fetcher } from '../auth/api';
import { createHeroApi } from './api';

function answering(body: unknown): { fetch: Fetcher; urls: string[] } {
  const urls: string[] = [];
  const fetch: Fetcher = async <T>(url: string): Promise<T> => {
    urls.push(url);
    return body as T;
  };
  return { fetch, urls };
}

describe('createHeroApi().winnings', () => {
  it('reads the hero route with dates only and maps the wire names into WinningsPoint', async () => {
    const { fetch, urls } = answering({
      hands: 150,
      bb_per_100: 6.67,
      ev_bb_per_100: 7.33,
      points: [
        { day: '2026-01-01', hands: 100, cumulative_net_bb: 12.5, cumulative_ev_bb: 10, cumulative_showdown_bb: 20, cumulative_nonshowdown_bb: -7.5 },
        { day: '2026-01-02', hands: 50, cumulative_net_bb: 10, cumulative_ev_bb: 11, cumulative_showdown_bb: 15, cumulative_nonshowdown_bb: -5 },
      ],
    });

    const result = await createHeroApi(fetch).winnings({ date_from: '2026-01-01', date_to: '' });

    expect(urls).toEqual(['/v1/hero/winnings?date_from=2026-01-01']);
    expect(result).toEqual({
      hands: 150,
      bbPer100: 6.67,
      evBbPer100: 7.33,
      points: [
        { day: '2026-01-01', hands: 100, net: 12.5, ev: 10, showdown: 20, nonShowdown: -7.5 },
        { day: '2026-01-02', hands: 50, net: 10, ev: 11, showdown: 15, nonShowdown: -5 },
      ],
    });
  });

  it('keeps a range with no hands empty and its rates null, rather than zero', async () => {
    const { fetch, urls } = answering({ hands: 0, bb_per_100: null, ev_bb_per_100: null, points: [] });

    const result = await createHeroApi(fetch).winnings();

    expect(urls).toEqual(['/v1/hero/winnings']);
    expect(result).toEqual({ hands: 0, bbPer100: null, evBbPer100: null, points: [] });
  });
});
