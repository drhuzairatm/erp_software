import { expect, test } from '@playwright/test'
import { adminDb, login } from './helpers'

const admin = adminDb()
test.afterAll(async () => { await admin.end() })

test('manager records education background and passport; finance sees it masked', async ({ page }) => {
  await login(page, 'edx.manager@demo.test')
  await page.getByLabel('Company').selectOption({ label: 'Dr.Expert Edulinks' })
  await page.goto('/students/new')
  const n = Date.now().toString().slice(-5)
  await page.getByLabel('Full name (as on passport) *').fill(`Phase B Person ${n}`)
  await page.getByLabel('Phone', { exact: true }).fill(`+91 90040 ${n}`)
  await page.getByLabel('Destination country').selectOption({ label: 'Russia' })
  await page.getByLabel('Course').selectOption({ label: 'MBBS' })
  await page.getByLabel('Preferred university').selectOption({ label: 'Volga State Medical University (Demo)' })
  await page.getByLabel('Campus').selectOption({ label: 'City clinical campus' })
  await page.getByLabel('Previous education country').selectOption({ label: 'Qatar' })
  await page.getByLabel('School / institution name').fill('Example School Doha')
  await page.getByLabel('Passport number').fill(`pq${n}00`)
  await page.getByLabel('Expiry date').fill('2032-03-01')
  await page.getByRole('button', { name: 'Register student' }).click()
  await expect(page.getByText(/Student registered with ID/)).toBeVisible()
  await expect(page.getByText('Qatar').first()).toBeVisible()
  await expect(page.getByText(`PQ${n}00`)).toBeVisible()
  await expect(page.getByText('City clinical campus', { exact: false })).toBeVisible()
  const url = page.url().replace(/\?.*$/, '')
  // The university's own rule (bank statement) is on the checklist
  await page.goto(`${url}?tab=documents`)
  await expect(page.locator('li', { hasText: 'Bank Statement / Sponsor Letter' }).getByText('University requirement')).toBeVisible()

  await login(page, 'edx.finance@demo.test')
  await page.goto(url)
  await expect(page.getByText('Passport details are hidden for your role')).toBeVisible()
  expect(await page.locator('main').innerText()).not.toContain(`PQ${n}00`)
})

test('university configuration: system administrator adds a course, intake and document rule', async ({ page }) => {
  await login(page, 'admin@demo.test')
  await page.getByRole('link', { name: 'Universities' }).click()
  await page.getByRole('link', { name: 'Black Sea Medical University (Demo)' }).click()
  await page.getByLabel('Intake').fill('February 2028')
  await page.getByLabel('Application deadline').fill('2027-12-15')
  await page.getByRole('button', { name: 'Add intake' }).click()
  await expect(page.getByRole('cell', { name: 'February 2028' })).toBeVisible()
  await page.getByLabel('Document').selectOption({ label: 'Medical / HIV Certificate' })
  await page.getByRole('button', { name: 'Add requirement' }).click()
  await expect(page.locator('li', { hasText: 'Medical / HIV Certificate' })).toBeVisible()
})

test('counsellors can read university information but not change it', async ({ page }) => {
  await login(page, 'edx.counsellor@demo.test')
  await page.goto('/universities')
  await page.getByRole('link', { name: 'Volga State Medical University (Demo)' }).click()
  await expect(page.getByText('Courses offered and admission requirements')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add requirement' })).toHaveCount(0)
})
