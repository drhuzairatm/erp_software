import { type ChildProcess, spawn } from 'node:child_process'
import path from 'node:path'

const BACKEND = path.resolve(import.meta.dirname, '../../../../backend')

/**
 * Starts the real Express API in a SEPARATE process (backend/tests/api/serve.ts, run with tsx exactly like `dev:api`),
 * so the API side uses its own request context (AsyncLocalStorage) and never this test's simulated Next.js cookie jar.
 * The child gets this process's environment (the throwaway test database settings) plus `env`; it does not read .env.
 * Points the Next.js side at it (API_INTERNAL_URL) until close().
 */
export async function startApiProcess(env: Record<string, string> = {}) {
  const child: ChildProcess = spawn(process.execPath, ['--conditions=react-server', '--import', 'tsx', 'tests/api/serve.ts'], {
    cwd: BACKEND, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const stderr: string[] = []
  child.stderr!.on('data', (c: Buffer) => stderr.push(c.toString()))
  const port = await new Promise<number>((resolve, reject) => {
    let out = ''
    const timer = setTimeout(() => reject(new Error(`API process did not start: ${stderr.join('').slice(0, 2000)}`)), 60_000)
    child.stdout!.on('data', (c: Buffer) => {
      out += c.toString()
      const line = out.split('\n')[0]
      if (out.includes('\n')) { clearTimeout(timer); resolve(JSON.parse(line).port) }
    })
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`API process exited (${code}): ${stderr.join('').slice(0, 2000)}`)) })
  })
  const base = `http://127.0.0.1:${port}`
  const previous = process.env.API_INTERNAL_URL
  process.env.API_INTERNAL_URL = base
  const close = () => new Promise<void>((resolve) => {
    if (process.env.API_INTERNAL_URL === base) { if (previous === undefined) delete process.env.API_INTERNAL_URL; else process.env.API_INTERNAL_URL = previous }
    if (child.exitCode !== null) return resolve()
    child.once('exit', () => resolve()); child.kill('SIGTERM')
  })
  return { base, stderr, close }
}
