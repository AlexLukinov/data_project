import { describe, expect, it } from 'vitest';

import type { FetchOptions, Fetcher } from '../auth/api';
import { createUploadsApi } from './api';

interface Call {
  url: string;
  options: FetchOptions | undefined;
}

function recorder(answer: unknown = []): { fetch: Fetcher; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: Fetcher = async <T>(url: string, options?: FetchOptions): Promise<T> => {
    calls.push({ url, options });
    return answer as T;
  };
  return { fetch, calls };
}

describe('createUploadsApi', () => {
  it('lets a refusal from the API through untouched, so the page can show its sentence', async () => {
    const refusal = { status: 415, data: { detail: 'This is a zip archive. Unzip it and upload the .txt hand histories inside.' } };
    const fetch: Fetcher = async () => {
      throw refusal;
    };
    const api = createUploadsApi(fetch);
    await expect(api.upload(new File(['x'], 'hands.zip'), { site: '', dataset: 'hero' })).rejects.toBe(refusal);
  });

  it('sends the file, the site and the dataset as a multipart form, never as JSON', async () => {
    const { fetch, calls } = recorder({ upload_id: 'u1', status: 'queued', dedupe: 'new' });
    const file = new File(['PokerStars Hand #1'], 'stars.txt', { type: 'text/plain' });
    const accepted = await createUploadsApi(fetch).upload(file, { site: '', dataset: 'population' });

    expect(accepted).toEqual({ upload_id: 'u1', status: 'queued', dedupe: 'new' });
    expect(calls[0]!.url).toBe('/v1/uploads');
    expect(calls[0]!.options!.method).toBe('POST');
    expect(calls[0]!.options!.headers).toBeUndefined();
    const body = calls[0]!.options!.body as unknown;
    expect(body).toBeInstanceOf(FormData);
    const form = body as FormData;
    expect((form.get('file') as File).name).toBe('stars.txt');
    expect(form.get('site')).toBe('');
    expect(form.get('dataset')).toBe('population');
  });

  it('unwraps the site list', async () => {
    const { fetch, calls } = recorder({ sites: ['ggpoker', 'pokerstars'] });
    expect(await createUploadsApi(fetch).sites()).toEqual(['ggpoker', 'pokerstars']);
    expect(calls.map((c) => c.url)).toEqual(['/v1/sites']);
  });

  it('spells every other endpoint', async () => {
    const { fetch, calls } = recorder();
    const api = createUploadsApi(fetch);
    await api.list();
    await api.list(10);
    await api.get('u 1');
    await api.accounts();
    await api.addAccount('pokerstars', 'Hero');
    await api.removeAccount('a1');

    expect(calls.map((c) => [c.url, c.options?.method ?? 'GET'])).toEqual([
      ['/v1/uploads?limit=50', 'GET'],
      ['/v1/uploads?limit=10', 'GET'],
      ['/v1/uploads/u%201', 'GET'],
      ['/v1/auth/poker-accounts', 'GET'],
      ['/v1/auth/poker-accounts', 'POST'],
      ['/v1/auth/poker-accounts/a1', 'DELETE'],
    ]);
    expect(calls[4]!.options!.body).toEqual({ site: 'pokerstars', screen_name: 'Hero' });
  });
});
