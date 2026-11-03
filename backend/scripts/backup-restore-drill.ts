/**
 * Backup → restore drill in a SEPARATE, ISOLATED PostgreSQL instance (Phase C).
 *
 *   npx tsx scripts/backup-restore-drill.ts            (development / staging only – never production)
 *
 * 1. Physical online backup of the running database with PostgreSQL's low-level API
 *    (pg_backup_start → copy data directory → pg_backup_stop → WAL + backup_label), plus a copy of file storage.
 * 2. A post-backup marker is written to the SOURCE to prove the restore point.
 * 3. The copy is started as a different server (own folder, own port 54398) – the source is never touched.
 * 4. Verification: row counts and content checksums of every table, migrations, security objects (RLS, policies,
 *    triggers, functions), referential integrity of every foreign key, the application role and RLS, the
 *    append-only audit log, and every stored file (exists + SHA-256 matches the database).
 * 5. The isolated instance is stopped and its copy deleted. A report is written to docs/BACKUP_RESTORE_DRILL.md
 *    (counts and hashes only – no personal data).
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import postgres from 'postgres'
import { loadEnv, requireEnv } from './lib/env'
import { repoPath, repoRoot } from '../src/server/repo-root'

loadEnv()
const SRC_URL = new URL(requireEnv('DATABASE_ADMIN_URL'))
const APP_URL = new URL(requireEnv('DATABASE_URL'))
if (!['localhost', '127.0.0.1'].includes(SRC_URL.hostname) || process.env.NODE_ENV === 'production') {
  console.error('Refusing to run: this drill is for a local development/staging database only.'); process.exit(1)
}
const DB = SRC_URL.pathname.slice(1)
const PORT = 54398
const DRILL = repoPath('.data', 'restore-drill')
const PG_BIN = path.resolve('node_modules/@embedded-postgres/darwin-arm64/native/bin')
const STORAGE = path.resolve(repoRoot(), process.env.STORAGE_LOCAL_DIR || '.data/storage')
const t0 = Date.now()
const log = (m: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`)
const results: { check: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail = '') => { results.push({ check: name, ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' – ' + detail : ''}`) }
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

type Sql = postgres.Sql
/** Fingerprint: per-table row count + content hash (ordered by every column), and security-object counts. */
async function fingerprint(sql: Sql) {
  const tables = await sql<{ s: string; t: string }[]>`select table_schema as s, table_name as t from information_schema.tables
    where table_type = 'BASE TABLE' and table_schema in ('public', 'auth_private') order by 1, 2`
  const rows: Record<string, { n: number; h: string }> = {}
  for (const { s, t } of tables) {
    const [r] = await sql.unsafe(`select count(*)::int as n, coalesce(md5(string_agg(x::text, '|' order by x::text)), '') as h from "${s}"."${t}" x`)
    rows[`${s}.${t}`] = { n: r.n, h: r.h }
  }
  const [objs] = await sql`select
    (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity) as rls_tables,
    (select count(*)::int from pg_policies where schemaname = 'public') as policies,
    (select count(*)::int from pg_trigger where not tgisinternal) as triggers,
    (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app') as app_functions,
    (select count(*)::int from pg_roles where rolname = 'erp_app' and rolcanlogin and not rolbypassrls) as app_role`
  return { rows, objs }
}

