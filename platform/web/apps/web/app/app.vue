<script setup lang="ts">
import { onMounted } from 'vue';

import { useAuthStore } from '~/stores/auth';

const links = [
  { to: '/', label: 'Home' },
  { to: '/lab', label: 'Range Lab' },
  { to: '/ranges', label: 'Ranges' },
  { to: '/hands', label: 'Hands' },
  { to: '/dev/components', label: 'Components' },
];

const auth = useAuthStore();
// Public pages never hit the middleware, so the header resumes the session itself; the call
// runs once and never throws.
onMounted(() => {
  void auth.bootstrap();
});

async function signOut(): Promise<void> {
  await auth.logout();
  await navigateTo('/');
}
</script>

<template>
  <div class="min-h-screen">
    <header class="border-b border-zinc-200 dark:border-zinc-800">
      <nav class="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
        <span class="font-semibold tracking-tight">Poker platform</span>
        <NuxtLink v-for="link in links" :key="link.to" :to="link.to" class="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100" active-class="!text-zinc-900 dark:!text-zinc-100 underline underline-offset-4">
          {{ link.label }}
        </NuxtLink>
        <span class="ml-auto flex items-center gap-4 text-sm">
          <template v-if="auth.status === 'authenticated'">
            <NuxtLink to="/account" data-testid="nav-account" class="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">{{ auth.user?.email ?? 'Account' }}</NuxtLink>
            <button type="button" data-testid="nav-signout" class="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100" @click="signOut">Sign out</button>
          </template>
          <NuxtLink v-else-if="auth.status === 'anonymous'" to="/login" data-testid="nav-signin" class="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">Sign in</NuxtLink>
        </span>
      </nav>
    </header>
    <main class="mx-auto max-w-7xl px-4 py-6">
      <NuxtPage />
    </main>
  </div>
</template>
