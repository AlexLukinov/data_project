<script setup lang="ts">
/**
 * The reports workbench, at `/reports` and at `/reports/<saved id>` (plan D.5).
 *
 * One page with an **optional** parameter rather than `index.vue` + `[id].vue`, so that saving a
 * report — which moves the address from the first form to the second — does not remount the
 * workbench and throw away the grid the founder was just looking at.
 *
 * Sharing the route record is not enough on its own: `NuxtPage` keys a page by its path by
 * default, so `/reports` → `/reports/<id>` remounted anyway and the grid vanished the moment a
 * report was saved — caught in the browser, not in a test. A constant `key` pins the two forms to
 * one instance, which also makes the workbench's watch on `savedId` load-bearing: moving between
 * two saved reports, by the Back button or by the library, now reloads the document in place.
 */
import { computed } from 'vue';

import ReportWorkbench from '~/components/reports/ReportWorkbench.vue';

definePageMeta({ key: 'reports' });

const route = useRoute();
const savedId = computed(() => {
  const id = route.params.id;
  const value = Array.isArray(id) ? id[0] : id;
  return value === undefined || value === '' ? null : value;
});
</script>

<template>
  <ReportWorkbench :saved-id="savedId" />
</template>
