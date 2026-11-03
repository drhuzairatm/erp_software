import { expect, test } from '@playwright/test'
import { adminDb, login } from './helpers'

const admin = adminDb()
test.afterAll(async () => { await admin.end() })

test('rule tester explains rules for a student; the AND/OR builder previews a condition', async ({ page }) => {
  const [s] = await admin`select student_code from students where is_demo and status = 'active' order by created_at limit 1`
  await login(page, 'md@demo.test')
  await page.goto('/admin/rule-tester')
  await page.getByLabel('Student ID').fill(s.student_code)
  await page.getByRole('button', { name: 'Check' }).click()
  await expect(page.getByRole('heading', { name: 'Facts used by the rules' })).toBeVisible()
  await expect(page.getByText('Passport validity', { exact: true })).toBeVisible()

  // build: Destination country is one of Bulgaria
  const builder = page.locator('form', { has: page.getByRole('button', { name: 'Preview' }) })
  await builder.getByRole('button', { name: '+ Condition' }).click()
  await builder.getByLabel('Field').selectOption({ label: 'Destination country' })
  await builder.getByLabel('Add value').selectOption({ label: 'Bulgaria' })
  await builder.getByRole('button', { name: 'Preview' }).click()
  await expect(page.getByText('Destination country is one of Bulgaria')).toBeVisible()
  await expect(page.getByText(/active students you can see would match/)).toBeVisible()
})
