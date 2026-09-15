<script setup lang="ts">
/**
 * The uploader's screen names (plan D.8): the names the parser treats as "my seat" when a file of
 * My hands comes in. Most exports need none, so the panel says when one is worth adding.
 *
 * Every write goes to the server and the list is read back after it, so what is shown is what is
 * stored. A refused add shows the server's sentence (a 409 for a name already there, a 422 list for
 * an unknown site or an empty name). A failed write and a failed read-back are separate sentences:
 * a list that fails to reload after the server accepted the change is not a refused change.
 */
import { computed, onMounted, ref, watch } from 'vue';

import { describeApiError } from '~/auth/api';
import type { PokerAccount, UploadsApi } from '~/upload/api';
import { SCREEN_NAME_MAX } from '~/upload/api';
import { describeUploadError } from '~/upload/status';

const props = defineProps<{ api: UploadsApi; sites: string[] }>();

const accounts = ref<PokerAccount[]>([]);
/** The list has been read at least once, by the first load or any read-back after a write. */
const loaded = ref(false);
/** Only the first load says "Loading…"; a read-back after a write keeps the list on screen. */
const firstLoad = ref(true);
const site = ref('');
const name = ref('');
const busy = ref(false);
const problem = ref('');

const canAdd = computed(() => !busy.value && site.value !== '' && name.value.trim() !== '');

// The sites arrive after mount on the page; keep the choice on one the server reads.
watch(
  () => props.sites,
  (sites) => {
    if (!sites.includes(site.value)) site.value = sites[0] ?? '';
  },
  { immediate: true },
);

onMounted(load);

async function load(): Promise<void> {
  busy.value = true;
  problem.value = '';
  try {
    accounts.value = await props.api.accounts();
    loaded.value = true;
  } catch (error) {
    problem.value = `Could not load your screen names: ${describeApiError(error)}`;
  } finally {
    busy.value = false;
    firstLoad.value = false;
  }
}

/** Read the list back after a write; a failure here is its own sentence, never a refused write. */
async function reload(): Promise<void> {
  busy.value = true;
  try {
    accounts.value = await props.api.accounts();
    loaded.value = true;
  } catch (error) {
    problem.value = `The change was saved, but the list could not be read back: ${describeApiError(error)}`;
  } finally {
    busy.value = false;
  }
}

async function add(): Promise<void> {
  if (!canAdd.value) return;
  busy.value = true;
  problem.value = '';
  try {
    await props.api.addAccount(site.value, name.value.trim());
  } catch (error) {
    problem.value = describeUploadError(error);
    return;
  } finally {
    busy.value = false;
  }
  name.value = '';
  await reload();
}

async function remove(account: PokerAccount): Promise<void> {
  if (!window.confirm(`Remove ${account.screen_name} on ${account.site}? Files already uploaded keep the seat they were given.`)) return;
  busy.value = true;
  problem.value = '';
  try {
    await props.api.removeAccount(account.id);
  } catch (error) {
    problem.value = `Could not remove ${account.screen_name}: ${describeApiError(error)}`;
    return;
  } finally {
    busy.value = false;
  }
  await reload();
}
</script>

<template>
  <section class="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800" data-testid="poker-accounts">
    <h2 class="font-medium">Poker accounts</h2>
    <p class="text-sm text-zinc-500">
      Your screen names tell the parser which seat is yours. Most exports need none — GGPoker names you Hero and PokerStars shows your cards on the “Dealt to” line — and a name applies to files uploaded after you add it.
    </p>

    <p v-if="firstLoad" class="text-sm text-zinc-500" data-testid="accounts-loading">Loading your screen names…</p>
    <ul v-else-if="accounts.length > 0" class="space-y-1 text-sm" data-testid="accounts-list">
      <li v-for="account in accounts" :key="account.id" class="flex items-center gap-3" :data-testid="`account-row-${account.id}`">
        <span class="w-24 text-zinc-500">{{ account.site }}</span>
        <span class="font-medium">{{ account.screen_name }}</span>
        <button
          type="button"
          :disabled="busy"
          class="ml-auto rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-900"
          :data-testid="`account-remove-${account.id}`"
          @click="remove(account)"
        >
          Remove
        </button>
      </li>
    </ul>
    <p v-else-if="loaded" class="text-sm text-zinc-500" data-testid="accounts-empty">No screen names yet.</p>

    <form class="flex flex-wrap items-center gap-2" @submit.prevent="add">
      <select v-model="site" aria-label="Site" :disabled="busy" class="rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700" data-testid="accounts-site">
        <option v-for="choice in sites" :key="choice" :value="choice">{{ choice }}</option>
      </select>
      <input
        v-model="name"
        type="text"
        aria-label="Screen name"
        placeholder="Screen name"
        :maxlength="SCREEN_NAME_MAX"
        :disabled="busy"
        class="rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700"
        data-testid="accounts-name"
      />
      <button type="submit" :disabled="!canAdd" class="rounded bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900" data-testid="accounts-add">Add</button>
    </form>
    <p v-if="problem" role="alert" class="text-sm text-red-600 dark:text-red-400" data-testid="accounts-error">{{ problem }}</p>
  </section>
</template>
