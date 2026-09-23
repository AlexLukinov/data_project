// @vitest-environment happy-dom
/**
 * A Worker whose module fails to load never answers, so a Comlink call over it never settles
 * (ADR-069's open item). The composable must turn the Worker's `error` event into a rejection
 * that carries a sentence, and must do so for a job started before the failure and for one
 * started after it.
 */
import type { EquityRequest } from '@poker/core';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';

import { WORKER_UNREACHABLE, useEquityService } from './useEquityService';

/** A Worker that can be made to fail, and a client whose calls never settle — the real shape of the bug. */
const fake = vi.hoisted(() => {
  const worker = Object.assign(new EventTarget(), { terminate: vi.fn() });
  return { worker, compute: vi.fn(() => new Promise<never>(() => undefined)), cancel: vi.fn(() => new Promise<never>(() => undefined)) };
});

vi.mock('@poker/workers', () => ({
  createEquityWorker: () => fake.worker,
  createEquityClient: () => ({ compute: fake.compute, cancel: fake.cancel }),
}));

const REQUEST = { ranges: [], board: [], deadCards: [] } as unknown as EquityRequest;

/** The composable needs a component instance for `onBeforeUnmount`; this one just hands the service out. */
function host() {
  let service: ReturnType<typeof useEquityService>['service'] | null = null;
  const wrapper = mount(
    defineComponent({
      setup() {
        service = useEquityService().service;
        return () => h('div');
      },
    }),
  );
  return { wrapper, service: service! };
}

function moduleFailsToLoad(): void {
  fake.worker.dispatchEvent(new Event('error'));
}

describe('useEquityService — a Worker that cannot start', () => {
  beforeEach(() => {
    fake.worker.terminate.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('rejects a job that was already waiting when the Worker fails, with a sentence', async () => {
    const { service } = host();
    const job = service.compute(REQUEST);
    const settled = vi.fn();
    job.catch(settled);

    moduleFailsToLoad();
    await flushPromises();

    expect(settled).toHaveBeenCalledOnce();
    const error = settled.mock.calls[0]![0] as Error;
    expect(error.message).toBe(WORKER_UNREACHABLE);
    expect(error.message).toContain('Reload the page to try again.');
    expect(error.message).not.toMatch(/Error|Event/);
  });

  it('rejects a job started after the failure at once, rather than waiting for a second event', async () => {
    const { service } = host();
    moduleFailsToLoad();
    await expect(service.compute(REQUEST)).rejects.toThrow(WORKER_UNREACHABLE);
  });

  it('settles a cancel after the failure as "nothing was running", because hosts fire and forget it', async () => {
    const { service } = host();
    moduleFailsToLoad();
    await expect(service.cancel('any')).resolves.toBe(false);
  });

  it('is not itself an unhandled rejection when the Worker fails with no job in flight', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      host();
      moduleFailsToLoad();
      await flushPromises();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('still terminates the Worker when the host unmounts', () => {
    const { wrapper } = host();
    wrapper.unmount();
    expect(fake.worker.terminate).toHaveBeenCalledOnce();
  });
});
