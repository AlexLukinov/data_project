<script setup lang="ts">
/**
 * The blocker table fed by the pool (plan H.7, ADR-094). At a step where a seat has just bet or
 * raised, the seat that must answer is at `facingNode(node)`; a press asks the pool how often that
 * seat folds here, the reader's chart for it is cut at that share by equity, and `BlockerPanel`
 * ranks the bettor's own candidates by what they block. The rate is measured; the ordering is a
 * rule of thumb, and the panel says both (`hands/blockers.ts` says why the per-class version was
 * rejected).
 *
 * One question, on a click and never per step (ADR-079). The rows are controls (ADR-074): a pick
 * is rung on the bettor's own grid by the host, and a new ask clears it.
 */
import type { Card, ComboIndex, NodeKey, WeightedRange } from '@poker/core';
import { canonicalNodeKey } from '@poker/core';
import { BlockerPanel, PoolDataBadge, percent } from '@poker/ui';
import { computed, ref, shallowRef, watch } from 'vue';

import type { PoolSplit } from '~/hands/blockers';
import { poolSplit } from '~/hands/blockers';
import type { RevealGroup } from '~/hands/reveal';
import { blockersProblem } from '~/hands/study';
import type { NodeFrequencies, PoolApi } from '~/pool/api';

const props = defineProps<{
  /** The defender's node: `facingNode(node)`, never null here — the host mounts the panel only then. */
  facing: NodeKey;
  /** The bettor's chart: the candidates to rank. */
  hero: WeightedRange | null;
  /** The reader's chart for the defender, when the library has one for this exact spot. */
  chart: WeightedRange | null;
  /** The defender's per-combo equities against the bettor's range, once the calculator has them. */
  equities: Float32Array | null;
  board: readonly Card[];
  pot: number;
  bet: number;
  group: RevealGroup;
  api: Pick<PoolApi, 'frequencies'>;
}>();
/** The pinned row, or `null` when a new ask has cleared it — the host rings exactly what the table shows. */
const emit = defineEmits<{ comboSelect: [combo: ComboIndex | null] }>();

const defender = computed(() => props.facing.hero_position);
const bettor = computed(() => props.facing.villain_position ?? 'the seat that bet');

/** What landed, and the group it was asked for — the chooser may have moved on since. */
const split = shallowRef<{ found: PoolSplit; group: RevealGroup } | null>(null);
/** Asks still running, whichever spot they were for: the button waits for all of them. */
const inFlight = ref(0);
const busy = computed(() => inFlight.value > 0);
const problem = ref('');
const selected = shallowRef<ComboIndex | null>(null);
/** A number per press, not the spot's id: stepping away and back must leave the earlier press stale. */
let presses = 0;
let asked = 0;

const facingId = computed(() => canonicalNodeKey(props.facing));
watch(facingId, () => {
  asked = 0;
  split.value = null;
  problem.value = '';
  selected.value = null;
});

/** The equities arrive after the calculator runs; a split asked before them is cut once they land. */
watch(
  () => props.equities,
  () => {
    const landed = split.value;
    if (landed === null || landed.found.ranges !== null) return;
    void recut(landed);
  },
);

async function recut(landed: { found: PoolSplit; group: RevealGroup }): Promise<void> {
  const found = await poolSplit({ frequencies: async () => landed.found.answer }, props.facing, props.chart, props.equities, landed.group.key, () => split.value !== landed);
  if (found !== null) split.value = { found, group: landed.group };
}

async function ask(): Promise<void> {
  if (busy.value) return;
  const token = ++presses;
  asked = token;
  const stale = (): boolean => asked !== token;
  const group = props.group;
  inFlight.value += 1;
  problem.value = '';
  split.value = null;
  pick(null);
  try {
    const found = await poolSplit(props.api, props.facing, props.chart, props.equities, group.key, stale);
    if (stale() || found === null) return;
    split.value = { found, group };
  } catch (error) {
    if (stale()) return;
    problem.value = blockersProblem(defender.value, error);
  } finally {
    inFlight.value -= 1;
  }
}

function pick(combo: ComboIndex | null): void {
  selected.value = combo;
  emit('comboSelect', combo);
}

/**
 * The fold rate's own interval and the players behind it (plan G.3, ADR-076), when the server
 * sent one: a rate over few players is shown as the wide claim it is.
 */
