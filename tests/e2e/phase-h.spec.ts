import { expect, test } from '@playwright/test'
import { login } from './helpers'

test('consent at registration, message prepared after a stage change, held in test mode', async ({ page }) => {
  await login(page, 'edx.manager@demo.test')
  await page.getByLabel('Company').selectOption({ label: 'Dr.Expert Edulinks' })
  await page.goto('/students/new')
  const n = Date.now().toString().slice(-5)
  await page.getByLabel('Full name (as on passport) *').fill(`Message Person ${n}`)
  await page.getByLabel('Primary phone', { exact: true }).fill(`+91 90070 ${n}`)
  // complete contact details (an administrator may require them from an early stage)
  await page.getByLabel('Secondary phone', { exact: true }).fill(`+91 90071 ${n}`)
  await page.locator('#email').fill(`message.${n}@example.test`)
  await page.locator('input[name="consent.student.whatsapp"]').check()
  await page.getByRole('button', { name: 'Register student' }).click()
  await expect(page.getByText(/Student registered with ID/)).toBeVisible()
  await page.getByLabel('Move to').selectOption({ label: 'Registration' })
  await page.getByRole('button', { name: 'Update stage' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Stage updated' })).toBeVisible()

  await page.getByRole('navigation', { name: 'Student sections' }).getByRole('link', { name: 'Messages' }).click()
  await expect(page.locator('tr', { hasText: 'Stage changed' }).filter({ hasText: 'Whatsapp' }).first()).toBeVisible()
  await expect(async () => {
    await page.reload()
    await expect(page.getByText('Test – not sent').first()).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 15000 })
  await expect(page.getByText(`Dear Message Person ${n}, your application`).first()).toBeVisible()

  await page.goto('/notifications')
  await expect(page.getByText('Test mode', { exact: true })).toBeVisible()
  expect((await page.request.get('/api/cron/notifications')).status()).toBe(404)
})

test('notification settings: administrator sees channels and rules', async ({ page }) => {
  await login(page, 'admin@demo.test')
  await page.getByRole('link', { name: 'Notification settings' }).click()
  await expect(page.getByText('WhatsApp (Gallabox)')).toBeVisible()
  await expect(page.getByText('Dr.Expert Edulinks: when to send')).toBeVisible()
  await expect(page.getByText('No provider (DLT needed)').first()).toBeVisible()
})
