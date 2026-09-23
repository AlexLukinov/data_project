<script setup lang="ts">
/**
 * Your read, then the pool's (plan H.7, ADR-093). The reader paints the range they believe the
 * acting seat arrives at this decision with; a press of Reveal asks the pool what that seat turned
 * over here — the field first, then the chosen group — and draws each answer as a diff against
 * the read. Nothing is asked until the press, and the groups are asked one after another
 * (`hands/reveal.ts` says why).
 *
 * The read is kept per situation for the life of the page, so stepping back finds it again; an
 * answer is kept per situation and group, so revealing the same spot twice asks nothing new. A
 * situation the reader has stepped away from is stale: its answers, arriving late, are dropped.
 */
import type { Card, NodeKey, WeightedRange } from '@poker/core';
import { canonicalNodeKey, createRange } from '@poker/core';
import { PoolDataBadge, RangeDiffView, RangeMatrix } from '@poker/ui';
import { computed, onMounted, ref, shallowRef, watch } from 'vue';

import type { GroupReveal, RevealGroup } from '~/hands/reveal';
import { WHOLE_FIELD, askGroups, diffRanges, groupsToAsk, hasWeight, revealQuestion, revealThin } from '~/hands/reveal';
import type { NodeShowdownRange, PoolApi } from '~/pool/api';

const props = defineProps<{
  node: NodeKey | null;
  board: readonly Card[];
  api: Pick<PoolApi, 'showdownRange'>;
  /** The groups on offer (`hands/reveal.ts#loadRevealGroups`), handed in so the panel stays testable with a fake. */
  groups: () => Promise<{ groups: RevealGroup[]; problem: string }>;
}>();

/** The group the reveal compares the field with; the blocker panel beside it reads the same choice. */
const group = defineModel<RevealGroup>('group', { required: true });

/** The groups on offer once loaded; the field alone until then. */
const choices = ref<RevealGroup[]>([WHOLE_FIELD]);
const groupsProblem = ref('');

const GROUPS_UNLISTED = 'The pool’s player groups and your saved cohorts could not be listed, so only the whole field can be asked here.';

/**
 * The two ranges are on different scales and the diff must say so: a painted read is how often a
 * hand is in the range (1 = always), while the pool's is how often each class was shown, relative
 * to the class shown most. A class the pool always arrives with but rarely takes to showdown
 * reads lighter than a read of 1, and that is not a disagreement about whether it is there.
 */
const POOL_SCALE =
  'The pool’s side is drawn relative to the hand class it showed most often here, not as a share of the time each hand is in the range, so a class it shows less often reads lighter even when it is always there. Read the difference for shape — which hands are in, which are out — rather than for exact weights.';

onMounted(async () => {
  try {
    const found = await props.groups();
    choices.value = found.groups;
    groupsProblem.value = found.problem;
  } catch {
    groupsProblem.value = GROUPS_UNLISTED;
  }
});

function choose(event: Event): void {
  const key = (event.target as HTMLSelectElement).value;
  group.value = choices.value.find((candidate) => candidate.key === key) ?? WHOLE_FIELD;
}

const nodeId = computed(() => (props.node === null ? '' : canonicalNodeKey(props.node)));
const question = computed(() => (props.node === null ? '' : revealQuestion(props.node)));

/** The reads, one per situation, and the read on screen. */
const reads = new Map<string, WeightedRange>();
const read = shallowRef<WeightedRange>(createRange());
const painted = computed(() => hasWeight(read.value));

function paint(next: WeightedRange): void {
  read.value = next;
  reads.set(nodeId.value, next);
}

/**
 * Asks already made, per situation and group — the promise, not only the answer, so a second
 * press while the first is still in flight joins it rather than firing the same pool-wide query
 * twice. A refusal is forgotten as soon as it lands: the next press asks afresh.
 */
const answers = new Map<string, Promise<NodeShowdownRange>>();
const remembering: Pick<PoolApi, 'showdownRange'> = {
  showdownRange: (key, cohortId) => {
    const at = `${canonicalNodeKey(key)}|${cohortId ?? ''}`;
    const known = answers.get(at);
    if (known !== undefined) return known;
    const answer = props.api.showdownRange(key, cohortId);
    answers.set(at, answer);
    answer.catch(() => answers.delete(at));
    return answer;
  },
};