function withInterval(answer: NodeFrequencies): string {
  const interval = answer.intervals?.fold;
  if (interval === undefined) return '';
  return ` (between ${percent(interval.low)} and ${percent(interval.high)}, over ${answer.players.toLocaleString('en-US')} players)`;
}

/** The measured half and the assumed half, said before any row is read. */
const provenance = computed(() => {
  const landed = split.value;
  if (landed === null || !landed.found.answer.enough) return '';
  const folds = percent(1 - landed.found.continues);
  const continues = percent(landed.found.continues);
  return `The pool folds ${folds} of the time here as ${landed.group.label}${withInterval(landed.found.answer)}, so ${continues} of your chart for ${defender.value} is taken as what continues — its strongest ${continues} by equity against ${bettor.value}’s range. The rate is measured; the ordering is a rule of thumb, and no solver was asked.`;
});

/**
 * The withheld state. Above the floor the server ships the measured rate with its interval so the
 * reader can see *why* it is withheld (too wide, or too few players); under the floor there is
 * nothing to show but the count.
 */
const withheld = computed(() => {
  const landed = split.value;
  if (landed === null || landed.found.answer.enough) return '';
  const answer = landed.found.answer;
  const fold = answer.frequencies.fold;
  const needed = `${answer.sample_size.toLocaleString('en-US')} of the ${answer.min_n.toLocaleString('en-US')} decisions needed`;
  if (fold === undefined) return `The pool has faced this bet as ${defender.value} too few times to say how often it folds — ${needed} — so nothing here is cut.`;
  return `The pool folds about ${percent(fold)} here as ${landed.group.label}${withInterval(answer)}, but that is too wide a claim to cut a range by — ${needed} — so nothing here is cut.`;
});
</script>

<template>
  <section class="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800" data-testid="study-blockers">
    <h2 class="font-medium">Which of {{ bettor }}’s hands block the answer</h2>
    <p class="text-sm text-zinc-500">The pool says how often {{ defender }} folds here; your chart for {{ defender }}, cut at that share by equity, says with what — and the bettor’s candidates are ranked by what they block.</p>
    <p v-if="hero === null" class="text-sm text-zinc-500" data-testid="blockers-no-hero">
      Ranking needs your chart for {{ bettor }} here — <NuxtLink to="/ranges/import" class="underline">import your charts</NuxtLink> and it appears as you step.
    </p>
    <template v-else>
      <button type="button" class="rounded border border-zinc-300 px-2 py-0.5 text-sm dark:border-zinc-700" data-testid="blockers-ask" :disabled="busy" @click="ask">
        Ask the pool how {{ defender }} answers
      </button>
      <p v-if="busy" role="status" class="text-sm text-zinc-500" data-testid="blockers-asking">Asking the pool…</p>
      <p v-if="problem" role="alert" class="text-sm text-red-600 dark:text-red-400" data-testid="blockers-error">{{ problem }}</p>
      <div v-if="split" class="space-y-2" data-testid="blockers-split">
        <PoolDataBadge :tier="1" :sample-size="split.found.answer.sample_size" :enough="split.found.answer.enough" :min-n="split.found.answer.min_n" />
        <p v-if="!split.found.answer.enough" class="text-sm text-zinc-500" data-testid="blockers-thin">{{ withheld }}</p>
        <template v-else>
          <p class="text-sm" data-testid="blockers-provenance">{{ provenance }}</p>
          <p v-if="chart === null" class="text-sm text-zinc-500" data-testid="blockers-no-chart">
            The rate is the pool’s; cutting a range at it needs your chart for {{ defender }} here —
            <NuxtLink to="/ranges/import" class="underline">import your charts</NuxtLink> and the table appears as you step.
          </p>
          <p v-else-if="split.found.ranges === null" class="text-sm text-zinc-500" data-testid="blockers-no-equities">
            The table appears once the equities of {{ defender }}’s chart against {{ bettor }}’s range have been computed.
          </p>
          <template v-else>
            <p class="text-xs text-zinc-500" data-testid="blockers-cutoff">
              {{ split.found.ranges.set.combos.length }} combos continue, the weakest of them at {{ percent(split.found.ranges.set.cutoffEquity) }} equity.
            </p>
            <BlockerPanel
              :hero-range="hero"
              :villain-call="split.found.ranges.call"
              :villain-fold="split.found.ranges.fold"
              :board="board"
              :pot="pot"
              :bet="bet"
              :selected-combo="selected"
              selectable
              @combo-select="pick"
            />
          </template>
        </template>
      </div>
    </template>
  </section>
</template>
