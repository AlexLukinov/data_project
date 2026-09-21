// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import type { EntryLike, PathedFile } from '~/ranges/files';
import { UNREADABLE_DROP } from '~/ranges/files';

import DropZone from './DropZone.vue';

/** A dropped file whose bytes arrive only when the test says so — a big folder still being walked. */
function slowEntry(name: string) {
  const waiting: (() => void)[] = [];
  const entry: EntryLike = {
    isFile: true,
    isDirectory: false,
    name,
    fullPath: `/export/${name}`,
    file: (ok) => waiting.push(() => ok(new File(['PokerStars Hand #1'], name))),
  };
  return { entry, release: () => waiting.splice(0).forEach((finish) => finish()) };
}

/** A dropped file the browser will not open: moved since the drag began, or not readable. */
function refusedEntry(name: string): EntryLike {
  return {
    isFile: true,
    isDirectory: false,
    name,
    fullPath: `/export/${name}`,
    file: (_ok, fail) => fail(new Error('ENOENT: no such file or directory')),
  };
}

/** A drop event carrying entries, the way a browser exposes them through `webkitGetAsEntry`. */
function drop(entries: EntryLike[]): Event {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { items: entries.map((entry) => ({ webkitGetAsEntry: () => entry })) } });
  return event;
}

describe('DropZone', () => {
  it('points at the two pick links when a drop cannot be read, rather than quoting the browser', async () => {
    const w = mount(DropZone);
    w.find('[data-testid="upload-drop"]').element.dispatchEvent(drop([refusedEntry('a.txt')]));
    await flushPromises();

    const said = w.find('[data-testid="upload-drop-error"]');
    expect(said.text()).toBe(UNREADABLE_DROP);
    expect(said.text()).not.toContain('ENOENT');
    expect(w.emitted('files')).toBeUndefined();
    // Still unlocked afterwards: the page must not stay stuck on the dataset this drop was for.
    expect(w.emitted('reading')).toEqual([[true], [false]]);
  });

  it('takes that sentence down once a pick through those links works', async () => {
    const w = mount(DropZone);
    w.find('[data-testid="upload-drop"]').element.dispatchEvent(drop([refusedEntry('a.txt')]));
    await flushPromises();
    expect(w.find('[data-testid="upload-drop-error"]').exists()).toBe(true);

    const input = w.find('[data-testid="upload-files-input"]');
    Object.defineProperty(input.element, 'files', { value: [new File(['PokerStars Hand #1'], 'b.txt')], configurable: true });
    await input.trigger('change');

    expect(w.find('[data-testid="upload-drop-error"]').exists()).toBe(false);
    expect(w.emitted('files')!.map(([files]) => (files as PathedFile[]).map((f) => f.path))).toEqual([['b.txt']]);
  });

  it('ignores a drop while it is disabled', async () => {
    const { entry, release } = slowEntry('a.txt');
    const w = mount(DropZone, { props: { disabled: true } });
    w.find('[data-testid="upload-drop"]').element.dispatchEvent(drop([entry]));
    release();
    await flushPromises();
    expect(w.emitted('reading')).toBeUndefined();
    expect(w.emitted('files')).toBeUndefined();
  });

  it('says it is reading while a folder is walked, ignores a second drop meanwhile, then hands the files on', async () => {
    const first = slowEntry('a.txt');
    const second = slowEntry('b.txt');
    const w = mount(DropZone);
    const zone = w.find('[data-testid="upload-drop"]').element;

    zone.dispatchEvent(drop([first.entry]));
    await flushPromises();
    expect(w.emitted('reading')).toEqual([[true]]);
    expect(w.find('[data-testid="upload-drop-reading"]').exists()).toBe(true);

    zone.dispatchEvent(drop([second.entry]));
    second.release();
    await flushPromises();
    expect(w.emitted('files')).toBeUndefined();

    first.release();
    await flushPromises();
    const handed = w.emitted('files')!.map(([files]) => (files as PathedFile[]).map((f) => f.path));
    expect(handed).toEqual([['export/a.txt']]);
    expect(w.emitted('reading')).toEqual([[true], [false]]);
    expect(w.find('[data-testid="upload-drop-reading"]').exists()).toBe(false);
  });
});
