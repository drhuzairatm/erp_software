import { type Page, expect } from '@playwright/test'
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
