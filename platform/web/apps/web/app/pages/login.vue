<script setup lang="ts">
// Sign-in (plan D.2). The error is the API's answer in plain English; the return path comes
// from the middleware and is followed only when it is a path on this site.
import { ref } from 'vue';

import { describeSignInError } from '~/auth/api';
import { safePath } from '~/auth/paths';
import { useAuthStore } from '~/stores/auth';

definePageMeta({ public: true });

const auth = useAuthStore();
const route = useRoute();
const email = ref('');
const password = ref('');
const error = ref<string | null>(null);
const busy = ref(false);

async function submit(): Promise<void> {
  busy.value = true;
  error.value = null;
  try {
    await auth.login(email.value, password.value);
    await navigateTo(safePath(route.query.next) ?? '/account');
  } catch (e) {
    error.value = describeSignInError(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="mx-auto max-w-sm space-y-6">
    <h1 class="text-2xl font-semibold">Sign in</h1>
    <form class="space-y-4" @submit.prevent="submit">
      <label class="block text-sm">
        <span class="text-zinc-600 dark:text-zinc-400">Email</span>
        <input v-model="email" type="email" name="email" autocomplete="email" required class="mt-1 w-full rounded border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900" />
      </label>
      <label class="block text-sm">
        <span class="text-zinc-600 dark:text-zinc-400">Password</span>
        <input v-model="password" type="password" name="password" autocomplete="current-password" required class="mt-1 w-full rounded border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900" />
      </label>
      <p v-if="error" role="alert" data-testid="login-error" class="text-sm text-red-600 dark:text-red-400">{{ error }}</p>
      <button type="submit" :disabled="busy" class="w-full rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">
        {{ busy ? 'Signing in…' : 'Sign in' }}
      </button>
    </form>
    <p class="text-sm text-zinc-600 dark:text-zinc-400">
      No account yet? <NuxtLink to="/register" class="underline">Create one</NuxtLink>.
    </p>
  </section>
</template>
