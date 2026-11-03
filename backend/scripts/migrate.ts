/**
 * Apply database migrations using the ADMIN connection (DATABASE_ADMIN_URL).
 *   npm run db:migrate                         apply new migrations
 *   npm run db:migrate -- --reset              DROP EVERYTHING and re-apply (local databases only)
 *   npm run db:migrate -- --rollback 0018      undo migrations newer than or equal to 0018 (newest first)
 *                                              Non-local databases additionally need --confirm-rollback
 *                                              (take a backup first: npm run db:backup).
 */
import { isLocalDatabase, loadEnv, requireEnv } from './lib/env'
import { rollbackTo, runMigrations, setAppRolePassword } from './lib/migrations'

loadEnv()
const adminUrl = requireEnv('DATABASE_ADMIN_URL')
const reset = process.argv.includes('--reset')

if (reset && (!isLocalDatabase(adminUrl) || process.env.NODE_ENV === 'production')) {
  console.error('Refusing to reset a non-local or production database.')
  process.exit(1)
}

const rbIndex = process.argv.indexOf('--rollback')
if (rbIndex > -1) {
  const target = process.argv[rbIndex + 1]
  if (!target || !/^\d{4}$/.test(target)) { console.error('Usage: npm run db:migrate -- --rollback 0018'); process.exit(1) }
  if (process.env.NODE_ENV === 'production' || (!isLocalDatabase(adminUrl) && !process.argv.includes('--confirm-rollback'))) {
    console.error('Refusing to roll back a non-local database without --confirm-rollback (and never with NODE_ENV=production). Take a backup first.')
    process.exit(1)
  }
  await rollbackTo(adminUrl, target)
  process.exit(0)
}

await runMigrations(adminUrl, { reset })
if (process.env.APP_DB_PASSWORD) {
  await setAppRolePassword(adminUrl, process.env.APP_DB_PASSWORD)
  console.log('Application role erp_app can log in.')
}
