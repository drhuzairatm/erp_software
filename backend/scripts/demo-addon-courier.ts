/**
 * ADD-ON for an existing demo database (no reset): a clearly fictional [DEMO] courier delivery address per company.
 * Only inserts. Local databases only.   npm run demo:courier
 */
import postgres from 'postgres'
import { isLocalDatabase, loadEnv, requireEnv } from './lib/env'
import { demoCourierAddresses } from './lib/demo-courier'

loadEnv()
const url = requireEnv('DATABASE_ADMIN_URL')
if (!isLocalDatabase(url) || process.env.NODE_ENV === 'production') { console.error('Demo add-ons run on local databases only.'); process.exit(1) }
const sql = postgres(url, { max: 1, onnotice: () => {} })
try {
  const [md] = await sql<{ id: string }[]>`select id from user_profiles where email = 'md@demo.test'`
  if (!md) throw new Error('Demo users not found – this add-on is for the demo database.')
  console.log(`Added ${await demoCourierAddresses(sql)} demo courier address(es).`)
} finally {
  await sql.end()
}
