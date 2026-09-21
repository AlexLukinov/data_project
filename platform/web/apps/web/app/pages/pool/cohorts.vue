<script setup lang="ts">
/**
 * The cohorts the field can be cut into (plan D.6), and — since D.6b — the founder's own.
 *
 * A cohort is **a rule, not a list**: `analysis/pool/cohorts.py` evaluates its thresholds against
 * the cached per-player stats every time a report runs, so "regulars" means whoever is playing like
 * one this month, not whoever was in the group when it was made. That is why this page shows a
 * cohort's size as a figure it fetched just now rather than a stored count.
 *
 * Two sources, deliberately shown as one list with its origin named: the `regs` and `fish` the pool
 * area **ships** (`GET /v1/pool/presets`), and the cohorts the founder has **saved**. The shipped
 * rules are the server's and are not retyped here; a shipped cohort can be copied into a saved one,
 * which is the only way to list the players it names.
 *
 * Every write goes to the server and the list is read back after it, so what is shown is what is
 * stored, never what was sent. A refused save is shown in the server's own sentence
 * (`pool/rules.ts#describeCohortError`): the 409 for a name already used, the 400 for a rule on a
 * stat the engine cannot evaluate per player. The write and the read-back are kept apart on
 * purpose: a list that fails to reload after the server accepted the row is a reload failure with
 * its own sentence, never a refused save with the form still open over a row that now exists.
 */
import { computed, ref } from 'vue';

import CohortForm from '~/components/pool/CohortForm.vue';
import DefinitionPanel from '~/components/reports/DefinitionPanel.vue';
import EmptyState from '~/components/reports/EmptyState.vue';
import StatGrid from '~/components/reports/StatGrid.vue';
import { describeApiError } from '~/auth/api';
import { createReportsApi } from '~/reports/api';
import { MIN_N } from '~/reports/cell';
import { describeCohortError } from '~/pool/rules';
import type { CohortChoice, CohortIn, PoolCohort } from '~/pool/stats';
import { MEMBER_LIMIT, cohortChoices, createPoolStatsApi } from '~/pool/stats';
import { LIST_NOT_REREAD, cohortsEmptyView, emptyMembersView, savedCohortsErrorWords, shippedCohortsErrorWords } from '~/pool/words';
import type { ReportResult } from '~/stats/api';
import { useDefinitionsStore } from '~/stores/definitions';

const MEMBERS_SHOWN = 100;

const definitions = useDefinitionsStore();
const pool = createPoolStatsApi(useApi());
const reports = createReportsApi(useApi());

const saved = ref<PoolCohort[]>([]);
const choices = ref<CohortChoice[]>([]);
const openKey = ref<string | null>(null);
const size = ref<number | null>(null);
const members = ref<ReportResult | null>(null);
const failure = ref('');
const busy = ref(false);
const describing = ref('');
const shippedProblem = ref('');
const savedProblem = ref('');

/** The form: closed, or open with what it starts from and the saved row it replaces, if any. */
const form = ref<{ initial: CohortIn | null; replacing: PoolCohort | null } | null>(null);
const saving = ref(false);
const saveFailure = ref('');
const deleteFailure = ref('');
const listFailure = ref('');

await useAsyncData('definitions', () => definitions.load(), { server: false });
await useAsyncData('pool-cohorts', load, { server: false });

const problems = computed(() => [shippedProblem.value, savedProblem.value].filter((problem) => problem !== ''));
const membersEmpty = emptyMembersView();
const describedStat = computed(() => definitions.stats.find((stat) => stat.code === describing.value));
const describedDim = computed(() => (describedStat.value === undefined ? definitions.byCode.get(describing.value) : undefined));

/**
 * Both lists, each answering for itself. Settled rather than joined: the shipped cohorts and the
 * founder's own fail separately, and a page that shows "No cohorts." over a failed call is telling
 * the founder their cohorts are gone. The saved half used to be swallowed by a `.catch(() => [])`
 * outright, so a saved cohort could disappear from this page without a word.
 */
async function load(): Promise<void> {
  shippedProblem.value = '';
  savedProblem.value = '';
  const [shipped, mine] = await Promise.allSettled([reports.poolPresets(), pool.cohorts()]);
  if (shipped.status === 'rejected') shippedProblem.value = shippedCohortsErrorWords(describeApiError(shipped.reason));
  if (mine.status === 'rejected') savedProblem.value = savedCohortsErrorWords(describeApiError(mine.reason));
  saved.value = mine.status === 'fulfilled' ? mine.value : [];
  choices.value = cohortChoices(shipped.status === 'fulfilled' ? shipped.value.cohorts : [], saved.value, definitions.stats);
  /* The list has now been read back, so "it may not show it yet" is no longer true of the rows
     under it — a Try again that worked must not leave that sentence contradicting them. A read
     that failed again leaves it, because the write it speaks for is still unconfirmed. */
  if (savedProblem.value === '') listFailure.value = '';
}

