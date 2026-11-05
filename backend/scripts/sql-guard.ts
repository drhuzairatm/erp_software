/**
 * SQL security guard. Read-only: it reports, and it changes nothing.
 *   npm run guard:sql                     every source file, and migrations after the last reviewed one
 *   npm run guard:sql -- --changed REF    only files changed since a local git ref (never fetches)
 * Exits 1 if a finding is not in sql-guard.baseline.json. A baseline entry needs a written reason.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { type BaselineEntry, type Finding, scanSql, scanTypeScript, sqlFileInScope, withoutBaseline } from './lib/sql-guard'

const ROOT = path.resolve(import.meta.dirname, '../..')
const SOURCE_DIRS = ['backend/src', 'frontend/src']
const SQL_DIRS = ['backend/db/migrations', 'backend/db/rollbacks']

const walk = (dir: string): string[] => readdirSync(path.join(ROOT, dir)).flatMap((name) => {
  const rel = `${dir}/${name}`
  return statSync(path.join(ROOT, rel)).isDirectory() ? walk(rel) : [rel]
})
const isSource = (f: string) => SOURCE_DIRS.some((d) => f.startsWith(d + '/')) && /\.tsx?$/.test(f) && !f.endsWith('.d.ts')
const isSql = (f: string) => SQL_DIRS.some((d) => f.startsWith(d + '/')) && f.endsWith('.sql') && sqlFileInScope(f)

function changedFiles(ref: string) {
  const git = (...a: string[]) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)
  return [...git('diff', '--name-only', ref), ...git('ls-files', '--others', '--exclude-standard')].filter((f) => existsSync(path.join(ROOT, f)))
}

const at = process.argv.indexOf('--changed')
const changedOnly = at > -1
if (changedOnly && !process.argv[at + 1]) { console.error('Usage: npm run guard:sql -- --changed <local git ref>'); process.exit(2) }
const files = changedOnly ? changedFiles(process.argv[at + 1]!) : [...SOURCE_DIRS, ...SQL_DIRS].flatMap(walk)

const found: Finding[] = []
for (const f of new Set(files)) {
  if (isSource(f)) found.push(...scanTypeScript(f, readFileSync(path.join(ROOT, f), 'utf8')))
  else if (isSql(f)) found.push(...scanSql(f, readFileSync(path.join(ROOT, f), 'utf8')))
}

const baseline = JSON.parse(readFileSync(path.join(import.meta.dirname, 'sql-guard.baseline.json'), 'utf8')) as BaselineEntry[]
const { unapproved, stale } = withoutBaseline(found, baseline)
const scanned = [...new Set(files)].filter((f) => isSource(f) || isSql(f)).length

console.log(`SQL guard: ${scanned} files, ${found.length} findings, ${found.length - unapproved.length} approved in the baseline, ${unapproved.length} not approved.`)
for (const f of unapproved) console.log(`\n${f.rule} ${f.file}:${f.line}\n  ${f.message}\n  ${f.code}`)
if (!changedOnly) for (const b of stale) console.log(`\nStale baseline entry, no longer found: ${b.rule} ${b.file}: ${b.code}`)
process.exit(unapproved.length || (!changedOnly && stale.length) ? 1 : 0)
