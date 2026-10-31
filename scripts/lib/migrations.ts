import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import postgres from 'postgres'

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'db/migrations')

export async function runMigrations(adminUrl: string, opts: { reset?: boolean; log?: (m: string) => void } = {}) {
  const log = opts.log ?? console.log
  const sql = postgres(adminUrl, { max: 1, onnotice: () => {} })
  try {
    if (opts.reset) {
      log('Resetting database schemas (public, app, auth_private)...')
      await sql.unsafe(`
        drop schema if exists app cascade;
        drop schema if exists auth_private cascade;
        drop schema if exists public cascade;
        create schema public;
      `)
    }
    await sql`create table if not exists public.schema_migrations (
      version text primary key, checksum text not null, applied_at timestamptz not null default now())`
    await sql`revoke all on public.schema_migrations from public`
    const applied = new Map((await sql<{ version: string; checksum: string }[]>`select version, checksum from public.schema_migrations`)
      .map((r) => [r.version, r.checksum]))
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort()
    let count = 0
    for (const file of files) {
      const body = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
      const checksum = createHash('sha256').update(body).digest('hex')
      const prev = applied.get(file)
      if (prev) {
        if (prev !== checksum) throw new Error(`Migration ${file} was modified after being applied. Create a new migration instead.`)
        continue
      }
      log(`Applying ${file}`)
      await sql.begin(async (tx) => {
        await tx.unsafe(body)
        await tx`insert into public.schema_migrations (version, checksum) values (${file}, ${checksum})`
      })
      count++
    }
    log(count ? `Applied ${count} migration(s).` : 'Database is up to date.')
  } finally {
    await sql.end()
  }
}

/** Give the application role a login password (it is created NOLOGIN by the migrations). */
export async function setAppRolePassword(adminUrl: string, password: string) {
  const sql = postgres(adminUrl, { max: 1, onnotice: () => {} })
  try {
    if (password.length < 16) throw new Error('APP_DB_PASSWORD must be at least 16 characters')
    await sql.unsafe(`alter role erp_app with login password '${password.replace(/'/g, "''")}'`)
  } finally {
    await sql.end()
  }
}
