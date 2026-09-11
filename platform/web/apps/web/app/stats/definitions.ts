/**
 * The registry, held once per session (plan D.3, ADR-021).
 *
 * `GET /v1/definitions` is the client's whole vocabulary: which dimensions exist, what values
 * each takes, which ops it accepts, which tables hold it. Nothing in the UI may hard-code any of
 * that — the four `as const` tuples in the old `hands/search.ts` were a copy of four registry
 * entries that had already drifted (they omit `UNKNOWN` from `position`), which is exactly the
 * failure mode the registry exists to remove.
 *
 * **No Dexie copy, unlike the range library.** The endpoint is behind the same bearer token as
 * every other call, so a session that cannot reach the server cannot be signed in either: an
 * offline registry would be a cache nothing could ever read. It is loaded once, shared by every
 * screen, and that is all.
 */

import type { Ref } from 'vue';
import { computed, ref } from 'vue';

import type { Dimension, Stat, StatsApi } from './api';
import type { GroupedDimensions } from './families';
import { groupByFamily } from './families';

export type DefinitionsStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface Definitions {
  readonly dimensions: Ref<Dimension[]>;
  readonly stats: Ref<Stat[]>;
  /** Dimension by code — what every clause is read and validated against. */
  readonly byCode: Ref<ReadonlyMap<string, Dimension>>;
  readonly groups: Ref<GroupedDimensions[]>;
  readonly status: Ref<DefinitionsStatus>;
  readonly error: Ref<string>;
  /** Fetch once. Concurrent callers share the one request; a failure can be retried. */
  load(): Promise<void>;
}

export function createDefinitions(api: StatsApi): Definitions {
  const dimensions = ref<Dimension[]>([]);
  const stats = ref<Stat[]>([]);
  const status = ref<DefinitionsStatus>('idle');
  const error = ref('');
  let inflight: Promise<void> | null = null;

  async function fetchOnce(): Promise<void> {
    status.value = 'loading';
    error.value = '';
    try {
      const answer = await api.definitions();
      dimensions.value = answer.dimensions;
      stats.value = answer.stats;
      status.value = 'ready';
    } catch (cause) {
      status.value = 'error';
      error.value = 'The stat registry could not be loaded, so the situation builder has no vocabulary.';
      inflight = null;
      throw cause;
    }
  }

  return {
    dimensions,
    stats,
    status,
    error,
    byCode: computed(() => new Map(dimensions.value.map((dim) => [dim.code, dim]))),
    groups: computed(() => groupByFamily(dimensions.value)),
    load: () => {
      if (status.value === 'ready') return Promise.resolve();
      inflight ??= fetchOnce();
      return inflight;
    },
  };
}
