<script setup lang="ts">
// One hand, stepped through, with every panel bound to the node the hand is currently at
// (spec §9.3). The panels ask the range library what is written down for this situation and for
// what the other seat just did, so stepping forward walks both the hand and my own charts.
import type { Axis, ComboIndex, EquityResult, HandState, NodeKey, ReplayHand, WeightedRange } from '@poker/core';
import { NO_RAKE, canonicalNodeKey, nodeKeyLabel, parseCards, parseRange } from '@poker/core';
import { ComboDistributionPanel, EQRPanel, EquityCalculator, HandReplayer, MDFPanel, PoolDataBadge, PoolRealizationPanel, PotOddsPanel, RangeMatrix, poolEqr } from '@poker/ui';
import { computed, reactive, ref } from 'vue';

import { createAnalysesApi } from '~/analyze/api';
import { facingNode } from '~/analyze/facing';
import { useEditableOdds } from '~/composables/useEditableOdds';
import PoolBlockers from '~/components/hands/PoolBlockers.vue';
import RangeReveal from '~/components/hands/RangeReveal.vue';
import type { NodeRanges } from '~/hands/panels';
import { NO_RANGES, createNodeRangeReader } from '~/hands/panels';
import type { RevealGroup } from '~/hands/reveal';
import { WHOLE_FIELD, loadRevealGroups } from '~/hands/reveal';
import { LIBRARY_UNREADABLE, analyzeProblem, oddsPanelsNote, offlineRangeNote, poolProblem, realizationProblem } from '~/hands/study';
import type { NodeFrequencies, NodeRealization } from '~/pool/api';
import { createPoolApi } from '~/pool/api';
import { classEquity } from '~/pool/estimate';
import { createPoolStatsApi } from '~/pool/stats';
import { situationQuery } from '~/ranges/situation';
import { useRangesStore } from '~/stores/ranges';

const props = defineProps<{ hand: ReplayHand; watchSeat?: number | null; handText?: string }>();

const store = useRangesStore();
const { service } = useEquityService();
// The reader is told when the library is answering from the browser's own copy, so an empty
// answer from it is asked again rather than kept as this session's answer (`hands/panels.ts`).
const reader = createNodeRangeReader(
  (key) => store.lookup(key),
  () => store.status === 'offline',
);
const poolApi = createPoolApi(useApi());
const poolStats = createPoolStatsApi(useApi());
const analysesApi = createAnalysesApi(useApi());

const step = ref(0);
const node = ref<NodeKey | null>(null);
const state = ref<HandState | null>(null);
const ranges = ref<NodeRanges>(NO_RANGES);
const pool = ref<NodeFrequencies | null>(null);
const realized = ref<NodeRealization | null>(null);
const equity = ref<EquityResult | null>(null);
const poolFailure = ref('');
const realizedFailure = ref('');

/**
 * The distribution panel's own state (plan F.12, audit §2.1 "controls that render editable and do
 * nothing"). It was mounted with a literal `:group-by="['made', 'draw']"` and no listeners, so its
 * four axis checkboxes emitted `update:groupBy` into nothing — the box stayed ticked, the prop
 * never moved and the tree below went on grouping the old way — and Export CSV did nothing at all.
 * The equities go in with them, because two of the axes (`equity`, `nut`) need them and the
 * calculator below has already worked them out for this very range.
 */
const axes = ref<Axis[]>(['made', 'draw']);
const exported = ref('');

/** The situation every answer on screen is for: a marker each late answer is checked against. */
let asked = '';

async function onNode(next: NodeKey | null, at: HandState): Promise<void> {
  node.value = next;
  state.value = at;
  pool.value = null;
  realized.value = null;
  equity.value = null;
  poolFailure.value = '';
  realizedFailure.value = '';
  // The axes are the reader's choice and survive the step; the exported text is about the range
  // at the step it was taken from, so it must not sit under the next one's heading. The same is
  // true of the defending set: it is the answer to this bet, not to the next one.
  exported.value = '';
  defending.value = [];
  pinned.value = null;
  // The charts are marked with the same `asked` situation as the pool's answers, and for the same
  // reason: stepping quickly, an earlier step's lookup can settle last, and its charts — or its
  // `failed` flag, which prints "your range library could not be read" — would land under the
  // label of the step the reader is now on.
  const id = next === null ? '' : canonicalNodeKey(next);
  asked = id;
  const [found] = await Promise.all([reader.at(props.hand, at.index), askThePool(next)]);
  if (asked === id) ranges.value = found;
}

