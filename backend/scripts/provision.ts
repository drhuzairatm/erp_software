/** Install organizations, default roles and reference data (safe to re-run). */
import { loadEnv, requireEnv } from './lib/env'
import { provision } from './lib/provision'

loadEnv()
await provision(requireEnv('DATABASE_ADMIN_URL'))
