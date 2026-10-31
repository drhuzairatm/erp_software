/**
 * Apply database migrations using the ADMIN connection (DATABASE_ADMIN_URL).
 *   npm run db:migrate            apply new migrations
 *   npm run db:migrate -- --reset DROP EVERYTHING and re-apply (local databases only)
 */
import { isLocalDatabase, loadEnv, requireEnv } from './lib/env'
import { runMigrations, setAppRolePassword } from './lib/migrations'

loadEnv()
const adminUrl = requireEnv('DATABASE_ADMIN_URL')
const reset = process.argv.includes('--reset')

if (reset && (!isLocalDatabase(adminUrl) || process.env.NODE_ENV === 'production')) {
  console.error('Refusing to reset a non-local or production database.')
  process.exit(1)
}

await runMigrations(adminUrl, { reset })
if (process.env.APP_DB_PASSWORD) {
  await setAppRolePassword(adminUrl, process.env.APP_DB_PASSWORD)
  console.log('Application role erp_app can log in.')
}
