/**
 * The auth transport (plan D.2, ADR-024): the `/v1/auth` calls the session needs, on top of any
 * `$fetch`-shaped function, so the session logic is testable with a fake. Every auth call sends
 * `credentials: 'include'`: the refresh token is an HttpOnly cookie scoped to `/v1/auth`, and a
 * cross-origin response's Set-Cookie is only honoured when the request carried credentials.
 */

export interface FetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
}

/** The part of Nuxt's `$fetch` the session relies on. */
export type Fetcher = <T>(url: string, options?: FetchOptions) => Promise<T>;

/** `POST /v1/auth/{login,register,refresh}`. The refresh token travels separately, as a cookie. */
export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

/** `GET /v1/auth/me`. */
export interface AuthUser {
  id: string;
  email: string;
  display_name: string;
  is_active: boolean;
}

export interface AuthApi {
  readonly baseUrl: string;
  readonly fetcher: Fetcher;
  login(email: string, password: string): Promise<TokenResponse>;
  register(email: string, password: string, displayName: string): Promise<TokenResponse>;
  refresh(): Promise<TokenResponse>;
  logout(): Promise<void>;
}

/** Bind the four auth endpoints to a fetcher and the API origin. */
export function createAuthApi(fetcher: Fetcher, baseUrl: string): AuthApi {
  const call = <T>(path: string, options: FetchOptions = {}): Promise<T> =>
    fetcher<T>(`${baseUrl}/v1/auth${path}`, { method: 'POST', credentials: 'include', ...options });
  return {
    baseUrl,
    fetcher,
    login: (email, password) => call('/login', { body: { email, password } }),
    register: (email, password, displayName) => call('/register', { body: { email, password, display_name: displayName } }),
    refresh: () => call('/refresh'),
    logout: () => call('/logout'),
  };
}

interface FetchErrorLike {
  status?: unknown;
  statusCode?: unknown;
  data?: unknown;
}

/** The HTTP status of a failed `$fetch` call, or undefined when the request never got an answer. */
export function errorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const { status, statusCode } = error as FetchErrorLike;
  if (typeof status === 'number') return status;
  if (typeof statusCode === 'number') return statusCode;
  return undefined;
}

/** True for a 401: the access token is missing, expired or revoked. */
export function isUnauthorized(error: unknown): boolean {
  return errorStatus(error) === 401;
}

/** The API's `detail` when it is one sentence (FastAPI's 422 sends a list instead). */
export function errorDetail(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const data = (error as FetchErrorLike).data;
  if (typeof data !== 'object' || data === null) return null;
  const detail = (data as { detail?: unknown }).detail;
  return typeof detail === 'string' ? detail : null;
}

interface ValidationItem {
  loc?: unknown;
  msg?: unknown;
}

/**
 * FastAPI's 422 `detail` is a list of `{loc, msg}`; each becomes "where: what", in the server's
 * words, with the `body` part of the location dropped. Empty when the detail is not such a list.
 */
export function validationMessages(error: unknown): string[] {
  if (typeof error !== 'object' || error === null) return [];
  const data = (error as FetchErrorLike).data;
  if (typeof data !== 'object' || data === null) return [];
  const detail = (data as { detail?: unknown }).detail;
  if (!Array.isArray(detail)) return [];
  return (detail as unknown[]).map((raw) => {
    const item = (typeof raw === 'object' && raw !== null ? raw : {}) as ValidationItem;
    const where = Array.isArray(item.loc) ? item.loc.filter((part) => part !== 'body').join('.') : '';
    const what = typeof item.msg === 'string' ? item.msg : 'invalid';
    return where === '' ? what : `${where}: ${what}`;
  });
}

const SIGN_IN_MESSAGES: Record<number, string> = {
  401: 'Wrong email or password.',
  403: 'This account is disabled.',
  409: 'That email is already registered.',
  422: 'Check the email address and the password (at least 10 characters).',
  429: 'Too many attempts. Wait a minute and try again.',
};

const NO_ANSWER = 'The API did not answer. Start it with `make api` in platform/ and try again.';

/** One actionable sentence for a failed sign-in or registration. */
export function describeSignInError(error: unknown): string {
  const status = errorStatus(error);
  if (status === undefined) return NO_ANSWER;
  return SIGN_IN_MESSAGES[status] ?? errorDetail(error) ?? `The API answered with status ${status}.`;
}

/**
 * One sentence for any other failed call: the API's own detail (a 422's list joined with " · "),
 * else its status, else what threw. `whenSilent` is what to say when nothing answered at all,
 * which differs per screen.
 */
export function describeApiError(error: unknown, whenSilent = NO_ANSWER): string {
  const status = errorStatus(error);
  if (status !== undefined) {
    const listed = validationMessages(error);
    if (listed.length > 0) return listed.join(' · ');
    return errorDetail(error) ?? `The API answered with status ${status}.`;
  }
  if (error instanceof Error && error.name !== 'FetchError' && error.name !== 'TypeError') return `${error.name}: ${error.message}`;
  return whenSilent;
}
