import { describe, expect, it } from 'vitest';

import { describeApiError, errorDetail, unwrapAsyncDataError, validationMessages } from './api';

const SILENT = 'Nothing answered.';

/** The two sentences `describeApiError` owns, pinned once so a reword shows up as one diff. */
const BROKE =
  'The API failed while answering this; the reason is in the terminal running `make api`. Reload the page once it has been fixed.';
const SIGNED_OUT = 'Your sign-in has expired. Use Sign in at the top of the page, then try again.';

/**
 * What ofetch throws when the request never reached the API: no status and no data, and — for the
 * FetchError it wraps the browser in — the browser's own TypeError as its `cause`.
 */
function networkFailure(name: 'FetchError' | 'TypeError'): Error {
  const error = new TypeError('fetch failed');
  error.name = name;
  if (name === 'FetchError') error.cause = new TypeError('Failed to fetch');
  return error;
}

/** Nuxt's flag, copied so the fake below is wrong in the same way the real one would be if it moved. */
const NUXT_FLAG = '__nuxt_error';

/** What threw, as `useAsyncData` stores it: h3's `createError` plus Nuxt's flag (Nuxt 4.5.2). */
type Thrown = { message?: string; status?: number; data?: unknown; cause?: unknown };

/**
 * Mirrors `nuxt/dist/app/composables/{asyncData,error}.js`: the message is copied, `data` only when
 * the answer carried any, `statusCode` falls back to 500 whatever went wrong, `cause` is
 * `thrown.cause` or the thrown error itself, and the flag is non-enumerable.
 */
function wrappedByNuxt(thrown: Thrown): unknown {
  const wrapper = new Error(thrown.message ?? '', { cause: thrown.cause ?? thrown }) as Error & { statusCode: number; data?: unknown };
  wrapper.statusCode = thrown.status ?? 500;
  if (thrown.data) wrapper.data = thrown.data;
  Object.defineProperty(wrapper, NUXT_FLAG, { value: true, configurable: false, writable: false });
  Object.defineProperty(wrapper, 'status', { get: () => wrapper.statusCode, configurable: true });
  return wrapper;
}

const UNPROCESSABLE = {
  status: 422,
  data: {
    detail: [
      { loc: ['body', 'site'], msg: "Input should be 'ggpoker' or 'pokerstars'" },
      { loc: ['body', 'screen_name'], msg: 'String should have at least 1 character' },
    ],
  },
};

describe('validationMessages', () => {
  it('reads nothing from what is not an error object', () => {
    expect(validationMessages(null)).toEqual([]);
    expect(validationMessages('boom')).toEqual([]);
    expect(validationMessages({ status: 500 })).toEqual([]);
    expect(validationMessages({ status: 400, data: { detail: 'The file is empty.' } })).toEqual([]);
  });

  it('keeps an item with no location or no message readable rather than dropping it', () => {
    const error = { status: 422, data: { detail: [{ msg: 'Field required' }, { loc: ['body'] }, 'junk'] } };
    expect(validationMessages(error)).toEqual(['Field required', 'invalid', 'invalid']);
  });

  it('turns each item into "where: what" with the body part of the location dropped', () => {
    expect(validationMessages(UNPROCESSABLE)).toEqual([
      "site: Input should be 'ggpoker' or 'pokerstars'",
      'screen_name: String should have at least 1 character',
    ]);
    const nested = { status: 422, data: { detail: [{ loc: ['query', 'limit'], msg: 'Input should be less than or equal to 200' }] } };
    expect(validationMessages(nested)).toEqual(['query.limit: Input should be less than or equal to 200']);
  });
});

describe('errorDetail', () => {
  it('is null when there is no one-sentence detail', () => {
    expect(errorDetail(undefined)).toBeNull();
    expect(errorDetail({ status: 500 })).toBeNull();
    expect(errorDetail({ status: 500, data: 'Internal Server Error' })).toBeNull();
    expect(errorDetail(UNPROCESSABLE)).toBeNull();
  });

  it('is the detail sentence when the API sent one', () => {
    expect(errorDetail({ status: 404, data: { detail: 'Upload not found' } })).toBe('Upload not found');
  });
});

