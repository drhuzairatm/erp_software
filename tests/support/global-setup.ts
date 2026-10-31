import { rm } from 'node:fs/promises'
import EmbeddedPostgres from 'embedded-postgres'
import postgres from 'postgres'
import { runMigrations, setAppRolePassword } from '../../scripts/lib/migrations'
import { provision } from '../../scripts/lib/provision'
import { seedDemo } from '../../scripts/lib/seed-demo'

const DIR = '.data/pg-test'

export default async function setup() {
  const adminUrl = new URL(process.env.DATABASE_ADMIN_URL!)
  await rm(DIR, { recursive: true, force: true })
  await rm(process.env.STORAGE_LOCAL_DIR!, { recursive: true, force: true })
  const pg = new EmbeddedPostgres({
    databaseDir: DIR,
    user: adminUrl.username,
    password: decodeURIComponent(adminUrl.password),
    port: Number(adminUrl.port),
    persistent: false,
    autoRehydrateSymlinks: true,
    onLog: () => {},
    postgresFlags: ['-c', 'listen_addresses=localhost', '-c', 'fsync=off'],
  })
  await pg.initialise()
  await pg.start()
  const sql = postgres({ host: 'localhost', port: Number(adminUrl.port), user: adminUrl.username,
    password: decodeURIComponent(adminUrl.password), database: 'postgres', max: 1, onnotice: () => {} })
  await sql.unsafe('create database erp_test')
  await sql.end()
  const quiet = () => {}
  await runMigrations(adminUrl.toString(), { log: quiet })
  await setAppRolePassword(adminUrl.toString(), process.env.APP_DB_PASSWORD!)
  await provision(adminUrl.toString(), quiet)
  await seedDemo(adminUrl.toString(), process.env.SEED_DEMO_PASSWORD!, quiet)
  return async () => {
    await pg.stop()
    await rm(process.env.STORAGE_LOCAL_DIR!, { recursive: true, force: true })
  }
}
