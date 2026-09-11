/**
 * The shared filter store (plan D.3): Pinia registers one filter, so the hand list, the reports
 * workbench and the pool all ask the same question and a link from one opens the same situation
 * in another. The logic lives in `~/filter/model`, tested with a plain map of dimensions; this
 * file only binds it to the registry store.
 */
import { defineStore } from 'pinia';
import { computed } from 'vue';

import { createFilterModel } from '../filter/model';
import { useDefinitionsStore } from './definitions';

export const useFilterStore = defineStore('filter', () => {
  const definitions = useDefinitionsStore();
  return createFilterModel(computed(() => definitions.byCode));
});
