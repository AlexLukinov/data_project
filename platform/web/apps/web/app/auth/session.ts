/**
 * The client session (plan D.2, ADR-024). The access token lives in memory only, never in
 * localStorage where any injected script could read it; the refresh token is a cookie JavaScript
 * cannot see. `fetch` adds the bearer header and, on a 401, refreshes once and retries.
 * Concurrent 401s share a single refresh: refresh tokens rotate, so a second refresh with the
 * same cookie would be rejected as a replay and sign the user out. Framework-free apart from Vue
 * refs so it is tested with a fake fetcher; the Pinia store only registers it.
 */
import { ref, type Ref } from 'vue';

import type { AuthApi, AuthUser, Fetcher, FetchOptions, TokenResponse } from './api';
import { isUnauthorized } from './api';

export type AuthStatus = 'unknown' | 'anonymous' | 'authenticated';

export interface AuthSession {
  status: Ref<AuthStatus>;
  user: Ref<AuthUser | null>;
  accessToken: Ref<string | null>;
  login(email: string, password: string): Promise<void>;
  register(email: string, password: string, displayName: string): Promise<void>;
  /** Revoke the refresh token; the local state is cleared even when the API cannot be reached. */
  logout(): Promise<void>;
  /** Exchange the refresh cookie for a new access token. False when the cookie is missing or stale. */
  refresh(): Promise<boolean>;
  /** Resume a session from the refresh cookie. Runs once; never throws. */
  bootstrap(): Promise<boolean>;
  /** `$fetch` against the API with the bearer header; a 401 refreshes once and retries. */
  fetch: Fetcher;
}

interface SessionState {
  status: Ref<AuthStatus>;
  user: Ref<AuthUser | null>;
  accessToken: Ref<string | null>;
  clear(): void;
  apply(token: TokenResponse): void;
}

const ME_PATH = '/v1/auth/me';

function createSessionState(): SessionState {
  const status = ref<AuthStatus>('unknown');
  const user = ref<AuthUser | null>(null);
  const accessToken = ref<string | null>(null);
  return {
    status,
    user,
    accessToken,
    clear: () => {
      accessToken.value = null;
      user.value = null;
      status.value = 'anonymous';
    },
    apply: (token) => {
      accessToken.value = token.access_token;
      status.value = 'authenticated';
    },
  };
}

/** One refresh in flight at a time; a 401 signs out, any other failure keeps the session and propagates. */
function createRefresher(api: AuthApi, state: SessionState): () => Promise<boolean> {
  let inflight: Promise<boolean> | null = null;
  async function exchange(): Promise<boolean> {
    try {
      state.apply(await api.refresh());
      return true;
    } catch (error) {
      if (!isUnauthorized(error)) throw error;
      state.clear();
      return false;
    }
  }
  return () => {
    inflight ??= exchange().finally(() => {
      inflight = null;
    });
    return inflight;
  };
}

function createAuthorizedFetch(api: AuthApi, state: SessionState, refresh: () => Promise<boolean>): Fetcher {
  function send<T>(path: string, options: FetchOptions): Promise<T> {
    const headers = { ...options.headers };
    if (state.accessToken.value !== null) headers.Authorization = `Bearer ${state.accessToken.value}`;
    return api.fetcher<T>(`${api.baseUrl}${path}`, { ...options, headers });
  }
  return async <T>(path: string, options: FetchOptions = {}): Promise<T> => {
    try {
      return await send<T>(path, options);
    } catch (error) {
      if (!isUnauthorized(error) || !(await refresh())) throw error;
      return send<T>(path, options);
    }
  };
}

/** Resume from the refresh cookie, once. No cookie and no answer from the API both mean signed out. */
function createBootstrap(state: SessionState, refresh: () => Promise<boolean>, loadUser: () => Promise<void>): () => Promise<boolean> {
  let booted: Promise<void> | null = null;
  async function resume(): Promise<void> {
    if (state.status.value === 'authenticated') return;
    try {
      if (await refresh()) await loadUser();
    } catch {
      state.clear(); // the sign-in page reports the real error on the next attempt
    }
  }
  return async () => {
    booted ??= resume();
    await booted;
    return state.status.value === 'authenticated';
  };
}

/** Build the session over an auth API. */
export function createSession(api: AuthApi): AuthSession {
  const state = createSessionState();
  const refresh = createRefresher(api, state);
  const fetch = createAuthorizedFetch(api, state, refresh);

  async function loadUser(): Promise<void> {
    state.user.value = await fetch<AuthUser>(ME_PATH);
  }
  async function signIn(issued: Promise<TokenResponse>): Promise<void> {
    state.apply(await issued);
    await loadUser();
  }
  const bootstrap = createBootstrap(state, refresh, loadUser);
  async function logout(): Promise<void> {
    try {
      await api.logout();
    } finally {
      state.clear();
    }
  }

  return {
    status: state.status,
    user: state.user,
    accessToken: state.accessToken,
    login: (email, password) => signIn(api.login(email, password)),
    register: (email, password, displayName) => signIn(api.register(email, password, displayName)),
    logout,
    refresh,
    bootstrap,
    fetch,
  };
}
