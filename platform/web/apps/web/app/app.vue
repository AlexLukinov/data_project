<script setup lang="ts">
const links = [
  { to: '/', label: 'Home' },
  { to: '/lab', label: 'Range Lab' },
  { to: '/dev/components', label: 'Components' },
];
</script>

<template>
  <div class="min-h-screen">
    <header class="border-b border-zinc-200 dark:border-zinc-800">
      <nav class="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
        <span class="font-semibold tracking-tight">Poker platform</span>
        <NuxtLink v-for="link in links" :key="link.to" :to="link.to" class="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100" active-class="!text-zinc-900 dark:!text-zinc-100 underline underline-offset-4">
          {{ link.label }}
        </NuxtLink>
      </nav>
    </header>
    <main class="mx-auto max-w-7xl px-4 py-6">
      <NuxtPage />
    </main>
  </div>
</template>
