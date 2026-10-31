/**
 * Load FICTIONAL demo data. Refuses to run against production. For a remote
 * staging database set SEED_ALLOW_REMOTE=true explicitly.
 */
import { isLocalDatabase, loadEnv, requireEnv } from './lib/env'
import { provision } from './lib/provision'
import { seedDemo } from './lib/seed-demo'

loadEnv()
const adminUrl = requireEnv('DATABASE_ADMIN_URL')
if (process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production') {
  console.error('Refusing to load demo data into a production environment.')
  process.exit(1)
}
if (!isLocalDatabase(adminUrl) && process.env.SEED_ALLOW_REMOTE !== 'true') {
  console.error('Database is not local. Set SEED_ALLOW_REMOTE=true to seed a staging database.')
  process.exit(1)
}
const password = requireEnv('SEED_DEMO_PASSWORD')
await provision(adminUrl)
await seedDemo(adminUrl, password)