describe('describeApiError', () => {
  it('says the API did not answer when the request never reached it', () => {
    expect(describeApiError(networkFailure('FetchError'), SILENT)).toBe(SILENT);
    expect(describeApiError(networkFailure('TypeError'), SILENT)).toBe(SILENT);
    expect(describeApiError(undefined)).toBe('The API did not answer. Start it with `make api` in platform/ and try again.');
  });

  it('names what threw when it was not the network', () => {
    expect(describeApiError(new RangeError('bad index'), SILENT)).toBe('RangeError: bad index');
  });

  it('offers another attempt when the API broke while answering and said nothing', () => {
    expect(describeApiError({ status: 502 })).toBe(BROKE);
    expect(describeApiError({ statusCode: 500, data: {} })).toBe(BROKE);
  });

  it('reads the catch-all\'s sanitized detail as no detail at all', () => {
    // The API answers an unclassified failure with this exact string; printing it verbatim named
    // no next step. (The query refused for running alongside too many others used to arrive this
    // way; since plan H.0 it is a 429 with its own sentence, which the test below keeps.)
    expect(describeApiError({ status: 500, data: { detail: 'Internal server error' } })).toBe(BROKE);
  });

  it('keeps a 5xx sentence that does say something', () => {
    const slow = { status: 504, data: { detail: "This query took longer than the account's budget allows." } };
    expect(describeApiError(slow)).toBe("This query took longer than the account's budget allows.");
  });

  it('names the one way back in when the sign-in has run out', () => {
    // The session has already spent its refresh cookie by the time a page sees this, so the API's
    // own "Invalid or expired token" would be wrapped in a retry that cannot succeed.
    expect(describeApiError({ status: 401, data: { detail: 'Invalid or expired token' } })).toBe(SIGNED_OUT);
    expect(describeApiError({ status: 401, data: { detail: 'Not authenticated' } })).toBe(SIGNED_OUT);
  });

  it('asks for a reload on a status the page has no sentence for', () => {
    expect(describeApiError({ status: 418 })).toBe('The API answered with status 418, which this page did not expect. Reload and try again.');
  });

  it("joins a 422's list of problems instead of reporting a bare status", () => {
    expect(describeApiError(UNPROCESSABLE)).toBe(
      "site: Input should be 'ggpoker' or 'pokerstars' · screen_name: String should have at least 1 character",
    );
  });

  it("shows the API's own sentence", () => {
    const conflict = { status: 409, data: { detail: 'This file is already uploaded as My hands. A file belongs to one dataset.' } };
    expect(describeApiError(conflict)).toBe('This file is already uploaded as My hands. A file belongs to one dataset.');
  });
});

describe('describeApiError, through the wrapper a page gets from useAsyncData', () => {
  it('says the API did not answer when nothing answered, rather than blaming a 500 the API never sent', () => {
    expect(describeApiError(wrappedByNuxt(networkFailure('FetchError')), SILENT)).toBe(SILENT);
  });

  it('names what threw on the page, rather than blaming a 500', () => {
    expect(describeApiError(wrappedByNuxt(new RangeError('bad index')), SILENT)).toBe('RangeError: bad index');
  });

  it("still shows the API's own sentence", () => {
    expect(describeApiError(wrappedByNuxt({ status: 400, data: { detail: 'The file is empty.' } }))).toBe('The file is empty.');
  });

  it("still joins a 422's list of problems", () => {
    expect(describeApiError(wrappedByNuxt(UNPROCESSABLE))).toBe(
      "site: Input should be 'ggpoker' or 'pokerstars' · screen_name: String should have at least 1 character",
    );
  });

  // Changed with the sanitized-detail rule above: this used to pin the developer's noun through
  // the wrapper, which is exactly how every page but the replayer printed a refusal under load.
  it('reads the sanitized 500 through the wrapper the same way', () => {
    expect(describeApiError(wrappedByNuxt({ status: 500, data: { detail: 'Internal server error' } }))).toBe(BROKE);
  });

  it('still shows what the API said about a 5xx it could describe', () => {
    const slow = { status: 504, data: { detail: "This query took longer than the account's budget allows." } };
    expect(describeApiError(wrappedByNuxt(slow))).toBe("This query took longer than the account's budget allows.");
  });

  it('leaves an error that carries a cause of its own unopened', () => {
    const answered = { status: 404, data: { detail: 'Upload not found' }, cause: new TypeError('something else entirely') };
    expect(describeApiError(answered)).toBe('Upload not found');
  });

  it('reads a flagged wrapper with no cause as itself', () => {
    const wrapper = { statusCode: 404, data: { detail: 'Gone' } };
    Object.defineProperty(wrapper, NUXT_FLAG, { value: true });
    expect(describeApiError(wrapper)).toBe('Gone');
  });
});

describe('unwrapAsyncDataError', () => {
  it('hands back anything Nuxt did not wrap', () => {
    expect(unwrapAsyncDataError(null)).toBeNull();
    expect(unwrapAsyncDataError(undefined)).toBeUndefined();
    expect(unwrapAsyncDataError('boom')).toBe('boom');
  });
});
