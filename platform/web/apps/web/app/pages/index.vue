<script setup lang="ts">
// Plan D.1's "Done means": a page that calls GET /health on the API and shows the answer.
// `useFetch` in setup (never `$fetch` here); `$fetch` only in the refresh handler.
interface Health {
  status: string;
  api?: string;
  clickhouse?: string;
}

const config = useRuntimeConfig();
const url = `${config.public.apiBase}/health`;
const { data, error, status, refresh } = await useFetch<Health>(url, { server: false, lazy: true });

async function recheck(): Promise<void> {
  await refresh();
}
</script>

<template>
  <section class="space-y-6">
    <h1 class="text-2xl font-semibold">Poker platform</h1>
    <div class="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 class="font-medium">API health</h2>
      <p class="mt-1 text-sm text-zinc-500">{{ url }}</p>
      <p v-if="status === 'pending'" class="mt-3 text-sm">Checking…</p>
      <p v-else-if="error" class="mt-3 text-sm text-red-600 dark:text-red-400">
        The API did not answer: {{ error.message }}. Start it with <code>make api</code> in <code>platform/</code>.
      </p>
      <dl v-else-if="data" class="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
        <dt class="text-zinc-500">status</dt>
        <dd data-testid="health-status" :class="data.status === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600'">{{ data.status }}</dd>
        <dt class="text-zinc-500">api</dt>
        <dd>{{ data.api ?? '—' }}</dd>
        <dt class="text-zinc-500">clickhouse</dt>
        <dd>{{ data.clickhouse ?? '—' }}</dd>
      </dl>
      <button type="button" class="mt-4 rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900" @click="recheck">Check again</button>
    </div>
    <p class="text-sm text-zinc-600 dark:text-zinc-400">
      The <NuxtLink to="/lab" class="underline">Range Lab</NuxtLink> works offline: ranges, boards, equity, distribution and blockers need no API.
    </p>
  </section>
</template>
