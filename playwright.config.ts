import { defineConfig } from '@playwright/test'

/**
 * End-to-end tests run against the local app with the FICTIONAL demo data
 * (npm run db:reset). Uses the installed Google Chrome.
 * Start the app first (npm run dev) or let Playwright start it.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000', channel: 'chrome', headless: true, screenshot: 'only-on-failure' },
  webServer: { command: 'npm run dev', url: 'http://localhost:3000/api/health', reuseExistingServer: true, timeout: 120_000 },
})
