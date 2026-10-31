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
