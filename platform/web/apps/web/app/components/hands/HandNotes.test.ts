// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HandNotesApi, HandTags, TagCount } from '~/hands/notes';
import { AUTOSAVE_MS } from '~/hands/notes';

import HandNotes from './HandNotes.vue';

const UID = 'abc123';

/** An in-memory server: one note, one tag list, a vocabulary derived from it. */
function fakeApi(over: Partial<HandNotesApi> = {}) {
  let note = '';
  let tags: string[] = [];
  const calls: string[] = [];
  const answer = (): HandTags => ({ hand_uid: UID, tags: [...tags].sort() });
  const api: HandNotesApi = {
    note: async () => ({ hand_uid: UID, body: note, updated_at: note === '' ? null : '2026-09-14T12:00:00Z' }),
    saveNote: async (_uid, body) => {
      calls.push(`save:${body}`);
      note = body.trim();
      return { hand_uid: UID, body: note, updated_at: note === '' ? null : '2026-09-14T12:00:00Z' };
    },
    tags: async () => answer(),
    addTag: async (_uid, tag) => {
      calls.push(`add:${tag}`);
      const spelled = tag.trim().toLowerCase();
      if (!tags.includes(spelled)) tags.push(spelled);
      return answer();
    },
    removeTag: async (_uid, tag) => {
      calls.push(`remove:${tag}`);
      tags = tags.filter((t) => t !== tag);
      return answer();
    },
    vocabulary: async (): Promise<TagCount[]> => tags.map((tag) => ({ tag, hands: 1 })),
    ...over,
  };
  return { api, calls, seed: (body: string, seeded: string[]) => ((note = body), (tags = seeded)) };
}

const text = (w: ReturnType<typeof mount>, id: string) => w.find(`[data-testid="${id}"]`).text();
const has = (w: ReturnType<typeof mount>, id: string) => w.find(`[data-testid="${id}"]`).exists();

describe('HandNotes', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows what the server already holds and keeps the box shut until it has', async () => {
    const { api, seed } = fakeApi();
    seed('fold pre next time', ['bluff', 'study']);
    const w = mount(HandNotes, { props: { handUid: UID, api } });
    expect(w.find('textarea').attributes('disabled')).toBeDefined();

    await flushPromises();
    expect((w.find('textarea').element as HTMLTextAreaElement).value).toBe('fold pre next time');
    expect(w.find('textarea').attributes('disabled')).toBeUndefined();
    expect(has(w, 'tag-chip-bluff') && has(w, 'tag-chip-study')).toBe(true);
    expect(has(w, 'tags-empty')).toBe(false);
  });

  it('saves the note after typing stops and says so', async () => {
    const { api, calls } = fakeApi();
    const w = mount(HandNotes, { props: { handUid: UID, api } });
    await flushPromises();

    await w.find('textarea').setValue('the turn barrel was the mistake');
    expect(text(w, 'note-status')).toBe('Unsaved changes');
    expect(calls).toEqual([]);

    vi.advanceTimersByTime(AUTOSAVE_MS);
    await flushPromises();
    expect(calls).toEqual(['save:the turn barrel was the mistake']);
    expect(text(w, 'note-status')).toBe('Saved');
  });

  it('flushes an unsaved draft on blur rather than waiting out the delay', async () => {
    const { api, calls } = fakeApi();
    const w = mount(HandNotes, { props: { handUid: UID, api } });
    await flushPromises();
    await w.find('textarea').setValue('leaving now');
    await w.find('textarea').trigger('blur');
    await flushPromises();
    expect(calls).toEqual(['save:leaving now']);
  });

  it('words a refused save beside the box and keeps the text', async () => {
    const { api } = fakeApi({
      saveNote: async () => {
        throw { status: 500, data: { detail: 'Internal server error' } };
      },
    });
    const w = mount(HandNotes, { props: { handUid: UID, api } });
    await flushPromises();
    await w.find('textarea').setValue('kept');
    vi.advanceTimersByTime(AUTOSAVE_MS);
    await flushPromises();
    expect(text(w, 'note-status')).toBe('Not saved: Internal server error');
    expect((w.find('textarea').element as HTMLTextAreaElement).value).toBe('kept');
  });

  it('adds a tag on Enter, shows it as the server spells it, and removes it from its chip', async () => {
    const { api, calls } = fakeApi();
    const w = mount(HandNotes, { props: { handUid: UID, api } });
    await flushPromises();
    expect(has(w, 'tags-empty')).toBe(true);

    await w.find('[data-testid="tag-input"]').setValue('  Bluff ');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(calls).toEqual(['add:  Bluff ']);
    expect(text(w, 'tag-chip-bluff')).toContain('bluff');
    expect((w.find('[data-testid="tag-input"]').element as HTMLInputElement).value).toBe('');

    await w.find('[data-testid="tag-remove-bluff"]').trigger('click');
    await flushPromises();
    expect(calls).toEqual(['add:  Bluff ', 'remove:bluff']);
    expect(has(w, 'tag-chip-bluff')).toBe(false);
    expect(has(w, 'tags-empty')).toBe(true);
  });

  it('does not offer to add a tag the hand already has, however it is spelled', async () => {
    const { api, seed } = fakeApi();
    seed('', ['3-bet pot']);
    const w = mount(HandNotes, { props: { handUid: UID, api } });
    await flushPromises();
    await w.find('[data-testid="tag-input"]').setValue(' 3-BET   pot');
    expect(w.find('[data-testid="tag-add"]').attributes('disabled')).toBeDefined();
    await w.find('[data-testid="tag-input"]').setValue('river');
    expect(w.find('[data-testid="tag-add"]').attributes('disabled')).toBeUndefined();
  });

  it("shows the server's own refusal of a tag", async () => {
    const { api } = fakeApi({
      addTag: async () => {
        throw { status: 422, data: { detail: 'you already have 500 distinct tags; reuse one of them or remove one before adding another' } };
      },
    });
    const w = mount(HandNotes, { props: { handUid: UID, api } });
    await flushPromises();
    await w.find('[data-testid="tag-input"]').setValue('one more');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(text(w, 'tag-error')).toContain('500 distinct tags');
  });

  it('lists the other tags in use as suggestions, minus the ones already on this hand', async () => {
    const { api, seed } = fakeApi();
    seed('', ['bluff']);
    const w = mount(HandNotes, {
      props: { handUid: UID, api: { ...api, vocabulary: async () => [{ tag: 'bluff', hands: 3 }, { tag: 'study', hands: 1 }] } },
    });
    await flushPromises();
    const offered = w.findAll('datalist option').map((o) => o.attributes('value'));
    expect(offered).toEqual(['study']);
  });
});
