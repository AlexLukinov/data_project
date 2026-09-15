// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';

import type { PathedFile } from '~/ranges/files';
import type { UploadAccepted, UploadChoice, UploadRow, UploadStatus, UploadsApi } from '~/upload/api';
import { WAIT_HINT_MS } from '~/upload/status';
import type { Timer } from '~/upload/tracker';
import { POLL_MS } from '~/upload/tracker';

import UploadQueue from './UploadQueue.vue';

/** A `NuxtLink` for a test with no Nuxt: an anchor that keeps the target. */
const NuxtLink = defineComponent({
  props: { to: { type: String, required: true } },
  setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()),
});

function row(id: string, status: UploadStatus, over: Partial<UploadRow> = {}): UploadRow {
  return {
    upload_id: id,
    status,
    site: 'pokerstars',
    dataset: 'hero',
    filename: id,
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

/** An in-memory API: each upload gets its file name as its id; each id answers its script in turn, then repeats the last answer. */
function fakeApi(over: Partial<UploadsApi> = {}) {
  const sent: string[] = [];
  const reads: string[] = [];
  const scripts = new Map<string, UploadRow[]>();
  const api: UploadsApi = {
    sites: async () => ['ggpoker', 'pokerstars'],
    list: async () => [],
    get: async (id) => {
      reads.push(id);
      const script = scripts.get(id) ?? [row(id, 'queued')];
      return script.length > 1 ? script.shift()! : script[0]!;
    },
    upload: async (file, choice): Promise<UploadAccepted> => {
      sent.push(`${file.name}:${choice.dataset}:${choice.site}`);
      return { upload_id: file.name, status: 'queued', dedupe: 'new' };
    },
    accounts: async () => [],
    addAccount: async () => {
      throw new Error('not used here');
    },
    removeAccount: async () => undefined,
    ...over,
  };
  return { api, sent, reads, script: (id: string, rows: UploadRow[]) => scripts.set(id, rows) };
}

/** The real timers (faked by vitest), counting what is still scheduled. */
function countingTimer() {
  const live = new Set<unknown>();
  const timer: Timer = {
    set: (fn, ms) => {
      const handle = setTimeout(() => {
        live.delete(handle);
        fn();
      }, ms);
      live.add(handle);
      return handle;
    },
    clear: (handle) => {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
      live.delete(handle);
    },
  };
  return { timer, live };
}

/** Uploads that answer only when the test releases them; `sent` records what each was sent as. */
function heldUploads() {
  const sent: string[] = [];
  const releases: (() => void)[] = [];
  const upload: UploadsApi['upload'] = (file, choice) =>
    new Promise<UploadAccepted>((resolve) => {
      sent.push(`${file.name}:${choice.dataset}:${choice.site}`);
      releases.push(() => resolve({ upload_id: file.name, status: 'queued', dedupe: 'new' }));
    });
  return { upload, sent, releases };
}

const HERO: UploadChoice = { site: '', dataset: 'hero' };

function mountQueue(api: UploadsApi, choice: UploadChoice = HERO) {
  const { timer, live } = countingTimer();
  const w = mount(UploadQueue, { props: { api, choice, timer, now: () => Date.now() }, global: { components: { NuxtLink } } });
  return { w, live };
}

const pathed = (name: string, text = 'PokerStars Hand #1'): PathedFile => ({ path: `export/${name}`, file: new File(text === '' ? [] : [text], name) });
const add = (w: ReturnType<typeof mount>, files: PathedFile[]) => (w.vm as unknown as { add(files: PathedFile[]): void }).add(files);
const texts = (w: ReturnType<typeof mount>, id: string) => w.findAll(`[data-testid="${id}"]`).map((node) => node.text());
const statuses = (w: ReturnType<typeof mount>) => w.findAll('[data-testid="upload-item"]').map((node) => node.attributes('data-status'));

describe('UploadQueue', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('refuses a zip and an empty file in their own names and never sends them', async () => {
    const { api, sent } = fakeApi();
    const { w } = mountQueue(api);
    add(w, [pathed('march.zip'), pathed('blank.txt', ''), pathed('good.txt')]);
    await flushPromises();

    expect(sent).toEqual(['good.txt:hero:']);
    expect(statuses(w)).toEqual(['refused', 'refused', 'queued']);
    const details = texts(w, 'upload-item-detail');
    expect(details).toContain('march.zip is a zip archive. Unzip it and drop the .txt files inside.');
    expect(details).toContain('blank.txt is empty.');
  });

  it("shows the server's refusal of one file and still sends the next", async () => {
    const conflict = { status: 409, data: { detail: 'This file is already uploaded as Pool hands. A file belongs to one dataset.' } };
    const tried: string[] = [];
    const { api } = fakeApi({
      upload: async (file) => {
        tried.push(file.name);
        if (file.name === 'first.txt') throw conflict;
        return { upload_id: file.name, status: 'queued', dedupe: 'new' };
      },
    });
    const { w } = mountQueue(api);
    add(w, [pathed('first.txt'), pathed('second.txt')]);
    await flushPromises();

    expect(tried).toEqual(['first.txt', 'second.txt']);
    expect(statuses(w)).toEqual(['error', 'queued']);
    expect(texts(w, 'upload-item-state')[0]).toBe('Not sent');
    expect(texts(w, 'upload-item-detail')[0]).toBe('This file is already uploaded as Pool hands. A file belongs to one dataset.');
  });

  it('says to start the API when the upload got no answer', async () => {
    const offline = new TypeError('fetch failed');
    const { api } = fakeApi({
      upload: async () => {
        throw offline;
      },
    });
    const { w } = mountQueue(api);
    add(w, [pathed('a.txt')]);
    await flushPromises();
    expect(texts(w, 'upload-item-detail')).toEqual(['The API did not answer. Start it with `make api` in platform/ and try again.']);
  });

  it('shows why a file failed on the server, and says the list is out of date', async () => {
    const { api, script } = fakeApi();
    script('a.txt', [row('a.txt', 'failed', { error_text: 'None of the 3 hands in this file could be read. They are kept for the parser’s backlog.' })]);
    const { w } = mountQueue(api);
    add(w, [pathed('a.txt')]);
    await flushPromises();

    expect(statuses(w)).toEqual(['failed']);
    expect(texts(w, 'upload-item-state')).toEqual(['Failed']);
    expect(w.find('[data-testid="upload-item-detail"]').attributes('role')).toBe('alert');
    expect(w.find('[data-testid="upload-item-link"]').exists()).toBe(false);
    expect(w.emitted('settled')).toHaveLength(1);
  });

  it('says why a check on a sent file failed and keeps checking', async () => {
    const { api, reads } = fakeApi();
    let fail = true;
    const flaky: UploadsApi = {
      ...api,
      get: async (id) => {
        if (fail) throw { status: 502 };
        return api.get(id);
      },
    };
    const { w } = mountQueue(flaky);
    add(w, [pathed('a.txt')]);
    await flushPromises();
    expect(texts(w, 'upload-item-state')).toEqual(['Sent']);
    expect(texts(w, 'upload-item-detail')).toEqual(['Could not check on it: The API answered with status 502.']);

    fail = false;
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(texts(w, 'upload-item-state')).toEqual(['Waiting for the parser']);
    expect(texts(w, 'upload-item-detail')).toEqual([]);
    expect(reads).toEqual(['a.txt']);
  });

  it('sends one file at a time, in the order they were handed over, and says when it is busy', async () => {
    const releases: (() => void)[] = [];
    const order: string[] = [];
    const { api } = fakeApi({
      upload: (file) =>
        new Promise<UploadAccepted>((resolve) => {
          order.push(file.name);
          releases.push(() => resolve({ upload_id: file.name, status: 'queued', dedupe: 'new' }));
        }),
    });
    const { w } = mountQueue(api);
    add(w, [pathed('a.txt'), pathed('b.txt')]);
    await flushPromises();
    expect(order).toEqual(['a.txt']);
    expect(statuses(w)).toEqual(['sending', 'waiting']);
    expect(texts(w, 'upload-item-state')).toEqual(['Sending…', 'Waiting to send']);
    expect(w.emitted('busy')).toEqual([[true]]);

    releases[0]!();
    await flushPromises();
    expect(order).toEqual(['a.txt', 'b.txt']);
    releases[1]!();
    await flushPromises();
    expect(statuses(w)).toEqual(['queued', 'queued']);
    expect(w.emitted('busy')).toEqual([[true], [false]]);
  });

  it('follows a file from waiting to processing to landed, then links to My game and stops checking', async () => {
    const { api, reads, script } = fakeApi();
    // Read at once and then every POLL_MS: still queued on every read up to and including WAIT_HINT_MS.
    script('a.txt', [
      ...Array.from({ length: WAIT_HINT_MS / POLL_MS + 1 }, () => row('a.txt', 'queued')),
      row('a.txt', 'processing', { hands_found: 5000, hands_parsed: 5000 }),
      row('a.txt', 'completed', { hands_found: 7200, hands_parsed: 7200 }),
    ]);
    const { w } = mountQueue(api);
    add(w, [pathed('a.txt')]);
    await flushPromises();
    expect(texts(w, 'upload-item-state')).toEqual(['Waiting for the parser']);
    expect(texts(w, 'upload-item-detail')).toEqual([]);

    await vi.advanceTimersByTimeAsync(WAIT_HINT_MS - POLL_MS);
    expect(texts(w, 'upload-item-detail')).toEqual([]);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(texts(w, 'upload-item-detail')).toEqual(['Still waiting. Is the parser worker running? Start it with `make worker` in platform/.']);

    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(texts(w, 'upload-item-state')).toEqual(['Reading hands — 5,000 stored so far']);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(statuses(w)).toEqual(['completed']);
    expect(texts(w, 'upload-item-state')).toEqual(['7,200 hands in']);
    const link = w.find('[data-testid="upload-item-link"]');
    expect([link.attributes('href'), link.text()]).toEqual(['/', 'See them in My game']);
    expect((w.emitted('settled')![0]![0] as UploadRow).hands_parsed).toBe(7200);

    const readsWhenLanded = reads.length;
    await vi.advanceTimersByTimeAsync(10 * POLL_MS);
    expect(reads).toHaveLength(readsWhenLanded);
  });

  it('keeps the dataset and site each file was handed over with, even when the choice changes while it waits', async () => {
    const held = heldUploads();
    const { api } = fakeApi({ upload: held.upload });
    const { w } = mountQueue(api);
    add(w, [pathed('a.txt'), pathed('b.txt')]);
    await flushPromises();
    expect(held.sent).toEqual(['a.txt:hero:']);

    await w.setProps({ choice: { site: 'ggpoker', dataset: 'population' } });
    held.releases[0]!();
    await flushPromises();
    held.releases[1]!();
    await flushPromises();

    expect(held.sent).toEqual(['a.txt:hero:', 'b.txt:hero:']);
    expect(texts(w, 'upload-item-dataset')).toEqual(['My hands', 'My hands']);
  });

  it('notes a duplicate and takes its dataset and its link from the row the server holds', async () => {
    const { api, script } = fakeApi({
      upload: async (file) => ({ upload_id: file.name, status: 'completed', dedupe: 'duplicate' }),
    });
    script('pool.txt', [row('pool.txt', 'completed', { dataset: 'population', hands_parsed: 90 })]);
    const { w } = mountQueue(api, HERO);
    add(w, [pathed('pool.txt')]);
    await flushPromises();

    expect(texts(w, 'upload-item-dedupe')).toEqual(['Uploaded before']);
    expect(texts(w, 'upload-item-dataset')).toEqual(['Pool hands']);
    const link = w.find('[data-testid="upload-item-link"]');
    expect([link.attributes('href'), link.text()]).toEqual(['/pool', 'Open the pool']);
  });

  it('says the dataset was not recorded for a row from before datasets, and offers no link to guess with', async () => {
    const { api, script } = fakeApi({
      upload: async (file) => ({ upload_id: file.name, status: 'completed', dedupe: 'duplicate' }),
    });
    script('old.txt', [row('old.txt', 'completed', { dataset: null, hands_parsed: 40 })]);
    const { w } = mountQueue(api, { site: '', dataset: 'population' });
    add(w, [pathed('old.txt')]);
    await flushPromises();

    expect(statuses(w)).toEqual(['completed']);
    expect(texts(w, 'upload-item-dataset')).toEqual(['Dataset not recorded']);
    expect(w.find('[data-testid="upload-item-link"]').exists()).toBe(false);
  });

  it('sends nothing more and checks on nothing once unmounted in the middle of an upload', async () => {
    const held = heldUploads();
    const { api, reads } = fakeApi({ upload: held.upload });
    const { w, live } = mountQueue(api);
    add(w, [pathed('a.txt'), pathed('b.txt')]);
    await flushPromises();
    expect(held.sent).toEqual(['a.txt:hero:']);
    expect(w.emitted('busy')).toEqual([[true]]);

    w.unmount();
    held.releases[0]!();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(10 * POLL_MS);

    expect(held.sent).toEqual(['a.txt:hero:']);
    expect(reads).toEqual([]);
    expect(live.size).toBe(0);
  });

  it('stops checking when it is unmounted', async () => {
    const { api, reads } = fakeApi();
    const { w, live } = mountQueue(api);
    add(w, [pathed('a.txt')]);
    await flushPromises();
    expect(live.size).toBe(1);

    w.unmount();
    expect(live.size).toBe(0);
    await vi.advanceTimersByTimeAsync(10 * POLL_MS);
    expect(reads).toEqual(['a.txt']);
  });
});
