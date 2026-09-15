import { describe, expect, it } from 'vitest';

import type { UploadRow } from './api';
import { DATASET_LABELS, NO_DATASET_LABEL, WAIT_HINT_MS, dedupeNote, describeRow, describeUploadError, refusal, uploadedAt } from './status';

/** A row as the API sends it; each test overrides what it is about. */
function row(over: Partial<UploadRow> = {}): UploadRow {
  return {
    upload_id: 'u1',
    status: 'completed',
    site: 'pokerstars',
    dataset: 'hero',
    filename: 'stars.txt',
    byte_size: 2048,
    hands_found: 0,
    hands_parsed: 0,
    hands_failed: 0,
    hands_without_hero: 0,
    error_text: '',
    created_at: '2026-09-15T08:05:00Z',
    updated_at: '2026-09-15T08:05:00Z',
    completed_at: null,
    ...over,
  };
}

describe('refusal', () => {
  it('refuses a zip by its name, whatever the case', () => {
    expect(refusal(new File(['PK'], 'march.zip'))).toBe('march.zip is a zip archive. Unzip it and drop the .txt files inside.');
    expect(refusal(new File(['PK'], 'MARCH.ZIP'))).toBe('MARCH.ZIP is a zip archive. Unzip it and drop the .txt files inside.');
  });

  it('refuses an empty file', () => {
    expect(refusal(new File([], 'blank.txt'))).toBe('blank.txt is empty.');
  });

  it('lets a hand history through', () => {
    expect(refusal(new File(['PokerStars Hand #1'], 'stars.txt'))).toBeNull();
    expect(refusal(new File(['x'], 'zip-codes.txt'))).toBeNull();
  });
});

describe('describeUploadError', () => {
  it('says to start the API when nothing answered', () => {
    const offline = new TypeError('fetch failed');
    expect(describeUploadError(offline)).toBe('The API did not answer. Start it with `make api` in platform/ and try again.');
  });

  it("joins a 422's list", () => {
    const error = { status: 422, data: { detail: [{ loc: ['body', 'screen_name'], msg: 'String should have at least 1 character' }, { loc: ['body', 'site'], msg: 'Field required' }] } };
    expect(describeUploadError(error)).toBe('screen_name: String should have at least 1 character · site: Field required');
  });

  it("shows the server's sentences as they are", () => {
    const sentences: [number, string][] = [
      [413, 'The file is larger than 200 MB. Split it and upload the parts.'],
      [409, 'This file is already uploaded as Pool hands. A file belongs to one dataset.'],
      [422, 'Could not tell which poker site this file is from. Choose the site and upload it again.'],
      [503, 'The upload queue did not answer. Upload the file again in a minute.'],
      [503, 'Storage did not answer. Upload the file again in a minute.'],
    ];
    for (const [status, detail] of sentences) expect(describeUploadError({ status, data: { detail } })).toBe(detail);
  });
});

