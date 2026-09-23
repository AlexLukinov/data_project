/**
 * The auth transport (plan D.2, ADR-024): the `/v1/auth` calls the session needs, on top of any
 * `$fetch`-shaped function, so the session logic is testable with a fake. Every auth call sends
 * `credentials: 'include'`: the refresh token is an HttpOnly cookie scoped to `/v1/auth`, and a
 * cross-origin response's Set-Cookie is only honoured when the request carried credentials.
 */

export interface FetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** JSON on every call but one: an upload sends a `FormData`, which ofetch passes through as it is. */
  body?: Record<string, unknown> | FormData;
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

/** One actionable sentence for a failed sign-in or registration. Read from the raw error: the sign-in form awaits its own call. */
export function describeSignInError(error: unknown): string {
  const status = errorStatus(error);
  if (status === undefined) return NO_ANSWER;
  return SIGN_IN_MESSAGES[status] ?? errorDetail(error) ?? `The API answered with status ${status}.`;
}

/** The flag Nuxt stamps on every error it hands a page (`isNuxtError`, `nuxt/dist/app/composables/error.js`). */
const NUXT_ERROR_SIGNATURE = '__nuxt_error';

/**
 * What actually threw behind a `useAsyncData` error. Nuxt stores h3's `createError(thrown)`, whose
 * `statusCode` is 500 whenever nothing answered — so a stopped API reads as "status 500" on every
 * page that awaits its data, unless the original is dug back out of `cause` (h3 sets that to
 * `thrown.cause || thrown`: a network failure arrives as its TypeError, an HTTP one as the fetch
 * error itself). Only Nuxt's own flag opens a wrapper: an error that carries a `cause` for its own
 * reasons is still its own message, and is handed back untouched.
 *
 * `errorStatus` and `isUnauthorized` deliberately do **not** unwrap: `session.ts` reads them on the
 * raw rejection of a call it made itself, where a 401 must stay a 401.
 */
export function unwrapAsyncDataError(error: unknown): unknown {
  if (typeof error !== 'object' || error === null || !(NUXT_ERROR_SIGNATURE in error)) return error;
  return (error as { cause?: unknown }).cause ?? error;
}

/**
 * What the API's catch-all sends for anything it did not classify (`api/main.py`). It is a
 * developer's noun with no next step, so it counts as *no* detail here — the sentence below says
 * what it stands for instead. `hands/study.ts` knows the same string; its own wording names the
 * step being replayed, which this one cannot.
 */
const SANITIZED = 'Internal server error';

/**
 * A 5xx the API would not describe. Until plan H.0 most of them were one thing — ClickHouse
 * refusing a query because the account was already running as many as its budget allows (plan
 * E.3), which arrived unclassified and so sanitized — and this sentence said so and offered a
 * retry. That refusal is now a 429 whose own detail reaches the screen unchanged, so what is
 * left behind a sanitized 5xx is a fault: retrying cannot help, and the sentence says where the
 * reason is instead of guessing at one.
 */
const API_BROKE = 'The API failed while answering this; the reason is in the terminal running `make api`. Reload the page once it has been fixed.';

/**
 * A 401 outside the sign-in form. `session.ts` has already tried the refresh cookie and cleared the
 * session, so the API's own "Invalid or expired token" would be wrapped in a retry that cannot
 * work: nothing signs the reader back in mid-page. The header's Sign in link is the only way out.
 */
const SIGN_IN_EXPIRED = 'Your sign-in has expired. Use Sign in at the top of the page, then try again.';

/**
 * One sentence for any other failed call: the API's own detail (a 422's list joined with " · "),
 * else what its bare status means, else what threw. The error is unwrapped first, because a page
 * that got it from `useAsyncData` is holding Nuxt's wrapper rather than the failure itself.
 * `whenSilent` is what to say when nothing answered at all, which differs per screen.
 *
 * A 5xx is read before its detail, because this API's catch-all always sends one and it says
 * nothing; a 5xx that does say something — tenancy's 504 "This query took longer than the
 * account's budget allows." — still speaks for itself.
 */
export function describeApiError(error: unknown, whenSilent = NO_ANSWER): string {
  const thrown = unwrapAsyncDataError(error);
  const status = errorStatus(thrown);
  if (status !== undefined) {
    if (status === 401) return SIGN_IN_EXPIRED;
    const listed = validationMessages(thrown);
    if (listed.length > 0) return listed.join(' · ');
    const detail = errorDetail(thrown);
    if (status >= 500 && (detail === null || detail === SANITIZED)) return API_BROKE;
    if (detail !== null) return detail;
    return `The API answered with status ${status}, which this page did not expect. Reload and try again.`;
  }
  if (thrown instanceof Error && thrown.name !== 'FetchError' && thrown.name !== 'TypeError') return `${thrown.name}: ${thrown.message}`;
  return whenSilent;
}
