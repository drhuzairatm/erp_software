import path from 'node:path'
import { defineConfig } from 'vitest/config'

// A dedicated, throwaway PostgreSQL instance is started for tests
// (see tests/support/global-setup.ts). These credentials are test-only.
const TEST_ENV = {
  DATABASE_URL: 'postgres://erp_app:test-app-password-0123456789@localhost:54339/erp_test',
  DATABASE_ADMIN_URL: 'postgres://postgres:test-admin-password-0123456789@localhost:54339/erp_test',
  APP_DB_PASSWORD: 'test-app-password-0123456789',
  STORAGE_DRIVER: 'local',
  STORAGE_LOCAL_DIR: '.data/storage-test',
  STORAGE_SIGNING_SECRET: 'test-signing-secret-0123456789-abcdefghij',
  SEED_DEMO_PASSWORD: 'Test-Demo-Passw0rd!',
  APP_URL: 'http://localhost:3000',
  MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  MFA_ENFORCE: 'roles',
}

// Also apply to the main process so global setup uses the test database.
Object.assign(process.env, TEST_ENV)

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      'server-only': path.resolve(import.meta.dirname, 'tests/support/server-only-stub.ts'),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    globalSetup: ['tests/support/global-setup.ts'],
    env: TEST_ENV,
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 120000,
  },
})
