import 'server-only'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { repoPath } from '../repo-root'

/**
 * Local test mailbox (finding N-8; development and automated tests ONLY).
 *
 * In test mode, sign-in codes and email-verification links are not delivered and never stored. To let developers and the
 * browser tests complete these flows with FICTIONAL accounts, the rendered message can be written to a local folder
 * instead: .data/test-mailbox/ (git-ignored), folder 0700, files 0600 (owner only).
 *
 * Enabled only when NODE_ENV !== 'production' AND NOTIFICATIONS_TEST_MAILBOX=1. Production builds and production
 * startup refuse it (see src/server/config/notifications-config.ts). It is never in the database and never visible to
 * staff (no API, no Messages page).
 */
export const TEST_MAILBOX_DIR = repoPath('.data', 'test-mailbox')

export function testMailboxEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.NODE_ENV !== 'production' && env.NOTIFICATIONS_TEST_MAILBOX === '1'
}

export function writeTestMailbox(m: { kind: string; channel: string; to: string; subject: string | null; body: string }) {
  if (!testMailboxEnabled()) return false
  mkdirSync(TEST_MAILBOX_DIR, { recursive: true, mode: 0o700 })
  chmodSync(TEST_MAILBOX_DIR, 0o700)
  const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${m.kind}-${Math.random().toString(36).slice(2, 10)}.json`
  writeFileSync(path.join(TEST_MAILBOX_DIR, name), JSON.stringify({ ...m, at: new Date().toISOString() }), { mode: 0o600, flag: 'wx' })
  return true
}
