/**
 * An example worked in this tab only (ADR-050): the analyzer's `StepContext` over a local copy of
 * the example's steps, so its step components run unchanged — and nothing is saved.
 *
 * The context is one object read through getters, for the reason `pages/analyze/[id].vue` gives:
 * props reach a child on the next render, so two patches in one tick built from a fresh snapshot
 * would lose the first.
 *
 * `pool` and `poolFacing` are `null` for good, and so is the reader's range library. All three say
 * why in `poolMissing`, `poolFacingMissing` and `libraryMissing`, which is what lets an example
 * open all nine steps rather than five: a gate handed a reason prints it instead of waiting for an
 * answer that is never coming (ADR-061, amending ADR-050 decision 4).
 */
import type { ComputedRef, Ref } from 'vue';
import { computed, ref } from 'vue';

import type { AnalysisStep } from '~/analyze/api';
import { emptyStep } from '~/analyze/api';
import type { StepContext } from '~/analyze/context';
import { spotFrom } from '~/analyze/spot';

import type { Example } from './examples';
import { EXAMPLE_OPENS_AT, EXAMPLE_STEPS, exampleSteps } from './examples';

/**
 * Why the four pool-scored steps have no field number here. The fact, not an apology: the field's
 * frequencies are counted from hands the reader has uploaded, and an example is a spot that ships
 * with the app — so there is nothing to count, and the way to the number is a hand of their own.
 */
const NO_POOL =
  'An example has no pool: what the field does is counted from hands you have uploaded, and this spot ships with the app. Open one of your own hands and press Analyze this node for the field’s own number here.';

/** Step 1's "Load my chart" has nothing to look in either, and both seats are already dealt one. */
const NO_LIBRARY = 'An example has no range library behind it — both seats already hold the reference chart named above.';

export interface ExampleSession {
  /** The step on screen — always one of `EXAMPLE_STEPS`, and `EXAMPLE_OPENS_AT` to begin with. */
  readonly current: Readonly<Ref<number>>;
  readonly context: StepContext;
  /** The steps whose prediction is committed, for the rail. */
  readonly completed: ComputedRef<number[]>;
  /** Change the step on screen; the other steps are untouched. */
  patch(patch: Partial<AnalysisStep>): void;
  /** Step 9's takeaway rule. Kept in this tab like everything else here. */
  setHeuristic(text: string): void;
  /** Go to a step the example opens; any other number is ignored. */
  goTo(step: number): void;
  /** The previous or next step the example opens, or `null` at either end. */
  neighbour(by: -1 | 1): number | null;
}

interface Local {
  readonly steps: Ref<AnalysisStep[]>;
  readonly step: ComputedRef<AnalysisStep>;
  readonly heuristic: Ref<string>;
}

/** The context the step components read, live over `steps`, `current` and the heuristic. */
function exampleContext(example: Example, local: Local): StepContext {
  const spot = computed(() => spotFrom(local.steps.value, example.node));
  return {
    get step() {
      return local.step.value;
    },
    get steps() {
      return local.steps.value;
    },
    get node() {
      return example.node;
    },
    get spot() {
      return spot.value;
    },
    pool: null,
    poolFacing: null,
    poolMissing: NO_POOL,
    poolFacingMissing: NO_POOL,
    libraryMissing: NO_LIBRARY,
    get heuristic() {
      return local.heuristic.value;
    },
  };
}

export function createExampleSession(example: Example): ExampleSession {
  const steps = ref<AnalysisStep[]>(exampleSteps(example));
  const current = ref(EXAMPLE_OPENS_AT);
  const step = computed(() => steps.value.find((s) => s.step === current.value) ?? emptyStep(current.value));
  const heuristic = ref('');

  return {
    current,
    context: exampleContext(example, { steps, step, heuristic }),
    completed: computed(() => steps.value.filter((s) => s.prediction !== null && EXAMPLE_STEPS.includes(s.step)).map((s) => s.step)),
    patch(patch) {
      const merged = { ...step.value, ...patch, step: current.value };
      steps.value = [...steps.value.filter((s) => s.step !== current.value), merged].sort((a, b) => a.step - b.step);
    },
    setHeuristic(text) {
      heuristic.value = text;
    },
    goTo(next) {
      if (EXAMPLE_STEPS.includes(next)) current.value = next;
    },
    neighbour(by) {
      return EXAMPLE_STEPS[EXAMPLE_STEPS.indexOf(current.value) + by] ?? null;
    },
  };
}
