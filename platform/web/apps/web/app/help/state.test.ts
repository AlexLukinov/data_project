import { describe, expect, it } from 'vitest';

import type { HelpState, HelpStorage } from './state';
import { FIRST_VISIT, HELP_STORAGE_KEY, createHelpSession, hasSeenTool, onArrival, parseHelpState, readHelpState, seeTool, writeHelpState } from './state';

function memory(initial: Record<string, string> = {}): HelpStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (key) => data[key] ?? null, setItem: (key, value) => void (data[key] = value) };
}

const throwing: HelpStorage = {
  getItem: () => {
    throw new Error('SecurityError: blocked');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

const state = (patch: Partial<HelpState> = {}): HelpState => ({ ...FIRST_VISIT, ...patch });

describe('parseHelpState', () => {
  it('reads a stored state back', () => {
    expect(parseHelpState('{"welcomed":true,"tour":"stopped","stop":2,"seen":["pool"]}')).toEqual(state({ welcomed: true, tour: 'stopped', stop: 2, seen: ['pool'] }));
  });

  it('reads a state written before tools were remembered as one with nothing read', () => {
    expect(parseHelpState('{"welcomed":true,"tour":"stopped","stop":2}')).toEqual(state({ welcomed: true, tour: 'stopped', stop: 2 }));
  });

  it('keeps the ids out of a seen list that is not one, rather than losing the tour with it', () => {
    expect(parseHelpState('{"welcomed":true,"tour":"unseen","stop":0,"seen":"pool"}').seen).toEqual([]);
    expect(parseHelpState('{"welcomed":true,"tour":"unseen","stop":0,"seen":["pool",7,null]}').seen).toEqual(['pool']);
  });

  it('treats nothing stored, broken text and a foreign shape as a first visit', () => {
    for (const text of [null, '', 'not json', '[]', '{"welcomed":"yes","tour":"running","stop":0}', '{"welcomed":true,"tour":"lost","stop":0}', '{"welcomed":true,"tour":"running","stop":-1}', '{"welcomed":true,"tour":"running","stop":1.5}']) {
      expect(parseHelpState(text), String(text)).toEqual(FIRST_VISIT);
    }
  });
});

describe('reading and writing', () => {
  it('round-trips through the storage under one key', () => {
    const storage = memory();
    expect(writeHelpState(storage, state({ welcomed: true, tour: 'finished', stop: 4, seen: ['lab'] }))).toBe(true);
    expect(Object.keys(storage.data)).toEqual([HELP_STORAGE_KEY]);
    expect(readHelpState(storage)).toEqual(state({ welcomed: true, tour: 'finished', stop: 4, seen: ['lab'] }));
  });

  it('reads a first visit and reports a refused write when the browser blocks storage', () => {
    expect(readHelpState(throwing)).toEqual(FIRST_VISIT);
    expect(readHelpState(null)).toEqual(FIRST_VISIT);
    expect(writeHelpState(throwing, FIRST_VISIT)).toBe(false);
    expect(writeHelpState(null, FIRST_VISIT)).toBe(false);
  });
});

describe('createHelpSession', () => {
  it('starts from what was stored and keeps every change', () => {
    const storage = memory({ [HELP_STORAGE_KEY]: '{"welcomed":true,"tour":"unseen","stop":0}' });
    const session = createHelpSession(storage);
    expect(session.state.value.welcomed).toBe(true);
    session.update({ tour: 'running', stop: 1 });
    expect(session.state.value).toEqual(state({ welcomed: true, tour: 'running', stop: 1 }));
    expect(readHelpState(storage)).toEqual(state({ welcomed: true, tour: 'running', stop: 1 }));
  });

  it('arrives with a tour that was left running stopped where it was, never running unasked', () => {
    const storage = memory({ [HELP_STORAGE_KEY]: '{"welcomed":true,"tour":"running","stop":3}' });
    expect(createHelpSession(storage).state.value).toEqual(state({ welcomed: true, tour: 'stopped', stop: 3 }));
    expect(onArrival(state({ welcomed: true, tour: 'finished' }))).toEqual(state({ welcomed: true, tour: 'finished' }));
  });

  it('still works for this visit when nothing can be kept', () => {
    const session = createHelpSession(throwing);
    session.update({ welcomed: true });
    expect(session.state.value.welcomed).toBe(true);
  });
});

describe('seeTool', () => {
  it('remembers a tool once, and keeps it across a reload', () => {
    const storage = memory();
    const session = createHelpSession(storage);
    expect(hasSeenTool(session.state.value, 'pool')).toBe(false);
    seeTool(session, 'pool');
    seeTool(session, 'pool');
    expect(session.state.value.seen).toEqual(['pool']);
    expect(hasSeenTool(createHelpSession(storage).state.value, 'pool')).toBe(true);
  });

  it('records nothing for a path that is not a tool', () => {
    const session = createHelpSession(null);
    seeTool(session, '');
    expect(session.state.value.seen).toEqual([]);
  });
});
