// @vitest-environment happy-dom
/**
 * A stored range's undo and redo (audit §2.7): the matrix and text edits walk back one stroke at a
 * time, an undo back to the saved body leaves nothing to save, a save keeps the undo, and a revert
 * — another body from the server — starts it again.
 */
import { nodeKey, parseRange, serializeRange } from '@poker/core';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Suspense, defineComponent, h, ref } from 'vue';

import type { RangeUpdate, RangeVersion, StoredRange } from '~/ranges/api';

import RangePage from './[id].vue';

const store = vi.hoisted(() => ({
  open: vi.fn(),
  versions: vi.fn(),
  update: vi.fn(),
  revert: vi.fn(),
  remove: vi.fn(),
  status: 'ready',
  error: null as string | null,
}));
vi.mock('~/stores/ranges', () => ({ useRangesStore: () => store }));

const ID = 'r1';
const KK = 14;
const comboText = (classes: string) => serializeRange(parseRange(classes).range, 'combo');
const FIRST_BODY = comboText('QQ');
const SAVED_BODY = comboText('AA');

const NuxtLink = defineComponent({ props: { to: { type: String, required: true } }, setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) });

/** What the server holds; `update` and `revert` change it the way the API does. */
let server: StoredRange;
let versions: RangeVersion[];

function serve(): void {
  server = {
    id: ID, name: 'BTN open', node_key: nodeKey('BTN'), source: 'own', source_tool: '', format: 'combo', tags: [],
    version: 2, created_at: '2026-09-14T12:00:00Z', updated_at: '2026-09-14T12:00:00Z', weights: SAVED_BODY, note: '',
  };
  versions = [
    { version: 1, weights: FIRST_BODY, note: '', created_at: '2026-09-13T12:00:00Z' },
    { version: 2, weights: SAVED_BODY, note: '', created_at: '2026-09-14T12:00:00Z' },
  ];
  store.open.mockImplementation(async () => server);
  store.versions.mockImplementation(async () => versions);
  store.update.mockImplementation(async (_id: string, body: RangeUpdate) => {
    const version = body.weights === undefined ? server.version : server.version + 1;
    server = { ...server, ...body, version };
    return server;
  });
  store.revert.mockImplementation(async (_id: string, version: number) => {
    server = { ...server, weights: versions.find((v) => v.version === version)!.weights, version: server.version + 1 };
    return server;
  });
}

const mounted: ReturnType<typeof mount>[] = [];

async function page() {
  const wrapper = mount({ render: () => h(Suspense, null, { default: () => h(RangePage) }) }, { global: { components: { NuxtLink }, stubs: { NodeKeyEditor: true } } });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

/** A stroke over one cell: down on it, up anywhere on the page. */
async function paint(wrapper: Awaited<ReturnType<typeof page>>, cls: number): Promise<void> {
  await wrapper.find(`[data-cls="${cls}"]`).trigger('pointerdown');
  window.dispatchEvent(new Event('pointerup'));
  await flushPromises();
}

async function press(target: EventTarget, key: string, mods: KeyboardEventInit = {}): Promise<void> {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mods }));
  await flushPromises();
}

const control = (w: Awaited<ReturnType<typeof page>>, id: string) => w.find<HTMLButtonElement>(`[data-testid="range-${id}"]`);

describe('a stored range — undo and redo', () => {
  beforeEach(() => {
    serve();
    vi.stubGlobal('useRoute', () => ({ params: { id: ID } }));
    // Nuxt's data loader, reduced to what the page reads: the answer, and a refresh that asks again.
    vi.stubGlobal('useAsyncData', async (_key: string, load: () => Promise<unknown>) => {
      const data = ref(await load());
      const refresh = async (): Promise<void> => {
        data.value = await load();
      };
      return { data, error: ref(null), refresh };
    });
  });
  afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    vi.unstubAllGlobals();
  });

  it('leaves ⌘Z typed in the name box to the box', async () => {
    const w = await page();
    await paint(w, KK);
    await press(w.find('[data-testid="range-name"]').element, 'z', { metaKey: true });
    expect(control(w, 'save').text()).toBe('Save as v3');
    expect(control(w, 'undo').element.disabled).toBe(false);
  });

  it('starts the undo again after a revert brings another body', async () => {
    const w = await page();
    await paint(w, KK);
    await w.find('[data-testid="range-revert-1"]').trigger('click');
    await flushPromises();

    expect(store.revert).toHaveBeenCalledWith(ID, 1);
    expect(control(w, 'undo').element.disabled).toBe(true);
    expect(control(w, 'save').element.disabled).toBe(true);
  });

  it('undoes a stroke back to the saved body, which leaves nothing to save, and redoes it', async () => {
    const w = await page();
    expect(control(w, 'undo').element.disabled).toBe(true);
    expect(control(w, 'undo').attributes('title')).toBe('⌘Z');
    expect(control(w, 'redo').attributes('title')).toBe('⌘⇧Z');

    await paint(w, KK);
    expect(control(w, 'save').text()).toBe('Save as v3');

    await control(w, 'undo').trigger('click');
    expect(control(w, 'save').element.disabled).toBe(true);
    expect(control(w, 'save').text()).toBe('Save');
    expect(control(w, 'redo').element.disabled).toBe(false);

    await press(window, 'z', { metaKey: true, shiftKey: true });
    expect(control(w, 'save').text()).toBe('Save as v3');
    await press(window, 'z', { ctrlKey: true });
    expect(control(w, 'save').element.disabled).toBe(true);
  });

  // The matrix takes its accessible name from the range's label, and a rename alone keeps the body —
  // so without a relabel the grid kept announcing the name the range was loaded or last edited under.
  it('puts a saved rename on the grid the matrix announces, without spending the undo history', async () => {
    const w = await page();
    await paint(w, KK);
    await w.find('[data-testid="range-name"]').setValue('BTN open 6max');
    await control(w, 'save').trigger('click');
    await flushPromises();

    expect(w.find('[role="grid"]').attributes('aria-label')).toBe('BTN open 6max');
    expect(control(w, 'undo').element.disabled).toBe(false);
  });

  // Found in the browser: a chart posted by the importer or the API keeps its own notation, and
  // comparing that text with the text this page writes offered "Save as v3" on an untouched page.
  it('does not call a body stored in another notation an unsaved change', async () => {
    server = { ...server, weights: 'AsAh: 1,AsAd: 1,AsAc: 1,AhAd: 1,AhAc: 1,AdAc: 1' };
    const w = await page();

    expect(control(w, 'save').element.disabled).toBe(true);
    expect(control(w, 'save').text()).toBe('Save');

    await paint(w, KK);
    expect(control(w, 'save').text()).toBe('Save as v3');
    await control(w, 'undo').trigger('click');
    expect(control(w, 'save').element.disabled).toBe(true);
  });

  it('keeps the undo across a save of the body, so the saved stroke can still be taken back', async () => {
    const w = await page();
    await paint(w, KK);
    await control(w, 'save').trigger('click');
    await flushPromises();

    expect(store.update).toHaveBeenCalledWith(ID, expect.objectContaining({ weights: comboText('AA,KK') }));
    expect(w.find('[data-testid="range-message"]').text()).toBe('Saved as a new version.');
    expect(control(w, 'save').element.disabled).toBe(true);
    expect(control(w, 'undo').element.disabled).toBe(false);

    await control(w, 'undo').trigger('click');
    expect(control(w, 'save').text()).toBe('Save as v4');
  });
});
