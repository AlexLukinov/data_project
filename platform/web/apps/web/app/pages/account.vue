<script setup lang="ts">
// The signed-in account, fetched live from GET /v1/auth/me through useApi. This is the page
// that shows silent refresh working: after the access token expires, "Reload" still answers
// without a sign-in (plan D.2's "Done means").
import type { AuthUser } from '~/auth/api';
import { describeApiError } from '~/auth/api';
import { useAuthStore } from '~/stores/auth';

const api = useApi();
const auth = useAuthStore();
const { data, error, status, refresh } = await useAsyncData('me', () => api<AuthUser>('/v1/auth/me'), { server: false });

async function reload(): Promise<void> {
  await refresh();
}

async function signOut(): Promise<void> {
  await auth.logout();
  await navigateTo('/');
}
</script>

<template>
  <section class="space-y-6">
    <h1 class="text-2xl font-semibold">Account</h1>
    <p class="text-sm text-zinc-500">Screen names and uploads are on the <NuxtLink to="/upload" class="underline" data-testid="account-upload-link">Upload page</NuxtLink>.</p>
    <div class="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <p v-if="status === 'pending'" class="text-sm text-zinc-500">Loading your account…</p>
      <p v-else-if="error" role="alert" class="text-sm text-red-600 dark:text-red-400">Could not load the account: {{ describeApiError(error.cause ?? error) }}</p>
      <dl v-else-if="data" class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
        <dt class="text-zinc-500">email</dt>
        <dd data-testid="account-email">{{ data.email }}</dd>
        <dt class="text-zinc-500">display name</dt>
        <dd>{{ data.display_name || '—' }}</dd>
        <dt class="text-zinc-500">id</dt>
        <dd class="font-mono text-xs">{{ data.id }}</dd>
        <dt class="text-zinc-500">active</dt>
        <dd>{{ data.is_active ? 'yes' : 'no' }}</dd>
      </dl>
      <div class="mt-4 flex gap-3">
        <button type="button" data-testid="account-reload" class="rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900" @click="reload">Reload</button>
        <button type="button" data-testid="account-signout" class="rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900" @click="signOut">Sign out</button>
      </div>
    </div>
  </section>
</template>
