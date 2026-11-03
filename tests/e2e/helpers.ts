import { type Page, expect } from '@playwright/test'
import { readdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import postgres from 'postgres'

process.loadEnvFile('.env')
export const PASSWORD = process.env.SEED_DEMO_PASSWORD!
/** A separate admin connection per test file (used only to look up fictional fixture ids). */
export const adminDb = () => postgres(process.env.DATABASE_ADMIN_URL!, { max: 1, onnotice: () => {} })

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.context().clearCookies()
  await page.goto('/login')
  await page.getByLabel('Work email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

/**
 * No virus scanner runs in development, so – as in production without a scanner – the demo MD gives MANUAL security
 * clearance (the real audited database function) to a document's current file before approval or courier release.
 */
export async function securityClearAsMd(admin: ReturnType<typeof adminDb>, documentId: string) {
  await admin.begin(async (tx) => {
    const [md] = await tx`select id from user_profiles where email = 'md@demo.test'`
    await tx`select set_config('app.user_id', ${md.id}, true)`
    const [f] = await tx`select f.id, f.scan_status from student_documents d join document_files f on f.id = coalesce(d.approved_file_id, d.current_file_id) where d.id = ${documentId}`
    if (f && (f.scan_status === 'not_scanned' || f.scan_status === 'scan_failed')) {
      await tx`select app.clear_file_manually(${f.id}, 'Fictional demo file – manual clearance for the e2e test (no scanner in development)')`
    }
  })
}

/**
 * N-8: in test mode sign-in codes and verification links are never stored. With NOTIFICATIONS_TEST_MAILBOX=1 (development
 * only) the dev server writes them to the local, owner-only test mailbox (.data/test-mailbox/). Waits for the newest
 * message of that kind to that (fictional) recipient written after `since`, removes the file and returns the body.
 * The app server must be started with NOTIFICATIONS_TEST_MAILBOX=1 (see docs/NOTIFICATIONS.md).
 */
const MAILBOX = path.resolve('.data/test-mailbox')
export async function fromTestMailbox(to: string, kind: 'portal_login_code' | 'email_verification', since: number, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    let files: string[] = []
    try { files = readdirSync(MAILBOX).filter((f) => f.endsWith('.json') && f.includes(kind)) } catch { /* not created yet */ }
    const hits = files.map((f) => ({ f, m: JSON.parse(readFileSync(path.join(MAILBOX, f), 'utf8')) as { to: string; body: string; at: string } }))
      .filter((x) => x.m.to.toLowerCase() === to.toLowerCase() && Date.parse(x.m.at) >= since - 1000)
      .sort((a, b) => Date.parse(b.m.at) - Date.parse(a.m.at))
    if (hits.length) {
      for (const h of hits) rmSync(path.join(MAILBOX, h.f), { force: true })
      return hits[0].m.body
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`No ${kind} message for the test recipient in the local test mailbox – is the dev server running with NOTIFICATIONS_TEST_MAILBOX=1?`)
}
export const codeFrom = (body: string) => body.match(/\b(\d{6})\b/)![1]
export const linkFrom = (body: string) => body.match(/https?:\/\/\S+\/verify-email\?token=[A-Za-z0-9_-]+/)![0]
