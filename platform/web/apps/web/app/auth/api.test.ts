import { describe, expect, it } from 'vitest';

import { describeApiError, errorDetail, validationMessages } from './api';

const SILENT = 'Nothing answered.';

/** What ofetch throws when the request never reached the API. */
function networkFailure(name: 'FetchError' | 'TypeError'): Error {
  const error = new TypeError('fetch failed');
  error.name = name;
  return error;
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

  it('falls back to the status when the answer carried no detail', () => {
    expect(describeApiError({ status: 502 })).toBe('The API answered with status 502.');
    expect(describeApiError({ statusCode: 500, data: {} })).toBe('The API answered with status 500.');
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
