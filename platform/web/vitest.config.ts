import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  test: {
    include: ['packages/*/src/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
    // Component tests declare `// @vitest-environment happy-dom` at the top of the file.
    environment: 'node',
    // The evaluator agreement test evaluates 200k random 7-card hands three times.
    testTimeout: 60_000,
  },
});
