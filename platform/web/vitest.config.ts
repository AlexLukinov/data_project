import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
    // The evaluator agreement test evaluates 100k random 7-card hands twice.
    testTimeout: 60_000,
  },
});