/**
 * What the field does here (tier 1), and what it won from here (plan F.10).
 *
 * Each answer is kept only while it is still the answer to the question on screen — compared by
 * the situation itself, not by object identity, because `node.value` hands back a reactive
 * proxy that never equals the key that was asked about.
 *
 * Neither is swallowed any more. The two calls settle independently, so one refusal does not take
 * the other's answer with it, and a failure becomes a sentence rather than an absent panel: the
 * database refuses a fifth simultaneous query, and a reader stepping quickly through a hand would
 * otherwise read that refusal as "the field has never played this spot" (`hands/study.ts`).
 */
async function askThePool(key: NodeKey | null): Promise<void> {
  if (key === null) return;
  const id = canonicalNodeKey(key);
  asked = id;
  const [answer, won] = await Promise.allSettled([poolApi.frequencies(key), poolApi.realization(key)]);
  if (asked !== id) return;
  pool.value = answer.status === 'fulfilled' ? answer.value : null;
  poolFailure.value = answer.status === 'rejected' ? poolProblem(answer.reason) : '';
  realized.value = won.status === 'fulfilled' ? won.value : null;
  realizedFailure.value = won.status === 'rejected' ? realizationProblem(won.reason) : '';
}

const poolActions = computed(() => Object.entries(pool.value?.frequencies ?? {}).sort((a, b) => b[1] - a[1]));

/**
 * Equity per 169-combo class, for the EQR column: the engine's own per-combo answer for MY
 * range against villain's, averaged inside each class. A class I do not hold has no equity here
 * and its EQR stays blank rather than borrowing one.
 */
const classEquities = computed(() => (equity.value === null ? null : classEquity(equity.value.perComboEquity)));
const REALIZATION_ROWS = 8;
const realizationRows = computed(() => (realized.value?.by_hand_class ?? []).slice(0, REALIZATION_ROWS));

/**
 * The pool's EQR beside a solver's, which is spec §10.4's whole point: the field's own
 * realization at this node, next to the one you typed in from a solution. It needs both halves
 * — the pool's `realized` and an equity from our engine — so it stays empty until the equity
 * lands (`poolEqr` returns null rather than inventing one).
 */
const solverEv = ref<number | null>(null);
const poolRealized = computed(() => {
  const overall = realized.value?.overall ?? null;
  const eqr = poolEqr(overall?.realized ?? null, equity.value?.heroEquity ?? null);
  return eqr === null || overall === null ? null : { eqr, sampleSize: overall.sample_size };
});

const board = computed(() => parseCards((state.value?.board ?? []).join(' ')));
const toCall = computed(() => state.value?.toCall ?? 0);
const potBefore = computed(() => Math.max(0, (state.value?.pot ?? 0) - toCall.value));

/**
 * The pot-odds and MDF panels start on this step's numbers and take the reader's own. A step
 * with different numbers starts again on the hand's; one with the same numbers keeps the edit,
 * and the line under the panels still says so. The hand has no rake to offer, and the call is
 * left to follow the bet (`null`), so a bigger bet typed in asks for a bigger call.
 */
const odds = reactive(useEditableOdds(() => ({ pot: potBefore.value, bet: toCall.value, call: null, rakeConfig: NO_RAKE })));
/** Why there is nothing for those two panels to work from, or `''` while there is. */
const noOdds = computed(() => oddsPanelsNote(potBefore.value, toCall.value));

function body(range: NodeRanges['mine']): WeightedRange | null {
  return range === null ? null : { ...parseRange(range.weights).range, label: range.name };
}