async function main() {
  if (!existsSync(path.join(PG_BIN, 'pg_ctl'))) throw new Error('PostgreSQL server binaries not found')
  await rm(DRILL, { recursive: true, force: true })
  await mkdir(DRILL, { recursive: true, mode: 0o700 })
  const src = postgres(SRC_URL.toString(), { max: 2, onnotice: () => {} })
  const [{ dir }] = await src`select current_setting('data_directory') as dir`
  const sizeOf = async (p: string) => Number((spawnSync('du', ['-sk', p], { encoding: 'utf8' }).stdout.split('\t')[0] || 0)) * 1024

  // ---- 1. online physical backup ------------------------------------------------------------
  log(`backup of ${DB} (data directory ${dir}) starting`)
  const conn = await src.reserve()
  const [{ start }] = await conn`select pg_backup_start('phase-c-restore-drill', true)::text as start`
  await cp(dir, path.join(DRILL, 'pgdata'), { recursive: true, filter: (f) => !/postmaster\.(pid|opts)$/.test(f) })
  if (existsSync(STORAGE)) await cp(STORAGE, path.join(DRILL, 'storage'), { recursive: true })
  const before = await fingerprint(src)
  const [stop] = await conn<{ lsn: string; labelfile: string; spcmapfile: string }[]>`select lsn::text, labelfile, spcmapfile from pg_backup_stop(false)`
  conn.release()
  await rm(path.join(DRILL, 'pgdata', 'pg_wal'), { recursive: true, force: true })
  await cp(path.join(dir, 'pg_wal'), path.join(DRILL, 'pgdata', 'pg_wal'), { recursive: true }) // WAL up to the stop point
  await writeFile(path.join(DRILL, 'pgdata', 'backup_label'), stop.labelfile)
  if (stop.spcmapfile) await writeFile(path.join(DRILL, 'pgdata', 'tablespace_map'), stop.spcmapfile)
  const backupBytes = await sizeOf(path.join(DRILL, 'pgdata'))
  const storageBytes = existsSync(path.join(DRILL, 'storage')) ? await sizeOf(path.join(DRILL, 'storage')) : 0
  log(`backup complete: WAL ${start} → ${stop.lsn}; database copy ${(backupBytes / 1048576).toFixed(1)} MB, files ${(storageBytes / 1048576).toFixed(1)} MB`)
  const tBackup = Date.now() - t0

  // ---- 2. change the SOURCE after the backup (must NOT appear in the restore) -------------------
  const marker = `restore-drill-${Date.now()}`
  await src`select app.audit('backup_restore_drill_marker', 'drill', ${marker})`

  // ---- 3. restore into an isolated instance -----------------------------------------------------
  const tRestore0 = Date.now()
  const startRes = spawnSync(path.join(PG_BIN, 'pg_ctl'), ['-D', path.join(DRILL, 'pgdata'), '-l', path.join(DRILL, 'restore.log'), '-w', '-t', '120',
    '-o', `-p ${PORT} -c listen_addresses=localhost -c archive_mode=off`, 'start'], { encoding: 'utf8' })
  if (startRes.status !== 0) throw new Error('restored server did not start:\n' + startRes.stdout + startRes.stderr + (await readFile(path.join(DRILL, 'restore.log'), 'utf8').catch(() => '')))
  const restoreLog = await readFile(path.join(DRILL, 'restore.log'), 'utf8')
  log('isolated instance started on port ' + PORT)
  const rUrl = new URL(SRC_URL.toString()); rUrl.port = String(PORT)
  const res = postgres(rUrl.toString(), { max: 2, onnotice: () => {} })
  try {
    // ---- 4. verification ---------------------------------------------------------------------
    check('restored server replayed the backup WAL and reached a consistent state', /consistent recovery state reached|database system is ready to accept connections/.test(restoreLog),
      (restoreLog.match(/redo (starts|done) at [^\n]*/g) ?? []).join('; '))
    const [{ inrec }] = await res`select pg_is_in_recovery() as inrec`
    check('restored database is open for normal use (not stuck in recovery)', !inrec)
    const after = await fingerprint(res)
    const tables = Object.keys(before.rows)
    const diffs = tables.filter((t) => before.rows[t].n !== after.rows[t]?.n || before.rows[t].h !== after.rows[t]?.h)
    check(`all ${tables.length} tables restored with identical row counts and content hashes`, diffs.length === 0, diffs.length ? 'differences: ' + diffs.join(', ') : '')
    const key = ['students', 'student_documents', 'document_files', 'payment_entries', 'student_assignments', 'organization_memberships', 'organizations',
      'roles', 'role_permissions', 'user_profiles', 'tasks', 'audit_logs', 'security_alerts', 'portal_publications', 'original_shipments']
    for (const t of key) {
      const b = before.rows[`public.${t}`], a = after.rows[`public.${t}`]
      if (b) check(`${t}: ${b.n} rows, content identical`, !!a && a.n === b.n && a.h === b.h, `hash ${b.h.slice(0, 12)}…`)
    }
    check('credentials and sessions (auth_private) restored', ['auth_private.credentials', 'auth_private.mfa'].every((t) => before.rows[t]?.h === after.rows[t]?.h))
    check('security objects restored (RLS, policies, triggers, app functions, application role)', JSON.stringify(before.objs) === JSON.stringify(after.objs), JSON.stringify(after.objs))
    const [{ migrations }] = await res`select string_agg(version, ',' order by version) as migrations from schema_migrations`.catch(async () => [{ migrations: 'n/a' }])
    check('migration history restored (latest 0033)', String(migrations).includes('0033'), String(migrations).split(',').slice(-3).join(','))
    const [{ m }] = await res`select count(*)::int as m from audit_logs where entity_id = ${marker}`
    check('restore point is exact: a change made AFTER the backup is absent', m === 0, marker)

    // payments and balances: totals per company and ledger match the source
    const bal = (s: Sql) => s`select org_id::text, ledger, currency, sum(amount_due)::text as due, sum(amount_received)::text as rec, sum(outstanding)::text as out, count(*)::int as n from student_balances group by 1, 2, 3 order by 1, 2, 3`
    const bs = await bal(src), br = await bal(res)
    check(`payment balances identical (${br.length} company/ledger/currency groups: due, received, outstanding)`, JSON.stringify(bs) === JSON.stringify(br))
    // referential integrity of every foreign key
    const fks = await res<{ tbl: string; ref: string; cols: string[]; rcols: string[] }[]>`
      select c.conrelid::regclass::text as tbl, c.confrelid::regclass::text as ref,
             array(select a.attname from unnest(c.conkey) with ordinality k(n, i) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n order by k.i)::text[] as cols,
             array(select a.attname from unnest(c.confkey) with ordinality k(n, i) join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.n order by k.i)::text[] as rcols
        from pg_constraint c join pg_namespace n on n.oid = c.connamespace where c.contype = 'f' and n.nspname in ('public', 'auth_private')`
    const orphans: string[] = []
    for (const f of fks) {
      const notNull = f.cols.map((c) => `x."${c}" is not null`).join(' and ')
      const join = f.cols.map((c, i) => `p."${f.rcols[i]}" = x."${c}"`).join(' and ')
      const [o] = await res.unsafe(`select count(*)::int as n from ${f.tbl} x where ${notNull} and not exists (select 1 from ${f.ref} p where ${join})`)
      if (o.n) orphans.push(`${f.tbl}(${f.cols}) → ${f.ref}: ${o.n}`)
    }
    check(`referential integrity: ${fks.length} foreign keys, no orphaned rows`, orphans.length === 0, orphans.join('; '))
    // company relationships: every student's company and every membership points to an existing company and role of that company
    const [{ bad }] = await res`select count(*)::int as bad from organization_memberships m join roles r on r.id = m.role_id where r.org_id <> m.org_id`
    check('company relationships consistent (each membership role belongs to its company)', bad === 0)
    const [{ asg }] = await res`select count(*)::int as asg from student_assignments a where not app.student_has_org(a.student_id, a.org_id)`
    check('staff assignments consistent (assignment company has access to the student)', asg === 0)

    // application role + row-level security work on the restored database
    const appUrl = new URL(APP_URL.toString()); appUrl.port = String(PORT)
    const app = postgres(appUrl.toString(), { max: 1, onnotice: () => {} })
    try {
      const [{ n }] = await app`select count(*)::int as n from students`
      check('application role can log in; without a user context RLS returns no student rows', n === 0)
      const keyRead = await app`select storage_key from document_files limit 1`.then(() => 'readable', (e) => e.code)
      check('storage keys remain unreadable to the application role', keyRead === '42501', String(keyRead))
    } finally { await app.end() }
    const tamper = await res`update audit_logs set action = 'tampered' where id = (select min(id) from audit_logs)`.then(() => 'changed', (e) => e.message)
    check('audit log is still append-only after restore (owner cannot modify it)', tamper !== 'changed', String(tamper).slice(0, 80))

    // files: every stored object referenced by the restored database exists in the restored storage copy and matches
    const refs = await res<{ k: string; h: string | null; what: string }[]>`
      select storage_key as k, sha256 as h, 'document' as what from document_files
      union all select storage_key, sha256, 'attestation evidence' from attestation_step_files
      union all select unnest(array[original_key, portrait_key, thumb_key]), null, 'student photo' from student_photos where is_current
      union all select unnest(array[original_key, display_key, thumb_key]), null, 'staff photo' from staff_photos where is_current`
    // replaced photo versions: their files are deleted on replacement BY DESIGN (STUDENT_PHOTOS.md); only the history row remains
    const [{ replaced }] = await res`select ((select count(*) from student_photos where not is_current) + (select count(*) from staff_photos where not is_current))::int as replaced`
    let missing = 0, missingAtSource = 0, mismatch = 0, verified = 0
    for (const r of refs) {
      const p = path.join(DRILL, 'storage', r.k)
      if (!existsSync(p)) { missing++; if (!existsSync(path.join(STORAGE, r.k))) missingAtSource++; continue }
      if (r.h) { if (sha(await readFile(p)) !== r.h) mismatch++; else verified++ } else if ((await stat(p)).size > 0) verified++
    }
    check(`stored files: ${refs.length} referenced, ${verified} present and verified (SHA-256 where recorded)`, missing - missingAtSource === 0 && mismatch === 0,
      `missing in backup copy: ${missing - missingAtSource}; checksum mismatches: ${mismatch}; missing already at the source: ${missingAtSource}; replaced photo versions whose files were deleted by design (not counted): ${replaced}`)
    check('no live file is missing at the source either (documents, attestation evidence, current photos)', missingAtSource === 0, String(missingAtSource))

    const tRestore = Date.now() - tRestore0
    const ok = results.every((r) => r.ok)
    const counts = key.filter((t) => before.rows[`public.${t}`]).map((t) => `| ${t} | ${before.rows[`public.${t}`].n} | ${after.rows[`public.${t}`]?.n} | \`${before.rows[`public.${t}`].h.slice(0, 16)}\` |`)
    await writeFile(repoPath('docs', 'BACKUP_RESTORE_DRILL.md'), `# Backup → restore drill (Phase C) – ${new Date().toISOString()}

**Result: ${ok ? 'PASSED' : 'FAILED'}** (${results.filter((r) => r.ok).length}/${results.length} checks)

- **Source:** local development database \`${DB}\` with fictional demo/test data only (no real student data).
- **Method:** PostgreSQL online physical backup (low-level API \`pg_backup_start\`/\`pg_backup_stop\`, WAL ${start} → ${stop.lsn}), plus a copy of file storage.
- **Restore target:** a separate PostgreSQL 17 instance (own data folder \`.data/restore-drill\`, own port ${PORT}). The source was never modified, apart from one audit marker written after the backup to prove the restore point.
- **Size:** database copy ${(backupBytes / 1048576).toFixed(1)} MB, files ${(storageBytes / 1048576).toFixed(1)} MB.
- **Timing:** backup ${(tBackup / 1000).toFixed(1)} s; restore + start + full verification ${(tRestore / 1000).toFixed(1)} s.
- **Cleanup:** the restored copy was deleted after verification.

## Checks
| Check | Result | Detail |
|---|---|---|
${results.map((r) => `| ${r.check} | ${r.ok ? 'PASS' : 'FAIL'} | ${r.detail.replace(/\|/g, '/')} |`).join('\n')}

## Key tables (source at backup time vs restored)
| Table | Source rows | Restored rows | Content hash (identical in both) |
|---|---|---|---|
${counts.join('\n')}

## What this does and does not prove
- **Proves:** a consistent online backup of the running database, together with its files, restores into an isolated server. That includes every row, security rules, the application role, the audit log and files, with nothing missing or corrupted.
- **Production backups differ:** they use the hosting provider's backups (e.g. Supabase daily / PITR), and \`pg_dump\` copies are kept off-site, as described in BACKUP_RECOVERY.md. Those must be restore-tested the same way on **staging** once hosting exists.
- **\`pg_dump\`/\`pg_restore\` not tested:** these command-line tools are not installed on this computer. Downloading them was not permitted in this session.
`)
    log(`report written to docs/BACKUP_RESTORE_DRILL.md – ${ok ? 'PASSED' : 'FAILED'}`)
    if (!ok) process.exitCode = 1
  } finally {
    await res.end().catch(() => {})
    spawnSync(path.join(PG_BIN, 'pg_ctl'), ['-D', path.join(DRILL, 'pgdata'), '-m', 'fast', '-w', 'stop'], { encoding: 'utf8' })
    await src.end()
    await rm(DRILL, { recursive: true, force: true })
    log('isolated instance stopped and its copy deleted')
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1 })
