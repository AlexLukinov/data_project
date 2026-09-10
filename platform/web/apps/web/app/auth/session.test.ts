import { describe, expect, it } from 'vitest';

import type { FetchOptions, Fetcher } from './api';
import { createAuthApi, describeSignInError, errorStatus } from './api';
import { safePath } from './paths';
import { createSession } from './session';

const BASE = 'http://api.test';
const USER = { id: 'u1', email: 'demo@example.com', display_name: 'Demo', is_active: true };

class FakeFetchError extends Error {
  constructor(
    readonly status: number,
    readonly data?: unknown,
  ) {
    super(`HTTP ${status}`);
  }
}

interface Call {
  url: string;
  options: FetchOptions | undefined;
}

type Step = (call: Call) => unknown;

const token = (value: string): Step => () => ({ access_token: value, token_type: 'bearer', expires_in: 60 });
const unauthorized: Step = () => {
  throw new FakeFetchError(401, { detail: 'Invalid or expired token' });
};
const offline: Step = () => {
  throw new TypeError('fetch failed');
};

/** A scripted `$fetch`: each call consumes the next step and records what was sent. */
function fakeFetcher(script: Step[]): { fetcher: Fetcher; calls: Call[] } {
  const calls: Call[] = [];
  const fetcher: Fetcher = async <T>(url: string, options?: FetchOptions): Promise<T> => {
    const call = { url, options };
    calls.push(call);
    const step = script.shift();
    if (step === undefined) throw new Error(`unexpected call ${url}`);
    return step(call) as T;
  };
  return { fetcher, calls };
}

function session(script: Step[]) {
  const { fetcher, calls } = fakeFetcher(script);
  return { auth: createSession(createAuthApi(fetcher, BASE)), calls };
}

const refreshCalls = (calls: Call[]) => calls.filter((c) => c.url.endsWith('/v1/auth/refresh')).length;

describe('login and register', () => {
  it('keeps the token in memory, sends the cookie flag and loads the user', async () => {
    const { auth, calls } = session([token('A'), () => USER]);
    await auth.login('demo@example.com', 'demo-password-123');
    expect(auth.status.value).toBe('authenticated');
    expect(auth.accessToken.value).toBe('A');
    expect(auth.user.value?.email).toBe('demo@example.com');
    expect(calls[0]).toEqual({
      url: `${BASE}/v1/auth/login`,
      options: { method: 'POST', credentials: 'include', body: { email: 'demo@example.com', password: 'demo-password-123' } },
    });
    expect(calls[1]!.url).toBe(`${BASE}/v1/auth/me`);
    expect(calls[1]!.options?.headers).toEqual({ Authorization: 'Bearer A' });
  });

  it('register sends the display name and signs in', async () => {
    const { auth, calls } = session([token('R'), () => USER]);
    await auth.register('new@example.com', 'a-long-password', 'New');
    expect(auth.accessToken.value).toBe('R');
    expect(calls[0]!.options?.body).toEqual({ email: 'new@example.com', password: 'a-long-password', display_name: 'New' });
  });

  it('a wrong password leaves the session anonymous and surfaces the error', async () => {
    const { auth } = session([unauthorized]);
    await expect(auth.login('demo@example.com', 'nope')).rejects.toBeInstanceOf(FakeFetchError);
    expect(auth.accessToken.value).toBeNull();
    expect(auth.status.value).toBe('unknown');
  });
});

describe('authorized fetch', () => {
  it('refreshes once on a 401 and retries the same request with the new token', async () => {
    const { auth, calls } = session([token('A'), () => USER, unauthorized, token('B'), () => ({ rows: 1 })]);
    await auth.login('demo@example.com', 'pw-long-enough');
    const body = { stats: ['vpip'] };
    const result = await auth.fetch<{ rows: number }>('/v1/reports/run', { method: 'POST', body });
    expect(result).toEqual({ rows: 1 });
    expect(calls.slice(2).map((c) => c.url)).toEqual([`${BASE}/v1/reports/run`, `${BASE}/v1/auth/refresh`, `${BASE}/v1/reports/run`]);
    expect(calls[2]!.options?.headers).toEqual({ Authorization: 'Bearer A' });
    expect(calls[4]!.options).toEqual({ method: 'POST', body, headers: { Authorization: 'Bearer B' } });
    expect(auth.accessToken.value).toBe('B');
    expect(auth.user.value).toEqual(USER);
  });

  it('a failed refresh signs the user out and rethrows the original 401', async () => {
    const { auth, calls } = session([token('A'), () => USER, unauthorized, unauthorized]);
    await auth.login('demo@example.com', 'pw-long-enough');
    await expect(auth.fetch('/v1/auth/me')).rejects.toMatchObject({ status: 401 });
    expect(auth.status.value).toBe('anonymous');
    expect(auth.accessToken.value).toBeNull();
    expect(auth.user.value).toBeNull();
    expect(calls).toHaveLength(4);
  });

  it('an unreachable API during refresh keeps the session and reports the outage', async () => {
    const { auth } = session([token('A'), () => USER, unauthorized, offline]);
    await auth.login('demo@example.com', 'pw-long-enough');
    await expect(auth.fetch('/v1/auth/me')).rejects.toBeInstanceOf(TypeError);
    expect(auth.status.value).toBe('authenticated');
    expect(auth.accessToken.value).toBe('A');
  });

  it('concurrent 401s share one refresh', async () => {
    const { auth, calls } = session([
      token('A'),
      () => USER,
      unauthorized,
      unauthorized,
      token('B'),
      (call) => ({ path: call.url }),
      (call) => ({ path: call.url }),
    ]);
    await auth.login('demo@example.com', 'pw-long-enough');
    const [a, b] = await Promise.all([auth.fetch<{ path: string }>('/v1/hero/leaks'), auth.fetch<{ path: string }>('/v1/hero/sessions')]);
    expect(a.path).toBe(`${BASE}/v1/hero/leaks`);
    expect(b.path).toBe(`${BASE}/v1/hero/sessions`);
    expect(refreshCalls(calls)).toBe(1);
    expect(calls.at(-1)!.options?.headers).toEqual({ Authorization: 'Bearer B' });
  });

  it('a non-401 error is not retried', async () => {
    const { auth, calls } = session([token('A'), () => USER, () => {
      throw new FakeFetchError(500, { detail: 'Internal server error' });
    }]);
    await auth.login('demo@example.com', 'pw-long-enough');
    await expect(auth.fetch('/v1/hero/leaks')).rejects.toMatchObject({ status: 500 });
    expect(calls).toHaveLength(3);
  });
});