const mine = computed(() => body(ranges.value.mine));
const villain = computed(() => body(ranges.value.villain));
const both = computed<WeightedRange[]>(() => (mine.value !== null && villain.value !== null ? [mine.value, villain.value] : []));
const watched = computed(() => props.hand.seats.find((s) => s.seat === props.watchSeat) ?? props.hand.seats.find((s) => s.isHero) ?? null);

/**
 * Who has to answer the bet the two panels are priced from, and with what (ADR-068).
 *
 * MDF is the *defender's* obligation, and on this screen the defender is not the seat `mine`
 * describes. `toCall` is reckoned for the seat of the next action (`HandState`), while
 * `nodeKeyAt` ends its sequence with the action just taken — so at every step where anything is
 * faced, `mine` is the seat that made the bet and `ranges.villain` is the seat that must answer
 * it. The panel was handed `mine`, which is why the defending set never had equities to work
 * from that would have meant anything.
 *
 * The pairing is only safe while the other seat's own last node *is* the seat now to act: three
 * handed, a fold can sit between the bet and the defender, and `villain` is then a third player's
 * range. Rather than compute a stranger's defending set, the panel keeps its MDF and alpha —
 * which are pot arithmetic and always true — and says which chart it would need.
 */
const defenderPosition = computed(() => props.hand.seats.find((s) => s.seat === state.value?.toAct)?.position ?? null);
const defenderRange = computed<WeightedRange | null>(() =>
  defenderPosition.value !== null && ranges.value.villainNode?.hero_position === defenderPosition.value ? villain.value : null,
);
/**
 * The defender's per-combo equity against the betting range. `both` goes into the calculator as
 * `[mine, villain]`, so villain's own array is the second one — the same pairing `/lab` makes.
 */
const defenderEquities = computed(() => (defenderRange.value === null ? null : (equity.value?.perComboEquityVillain ?? null)));
/** The combos "Show on the matrix" asked for; a new step is a new question, so it is dropped. */
const defending = ref<ComboIndex[]>([]);

/**
 * The pool at the node, on a press (plan H.7): the reveal against the reader's read, and the
 * defender's fold rate behind the blocker table. Both share one choice of group and both ask only
 * on a press — one step already costs up to four ClickHouse queries (ADR-079).
 */
const group = ref<RevealGroup>(WHOLE_FIELD);
/** The defender's node, when the step just made is a bet or a raise somebody has to answer. */
const facing = computed(() => facingNode(node.value));
/** The defender's own chart, only when the library's "villain" node really is the defender's. */
const facingChart = computed<WeightedRange | null>(() => (facing.value !== null && ranges.value.villainNode?.hero_position === facing.value.hero_position ? villain.value : null));
/** Its per-combo equities against the bettor's chart — the calculator's second array, as for the MDF panel. */
const facingEquities = computed(() => (facingChart.value === null ? null : (equity.value?.perComboEquityVillain ?? null)));
/** The blocker row the reader pinned, rung on the bettor's own grid (ADR-074); dropped at the next step. */
const pinned = ref<ComboIndex | null>(null);
const pinnedCombos = computed(() => (pinned.value === null ? null : [pinned.value]));

/**
 * Take this exact situation into the 9-step analyzer (spec §15). A pasted hand carries its own
 * text, because nothing on the server has stored it (ADR-029) and the analysis must reopen.
 */
const starting = ref(false);
const startFailure = ref('');

async function analyzeThisNode(): Promise<void> {
  const key = node.value;
  if (key === null || starting.value) return;
  starting.value = true;
  startFailure.value = '';
  try {
    const stored = props.hand.handUid !== '';
    const created = await analysesApi.create({
      title: `${nodeKeyLabel(key)} · ${props.hand.playedAt.slice(0, 10)}`,
      source: stored ? 'stored' : 'pasted',
      hand_uid: stored ? props.hand.handUid : '',
      hand_text: stored ? '' : (props.handText ?? ''),
      node_key: key,
      action_index: state.value?.index ?? 0,
    });
    await navigateTo(`/analyze/${created.id}`);
  } catch (cause) {
    // Without this the press was an unhandled rejection: the button came back to life and the
    // page stayed where it was, with nothing to say why.
    startFailure.value = analyzeProblem(cause);
  } finally {
    starting.value = false;
  }
}
</script>

