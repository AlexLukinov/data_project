// One Nuxt 4 app in SPA mode (ADR-024/027): everything is behind auth and FastAPI is the only
// server, so nothing renders on the server. Tailwind v4 through its Vite plugin; Pinia for
// state; English only.
import tailwindcss from '@tailwindcss/vite';

export default defineNuxtConfig({
  ssr: false,
  compatibilityDate: '2026-09-10',
  modules: ['@pinia/nuxt'],
  css: ['~/assets/css/main.css', '@poker/ui/theme.css'],
  typescript: { strict: true, typeCheck: false },
  runtimeConfig: {
    public: {
      // Override with NUXT_PUBLIC_API_BASE; the API's CORS allows http://localhost:3000.
      apiBase: 'http://localhost:8000',
    },
  },
  vite: {
    plugins: [tailwindcss()],
    // Workspace packages are consumed from source; Vite transpiles their TypeScript.
    optimizeDeps: { exclude: ['@poker/core', '@poker/ui', '@poker/workers'] },
    worker: { format: 'es' },
  },
  app: {
    head: {
      title: 'Range Lab',
      htmlAttrs: { lang: 'en' },
      meta: [{ name: 'color-scheme', content: 'light dark' }],
    },
  },
});
