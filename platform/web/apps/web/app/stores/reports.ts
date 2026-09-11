/**
 * The report library store (plan D.5): Pinia registers one copy of the presets and the saved
 * reports, so every screen that offers "open a standard report" offers the same list and a save
 * made on one is visible on the next.
 *
 * The *workbench* is deliberately not in here. `reports/model.ts` is created per screen, because
 * the whole point of D.3's split is that My game and the Pool share a situation without sharing
 * the columns they measure it with — one global column selection would undo that.
 */
import { defineStore } from 'pinia';

import { createReportsApi } from '../reports/api';
import { createLibrary } from '../reports/library';
import { useAuthStore } from './auth';

export const useReportsStore = defineStore('reports', () => createLibrary(createReportsApi(useAuthStore().fetch)));
