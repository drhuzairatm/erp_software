import { expect, test } from '@playwright/test'
import sharp from 'sharp'
import { login } from './helpers'

const jpeg = async (colour: string) => ({ name: 'passport.jpg', mimeType: 'image/jpeg',
  buffer: await sharp({ create: { width: 600, height: 800, channels: 3, background: colour } }).jpeg().toBuffer() })

test('register with a photo; avatar in the list and profile; preview, replace and download', async ({ page }) => {
  await login(page, 'edx.manager@demo.test')
  await page.getByLabel('Company').selectOption({ label: 'Dr.Expert Edulinks' })
  await page.goto('/students/new')
  const n = Date.now().toString().slice(-5)
  await page.getByLabel('Full name (as on passport) *').fill(`Photo Person ${n}`)
  await page.getByLabel('Primary phone', { exact: true }).fill(`+91 90050 ${n}`)
  await page.getByLabel('Secondary phone', { exact: true }).fill(`+91 90051 ${n}`)
  await page.locator('#email').fill(`photo.${n}@example.test`)
  await page.getByLabel('Choose a photo from the device').setInputFiles(await jpeg('#dfe7f1'))
  await expect(page.getByText('Avatar preview')).toBeVisible()
  await page.getByRole('button', { name: 'Register student' }).click()
  await expect(page.getByText(/Student registered with ID/)).toBeVisible()
  await expect(page.getByRole('button', { name: /View .* photo/ })).toBeVisible()

  // larger preview with download
  await page.getByRole('button', { name: /View .* photo/ }).click()
  await expect(page.getByRole('img', { name: `Photo of Photo Person ${n}` })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Download Passport Photo' })).toBeVisible()
  await page.getByRole('button', { name: 'Close' }).click()

  // replace
  await page.getByRole('button', { name: 'Replace photo' }).click()
  await page.getByRole('dialog', { name: 'Replace photo' }).getByLabel('Choose a photo from the device').setInputFiles(await jpeg('#f2e7df'))
  await page.getByRole('button', { name: 'Confirm and replace' }).click()
  await expect(page.locator('img[src*="photo?size=thumb&v=2"]').first()).toBeVisible()
  const studentId = new URL(page.url()).pathname.split('/')[2]
  const dl = await page.request.get(`/api/students/${studentId}/photo/download`)
  expect(dl.status()).toBe(200)
  expect(dl.headers()['content-type']).toContain('image/jpeg')
  expect(dl.headers()['content-disposition'] ?? '').toContain('_PassportPhoto.jpg')

  // list: avatar photo; Photo Missing filter excludes the student
  await page.goto(`/students?q=Photo Person ${n}`)
  await expect(page.locator('img[src*="/photo?size=thumb"]').first()).toBeVisible()
  await page.goto(`/students?q=Photo Person ${n}&photo=no`)
  await expect(page.getByRole('link', { name: `Photo Person ${n}` })).toHaveCount(0)
})