/** Read the list back after a write. A failed read is its own sentence, never mistaken for a refused write. */
async function reload(): Promise<void> {
  await load();
  if (savedProblem.value !== '') listFailure.value = LIST_NOT_REREAD;
}

/**
 * Ask for the registry again. The store keeps the reason in `definitions.error`, which is the
 * sentence already on screen, so there is nothing here to rethrow into an unhandled rejection.
 */
function retryDefinitions(): void {
  void definitions.load().catch(() => undefined);
}

/**
 * Open one cohort: its live size and the players in it.
 *
 * Only a **saved** cohort has an id, and `GET /v1/pool/cohorts/{id}/members` is the only route that
 * lists members, so a shipped preset shows its rules and its link and says plainly that it has no
 * membership list — rather than inventing one from a report the engine was never asked.
 */
async function show(choice: CohortChoice): Promise<void> {
  openKey.value = choice.key;
  size.value = null;
  members.value = null;
  failure.value = '';
  if (choice.id === null) return;
  busy.value = true;
  try {
    const [detail, rows] = await Promise.all([pool.cohort(choice.id), pool.members(choice.id, MEMBERS_SHOWN)]);
    size.value = detail.players;
    members.value = rows;
  } catch (error) {
    failure.value = describeApiError(error);
  } finally {
    busy.value = false;
  }
}

function openNew(): void {
  saveFailure.value = '';
  form.value = { initial: null, replacing: null };
}

/** Edit a saved cohort, or start one of your own from a shipped cohort's rules and label. */
function openFrom(choice: CohortChoice): void {
  saveFailure.value = '';
  const row = saved.value.find((cohort) => cohort.id === choice.id) ?? null;
  if (row !== null) form.value = { initial: { name: row.name, criteria: row.criteria }, replacing: row };
  else if (choice.spec !== null) form.value = { initial: { name: choice.label, criteria: choice.spec }, replacing: null };
}

/**
 * Save the form: a `POST` for a new cohort, a `PUT` over the one being edited. Only the write can
 * set `saveFailure`; once the server has the row the form closes, the list is re-read, and an open
 * "Who is in it" panel on the edited cohort is fetched again — its rules just changed, so its size
 * and members are no longer "right now".
 */
async function save(body: CohortIn): Promise<void> {
  if (form.value === null) return;
  const target = form.value.replacing;
  saving.value = true;
  saveFailure.value = '';
  try {
    await (target === null ? pool.createCohort(body) : pool.updateCohort(target.id, body));
  } catch (error) {
    saveFailure.value = describeCohortError(error);
    return;
  } finally {
    saving.value = false;
  }
  form.value = null;
  await reload();
  const open = target === null ? undefined : choices.value.find((choice) => choice.key === target.id);
  if (open !== undefined && openKey.value === open.key) await show(open);
}

/** Delete a saved cohort. A `/pool?cohort=<id>` link that named it will measure the whole field instead. */
async function remove(choice: CohortChoice): Promise<void> {
  if (choice.id === null) return;
  if (!window.confirm(`Delete "${choice.label}"? A link that names it will measure the whole field instead.`)) return;
  deleteFailure.value = '';
  try {
    await pool.deleteCohort(choice.id);
  } catch (error) {
    deleteFailure.value = describeCohortError(error);
    return;
  }
  if (openKey.value === choice.key) openKey.value = null;
  if (form.value?.replacing?.id === choice.id) form.value = null;
  await reload();
}
</script>

