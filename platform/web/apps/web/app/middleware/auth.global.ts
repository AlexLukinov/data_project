/**
 * Every route is behind sign-in unless its page declares `definePageMeta({ public: true })`
 * (ADR-024: everything is behind auth; spec §17: the Range Lab's calculation needs no backend,
 * so `/lab` and `/dev/*` are public). An unknown session tries the refresh cookie first, so a
 * reload keeps the user signed in; otherwise sign-in gets the intended page as its return path.
 */
import { useAuthStore } from '../stores/auth';

export default defineNuxtRouteMiddleware(async (to) => {
  if (to.meta.public === true) return;
  const auth = useAuthStore();
  if (auth.status === 'unknown') await auth.bootstrap();
  if (auth.status !== 'authenticated') return navigateTo({ path: '/login', query: { next: to.fullPath } });
});
