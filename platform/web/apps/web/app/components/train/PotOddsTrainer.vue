<script setup lang="ts">
// The pot odds and MDF trainer (spec §16). Before the answer there is nothing on screen but the
// two numbers — no panel, no arithmetic, because the whole point is doing it in your head at the
// speed you would have to at the table.
//
// Afterwards the real `PotOddsPanel` and `MDFPanel` appear with the spot's numbers in them. They
// are editable, deliberately: once the answer is in, the best thing to do with a spot you got
// wrong is push the size around and watch which way the number moves. Both panels share one set
// of numbers, a line says when they are no longer the spot's, and the next spot starts clean.
import { MDFPanel, PotOddsPanel } from '@poker/ui';
import { computed, reactive } from 'vue';

import { useEditableOdds } from '~/composables/useEditableOdds';
import type { PotOddsSpot } from '~/train/types';

const props = defineProps<{ spot: PotOddsSpot; revealed: boolean }>();

const odds = reactive(
  useEditableOdds(() => ({ pot: props.spot.potBB, bet: props.spot.betBB, rakeConfig: { rakePct: props.spot.rakePct, rakeCapBB: props.spot.rakeCapBB } })),
);

/** Alpha and the bluff break-even are one number under two names; the reveal says so. */
const SAME_NUMBER =
  'Alpha and the bluff break-even are the same number — bet / (pot + bet). The share they are allowed to fold is exactly how often a bluff of this size has to work.';
const showsIdentity = computed(() => props.spot.ask === 'alpha' || props.spot.ask === 'bluffBreakeven');
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-baseline gap-x-8 gap-y-2">
      <p><span class="text-sm text-zinc-500">Pot</span> <span class="text-2xl tabular-nums" data-testid="odds-pot">{{ spot.potBB }}bb</span></p>
      <p><span class="text-sm text-zinc-500">Bet</span> <span class="text-2xl tabular-nums" data-testid="odds-bet">{{ spot.betBB }}bb</span></p>
      <p v-if="spot.afterRake" class="text-sm text-amber-700 dark:text-amber-400" data-testid="odds-rake">
        After 5% rake, capped at 3bb.
      </p>
    </div>

    <div v-if="revealed" class="space-y-4">
      <p v-if="showsIdentity" class="text-sm text-zinc-500" data-testid="odds-identity">{{ SAME_NUMBER }}</p>
      <div class="grid gap-6 lg:grid-cols-2">
        <PotOddsPanel v-model:pot="odds.pot" v-model:bet="odds.bet" v-model:call="odds.call" v-model:implied-extra="odds.impliedExtra" v-model:rake-config="odds.rakeConfig" />
        <MDFPanel v-model:pot="odds.pot" v-model:bet="odds.bet" :rake-config="odds.rakeConfig" />
      </div>
      <p v-if="odds.edited" class="text-sm text-zinc-500" data-testid="odds-edited">
        These are your numbers now, not the spot's.
        <button type="button" class="underline" data-testid="odds-reset" @click="odds.reset()">Back to the spot's numbers</button>
      </p>
    </div>
  </div>
</template>
