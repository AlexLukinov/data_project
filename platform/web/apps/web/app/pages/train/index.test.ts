// @vitest-environment happy-dom
/**
 * The training index reads one store — this browser's own (spec §17: every trainer works with no
 * backend). A store that cannot be read is not an empty one, and "Not started" would tell a reader
 * with a record that their work is gone (ADR-061).
 */
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';

import type { ScoreRow } from '~/train/types';

import TrainIndex from './index.vue';

const cache = vi.hoisted(() => ({ scores: vi.fn(), reviews: vi.fn() }));
vi.mock('~/train/cache', () => ({ createTrainingCache: () => cache }));

const NuxtLink = defineComponent({
  props: { to: { type: String, required: true } },
  setup: (props, { slots, attrs }) => () => h('a', { ...attrs, href: props.to }, slots.default?.()),
});

function score(over: Partial<ScoreRow> = {}): ScoreRow {
  return {
    id: 's1',
    mode: 'equity',
    spot_hash: 'equity:1',
    question_key: 'equity',
    question: 'q',
    prediction: '40',
    actual: '42',
    error: 2,
    correct: true,
    weight_error: null,
    bucket: 'dry',
    created_at: '2026-09-20T10:00:00Z',
    ...over,
  };
}

function render() {
  return mount(TrainIndex, { global: { components: { NuxtLink } } });
}

const text = (w: ReturnType<typeof render>, id: string) => w.find(`[data-testid="${id}"]`).text();
const has = (w: ReturnType<typeof render>, id: string) => w.find(`[data-testid="${id}"]`).exists();

describe('/train — when the practice record cannot be read', () => {
  beforeEach(() => {
    cache.scores.mockReset();
    cache.reviews.mockReset();
    vi.stubGlobal('definePageMeta', vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('says so, rather than showing a reader with a record that they have none', async () => {
    cache.scores.mockRejectedValue(new DOMException('site data is blocked in this browser', 'SecurityError'));
    const w = render();
    await flushPromises();

    const problem = w.find('[data-testid="train-store-error"]');
    expect(problem.attributes('role')).toBe('alert');
    expect(problem.text()).toContain('missing rather than zero');
    expect(problem.text()).toContain('site data is blocked in this browser');
    // Not "nothing practised yet", and not "Not started" on any mode.
    expect(has(w, 'train-empty')).toBe(false);
    expect(w.text()).not.toContain('Not started');
    expect(w.text()).toContain('not known');
  });

  it('keeps the scores it did read when only what is owed fails', async () => {
    cache.scores.mockResolvedValue([score(), score({ id: 's2', correct: false })]);
    cache.reviews.mockRejectedValue(new Error('the reviews table is missing'));
    const w = render();
    await flushPromises();

    expect(has(w, 'train-store-error')).toBe(true);
    expect(text(w, 'accuracy-equity')).toContain('50');
    expect(w.text()).toContain('2 answered');
    expect(w.text()).not.toContain('not known');
  });

  it('says nothing when the store answers, and counts what is owed', async () => {
    cache.scores.mockResolvedValue([score()]);
    cache.reviews.mockResolvedValue([]);
    const w = render();
    await flushPromises();

    expect(has(w, 'train-store-error')).toBe(false);
    expect(has(w, 'train-empty')).toBe(false);
    expect(w.text()).toContain('1 answered');
  });
});
