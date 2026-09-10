<script setup lang="ts">
// Registration (plan D.2). The API requires a password of at least 10 characters and answers
// 409 for a known email; both become one sentence with the next step.
import { ref } from 'vue';

import { describeSignInError, errorStatus } from '~/auth/api';
import { useAuthStore } from '~/stores/auth';

definePageMeta({ public: true });

const PASSWORD_MIN = 10;
const CONFLICT = 409;

const auth = useAuthStore();
const email = ref('');
const password = ref('');
const displayName = ref('');
const error = ref<string | null>(null);
const known = ref(false);
const busy = ref(false);

async function submit(): Promise<void> {
  busy.value = true;
  error.value = null;
  known.value = false;
  try {
    await auth.register(email.value, password.value, displayName.value);
    await navigateTo('/account');
  } catch (e) {
    error.value = describeSignInError(e);
    known.value = errorStatus(e) === CONFLICT;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="mx-auto max-w-sm space-y-6">
    <h1 class="text-2xl font-semibold">Create an account</h1>
    <form class="space-y-4" @submit.prevent="submit">
      <label class="block text-sm">
        <span class="text-zinc-600 dark:text-zinc-400">Email</span>
        <input v-model="email" type="email" name="email" autocomplete="email" required class="mt-1 w-full rounded border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900" />
      </label>
      <label class="block text-sm">
        <span class="text-zinc-600 dark:text-zinc-400">Display name <span class="text-zinc-400">(optional)</span></span>
        <input v-model="displayName" type="text" name="display_name" autocomplete="nickname" maxlength="120" class="mt-1 w-full rounded border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900" />
      </label>
      <label class="block text-sm">
        <span class="text-zinc-600 dark:text-zinc-400">Password <span class="text-zinc-400">(at least {{ PASSWORD_MIN }} characters)</span></span>
        <input v-model="password" type="password" name="password" autocomplete="new-password" :minlength="PASSWORD_MIN" required class="mt-1 w-full rounded border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900" />
      </label>
      <p v-if="error" role="alert" data-testid="register-error" class="text-sm text-red-600 dark:text-red-400">
        {{ error }}
        <NuxtLink v-if="known" to="/login" class="underline">Sign in instead</NuxtLink>
      </p>
      <button type="submit" :disabled="busy" class="w-full rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">
        {{ busy ? 'Creating…' : 'Create account' }}
      </button>
    </form>
    <p class="text-sm text-zinc-600 dark:text-zinc-400">
      Already registered? <NuxtLink to="/login" class="underline">Sign in</NuxtLink>.
    </p>
  </section>
</template>
