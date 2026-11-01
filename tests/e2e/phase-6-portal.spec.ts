import { expect, test } from '@playwright/test'
import { adminDb, login } from './helpers'

const admin = adminDb()
test.afterAll(async () => { await admin.end() })

test('staff set up a portal password account; the student sets a password and signs in with the Student ID', async ({ page }) => {
  await login(page, 'edx.manager@demo.test')
  await page.getByLabel('Company').selectOption({ label: 'Dr.Expert Edulinks' })
  await page.goto('/students/new')
  const n = Date.now().toString().slice(-5)
  await page.getByLabel('Full name (as on passport) *').fill(`Portal Password ${n}`)
  await page.getByLabel('Primary phone', { exact: true }).fill(`+91 90060 ${n}`)
  await page.getByLabel('Secondary phone', { exact: true }).fill(`+91 90061 ${n}`)
  await page.locator('#email').fill(`portal.pw.${n}@example.test`)
  await page.getByRole('button', { name: 'Register student' }).click()
  await expect(page.getByText(/Student registered with ID/)).toBeVisible()
  const code = (await page.getByText(/Student registered with ID/).innerText()).match(/[A-Z]{3}-\d{2}-\d{6}/)![0]

  await page.getByRole('button', { name: 'Create account & issue set-up link' }).click()
  const linkBox = page.getByLabel('One-time link (shown only now)')
  await expect(linkBox).toBeVisible()
  const link = new URL(await linkBox.inputValue())

  const student = await page.context().browser()!.newPage({ viewport: { width: 390, height: 844 } })
  await student.goto(link.pathname + link.search)
  await expect(student.getByText(code)).toBeVisible()
  await student.getByLabel('New password').fill('Fictional-Pass-2026!')
  await student.getByLabel('Repeat the password').fill('Fictional-Pass-2026!')
  await student.getByRole('button', { name: 'Save password' }).click()
  await expect(student.getByText('Your password is saved. Sign in below.')).toBeVisible()
  await student.getByLabel('Password', { exact: true }).fill('Wrong-Password-1!')
  await student.getByLabel('Student ID or verified email').fill(code)
  await student.getByRole('button', { name: 'Sign in with password' }).click()
  await expect(student.getByText(/is not correct/)).toBeVisible()
  await student.getByLabel('Password', { exact: true }).fill('Fictional-Pass-2026!')
  await student.getByRole('button', { name: 'Sign in with password' }).click()
  await expect(student.getByRole('heading', { name: 'Application progress' })).toBeVisible()
  await expect(student.getByRole('heading', { name: /Notifications/ })).toBeVisible()
  // the used link no longer works
  await student.goto(link.pathname + link.search)
  await expect(student.getByText(/expired or was already used/)).toBeVisible()
  await student.close()

  await page.reload()
  await expect(page.getByText('Active', { exact: true }).first()).toBeVisible()
})
