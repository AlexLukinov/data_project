/**
 * What the app remembers about helping this reader: whether the first-visit offer has been
 * answered, and where the tour stands (spec §13: "short, skippable, resumable from the help menu").
 *
 * It lives in `localStorage` because it describes this browser, not the account: a first visit
 * is anonymous, and a reader who signs in later has still seen the offer. It is a convenience,
 * never a record — storage that throws (a private window, blocked site data) reads as a first
 * visit and a write that fails is dropped, so the worst case is being offered the tour again.
 */
import type { Ref } from 'vue';
import { ref } from 'vue';

export type TourStatus = 'unseen' | 'running' | 'stopped' | 'finished';

export interface HelpState {
  /** The first-visit offer has been answered: the tour or an example taken, or turned down. */
  readonly welcomed: boolean;
  readonly tour: TourStatus;
  /** The stop the tour is on, or was left at. */
  readonly stop: number;
  /**
   * The tools whose explainer has been read and closed. A tool that is not in here opens its
   * card the first time the reader lands on it (ADR-058); one that is in here opens collapsed.
   * Ids rather than a count, so adding a screen explains itself even to a reader who has been
   * here for months.
   */
  readonly seen: readonly string[];
}

export type HelpStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const HELP_STORAGE_KEY = 'poker-help/v1';
export const FIRST_VISIT: HelpState = { welcomed: false, tour: 'unseen', stop: 0, seen: [] };

const STATUSES: readonly TourStatus[] = ['unseen', 'running', 'stopped', 'finished'];

/**
 * The tool ids out of a stored state. Missing is the normal case for anything written before
 * F.13, and it means "nothing read yet" rather than a broken record: a state that still carries
 * a usable tour must not be thrown away over a field that did not exist when it was written.
 */
function parseSeen(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
}

/** A stored state, or the first visit's when the text is missing, not JSON, or not this shape. */
export function parseHelpState(text: string | null): HelpState {
  if (text === null) return FIRST_VISIT;
  try {
    const value = JSON.parse(text) as Partial<Record<keyof HelpState, unknown>>;
    const tour = STATUSES.find((status) => status === value.tour);
    const stop = value.stop;
    if (typeof value.welcomed !== 'boolean' || tour === undefined || typeof stop !== 'number' || !Number.isInteger(stop) || stop < 0) return FIRST_VISIT;
    return { welcomed: value.welcomed, tour, stop, seen: parseSeen(value.seen) };
  } catch {
    return FIRST_VISIT;
  }
}

export function readHelpState(storage: HelpStorage | null): HelpState {
  try {
    return parseHelpState(storage?.getItem(HELP_STORAGE_KEY) ?? null);
  } catch {
    return FIRST_VISIT;
  }
}

/** Keep the state for the next visit. False when the browser refused it. */
export function writeHelpState(storage: HelpStorage | null, state: HelpState): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(HELP_STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/** The browser's storage, or `null` where merely touching it throws. */
export function browserStorage(): HelpStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export interface HelpSession {
  readonly state: Readonly<Ref<HelpState>>;
  /** Replace part of the state and keep it. */
  update(patch: Partial<HelpState>): void;
}

/**
 * The state as a new page load finds it: a tour left running — a reload mid-tour, or a tab closed
 * last week — is stopped where it was, so the card never reappears unasked and Help resumes it.
 */
export function onArrival(state: HelpState): HelpState {
  return state.tour === 'running' ? { ...state, tour: 'stopped' } : state;
}

/** The state bound to a storage: read once, on arrival, and written on every change. */
export function createHelpSession(storage: HelpStorage | null): HelpSession {
  const state = ref<HelpState>(onArrival(readHelpState(storage)));
  return {
    state,
    update(patch) {
      state.value = { ...state.value, ...patch };
      writeHelpState(storage, state.value);
    },
  };
}

/** Whether this reader has already read and closed a tool's explainer. */
export function hasSeenTool(state: HelpState, id: string): boolean {
  return state.seen.includes(id);
}

/** Remember that a tool has been explained. Recording one twice is not an event. */
export function seeTool(help: HelpSession, id: string): void {
  if (id === '' || hasSeenTool(help.state.value, id)) return;
  help.update({ seen: [...help.state.value.seen, id] });
}
