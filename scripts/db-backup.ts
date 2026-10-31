/**
 * Database backup (logical dump, custom format) using the ADMIN connection.
 *   npm run db:backup            → backups/erp-YYYY-MM-DDTHH-MM.dump
 * Requires PostgreSQL client tools (pg_dump) matching the server major version (17):
 * on a Mac `brew install postgresql@17`; on Linux the postgresql-client-17 package.
 * Set PG_DUMP=/path/to/pg_dump if it is not on PATH. Store dumps encrypted and off-site
 * (see docs/BACKUP_RECOVERY.md); never commit them (the backups/ folder is git-ignored).
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { loadEnv, requireEnv } from './lib/env'

loadEnv()
const url = requireEnv('DATABASE_ADMIN_URL')
const bin = process.env.PG_DUMP || 'pg_dump'
const probe = spawnSync(bin, ['--version'], { encoding: 'utf8' })
if (probe.error || probe.status !== 0) {
  console.error(`pg_dump was not found (${bin}). Install PostgreSQL 17 client tools or set PG_DUMP. No backup was taken.`)
  process.exit(1)
}
mkdirSync('backups', { recursive: true, mode: 0o700 })
const file = `backups/erp-${new Date().toISOString().slice(0, 16).replace(/:/g, '-')}.dump`
const r = spawnSync(bin, ['--format=custom', '--no-owner', `--file=${file}`, url], { stdio: 'inherit' })
if (r.status !== 0) { console.error('pg_dump failed; no complete backup was written.'); process.exit(1) }
console.log(`Backup written to ${file}. Verify it with: pg_restore --list ${file}`)
