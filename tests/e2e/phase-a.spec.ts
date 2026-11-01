import { expect, test } from '@playwright/test'
import { totp } from '../../src/server/auth/mfa'
import { adminDb, login, PASSWORD } from './helpers'

const admin = adminDb()
test.afterAll(async () => { await admin.end() })

test('CEO sees operations and payment counts, never amounts or the ledger', async ({ page }) => {
  await login(page, 'ceo@demo.test')
  await page.getByLabel('Company').selectOption({ label: 'All my companies' })
  await expect(page.getByRole('heading', { name: 'Consolidated dashboard' })).toBeAttached()
  // management analytics: counts only, no amounts
  await expect(page.getByText('Revenue and payment amounts are shown to the MD and Accounts only.')).toBeVisible()
  expect(await page.locator('main').innerText()).not.toMatch(/₹/)
  // operations view: payment counts only
  await page.goto('/?view=operations')
  await expect(page.getByText('Students with fees outstanding', { exact: true })).toBeVisible()
  const main = await page.locator('main').innerText()
  expect(main).not.toMatch(/₹/)
  await expect(page.getByRole('link', { name: 'Payment ledger' })).toHaveCount(0)
  await page.goto('/payments')
  await expect(page.getByText('You do not have access to financial records.')).toBeVisible()
  expect((await page.request.get('/api/reports/balances')).status()).toBe(404)
  // A student profile has no Payments tab for the CEO
  const [s] = await admin`select id from students where is_demo limit 1`
  await page.goto(`/students/${s.id}`)
  await expect(page.getByRole('link', { name: 'Payments' })).toHaveCount(0)
})

test('MD sees financial amounts', async ({ page }) => {
  await login(page, 'md@demo.test')
  await page.getByLabel('Company').selectOption({ label: 'All my companies' })
  await expect(page.getByText(/Outstanding \(INR\)/)).toBeVisible() // management analytics
  await page.goto('/?view=operations')
  await expect(page.getByText(/Outstanding service fees/).first()).toBeVisible() // one card per currency
  await expect(page.getByRole('link', { name: 'Payment ledger' })).toBeVisible()
})

test('set up two-factor login, then sign in with a code', async ({ page }) => {
  const email = 'grd.counsellor2@demo.test'
  await admin`delete from auth_private.mfa where user_id = (select id from user_profiles where email = ${email})`
  await login(page, email)
  await page.goto('/account/security')
  await page.getByRole('button', { name: 'Set up two-factor login' }).click()
  await expect(page.getByAltText('QR code for your authenticator app')).toBeVisible()
  const secret = (await page.locator('p.font-mono').first().innerText()).replace(/\s/g, '')
  const step = Math.floor(Date.now() / 30000)
  await page.getByLabel('6-digit code from the app').fill(totp(secret, step - 1))
  await page.getByRole('button', { name: 'Turn on two-factor login' }).click()
  await expect(page.getByText('Save these recovery codes now')).toBeVisible()

  // Sign out and sign in again: password, then code
  await page.context().clearCookies()
  await page.goto('/login')
  await page.getByLabel('Work email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/login\/verify/)
  // Pending sign-in cannot reach the app or APIs
  expect((await page.request.get('/api/students/import-template')).status()).toBe(404)
  await page.getByLabel('Code').fill('000000')
  await page.getByRole('button', { name: 'Verify' }).click()
  await expect(page.getByText(/That code is not correct\. 4 attempts left/)).toBeVisible()
  await page.getByLabel('Code').fill(totp(secret, Math.floor(Date.now() / 30000)))
  await page.getByRole('button', { name: 'Verify' }).click()
  await expect(page.getByRole('heading', { name: /dashboard/ })).toBeVisible()
})