<template>
  <section class="space-y-4">
    <div class="flex flex-wrap items-baseline gap-3">
      <h1 class="text-2xl font-semibold">Cohorts</h1>
      <NuxtLink to="/pool" class="text-sm underline underline-offset-2">The pool</NuxtLink>
      <button
        type="button"
        :disabled="form !== null && form.replacing === null && form.initial === null"
        data-testid="cohort-new"
        class="ml-auto rounded bg-zinc-900 px-3 py-1 text-sm text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
        @click="openNew"
      >
        New cohort
      </button>
    </div>

    <p class="max-w-2xl text-sm text-zinc-500">
      A cohort is a rule about how someone plays, applied when a report runs — not a saved list of
      names. Measuring the field with one scopes every number to the players who match it today.
    </p>

    <div v-if="definitions.status === 'error'" role="alert" data-testid="definitions-error" class="rounded border border-red-300 p-3 text-sm text-red-700 dark:border-red-800 dark:text-red-400">
      {{ definitions.error }}
      <button type="button" class="ml-2 underline underline-offset-2" @click="retryDefinitions">Try again</button>
    </div>

    <div v-if="problems.length" class="rounded border border-red-300 p-3 text-sm text-red-700 dark:border-red-800 dark:text-red-400">
      <p v-for="problem in problems" :key="problem" role="alert" data-testid="cohorts-load-error">{{ problem }}</p>
      <button type="button" class="mt-1 underline underline-offset-2" @click="load()">Try again</button>
    </div>

    <CohortForm
      v-if="form !== null"
      :stats="definitions.stats"
      :initial="form.initial"
      :replacing="form.replacing !== null"
      :busy="saving"
      :failure="saveFailure"
      @save="save"
      @cancel="form = null"
    />

    <p v-if="deleteFailure" role="alert" data-testid="cohort-delete-error" class="text-sm text-red-600 dark:text-red-400">{{ deleteFailure }}</p>
    <p v-if="listFailure" role="alert" data-testid="cohort-list-error" class="text-sm text-red-600 dark:text-red-400">{{ listFailure }}</p>

    <EmptyState v-if="choices.length === 0 && problems.length === 0" :view="cohortsEmptyView()" testid="no-cohorts" @act="openNew" />

    <ul class="space-y-2" data-testid="cohort-list">
      <li
        v-for="choice in choices"
        :key="choice.key"
        class="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
        :data-testid="`cohort-${choice.key}`"
      >
        <div class="flex flex-wrap items-baseline gap-2">
          <h2 class="text-sm font-medium">{{ choice.label }}</h2>
          <span class="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            {{ choice.id === null ? 'shipped' : 'saved' }}
          </span>
          <p class="text-xs text-zinc-500">{{ choice.description }}</p>
          <NuxtLink :to="{ path: '/pool', query: { cohort: choice.key } }" class="ml-auto text-sm underline underline-offset-2">
            Measure the field with this
          </NuxtLink>
          <button type="button" class="text-sm underline underline-offset-2" :data-testid="`open-${choice.key}`" @click="show(choice)">
            {{ openKey === choice.key ? 'Showing' : 'Who is in it' }}
          </button>
          <button type="button" class="text-sm underline underline-offset-2" :data-testid="`edit-${choice.key}`" @click="openFrom(choice)">
            {{ choice.id === null ? 'Save as mine' : 'Edit' }}
          </button>
          <button v-if="choice.id !== null" type="button" class="text-sm underline underline-offset-2" :data-testid="`delete-${choice.key}`" @click="remove(choice)">
            Delete
          </button>
        </div>

        <div v-if="openKey === choice.key" class="mt-3 space-y-2">
          <p v-if="choice.id === null" class="text-xs text-zinc-500" data-testid="shipped-no-members">
            A shipped cohort has no stored membership list — it is only the rule above. “Save as mine”
            makes a cohort of your own with the same rules, which does list the players it names.
          </p>
          <template v-else>
            <p v-if="busy" class="text-xs text-zinc-500" data-testid="cohort-counting">Counting…</p>
            <template v-else-if="size !== null">
              <p v-if="size > 0" class="text-xs text-zinc-500" data-testid="cohort-size">
                <strong class="tabular-nums">{{ size.toLocaleString('en-US') }}</strong> players match right now;
                showing the first {{ Math.min(MEMBERS_SHOWN, MEMBER_LIMIT) }}.
              </p>
              <EmptyState v-else :view="membersEmpty" testid="cohort-none" @act="openFrom(choice)" />
            </template>
            <p v-if="failure" role="alert" data-testid="cohort-error" class="text-sm text-red-600 dark:text-red-400">{{ failure }}</p>
            <StatGrid v-if="size !== 0" :result="members" :stats="definitions.stats" :dimensions="definitions.byCode" :min-n="MIN_N" @describe="describing = $event" />
          </template>
        </div>
      </li>
    </ul>

    <DefinitionPanel v-if="describing" :stat="describedStat" :dimension="describedDim" :dimensions="definitions.byCode" @close="describing = ''" />
  </section>
</template>
