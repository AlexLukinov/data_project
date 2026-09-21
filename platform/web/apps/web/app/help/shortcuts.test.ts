import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { SHORTCUT_GROUPS, asksForShortcuts, isApplePlatform, keyLabel } from './shortcuts';

const WORKSPACE = fileURLToPath(new URL('../../../../', import.meta.url));
const SCANNED = ['packages/poker-ui/src', 'apps/web/app'];
/** A key handler bound in a template or on the window — what makes a file a shortcut's home. */
const BINDS_KEYS = /@key(?:down|up)\b|addEventListener\(\s*['"]key(?:down|up)['"]/;

function sourceFiles(): string[] {
  return SCANNED.flatMap((root) =>
    readdirSync(join(WORKSPACE, root), { recursive: true, encoding: 'utf8' })
      .filter((file) => /\.(vue|ts)$/.test(file) && !file.endsWith('.test.ts'))
      .map((file) => `${root}/${file}`),
  );
}

/** A key event as the handler reads it: the key, the modifiers, and where it was pressed. */
function key(init: { key: string; metaKey?: boolean }, tagName: string): KeyboardEvent {
  return { ctrlKey: false, altKey: false, metaKey: false, ...init, target: { tagName, isContentEditable: false } } as unknown as KeyboardEvent;
}

describe('the shortcut registry', () => {
  it('names every file that binds a key, so a new binding without a row fails here', () => {
    const listed = new Set(SHORTCUT_GROUPS.flatMap((group) => group.sources));
    const binding = sourceFiles().filter((file) => BINDS_KEYS.test(readFileSync(join(WORKSPACE, file), 'utf8')));
    expect(binding.length).toBeGreaterThan(0);
    expect(binding.filter((file) => !listed.has(file))).toEqual([]);
  });

  it('points only at files that exist', () => {
    const sources = SHORTCUT_GROUPS.flatMap((group) => group.sources);
    expect(sources.filter((file) => !existsSync(join(WORKSPACE, file)))).toEqual([]);
  });

  it('gives every group a place and at least one shortcut, every shortcut a key and a sentence', () => {
    for (const group of SHORTCUT_GROUPS) {
      expect(group.where).not.toBe('');
      expect(group.shortcuts.length).toBeGreaterThan(0);
      for (const shortcut of group.shortcuts) {
        expect(shortcut.does).not.toBe('');
        expect(shortcut.chords.length).toBeGreaterThan(0);
        expect(shortcut.chords.every((chord) => chord.length > 0)).toBe(true);
      }
    }
  });

  it('lists the bindings the audit found, each in its own group', () => {
    expect(SHORTCUT_GROUPS.map((group) => group.title)).toEqual([
      'Anywhere',
      'Undo and redo a range',
      'An explained word',
      'Range matrix',
      'Range text',
      'Analyzer steps',
      'Hand replayer',
      'Your call',
      'Number boxes',
    ]);
  });
});

describe('keyLabel', () => {
  it('prints Mod as ⌘ and Shift as ⇧ on a Mac, Ctrl and Shift elsewhere', () => {
    expect(['Mod', 'Shift', 'Z'].map((token) => keyLabel(token, true))).toEqual(['⌘', '⇧', 'Z']);
    expect(['Mod', 'Shift', 'z'].map((token) => keyLabel(token, false))).toEqual(['Ctrl', 'Shift', 'Z']);
  });

  it('prints arrows, Enter and Escape as the keys show them, and a span as written', () => {
    expect(['ArrowLeft', 'ArrowDown', 'Enter', 'Escape', '1–9', '?'].map((token) => keyLabel(token, false))).toEqual(['←', '↓', '↵', 'Esc', '1–9', '?']);
  });
});

describe('isApplePlatform', () => {
  it('recognises a Mac and an iPad, and nothing else', () => {
    expect(['MacIntel', 'iPad', 'macOS'].map(isApplePlatform)).toEqual([true, true, true]);
    expect(['Win32', 'Linux x86_64', ''].map(isApplePlatform)).toEqual([false, false, false]);
  });
});

describe('asksForShortcuts', () => {
  it('answers ? pressed on the page', () => {
    expect(asksForShortcuts(key({ key: '?' }, 'BODY'))).toBe(true);
  });

  it('ignores ? typed into a box, and ? with a modifier', () => {
    expect(asksForShortcuts(key({ key: '?' }, 'INPUT'))).toBe(false);
    expect(asksForShortcuts(key({ key: '?' }, 'TEXTAREA'))).toBe(false);
    expect(asksForShortcuts(key({ key: '?', metaKey: true }, 'BODY'))).toBe(false);
    expect(asksForShortcuts(key({ key: '/' }, 'BODY'))).toBe(false);
  });

  it('ignores ? typed into an editable element', () => {
    const event = { key: '?', ctrlKey: false, altKey: false, metaKey: false, target: { tagName: 'DIV', isContentEditable: true } };
    expect(asksForShortcuts(event as unknown as KeyboardEvent)).toBe(false);
  });
});
