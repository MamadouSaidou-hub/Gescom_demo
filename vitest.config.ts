import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 20_000,
    // These are integration tests against one shared database, and several files operate on the
    // same demo tenant. Run files one at a time: in parallel, cash-accounts.test.ts's cleanup
    // could delete a cash account that sales.test.ts had just selected as the default caisse,
    // failing an unrelated test with a foreign-key violation.
    fileParallelism: false,
  },
})
