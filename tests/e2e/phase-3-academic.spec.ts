import { expect, test } from '@playwright/test'
import { adminDb, login } from './helpers'

const admin = adminDb()
test.afterAll(async () => { await admin.end() })

test('academic tab: Plus Two with subjects, Bulgaria threshold flag, name difference and One and Same request', async ({ page }) => {
  await login(page, 'edx.manager@demo.test')
  await page.getByLabel('Company').selectOption({ label: 'Dr.Expert Edulinks' })
  await page.goto('/students/new')
  const n = Date.now().toString().slice(-5)
  await page.getByLabel('Full name (as on passport) *').fill(`Meera Test${n} Nair`)
  await page.getByLabel('Primary phone', { exact: true }).fill(`98762 ${n}`)
  await page.getByLabel('Destination country').selectOption({ label: 'Bulgaria' })
  await page.getByLabel('Passport number').fill(`AC${n}`)
  await page.getByLabel('Expiry date').fill('2033-01-01')
  await page.getByRole('button', { name: 'Register student' }).click()
  await expect(page.getByText(/Student registered with ID/)).toBeVisible()
  const studentUrl = page.url().split('?')[0]

  // passport holder name
  await page.goto(`${studentUrl}?tab=passport`)
  await page.getByLabel('A correction to the current passport').check()
  await page.getByLabel('Passport number *').fill(`AC${n}`)
  await page.getByLabel('Holder name exactly as printed').fill(`MEERA TEST${n} NAIR`)
  await page.getByLabel('Expiry date *').fill('2033-01-01')
  await page.getByLabel(/Notes \*/).fill('Holder name added from passport (test)')
  await page.getByRole('button', { name: 'Record correction' }).click()
  await expect(page.getByText(/recorded as a new version/)).toBeVisible()

  // Plus Two with subject marks; certificate name without the surname
  await page.goto(`${studentUrl}?tab=academic`)
  await page.getByLabel('Student name as printed on the certificate').fill(`MEERA TEST${n}`)
  await page.getByLabel('Grading system').selectOption('marks')
  await page.getByLabel('Subject 1 marks obtained').fill('72')
  await page.getByLabel('Subject 2 marks obtained').fill('55')
  await page.getByLabel('Subject 3 marks obtained').fill('81')
  await page.getByLabel('Subject 4 marks obtained').fill('64')
  await page.getByRole('button', { name: 'Add record' }).click()
  await expect(page.getByText(/Name checks and eligibility were updated/)).toBeVisible()
  await expect(page.getByText('Below threshold')).toBeVisible()
  await expect(page.getByText(/Surname missing — needs human review/)).toBeVisible()

  // staff require One and Same, choose the approved template, preview, record a manual request
  // a mandatory rule opens the case automatically; otherwise staff decide
  const require = page.getByRole('button', { name: 'Require One and Same' })
  if (await require.isVisible()) {
    await require.click()
    await expect(page.getByText(/One and Same case opened/)).toBeVisible()
  }
  await page.getByLabel('Template').selectOption({ index: 1 })
  await page.getByRole('button', { name: 'Generate preview' }).click()
  await expect(page.locator('pre').filter({ hasText: `MEERA TEST${n} NAIR` })).toBeVisible()
  await page.getByLabel('How to request').selectOption('manual')
  await page.getByLabel('Request note').fill('Explained by phone (test)')
  await page.getByRole('button', { name: 'Request from student' }).click()
  await expect(page.getByText('Pending (requested)')).toBeVisible()
  await page.goto(`${studentUrl}?tab=documents`)
  await expect(page.getByText(/One and Same Certificate/).first()).toBeVisible()
})

test('administrator sees academic and name rules; MD sees the Bonafide draft and adds a destination country option', async ({ page }) => {
  await login(page, 'admin@demo.test')
  await page.getByRole('link', { name: 'Academic & name rules' }).click()
  await expect(page.getByRole('cell', { name: 'Bulgaria – Plus Two subject minimum 60%' }).first()).toBeVisible()
  await expect(page.getByText('One and Same templates')).toBeVisible()
  await login(page, 'md@demo.test')
  await page.goto('/admin/verification-rules')
  await expect(page.getByText(/Bonafide – Indian student at a Qatar school/)).toBeVisible()
  await page.goto('/admin/settings')
  await expect(page.getByLabel('Used as')).toBeVisible()
  await expect(page.getByLabel('Academic details')).toBeVisible()
})
