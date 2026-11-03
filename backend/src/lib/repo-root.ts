import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * The repository root: the folder whose package.json declares the npm workspaces (frontend/ and backend/).
 * Local development data (.data/: database, file storage, test mailbox), the .env file and docs/ live there.
 *
 * Commands run from frontend/, backend/ or the root (npm workspaces start scripts in the workspace folder), so paths that
 * used to be relative to the working directory are resolved from here instead. If no workspace root is found (for
 * example a deployment that contains only the app folder), the working directory is used, as before.
 */
let cached: string | undefined

export function repoRoot(): string {
  if (cached) return cached
  const start = path.resolve(/*turbopackIgnore: true*/ process.cwd())
  let dir = start
  for (;;) {
    const pkg = path.join(dir, 'package.json')
    if (existsSync(pkg)) {
      try {
        if (Array.isArray(JSON.parse(readFileSync(pkg, 'utf8')).workspaces)) return (cached = dir)
      } catch { /* unreadable package.json: keep looking */ }
    }
    const parent = path.dirname(dir)
    if (parent === dir) return (cached = start)
    dir = parent
  }
}

/** A path inside the repository root, e.g. repoPath('.data', 'pg'). */
export function repoPath(...parts: string[]): string {
  // runtime-only location (local development data, .env, docs): never traced into a production build
  return path.join(/*turbopackIgnore: true*/ repoRoot(), ...parts)
}