const revealed = shallowRef<GroupReveal[] | null>(null);
const asking = ref('');
/** Asks still running, whichever situation they were for: the button waits for all of them. */
const inFlight = ref(0);
/**
 * The press every late answer is checked against. A number per press rather than the situation's
 * id: stepping away and back and pressing again must find the earlier press stale, or two asks for
 * one spot run at once and the field lands twice.
 */
let presses = 0;
let asked = 0;

watch(
  nodeId,
  (id) => {
    asked = 0;
    revealed.value = null;
    asking.value = '';
    read.value = reads.get(id) ?? createRange();
  },
  { immediate: true },
);

async function revealNow(): Promise<void> {
  const key = props.node;
  if (key === null || !painted.value || inFlight.value > 0) return;
  const token = ++presses;
  asked = token;
  revealed.value = [];
  const stale = (): boolean => asked !== token;
  inFlight.value += 1;
  try {
    await askGroups(
      remembering,
      key,
      groupsToAsk(choices.value, group.value.key),
      stale,
      (found) => {
        revealed.value = [...(revealed.value ?? []), found];
      },
      (next) => {
        asking.value = next.label;
      },
    );
  } finally {
    inFlight.value -= 1;
    if (!stale()) asking.value = '';
  }
}

const diff = computed(() => diffRanges(read.value, revealed.value ?? []));
const testKey = (found: GroupReveal): string => (found.group.key === '' ? 'field' : found.group.key);
</script>

<template>
  <section class="space-y-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800" data-testid="study-reveal">
    <h2 class="font-medium">Your read, then the pool’s</h2>
    <p v-if="node === null" class="text-sm text-zinc-500" data-testid="reveal-no-node">Step to a decision and paint what you think that seat has.</p>
    <template v-else>
      <p class="text-sm" data-testid="reveal-question">{{ question }}</p>
      <RangeMatrix :range="read" mode="edit" :blocked-cards="board" @update:range="paint" />

      <div class="flex flex-wrap items-center gap-3 text-sm">
        <label class="flex items-center gap-2">
          <span class="text-zinc-500">compare the field with</span>
          <select :value="group.key" data-testid="reveal-group" class="rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700" @change="choose">
            <option v-for="choice in choices" :key="choice.key" :value="choice.key">{{ choice.key === '' ? 'nobody — the field alone' : choice.label }}</option>
          </select>
        </label>
        <button type="button" class="rounded border border-zinc-300 px-2 py-0.5 dark:border-zinc-700" data-testid="reveal-button" :disabled="!painted || inFlight > 0" @click="revealNow">
          Reveal the pool’s range
        </button>
        <span v-if="!painted" class="text-zinc-500" data-testid="reveal-paint-first">Paint your read first — the pool answers only after you have committed to one.</span>
      </div>
      <p v-if="groupsProblem" role="status" class="text-xs text-amber-700 dark:text-amber-300" data-testid="reveal-groups-problem">{{ groupsProblem }}</p>
      <p v-if="asking" role="status" class="text-sm text-zinc-500" data-testid="reveal-asking">Asking the pool about {{ asking }}… one group at a time, so this can take a few seconds each.</p>

      <div v-if="revealed" class="space-y-3" data-testid="reveal-answer">
        <div v-for="found in revealed" :key="found.group.key" class="space-y-1" :data-testid="`reveal-group-${testKey(found)}`">
          <p v-if="found.problem" role="alert" class="text-sm text-red-600 dark:text-red-400">{{ found.problem }}</p>
          <template v-else-if="found.answer">
            <p class="text-sm"><span class="font-medium">{{ found.group.label }}</span><span v-if="!found.answer.enough"> — {{ revealThin(found.answer, found.group.label) }}</span></p>
            <PoolDataBadge :tier="2" :sample-size="found.answer.sample_size" :enough="found.answer.enough" :min-n="found.answer.min_n" :covers="found.answer.covers" />
          </template>
        </div>
        <template v-if="diff.length >= 2">
          <RangeDiffView :ranges="diff" />
          <p class="text-xs text-zinc-500" data-testid="reveal-scale">{{ POOL_SCALE }}</p>
        </template>
      </div>
    </template>
  </section>
</template>
