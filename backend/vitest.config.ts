import path from 'node:path'
import { defineConfig } from 'vitest/config'
import { TEST_ENV } from './tests/support/test-env.ts'

// A dedicated, throwaway PostgreSQL instance is started for tests (see tests/support/global-setup.ts).
// `npm test` runs tests/integration/migrations.test.ts in a SECOND run, on its own freshly seeded database: it rolls back
// and re-applies migrations 0017+, which removes demo configuration other tests use, and some rollbacks refuse by design
// while business data exists (0028: non-INR payments). Running it separately keeps every test independent of file order.
// Also apply to the main process so global setup uses the test database.
Object.assign(process.env, TEST_ENV)

export default defineConfig({
  resolve: {
    alias: [
      // Shared server code runs here as it does inside the Next.js app (next/headers, simulated per test where needed).
      // The Express API tests (tests/api) switch to the Express request-context provider explicitly with vi.mock.
      { find: /^@\/lib\/http\/context-provider$/, replacement: path.resolve(import.meta.dirname, '../frontend/src/server-api/next-context-provider.ts') },
      { find: /^@\//, replacement: `${path.resolve(import.meta.dirname, 'src')}/` },
      { find: 'server-only', replacement: path.resolve(import.meta.dirname, 'tests/support/server-only-stub.ts') },
    ],
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts', 'tests/api/**/*.test.ts'],
    globalSetup: ['tests/support/global-setup.ts'],
    env: TEST_ENV,
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 120000,
  },
})
