import { describe, expect, it } from 'vitest';

import type { UploadRow, UploadStatus } from './api';
import { WAIT_HINT_MS } from './status';
import type { Timer, TrackedUpload } from './tracker';
import { GAVE_UP, GIVE_UP_MS, MAX_ACTIVE, POLL_MS, createUploadTracker } from './tracker';

/** Let every pending promise settle (real macrotask; the tracker's own timer is the fake one). */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A timer and a clock that only move when the test says so. */
function fakeTime() {
  let now = 0;
  let nextId = 1;
  const due = new Map<number, { fn: () => void; at: number }>();
  const timer: Timer = {
    set: (fn, ms) => {
      const id = nextId++;
      due.set(id, { fn, at: now + ms });
      return id;
    },
    clear: (handle) => {
      due.delete(handle as number);
    },
  };
  /** Move the clock forward, firing each timer that falls due on the way, in order. */
  async function advance(ms: number): Promise<void> {
    const until = now + ms;
    for (;;) {
      await settle();
      const next = [...due.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (next === undefined) break;
      due.delete(next[0]);
      now = next[1].at;
      next[1].fn();
    }
    now = until;
    await settle();
  }
  return { timer, now: () => now, advance, pending: () => due.size };
}

function row(status: UploadStatus, over: Partial<UploadRow> = {}): UploadRow {
  return {
    upload_id: 'u1',
    status,
    site: 'ggpoker',
    dataset: 'hero',
    filename: 'gg.txt',
    byte_size: 10,
    hands_found: 0,
    hands_parsed: 0,
    hands_failed: 0,
    hands_without_hero: 0,
    error_text: '',
    created_at: '2026-09-15T08:00:00Z',
    updated_at: '2026-09-15T08:00:00Z',
    completed_at: null,
    ...over,
  };
}

/** A server that answers each read with the next item: a row, or something to throw. */
function scripted(answers: (UploadRow | { throws: unknown })[]) {
  const reads: string[] = [];
  const api = {
    get: async (id: string): Promise<UploadRow> => {
      reads.push(id);
      const answer = answers[Math.min(reads.length, answers.length) - 1]!;
      if ('throws' in answer) throw answer.throws;
      return answer;
    },
  };
  return { api, reads };
}

function setup(answers: (UploadRow | { throws: unknown })[]) {
  const time = fakeTime();
  const { api, reads } = scripted(answers);
  const updates: TrackedUpload[] = [];
  const tracker = createUploadTracker(api, { timer: time.timer, now: time.now, onChange: (u) => updates.push(u) });
  return { time, reads, updates, tracker };
}

describe('createUploadTracker', () => {
  it('keeps asking after a read fails, and says why the read failed', async () => {
    const offline = new TypeError('fetch failed');
    const { time, reads, updates, tracker } = setup([{ throws: offline }, { throws: { status: 503, data: { detail: 'Service Unavailable' } } }, row('queued')]);
    tracker.track('u1');
    await time.advance(0);
    expect(updates.at(-1)).toEqual({ uploadId: 'u1', row: null, waitedMs: 0, phase: 'polling', failure: 'The API did not answer. Start it with `make api` in platform/ and try again.' });

    await time.advance(POLL_MS);
    expect(updates.at(-1)!.failure).toBe('Service Unavailable');

    await time.advance(POLL_MS);
    expect(updates.at(-1)).toMatchObject({ phase: 'polling', failure: '', waitedMs: 2 * POLL_MS });
    expect(updates.at(-1)!.row!.status).toBe('queued');
    expect(reads).toHaveLength(3);
  });

  it('gives up at the ceiling, keeps the last row, and stops asking', async () => {
    const { time, reads, updates, tracker } = setup([row('queued')]);
    tracker.track('u1');
    await time.advance(GIVE_UP_MS);
    const last = updates.at(-1)!;
    expect(last).toMatchObject({ phase: 'gave-up', failure: GAVE_UP, waitedMs: GIVE_UP_MS });
    expect(last.row!.status).toBe('queued');
    expect(GAVE_UP).toBe('Stopped checking after 10 minutes. Reload the page to check again.');

    const readsAtGiveUp = reads.length;
    await time.advance(10 * POLL_MS);
    expect(reads).toHaveLength(readsAtGiveUp);
    expect(time.pending()).toBe(0);
  });

  it('stop clears every timer and ignores a read that was still in flight', async () => {
    const { time, reads, updates, tracker } = setup([row('queued')]);
    tracker.track('u1');
    tracker.track('u2');
    tracker.stop(); // both first reads are in flight
    await time.advance(0);
    expect(updates).toEqual([]);
    expect(time.pending()).toBe(0);

    await time.advance(5 * POLL_MS);
    expect(reads).toEqual(['u1', 'u2']);
  });

  it('ignores a track after stop, so nothing is asked and nothing is scheduled', async () => {
    const { time, reads, updates, tracker } = setup([row('queued')]);
    tracker.stop();
    tracker.track('u1');
    await time.advance(5 * POLL_MS);
    expect(reads).toEqual([]);
    expect(updates).toEqual([]);
    expect(time.pending()).toBe(0);
  });

  it('gives up on the uploads still waiting for a slot too, when nothing has moved', async () => {
    const time = fakeTime();
    const api = { get: async (id: string) => row('queued', { upload_id: id }) };
    const updates: TrackedUpload[] = [];
    const tracker = createUploadTracker(api, { timer: time.timer, now: time.now, onChange: (u) => updates.push(u) });
    const ids = Array.from({ length: MAX_ACTIVE + 2 }, (_, i) => `f${i + 1}`);
    ids.forEach((id) => tracker.track(id));
    await time.advance(GIVE_UP_MS);

    const gaveUp = updates.filter((u) => u.phase === 'gave-up').map((u) => u.uploadId);
    expect(gaveUp.sort()).toEqual([...ids].sort());
    expect(time.pending()).toBe(0);
  });

  it('keeps a file behind a busy worker from looking stuck, and never gives up while a sibling moves', async () => {
    const time = fakeTime();
    let batches = 0;
    const api = {
      get: async (id: string): Promise<UploadRow> => {
        if (id !== 'busy') return row('queued', { upload_id: id });
        batches += 1;
        return row('processing', { upload_id: 'busy', hands_parsed: batches * 5000, updated_at: `2026-09-15T08:00:${batches}Z` });
      },
    };
    const updates: TrackedUpload[] = [];
    const tracker = createUploadTracker(api, { timer: time.timer, now: time.now, onChange: (u) => updates.push(u) });
    tracker.track('busy');
    tracker.track('behind');
    await time.advance(3 * WAIT_HINT_MS);
    const behind = updates.filter((u) => u.uploadId === 'behind');
    expect(behind.length).toBeGreaterThan(10);
    expect(Math.max(...behind.map((u) => u.waitedMs))).toBeLessThan(WAIT_HINT_MS);

    await time.advance(GIVE_UP_MS + 10 * POLL_MS);
    expect(updates.some((u) => u.phase === 'gave-up')).toBe(false);
    tracker.stop();
  });

  it('measures the wait from the last time any watched row moved', async () => {
    const time = fakeTime();
    const scripts: Record<string, UploadRow[]> = {
      a: [row('queued', { upload_id: 'a' }), row('processing', { upload_id: 'a', updated_at: '2026-09-15T08:00:02Z' })],
      b: [row('queued', { upload_id: 'b' })],
    };
    const api = { get: async (id: string) => (scripts[id]!.length > 1 ? scripts[id]!.shift()! : scripts[id]![0]!) };
    const updates: TrackedUpload[] = [];
    const tracker = createUploadTracker(api, { timer: time.timer, now: time.now, onChange: (u) => updates.push(u) });
    tracker.track('a');
    tracker.track('b');
    await time.advance(POLL_MS); // a starts processing here, then stays exactly as it is
    await time.advance(WAIT_HINT_MS - POLL_MS);
    expect(updates.at(-1)).toMatchObject({ uploadId: 'b', waitedMs: WAIT_HINT_MS - POLL_MS });
    await time.advance(POLL_MS);
    expect(updates.at(-1)).toMatchObject({ uploadId: 'b', waitedMs: WAIT_HINT_MS });
    tracker.stop();
  });

  it(`polls at most ${MAX_ACTIVE} uploads at once and starts the next, oldest first, when one lands`, async () => {
    const time = fakeTime();
    const reads: string[] = [];
    const landed = new Set<string>();
    const api = {
      get: async (id: string) => {
        reads.push(id);
        return row(landed.has(id) ? 'completed' : 'queued', { upload_id: id });
      },
    };
    const tracker = createUploadTracker(api, { timer: time.timer, now: time.now, onChange: () => undefined });
    ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7'].forEach((id) => tracker.track(id));
    await time.advance(0);
    expect(reads).toEqual(['f1', 'f2', 'f3', 'f4', 'f5']);

    reads.length = 0;
    await time.advance(POLL_MS);
    expect(reads.sort()).toEqual(['f1', 'f2', 'f3', 'f4', 'f5']);

    landed.add('f2');
    reads.length = 0;
    await time.advance(POLL_MS);
    expect(reads.sort()).toEqual(['f1', 'f2', 'f3', 'f4', 'f5', 'f6']);
    tracker.stop();
  });

  it('stops asking once the upload has failed', async () => {
    const { time, reads, updates, tracker } = setup([row('processing'), row('failed', { error_text: 'Processing failed on our side. Upload the file again to retry.' })]);
    tracker.track('u1');
    await time.advance(3 * POLL_MS);
    expect(reads).toHaveLength(2);
    expect(updates.at(-1)).toMatchObject({ phase: 'done', failure: '' });
    expect(updates.at(-1)!.row!.error_text).toBe('Processing failed on our side. Upload the file again to retry.');
  });

  it('reports queued, then processing with its counts so far, then completed, and stops', async () => {
    const { time, reads, updates, tracker } = setup([
      row('queued'),
      row('processing', { hands_found: 5000, hands_parsed: 5000 }),
      row('completed', { hands_found: 7200, hands_parsed: 7200 }),
    ]);
    tracker.track('u1');
    tracker.track('u1'); // watching twice is one watch
    await time.advance(10 * POLL_MS);

    // Each change of status is progress, so the wait restarts on every answer that moved.
    expect(updates.map((u) => [u.row?.status, u.phase, u.waitedMs])).toEqual([
      ['queued', 'polling', 0],
      ['processing', 'polling', 0],
      ['completed', 'done', 0],
    ]);
    expect(updates[1]!.row!.hands_parsed).toBe(5000);
    expect(reads).toHaveLength(3);
    expect(time.pending()).toBe(0);
  });

  it('watches several uploads independently', async () => {
    const time = fakeTime();
    const rows: Record<string, UploadRow[]> = {
      a: [row('completed', { upload_id: 'a' })],
      b: [row('queued', { upload_id: 'b' }), row('completed', { upload_id: 'b' })],
    };
    const api = { get: async (id: string) => rows[id]!.shift() ?? row('completed', { upload_id: id }) };
    const updates: TrackedUpload[] = [];
    const tracker = createUploadTracker(api, { timer: time.timer, now: time.now, onChange: (u) => updates.push(u) });
    tracker.track('a');
    tracker.track('b');
    await time.advance(POLL_MS);
    expect(updates.map((u) => [u.uploadId, u.phase])).toEqual([
      ['a', 'done'],
      ['b', 'polling'],
      ['b', 'done'],
    ]);
  });
});
