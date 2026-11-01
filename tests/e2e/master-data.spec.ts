import { expect, test } from '@playwright/test'
import { adminDb, login } from './helpers'

const admin = adminDb()
test.afterAll(async () => { await admin.end() })

test('MD adds a country; staff request a university; MD approves; the student form offers it only for that country', async ({ page }) => {
  const n = Date.now().toString().slice(-6)
  let code = 'Q' + 'ABCDEFGHIJKLMNOPRSTUVWXYZ'[Number(n) % 25]
  for (const ch of 'ABCDEFGHIJKLMNOPRSTUVWXYZ') { if (!(await admin`select 1 from countries where code = ${'X' + ch}`).length) { code = 'X' + ch; break } }
  await login(page, 'md@demo.test')
  await page.goto('/admin/master-data/countries')
  const add = page.locator('section', { has: page.getByRole('heading', { name: 'Add a country' }) })
  await add.getByLabel('ISO code *').fill(code)
  await add.getByLabel('Country name *').fill(`Testland ${n}`)
  await add.getByRole('button', { name: 'Add country' }).click()
  await expect(page.getByText(`Testland ${n}`).first()).toBeVisible()

  // a counsellor cannot change master data, but can request it
  await login(page, 'edx.counsellor@demo.test')
  await page.goto('/admin/master-data/countries')
  await expect(page.getByText('You do not have access to master data.')).toBeVisible()
  await page.goto('/admin/master-data/requests')
  await page.getByLabel('Name *').fill(`Testland Medical University ${n}`)
  await page.getByLabel('Country *').selectOption({ label: `Testland ${n}` })
  await page.getByRole('button', { name: 'Send request' }).click()
  await expect(page.getByText(/Request sent/)).toBeVisible()

  await login(page, 'md@demo.test')
  await page.goto('/admin/master-data/requests')
  const item = page.locator('li', { hasText: `Testland Medical University ${n}` })
  await item.getByRole('button', { name: 'Approve & add' }).click()
  await expect(item.getByText('approved', { exact: true })).toBeVisible()

  await login(page, 'edx.manager@demo.test')
  await page.goto('/students/new')
  const uni = page.getByLabel('Preferred university')
  await page.getByLabel('Destination country').selectOption({ label: `Testland ${n}` })
  await expect(uni.locator('option', { hasText: `Testland Medical University ${n}` })).toHaveCount(1)
  await page.getByLabel('Destination country').selectOption({ label: 'Bulgaria' })
  await expect(uni.locator('option', { hasText: `Testland Medical University ${n}` })).toHaveCount(0)
})
