import { expect, test } from '@playwright/test'
import { login } from './helpers'

test('manager imports students from a CSV after reviewing the preview', async ({ page }) => {
  await login(page, 'edx.manager@demo.test')
  await page.goto('/students')
  await page.getByRole('link', { name: 'Import CSV' }).click()
  await expect(page.getByRole('heading', { name: 'Import students from CSV' })).toBeVisible()

  const template = await page.request.get('/api/students/import-template')
  expect(await template.text()).toContain('Name,Phone,Email,Assigned To,Purpose,Country,Course')

  const n = Date.now().toString().slice(-5)
  const csv = `Student Name,Mobile,Country,Course,Notes\nCSV Person ${n}A,+91 90011 ${n},Russia,MBBS,From e2e\nCSV Person ${n}B,+91 90012 ${n},Narnia,MBBS,\n`
  await page.getByLabel('CSV file').setInputFiles({ name: 'e2e.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await page.getByRole('button', { name: 'Check file' }).click()
  await expect(page.getByText('Country "Narnia" is not in the system')).toBeVisible()
  await expect(page.getByRole('button', { name: /Ready\s*1/ })).toBeVisible()
  await page.getByRole('button', { name: 'Import 1 student' }).click()
  await expect(page.getByText('Imported 1 student; skipped 1.')).toBeVisible()
  await page.getByRole('link', { name: /EDX-\d{2}-\d{6}/ }).click()
  await expect(page.getByRole('heading', { name: `CSV Person ${n}A` })).toBeVisible()
})

test('counsellors are not offered bulk import', async ({ page }) => {
  await login(page, 'edx.counsellor@demo.test')
  await page.goto('/students')
  await expect(page.getByRole('link', { name: 'Import CSV' })).toHaveCount(0)
  await page.goto('/students/import')
  await expect(page.getByText('You do not have permission to import students')).toBeVisible()
})
