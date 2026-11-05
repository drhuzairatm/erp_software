/**
 * Browser tests on a throwaway stack: the test PostgreSQL instance (port 54339, fictional seed), the internal API and
 * Next.js in development mode. Used by CI and locally. It never touches the development
 * database: it refuses to start unless every database URL is the throwaway one, or if ports 3000 or 4000 are already taken
 * (Playwright would otherwise test whichever server is already running).
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { rmSync } from 'node:fs'
import { createConnection } from 'node:net'
import path from 'node:path'
import setup from '../tests/support/global-setup.ts'
import { TEST_ENV } from '../tests/support/test-env.ts'

const ROOT = path.resolve(import.meta.dirname, '../..')
const NEXT_DEV_CACHE = path.join(ROOT, 'frontend/.next/dev')

Object.assign(process.env, TEST_ENV, { MFA_ENFORCE: 'off', NOTIFICATIONS_MODE: 'test', NOTIFICATIONS_TEST_MAILBOX: '1' })
for (const k of ['DATABASE_URL', 'DATABASE_ADMIN_URL']) {
  if (!process.env[k]!.includes('localhost:54339/erp_test')) throw new Error(`Refusing to run: ${k} is not the throwaway database.`)
}

const portInUse = (port: number) => new Promise<boolean>((resolve) => {
  const c = createConnection({ port, host: 'localhost' })
  c.once('connect', () => { c.destroy(); resolve(true) })
  c.once('error', () => resolve(false))
})
for (const port of [3000, 4000]) if (await portInUse(port)) throw new Error(`Refusing to run: port ${port} is already in use. Stop that server first.`)

const start = (script: string): ChildProcess => spawn('npm', ['run', script], { cwd: ROOT, stdio: 'inherit', detached: true })
const run = (script: string) => new Promise<number>((resolve) => {
  spawn('npm', ['run', script], { cwd: ROOT, stdio: 'inherit' }).once('exit', (code) => resolve(code ?? 1))
})
async function healthy() {
  for (let i = 0; i < 120; i++) {
    const ok = await fetch('http://localhost:3000/api/health').then((r) => r.status === 200, () => false)
    if (ok) return true
    await new Promise((r) => setTimeout(r, 2000))
  }
  return false
}

rmSync(NEXT_DEV_CACHE, { recursive: true, force: true }) // a stale development build causes a reload loop in the browser
const stopDatabase = await setup()
const servers = [start('dev:api'), start('dev')]
let exitCode = 1
try {
  if (await healthy()) exitCode = await run('test:e2e')
  else console.error('The application did not become healthy.')
} finally {
  for (const s of servers) { try { process.kill(-s.pid!, 'SIGTERM') } catch { /* already stopped */ } }
  await new Promise((r) => setTimeout(r, 1500))
  await stopDatabase?.()
  rmSync(NEXT_DEV_CACHE, { recursive: true, force: true })
}
process.exit(exitCode)
