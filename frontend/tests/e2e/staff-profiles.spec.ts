import { expect, test } from '@playwright/test'
import sharp from 'sharp'
import { login } from './helpers'

test('MD adds a staff member with a photo and reporting manager; profile, list avatar and role members', async ({ page }) => {
  await login(page, 'md@demo.test')
  await page.goto('/admin/users')
  const n = Date.now().toString().slice(-6)
  await page.getByLabel('Full name').fill(`Photo Staff ${n}`)
  await page.getByLabel('Work email').fill(`photo.staff.${n}@example.test`)
  await page.getByLabel('Company and role').selectOption({ label: 'Sales / Counsellor' })
  await page.getByLabel('Reporting manager').selectOption({ index: 1 })
  const img = await sharp({ create: { width: 640, height: 640, channels: 3, background: '#c9d6e4' } }).jpeg().toBuffer()
  await page.getByLabel('Choose a photo from the device').setInputFiles({ name: 'me.jpg', mimeType: 'image/jpeg', buffer: img })
  await page.getByRole('button', { name: 'Add staff' }).click()
  await expect(page.getByText(/Account created/)).toBeVisible()

  await page.goto(`/admin/users?q=Photo Staff ${n}`)
  const row = page.locator('tr', { hasText: `Photo Staff ${n}` })
  await expect(row.locator('img[src*="/api/staff/"]')).toBeVisible()
  await expect(row.getByText(/EMP-\d{5}/)).toBeVisible()
  await expect(row.getByText(/Reports to /)).toBeVisible()
  await row.getByRole('link', { name: `Photo Staff ${n}` }).click()
  await expect(page.getByRole('img', { name: `Photo of Photo Staff ${n}` })).toBeVisible()
  await expect(page.getByText('Company access and role')).toBeVisible()

  await page.goto('/admin/roles')
  const roles = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Sales / Counsellor' }) })
  for (let i = 0; i < await roles.count(); i++) await roles.nth(i).locator('summary').click()
  await expect(page.getByRole('link', { name: `Photo Staff ${n}` }).first()).toBeVisible()
})
