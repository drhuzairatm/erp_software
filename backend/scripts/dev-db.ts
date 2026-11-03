/**
 * Runs a local PostgreSQL 17 server for development (no Docker or admin rights
 * needed). Data is kept in .data/pg. Stop it with Ctrl+C.
 */
import EmbeddedPostgres from 'embedded-postgres'
import postgres from 'postgres'
import { loadEnv, requireEnv } from './lib/env'
import { repoPath } from '../src/lib/repo-root'

loadEnv()
const adminUrl = new URL(requireEnv('DATABASE_ADMIN_URL'))
const port = Number(adminUrl.port || 5432)
const dbName = adminUrl.pathname.slice(1)

const pg = new EmbeddedPostgres({
  databaseDir: repoPath('.data', 'pg'),
  user: decodeURIComponent(adminUrl.username),
  password: decodeURIComponent(adminUrl.password),
  port,
  persistent: true,
  autoRehydrateSymlinks: true,
  onLog: () => {},
  postgresFlags: ['-c', 'listen_addresses=localhost'],
})

const { existsSync } = await import('node:fs')
if (!existsSync(repoPath('.data', 'pg', 'PG_VERSION'))) {
  console.log('Initialising local database cluster in .data/pg ...')
  await pg.initialise()
}
await pg.start()
const sql = postgres({ host: 'localhost', port, user: adminUrl.username, password: decodeURIComponent(adminUrl.password), database: 'postgres', max: 1, onnotice: () => {} })
const exists = await sql`select 1 from pg_database where datname = ${dbName}`
if (!exists.length) {
  await sql.unsafe(`create database "${dbName.replace(/"/g, '')}"`)
  console.log(`Created database ${dbName}`)
}
await sql.end()
console.log(`Local PostgreSQL running on localhost:${port} (database ${dbName}). Press Ctrl+C to stop.`)

const stop = async () => {
  await pg.stop()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
setInterval(() => {}, 1 << 30)
