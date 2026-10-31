import { existsSync } from 'node:fs'
import path from 'node:path'

/** Load .env (if present) for command-line scripts. Real env vars win. */
export function loadEnv() {
  const file = path.resolve(process.cwd(), '.env')
  if (existsSync(file)) process.loadEnvFile(file)
}

export function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) {
    console.error(`Missing required environment variable ${name}. See .env.example.`)
    process.exit(1)
  }
  return v
}

/** True if a postgres URL points at this machine. */
export function isLocalDatabase(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '::1'
  } catch {
    return false
  }
}
