/**
 * An example worked in this tab only (ADR-050): the analyzer's `StepContext` over a local copy of
 * the example's steps, so its step components run unchanged — and nothing is saved.
 *
 * The context is one object read through getters, for the reason `pages/analyze/[id].vue` gives:
 * props reach a child on the next render, so two patches in one tick built from a fresh snapshot
 * would lose the first. `pool` and `poolFacing` are `null` for good, and the page never mounts a
 * step that reads them (`EXAMPLE_STEPS`).
 */
import type { ComputedRef, Ref } from 'vue';
import { computed, ref } from 'vue';

import type { AnalysisStep } from '~/analyze/api';
import { emptyStep } from '~/analyze/api';
import type { StepContext } from '~/analyze/context';
import { spotFrom } from '~/analyze/spot';

import type { Example } from './examples';
import { EXAMPLE_STEPS, exampleSteps } from './examples';

export interface ExampleSession {
  /** The step on screen — always one of `EXAMPLE_STEPS`. */
  readonly current: Readonly<Ref<number>>;
  readonly context: StepContext;
  /** The steps whose prediction is committed, for the rail. */
  readonly completed: ComputedRef<number[]>;
  /** Change the step on screen; the other steps are untouched. */
  patch(patch: Partial<AnalysisStep>): void;
  /** Go to a step the example opens; any other number is ignored. */
  goTo(step: number): void;
  /** The previous or next step the example opens, or `null` at either end. */
  neighbour(by: -1 | 1): number | null;
}

/** The context the step components read, live over `steps` and `current`. */
function exampleContext(example: Example, steps: Ref<AnalysisStep[]>, step: ComputedRef<AnalysisStep>): StepContext {
  const spot = computed(() => spotFrom(steps.value, example.node));
  return {
    get step() {
      return step.value;
    },
    get steps() {
      return steps.value;
    },
    get node() {
      return example.node;
    },
    get spot() {
      return spot.value;
    },
    hand: null,
    pool: null,
    poolFacing: null,
    heuristic: '',
  };
}

export function createExampleSession(example: Example): ExampleSession {
  const steps = ref<AnalysisStep[]>(exampleSteps(example));
  const current = ref(EXAMPLE_STEPS[0]!);
  const step = computed(() => steps.value.find((s) => s.step === current.value) ?? emptyStep(current.value));

  return {
    current,
    context: exampleContext(example, steps, step),
    completed: computed(() => steps.value.filter((s) => s.prediction !== null && EXAMPLE_STEPS.includes(s.step)).map((s) => s.step)),
    patch(patch) {
      const merged = { ...step.value, ...patch, step: current.value };
      steps.value = [...steps.value.filter((s) => s.step !== current.value), merged].sort((a, b) => a.step - b.step);
    },
    goTo(next) {
      if (EXAMPLE_STEPS.includes(next)) current.value = next;
    },
    neighbour(by) {
      return EXAMPLE_STEPS[EXAMPLE_STEPS.indexOf(current.value) + by] ?? null;
    },
  };
}
