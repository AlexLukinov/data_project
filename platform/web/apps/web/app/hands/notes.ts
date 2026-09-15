/**
 * Notes and tags on a hand (plan D.7b): the transport for `/v1/hands/{uid}/note` and
 * `/v1/hands/{uid}/tags`, and the one piece of behaviour worth testing without a browser — the
 * autosave that writes the note after typing stops.
 *
 * Field names are the API's (snake_case), exactly as `api/schemas_hand_notes.py` sends them. A
 * tag is normalized by the server (trimmed, lower-cased); the client sends what was typed and
 * shows what came back, so the chip always reads as the server spells it.
 */

import type { Fetcher } from '../auth/api';

export interface HandNote {
  hand_uid: string;
  body: string;
  /** Null when there is no note. */
  updated_at: string | null;
}

export interface HandTags {
  hand_uid: string;
  tags: string[];
}

export interface TagCount {
  tag: string;
  hands: number;
}

export interface HandNotesApi {
  note(handUid: string): Promise<HandNote>;
  /** Writes the note; a blank body removes it. */
  saveNote(handUid: string, body: string): Promise<HandNote>;
  tags(handUid: string): Promise<HandTags>;
  addTag(handUid: string, tag: string): Promise<HandTags>;
  removeTag(handUid: string, tag: string): Promise<HandTags>;
  /** Every tag the user has used, most used first — the datalist and the list's filter. */
  vocabulary(): Promise<TagCount[]>;
}

const BASE = '/v1/hands';

/** The server's limits (`api/schemas_hand_notes.py`), mirrored so the inputs stop where it would refuse. */
export const MAX_TAG_CHARS = 40;
export const MAX_NOTE_CHARS = 10_000;

/** Bind the note and tag endpoints to a fetcher (the auth store's, which adds the bearer header). */
export function createHandNotesApi(fetch: Fetcher): HandNotesApi {
  return {
    note: (uid) => fetch<HandNote>(`${BASE}/${uid}/note`),
    saveNote: (uid, body) => fetch<HandNote>(`${BASE}/${uid}/note`, { method: 'PUT', body: { body } }),
    tags: (uid) => fetch<HandTags>(`${BASE}/${uid}/tags`),
    addTag: (uid, tag) => fetch<HandTags>(`${BASE}/${uid}/tags`, { method: 'POST', body: { tag } }),
    removeTag: (uid, tag) => fetch<HandTags>(`${BASE}/${uid}/tags/${encodeURIComponent(tag)}`, { method: 'DELETE' }),
    vocabulary: () => fetch<TagCount[]>(`${BASE}/tags`),
  };
}

export type SaveState = 'clean' | 'dirty' | 'saving' | 'saved' | 'failed';

export interface Autosave {
  /** Called on every keystroke: schedules a save `delayMs` after the last one. */
  change(text: string): void;
  /** Save now, if there is anything unsaved — what a blur or a page leave wants. */
  flush(): Promise<void>;
}

export interface Timer {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const REAL_TIMER: Timer = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export const AUTOSAVE_MS = 800;

export interface AutosaveOptions {
  delayMs?: number;
  timer?: Timer;
  /** Told every time the state changes, with the failure's wording when there is one. */
  onState?: (state: SaveState, failure: string) => void;
}

/**
 * Debounced autosave with one rule that matters: **the last text typed is the text saved.** A
 * save in flight when more typing arrives is not cancelled — it cannot be — but its answer is
 * ignored for state, and another save follows once it lands. So the server can briefly hold an
 * older draft, never a draft newer than the one on screen being reported as saved.
 *
 * `save` is given the text and may throw; a failure keeps the text unsaved and words the
 * reason, and the next keystroke tries again.
 */
export function createAutosave(save: (text: string) => Promise<void>, describe: (error: unknown) => string, options: AutosaveOptions = {}): Autosave {
  const { delayMs = AUTOSAVE_MS, timer = REAL_TIMER, onState = () => undefined } = options;
  const draft: Draft = { wanted: null, inFlight: null, failed: false };
  const writer: Writer = { save, describe, onState };
  let pending: unknown = null;

  function start(): Promise<void> {
    if (draft.inFlight === null) draft.inFlight = write(draft, writer);
    return draft.inFlight;
  }

  return {
    change(text) {
      draft.wanted = text;
      onState('dirty', '');
      if (pending !== null) timer.clear(pending);
      pending = timer.set(() => {
        pending = null;
        void start();
      }, delayMs);
    },
    async flush() {
      if (pending !== null) {
        timer.clear(pending);
        pending = null;
      }
      if (draft.wanted !== null) await start();
      else if (draft.inFlight !== null) await draft.inFlight;
    },
  };
}

/** What is waiting to be saved and what is on its way. */
interface Draft {
  wanted: string | null;
  inFlight: Promise<void> | null;
  failed: boolean;
}

interface Writer {
  save: (text: string) => Promise<void>;
  describe: (error: unknown) => string;
  onState: (state: SaveState, failure: string) => void;
}

/** One save of whatever is wanted, then another if typing continued meanwhile. */
async function write(draft: Draft, writer: Writer): Promise<void> {
  if (draft.wanted === null) return;
  const text = draft.wanted;
  draft.wanted = null;
  draft.failed = false;
  writer.onState('saving', '');
  try {
    await writer.save(text);
    if (draft.wanted === null) writer.onState('saved', '');
  } catch (error) {
    if (draft.wanted === null) draft.wanted = text;
    draft.failed = true;
    writer.onState('failed', writer.describe(error));
  }
  draft.inFlight = null;
  if (draft.wanted !== null && !draft.failed) draft.inFlight = write(draft, writer);
}

/** What the status line says for a save state. */
export function saveStateText(state: SaveState, failure: string): string {
  switch (state) {
    case 'clean':
      return '';
    case 'dirty':
      return 'Unsaved changes';
    case 'saving':
      return 'Saving…';
    case 'saved':
      return 'Saved';
    case 'failed':
      return `Not saved: ${failure}`;
  }
}

/**
 * Whether a typed tag would be new on this hand, compared the way the server compares —
 * trimmed, lower-cased, inner whitespace collapsed — so the input can say "already on this
 * hand" without a round trip. The server remains the authority on spelling.
 */
export function tagLooksNew(typed: string, existing: readonly string[]): boolean {
  const tag = typed.split(/\s+/).filter((part) => part !== '').join(' ').toLowerCase();
  return tag !== '' && !existing.includes(tag);
}
