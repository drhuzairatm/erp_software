import path from 'node:path'

/**
 * Test-only settings for the dedicated, throwaway PostgreSQL instance started for each test run
 * (tests/support/global-setup.ts: .data/pg-test, port 54339, fictional seed). Never the development database.
 * Shared by backend/vitest.config.ts and frontend/vitest.config.ts. These credentials are test-only.
 */
export const TEST_ENV = {
  DATABASE_URL: 'postgres://erp_app:test-app-password-0123456789@localhost:54339/erp_test',
  DATABASE_ADMIN_URL: 'postgres://postgres:test-admin-password-0123456789@localhost:54339/erp_test',
  APP_DB_PASSWORD: 'test-app-password-0123456789',
  STORAGE_DRIVER: 'local',
  // absolute, so the same folder is used whichever workspace runs the tests (repository root .data/storage-test)
  STORAGE_LOCAL_DIR: path.resolve(import.meta.dirname, '../../../.data/storage-test'),
  STORAGE_SIGNING_SECRET: 'test-signing-secret-0123456789-abcdefghij',
  SEED_DEMO_PASSWORD: 'Test-Demo-Passw0rd!',
  APP_URL: 'http://localhost:3000',
  MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  MFA_ENFORCE: 'roles',
  // internal API credential (test-only value): used by the Next.js-side proxy and the Express API in tests
  INTERNAL_API_SECRET: 'test-internal-api-secret-0123456789-abcdefghij',
}