describe('bootstrap', () => {
  it('resumes from the refresh cookie and runs once', async () => {
    const { auth, calls } = session([token('A'), () => USER]);
    expect(await auth.bootstrap()).toBe(true);
    expect(await auth.bootstrap()).toBe(true);
    expect(auth.status.value).toBe('authenticated');
    expect(auth.user.value).toEqual(USER);
    expect(calls.map((c) => c.url)).toEqual([`${BASE}/v1/auth/refresh`, `${BASE}/v1/auth/me`]);
    expect(calls[0]!.options?.credentials).toBe('include');
  });

  it('is anonymous without a cookie', async () => {
    const { auth } = session([unauthorized]);
    expect(await auth.bootstrap()).toBe(false);
    expect(auth.status.value).toBe('anonymous');
  });

  it('is anonymous when the API is unreachable, without throwing', async () => {
    const { auth } = session([offline]);
    expect(await auth.bootstrap()).toBe(false);
    expect(auth.status.value).toBe('anonymous');
  });

  it('does not refresh when already signed in', async () => {
    const { auth, calls } = session([token('A'), () => USER]);
    await auth.login('demo@example.com', 'pw-long-enough');
    expect(await auth.bootstrap()).toBe(true);
    expect(calls).toHaveLength(2);
  });
});

describe('logout', () => {
  it('revokes the cookie and clears the state', async () => {
    const { auth, calls } = session([token('A'), () => USER, () => undefined]);
    await auth.login('demo@example.com', 'pw-long-enough');
    await auth.logout();
    expect(auth.status.value).toBe('anonymous');
    expect(auth.accessToken.value).toBeNull();
    expect(calls[2]).toEqual({ url: `${BASE}/v1/auth/logout`, options: { method: 'POST', credentials: 'include' } });
  });

  it('clears the state even when the API is unreachable', async () => {
    const { auth } = session([token('A'), () => USER, offline]);
    await auth.login('demo@example.com', 'pw-long-enough');
    await expect(auth.logout()).rejects.toBeInstanceOf(TypeError);
    expect(auth.status.value).toBe('anonymous');
    expect(auth.accessToken.value).toBeNull();
  });
});

describe('errors and paths', () => {
  it('reads the status from ofetch-style errors', () => {
    expect(errorStatus(new FakeFetchError(429))).toBe(429);
    expect(errorStatus({ statusCode: 403 })).toBe(403);
    expect(errorStatus(new TypeError('fetch failed'))).toBeUndefined();
    expect(errorStatus(null)).toBeUndefined();
  });

  it('turns a failure into one actionable sentence', () => {
    expect(describeSignInError(new FakeFetchError(401, { detail: 'Invalid credentials' }))).toBe('Wrong email or password.');
    expect(describeSignInError(new FakeFetchError(409))).toBe('That email is already registered.');
    expect(describeSignInError(new FakeFetchError(429))).toBe('Too many attempts. Wait a minute and try again.');
    expect(describeSignInError(new FakeFetchError(422, { detail: [{ loc: ['body', 'email'] }] }))).toContain('Check the email address');
    expect(describeSignInError(new FakeFetchError(503, { detail: 'Database unavailable' }))).toBe('Database unavailable');
    expect(describeSignInError(new FakeFetchError(502))).toBe('The API answered with status 502.');
    expect(describeSignInError(new TypeError('fetch failed'))).toContain('did not answer');
  });

  it('follows only a path on this site after sign-in', () => {
    expect(safePath('/account')).toBe('/account');
    expect(safePath('/lab?x=1')).toBe('/lab?x=1');
    expect(safePath('//evil.example/steal')).toBeNull();
    expect(safePath('https://evil.example')).toBeNull();
    expect(safePath(['/a', '/b'])).toBeNull();
    expect(safePath(undefined)).toBeNull();
  });
});
