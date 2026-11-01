import { expect, test } from '@playwright/test'
import { adminDb, login } from './helpers'

const admin = adminDb()
test.afterAll(async () => { await admin.end() })

test('accounts record a USD payment with its own rate; INR equivalent shown; another person verifies; numbered receipt', async ({ page }) => {
  const [s] = await admin`select id from students where is_demo and status = 'active' and originating_org_id = (select id from organizations where code = 'EDX') order by created_at limit 1`
  const ref = `USD-E2E-${Date.now()}`
  await login(page, 'edx.finance@demo.test')
  await page.goto(`/students/${s.id}?tab=payments`)
  await page.getByLabel('Entry type').selectOption({ label: 'Receipt (money received)' })
  await page.getByLabel('Currency').selectOption('USD')
  await page.getByLabel('Amount (USD)').fill('1000')
  await page.getByLabel('Exchange rate applied (INR for 1 USD) *').fill('90')
  await expect(page.locator('[aria-live="polite"]', { hasText: '₹90,000.00' })).toBeVisible()
  await page.getByLabel('Method').selectOption({ label: 'Bank transfer' })
  await page.getByLabel('Transaction / reference no.').fill(ref)
  await page.getByRole('button', { name: 'Record entry' }).click()
  await expect(page.getByText(/Entry recorded/)).toBeVisible()
  const row = page.locator('tr', { hasText: ref })
  await expect(row.getByText('$1,000.00')).toBeVisible()
  await expect(row.getByText('₹90,000.00')).toBeVisible()

  await login(page, 'md@demo.test')
  await page.goto(`/students/${s.id}?tab=payments`)
  const pending = page.locator('tr', { hasText: ref })
  await pending.getByRole('button', { name: 'Verify' }).click()
  const receipt = page.locator('tr', { hasText: ref }).getByRole('link', { name: /Receipt EDX-RCP-/ })
  await expect(receipt).toBeVisible()
  await receipt.click()
  await expect(page.getByText('Payment receipt', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('1 USD = 90 INR')).toBeVisible()
  await expect(page.getByText('₹90,000.00')).toBeVisible()

  await page.goto('/')
  await expect(page.getByText('Consolidated – INR equivalent')).toBeVisible()
})