describe('describeRow', () => {
  it('shows a failed file in the tone of a failure, with the reason the server wrote', () => {
    const failed = row({ status: 'failed', error_text: 'No hands were found in this file. Check that it is a pokerstars hand history.' });
    expect(describeRow(failed, { waitedMs: 0 })).toEqual({
      tone: 'fail',
      headline: 'Failed',
      detail: 'No hands were found in this file. Check that it is a pokerstars hand history.',
    });
  });

  it('asks about the worker only once a file has waited long enough', () => {
    const queued = row({ status: 'queued' });
    expect(describeRow(queued, { waitedMs: WAIT_HINT_MS - 1 })).toEqual({ tone: 'wait', headline: 'Waiting for the parser', detail: '' });
    expect(describeRow(queued, { waitedMs: WAIT_HINT_MS }).detail).toBe('Still waiting. Is the parser worker running? Start it with `make worker` in platform/.');
  });

  it('warns when none of the hands in My hands has a seat recognised as the uploader', () => {
    const state = describeRow(row({ hands_parsed: 5000, hands_without_hero: 5000 }), { waitedMs: 0 });
    expect(state.tone).toBe('warn');
    expect(state.headline).toBe('5,000 hands in');
    expect(state.detail).toBe(
      'None of these 5,000 hands has a seat recognised as yours, so My game does not count them. If they are your hands, add your screen name for pokerstars under Poker accounts before uploading more. ' +
        'If the file is from a table you observed rather than played, it cannot be moved to Pool hands from this page: the server refuses the same file under the other dataset.',
    );
  });

  it('warns about a single hand without a seat in words that fit one hand', () => {
    const state = describeRow(row({ site: 'ggpoker', hands_parsed: 1, hands_without_hero: 1 }), { waitedMs: 0 });
    expect(state.headline).toBe('1 hand in');
    expect(state.detail).toBe(
      'This hand has no seat recognised as yours, so My game does not count it. If it is your hand, add your screen name for ggpoker under Poker accounts before uploading more. ' +
        'If the file is from a table you observed rather than played, it cannot be moved to Pool hands from this page: the server refuses the same file under the other dataset.',
    );
  });

  it('does not pass a row from before datasets off as fine, since nobody can say where its hands went', () => {
    const state = describeRow(row({ dataset: null, hands_parsed: 90, hands_without_hero: 90 }), { waitedMs: 0 });
    expect(state).toEqual({
      tone: 'warn',
      headline: '90 hands in',
      detail: 'This file was uploaded before uploads recorded a dataset, so this page cannot tell whether its hands are in My game or the pool.',
    });
  });

  it('warns when only some of the hands have no seat recognised', () => {
    const state = describeRow(row({ hands_parsed: 1200, hands_failed: 3, hands_without_hero: 40 }), { waitedMs: 0 });
    expect(state).toEqual({
      tone: 'warn',
      headline: '1,200 hands in, 3 could not be read',
      detail: '40 of these 1,200 hands have no seat recognised as yours and are not counted in My game.',
    });
  });

  it('never warns about seats on Pool hands', () => {
    expect(describeRow(row({ dataset: 'population', hands_parsed: 90, hands_without_hero: 90 }), { waitedMs: 0 })).toEqual({ tone: 'ok', headline: '90 hands in', detail: '' });
  });

  it('counts what is stored so far while processing', () => {
    expect(describeRow(row({ status: 'processing', hands_found: 20000, hands_parsed: 15000 }), { waitedMs: 0 })).toEqual({
      tone: 'wait',
      headline: 'Reading hands — 15,000 stored so far',
      detail: '',
    });
  });

  it('reports a clean hero upload as done', () => {
    expect(describeRow(row({ hands_parsed: 12408 }), { waitedMs: 0 })).toEqual({ tone: 'ok', headline: '12,408 hands in', detail: '' });
  });
});

describe('dedupeNote and labels', () => {
  it('notes only a file the server had seen before', () => {
    expect(dedupeNote({ dedupe: 'new' })).toBe('');
    expect(dedupeNote({ dedupe: 'duplicate' })).toBe('Uploaded before');
    expect(dedupeNote({ dedupe: 'requeued' })).toBe('Failed before — trying again');
  });

  it('names each dataset the way the rest of the app does, and a missing one as missing', () => {
    expect(DATASET_LABELS).toEqual({ hero: 'My hands', population: 'Pool hands' });
    expect(NO_DATASET_LABEL).toBe('Dataset not recorded');
  });
});

describe('uploadedAt', () => {
  it('leaves text that is not a timestamp as it is', () => {
    expect(uploadedAt('yesterday')).toBe('yesterday');
  });

  it('prints a timestamp to the minute', () => {
    // No offset: read as local time, so the test does not depend on the machine's zone.
    expect(uploadedAt('2026-09-05T08:07:59')).toBe('2026-09-05 08:07');
  });
});
