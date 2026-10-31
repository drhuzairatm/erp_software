import { expect, test } from '@playwright/test'
import { login } from './helpers'

async function register(page: import('@playwright/test').Page, name: string, country: string, passportExpiry: string) {
  await page.goto('/students/new')
  const n = Date.now().toString().slice(-5)
  await page.getByLabel('Full name (as on passport) *').fill(`${name} ${n}`)
  await page.getByLabel('Primary phone', { exact: true }).fill(`98763 ${n}`)
  await page.getByLabel('Destination country').selectOption({ label: country })
  await page.getByLabel('Passport number').fill(`AL${n}`)
  await page.getByLabel('Expiry date').fill(passportExpiry)
  return n
}

test('Bulgaria notice appears on country selection and on the profile; acknowledgement is recorded; registration is not blocked', async ({ page }) => {
  await login(page, 'edx.manager@demo.test')
  await page.getByLabel('Company').selectOption({ label: 'Dr.Expert Edulinks' })
  await register(page, 'Notice Test', 'Bulgaria', '2033-01-01')
  const notice = page.locator('section, details').filter({ hasText: 'BULGARIA – IMPORTANT ACADEMIC REQUIREMENTS' }).first()
  await expect(notice).toBeVisible()
  await expect(notice.getByText('Important warning')).toBeVisible()
  await expect(notice.getByText(/Chemistry/)).toBeVisible()
  await page.getByRole('button', { name: 'Register student' }).click()
  await expect(page.getByText(/Student registered with ID/)).toBeVisible()
  const card = page.getByRole('region', { name: 'Needs attention' }).locator('section').filter({ hasText: 'BULGARIA' })
  await expect(card.getByText('Academic information missing')).toBeVisible()
  await expect(card.getByText('Acknowledgement pending')).toBeVisible()
  await card.getByRole('button', { name: 'Acknowledge' }).click()
  await expect(page.getByText(/Requirements acknowledged by Rahul Nair/)).toBeVisible()
  // the notice stays visible on other tabs
  await page.getByRole('link', { name: 'Documents', exact: true }).click()
  await expect(page.getByText('BULGARIA – IMPORTANT ACADEMIC REQUIREMENTS')).toBeVisible()
})

test('red alert for an expired passport, amber for less than 12 months — registration still works', async ({ page }) => {
  await login(page, 'edx.manager@demo.test')
  await page.getByLabel('Company').selectOption({ label: 'Dr.Expert Edulinks' })
  await register(page, 'Expired Passport', 'Georgia', '2026-01-15')
  await page.getByRole('button', { name: 'Register student' }).click()
  await expect(page.getByText(/Student registered with ID/)).toBeVisible()
  const red = page.getByRole('alert').filter({ hasText: 'PASSPORT EXPIRED – URGENT RENEWAL REQUIRED' })
  await expect(red).toBeVisible()
  await expect(red.getByText('Critical', { exact: true })).toBeVisible()
  const soon = new Date(Date.now() + 250 * 86400000).toISOString().slice(0, 10)
  await register(page, 'Short Passport', 'Georgia', soon)
  await page.getByRole('button', { name: 'Register student' }).click()
  await expect(page.getByText(/Student registered with ID/)).toBeVisible()
  const amber = page.getByRole('region', { name: 'Needs attention' }).locator('section').filter({ hasText: 'Passport valid for less than 12 months' })
  await expect(amber).toBeVisible()
  await expect(amber.getByText('Passport', { exact: true })).toBeVisible()
})

test('administrator adds a blue additional point for Romania; managers see pending acknowledgements; mobile layout shows the alerts', async ({ page }) => {
  await login(page, 'admin@demo.test')
  await page.getByRole('link', { name: 'Country-wise requirements' }).click()
  await page.getByRole('link', { name: 'New requirement' }).click()
  const t = `ROMANIA – ADDITIONAL UNIVERSITY REQUIREMENT ${Date.now().toString().slice(-4)}`
  await page.getByLabel('Country *').selectOption({ label: 'Romania' })
  await page.getByLabel('Category *', { exact: true }).selectOption('general')
  await page.getByLabel('Display category *').selectOption('additional_point')
  await page.getByLabel('Priority *').selectOption('normal')
  await page.getByLabel('Notification title *').fill(t)
  await page.getByLabel('Notification message *').fill('Test-only instruction for staff.')
  await page.getByRole('button', { name: 'Create requirement' }).click()
  await expect(page.getByText('Saved.')).toBeVisible()
  await expect(page.locator('section').filter({ hasText: t }).getByText('Additional point')).toBeVisible()
  await page.getByLabel('Reason', { exact: true }).fill('Test clean-up')
  await page.getByRole('button', { name: 'Deactivate' }).click()
  await page.getByRole('button', { name: 'Yes, continue' }).click()
  await expect(page.getByText('Deactivated.')).toBeVisible()

  await login(page, 'edx.manager@demo.test')
  await expect(page.getByRole('region', { name: 'Priority attention' })).toBeVisible()
  await page.goto('/reports/pending-acknowledgements')
  await expect(page.getByRole('heading', { name: 'Notices awaiting acknowledgement' })).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('region', { name: 'Priority attention' })).toBeVisible()
})
