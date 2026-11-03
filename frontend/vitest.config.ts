import path from 'node:path'
import { defineConfig } from 'vitest/config'
import { TEST_ENV } from '../backend/tests/support/test-env.ts'

// Integration tests of the app's route handlers and server actions (src/app/api, src/app/actions). They use the same
// dedicated, throwaway PostgreSQL instance as the backend tests (../backend/tests/support/global-setup.ts), never the
// development database. Also applied to the main process so global setup uses the test database.
Object.assign(process.env, TEST_ENV)

const BACKEND = path.resolve(import.meta.dirname, '../backend')

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/server\//, replacement: `${BACKEND}/src/server/` },
      { find: /^@\/lib\//, replacement: `${BACKEND}/src/lib/` },
      { find: /^@\//, replacement: `${path.resolve(import.meta.dirname, 'src')}/` },
      { find: 'server-only', replacement: `${BACKEND}/tests/support/server-only-stub.ts` },
    ],
  },
  test: {
    include: ['tests/integration/**/*.test.ts'],
    globalSetup: [`${BACKEND}/tests/support/global-setup.ts`],
    env: TEST_ENV,
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 120000,
  },
})