<template>
  <div class="space-y-4">
    <HandReplayer v-model="step" :hand="hand" @node-change="onNode" />

    <section class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div class="space-y-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        <div class="flex flex-wrap items-baseline gap-2">
          <h2 class="font-medium">Situation</h2>
          <span class="text-sm text-zinc-500" data-testid="study-node">{{ node ? nodeKeyLabel(node) : 'before the first decision' }}</span>
          <NuxtLink v-if="node" :to="{ path: '/ranges/compare', query: situationQuery(node) }" class="ml-auto text-sm underline" data-testid="study-compare">Compare here</NuxtLink>
          <button v-if="node" type="button" class="rounded border border-zinc-300 px-2 py-0.5 text-sm dark:border-zinc-700" data-testid="study-analyze" :disabled="starting" @click="analyzeThisNode">Analyze this node</button>
        </div>
        <p v-if="watched" class="text-sm text-zinc-500" data-testid="study-watching">Watching {{ watched.position }} {{ watched.name }}<span v-if="watched.cards.length"> with {{ watched.cards.join(' ') }}</span></p>
        <p v-if="startFailure" role="alert" class="text-sm text-red-600 dark:text-red-400" data-testid="study-analyze-error">{{ startFailure }}</p>

        <div v-if="pool" class="space-y-1" data-testid="study-pool">
          <p v-if="pool.enough" class="flex flex-wrap gap-x-3 text-sm">
            <span v-for="[action, share] in poolActions" :key="action" class="tabular-nums" :data-testid="`study-pool-${action}`">
              <span class="text-zinc-500">{{ action }}</span> {{ (share * 100).toFixed(1) }}%
            </span>
          </p>
          <p v-else class="text-sm text-zinc-500">The pool has not played this situation often enough to show frequencies.</p>
          <PoolDataBadge :tier="1" :sample-size="pool.sample_size" :enough="pool.enough" :min-n="pool.min_n" />
        </div>
        <p v-else-if="poolFailure" role="alert" class="text-sm text-red-600 dark:text-red-400" data-testid="study-pool-error">{{ poolFailure }}</p>

        <div v-if="mine">
          <p class="mb-1 text-sm">My chart here: <span class="font-medium" data-testid="study-my-range">{{ ranges.mine?.name }}</span></p>
          <RangeMatrix :range="mine" mode="view" :blocked-cards="board" :highlight-combos="pinnedCombos" />
        </div>
        <p v-else-if="ranges.failed" role="alert" class="text-sm text-red-600 dark:text-red-400" data-testid="study-range-error">{{ LIBRARY_UNREADABLE }}</p>
        <p v-else-if="store.status === 'offline'" role="alert" class="text-sm text-red-600 dark:text-red-400" data-testid="study-no-range">{{ offlineRangeNote(store.error) }}</p>
        <p v-else class="text-sm text-zinc-500" data-testid="study-no-range">
          Nothing stored for this situation.
          <NuxtLink to="/ranges/import" class="underline">Import your charts</NuxtLink> and they will show up here as you step.
        </p>

        <RangeReveal v-model:group="group" :node="node" :board="board" :api="poolApi" :groups="() => loadRevealGroups(poolStats)" />
      </div>

      <div class="space-y-4">
        <div v-if="noOdds === ''" class="space-y-4">
          <PotOddsPanel v-model:pot="odds.pot" v-model:bet="odds.bet" v-model:call="odds.call" v-model:implied-extra="odds.impliedExtra" v-model:rake-config="odds.rakeConfig" data-testid="study-pot-odds" />
          <p class="text-sm text-zinc-500" data-testid="study-mdf-whose">
            What {{ defenderPosition ?? 'the seat facing this bet' }} has to defend against it — not what the seat that bet is holding.
          </p>
          <MDFPanel
            v-model:pot="odds.pot"
            v-model:bet="odds.bet"
            :rake-config="odds.rakeConfig"
            :range="defenderRange"
            :equities="defenderEquities"
            @defend-click="defending = $event"
          />
          <p v-if="defenderRange === null" class="text-sm text-zinc-500" data-testid="study-mdf-no-chart">
            The MDF and alpha above stand on the pot alone. Naming the combos that make them up needs your chart for
            {{ defenderPosition ?? 'the seat facing this bet' }} here —
            <NuxtLink to="/ranges/import" class="underline">import your charts</NuxtLink> and it appears as you step.
          </p>
          <div v-if="defenderRange && defending.length" class="space-y-1" data-testid="study-defend-matrix">
            <p class="text-sm">The {{ defending.length }} combos {{ defenderPosition }} continues with at exactly this MDF</p>
            <RangeMatrix :range="defenderRange" mode="view" :blocked-cards="board" :highlight-combos="defending" />
          </div>
          <p v-if="odds.edited" class="text-sm text-zinc-500" data-testid="study-odds-edited">
            These are no longer the hand's numbers.
            <button type="button" class="underline" data-testid="study-odds-reset" @click="odds.reset()">Back to the hand's numbers</button>
          </p>
        </div>
        <p v-else class="text-sm text-zinc-500" data-testid="study-nothing-faced">{{ noOdds }}</p>

        <PoolBlockers
          v-if="facing"
          :facing="facing"
          :hero="mine"
          :chart="facingChart"
          :equities="facingEquities"
          :board="board"
          :pot="odds.pot"
          :bet="odds.bet"
          :group="group"
          :api="poolApi"
          @combo-select="pinned = $event"
        />

        <ComboDistributionPanel
          v-if="mine"
          :range="mine"
          :board="board"
          :group-by="axes"
          :equities="equity?.perComboEquity ?? null"
          @update:group-by="axes = $event"
          @export="exported = $event"
        />
        <!-- The Export button hands the text back rather than downloading it: a download in this
             app's sandbox is inert, and the Lab already answers the same button the same way. -->
        <details v-if="exported" class="text-sm" data-testid="study-dist-export">
          <summary class="cursor-pointer text-zinc-500">Exported text</summary>
          <pre class="mt-2 overflow-x-auto rounded bg-zinc-100 p-2 text-xs dark:bg-zinc-900">{{ exported }}</pre>
        </details>
        <EquityCalculator v-if="both.length === 2" :ranges="both" :board="board" :service="service" @result="equity = $event" />
        <p v-else-if="mine && ranges.villainNode" class="text-sm text-zinc-500" data-testid="study-no-villain-range">
          No stored range for {{ nodeKeyLabel(ranges.villainNode) }}, so there is nothing to run the equity against yet.
          <NuxtLink to="/ranges/import" class="underline">Import your charts</NuxtLink> and the equity, the defending set and the
          realization below all follow.
        </p>

        <p v-if="realizedFailure" role="alert" class="text-sm text-red-600 dark:text-red-400" data-testid="study-realization-error">{{ realizedFailure }}</p>
        <p v-else-if="realized?.needs_rebuild" class="text-sm text-zinc-500" data-testid="study-eqr-rebuild">
          What the field won from this situation cannot be measured on this database yet; it appears after the statistics are next rebuilt.
        </p>
        <div v-else-if="realized?.enough" class="space-y-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800" data-testid="study-realization">
          <h2 class="font-medium">What the field won from here</h2>
          <EQRPanel
            v-if="equity && potBefore > 0"
            :equity="equity.heroEquity"
            :pot="potBefore"
            :ev="solverEv"
            :pool-eqr="poolRealized"
            @update:ev="solverEv = $event"
          />
          <PoolRealizationPanel
            :action="realized.action"
            :overall="realized.overall"
            :rows="realizationRows"
            :covers="realized.covers"
            :min-bucket-n="realized.min_bucket_n"
            :equity="classEquities"
            :overall-equity="equity?.heroEquity ?? null"
          />
        </div>
      </div>
    </section>
  </div>
</template>
