import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.{js,mjs}'],
    exclude: ['tests/**/*.spec.mjs', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // Coverage threshold intentionally not enforced:
      // Main logic lives in index.html inline ES module (browser-only, not importable by vitest).
      // Quality gate uses: 80+ unit tests + 33-point check-html.mjs static analysis.
      // Future: extract logic to lib/ for measurable coverage.
    },
    // Worker syntax check before test run
    setupFiles: ['tests/setup.mjs'],
  },
});
