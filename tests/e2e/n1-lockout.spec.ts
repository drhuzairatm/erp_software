import { expect, test } from '@playwright/test'
import { adminDb, login } from './helpers'

/**
 * Finding N-1 in a real browser (fictional accounts only; reset links are never printed).
 * Staff: a reset completed in the employee's own browser makes that browser trusted; an "attacker" browser that knows
 * only the email locks itself out, while the employee's browser still signs in.
 * Portal: wrong passwords for a Student ID from another browser do not lock the student's usual browser.
 */
const admin = adminDb()
test.afterAll(async () => { await admin.end() })
const PW = 'Fictional-N1-E2e-Pass7!'
const NEW_PW = 'Fictional-N1-E2e-New9!'

test('staff: reset in own browser → trusted; another browser that only knows the email is locked; the employee still signs in', async ({ page, browser }) => {
  const n = Date.now().toString().slice(-6)
  const email = `n1.e2e.${n}@example.test`
  await login(page, 'md@demo.test')
  await page.goto('/admin/users')
  await page.getByLabel('Full name').fill(`N1 Employee ${n}`)
  await page.getByLabel('Work email').fill(email)
  await page.getByLabel('Company and role').selectOption({ label: 'Sales / Counsellor' })
  await page.getByRole('button', { name: 'Add staff' }).click()
  await expect(page.getByText(/Account created/)).toBeVisible()
  const invite = new URL(await page.getByLabel('One-time link').inputValue())

  const own = await browser.newContext({ baseURL: 'http://localhost:3000' })
  const ep = await own.newPage()
  await ep.goto(invite.pathname)
  await ep.getByLabel('New password').fill(PW); await ep.getByLabel('Confirm password').fill(PW)
  await ep.getByRole('button', { name: 'Activate my account' }).click()
  await expect(ep.getByText('Your account is active and your email address is confirmed.')).toBeVisible()

  // the employee resets the password in their own browser (identical answer as for an unknown address)
  await ep.goto('/forgot-password')
  await ep.getByLabel('Work email').fill(`nobody.${n}@example.test`)
  await ep.getByRole('button', { name: 'Request reset' }).click()
  const unknownAnswer = await ep.getByRole('status').innerText()
  await ep.goto('/forgot-password')
  await ep.getByLabel('Work email').fill(email)
  await ep.getByRole('button', { name: 'Request reset' }).click()
  await expect(ep.getByText(unknownAnswer)).toBeVisible()
  // no email provider in development: the queued message is skipped and its link wiped at once (by design)
  const [u] = await admin`select id from user_profiles where email = ${email}`
  await expect.poll(async () => (await admin`select status, link_encrypted from auth_private.staff_email_outbox where user_id = ${u.id}`)[0])
    .toEqual({ status: 'skipped', link_encrypted: null })
  // so, as documented, the MD issues the reset link and gives it to the employee
  await page.goto('/admin/users')
  const row = page.locator('tr', { hasText: email })
  await row.getByRole('button', { name: 'Issue reset link' }).click()
  const resetLink = new URL(await row.getByLabel('One-time link').inputValue())
  await ep.goto(resetLink.pathname)
  await ep.getByLabel('New password').fill(NEW_PW); await ep.getByLabel('Confirm password').fill(NEW_PW)
  await ep.getByRole('button', { name: 'Set password' }).click()
  await expect(ep).toHaveURL(/\/login\?reset=1/)
  const device = (await own.cookies()).find((c) => c.name === 'erp_device')
  expect(device?.httpOnly).toBe(true)

  // an attacker's browser: 5 wrong passwords, then even the right one is refused there
  const att = await browser.newContext({ baseURL: 'http://localhost:3000' })
  const ap = await att.newPage()
  await ap.goto('/login')
  for (let i = 0; i < 5; i++) {
    await ap.getByLabel('Work email').fill(email); await ap.getByLabel('Password').fill('Wrong-Password-123!')
    await ap.getByRole('button', { name: 'Sign in' }).click()
    await expect(ap.getByText('Incorrect email or password.')).toBeVisible()
  }
  await ap.getByLabel('Work email').fill(email); await ap.getByLabel('Password').fill(NEW_PW)
  await ap.getByRole('button', { name: 'Sign in' }).click()
  await expect(ap.getByText(/Too many failed attempts from this browser/)).toBeVisible()
  await att.close()

  // the employee's own (trusted) browser is not locked out
  await ep.goto('/login')
  await ep.getByLabel('Work email').fill(email); await ep.getByLabel('Password').fill(NEW_PW)
  await ep.getByRole('button', { name: 'Sign in' }).click()
  await expect(ep).not.toHaveURL(/\/login/)
  await own.close()
})

test('portal: wrong passwords for a Student ID from another browser do not lock the student\'s usual browser', async ({ page, browser }) => {
  await login(page, 'edx.manager@demo.test')
  await page.getByLabel('Company').selectOption({ label: 'Dr.Expert Edulinks' })
  await page.goto('/students/new')
  const n = Date.now().toString().slice(-5)
  await page.getByLabel('Full name (as on passport) *').fill(`Portal N1 ${n}`)
  await page.getByLabel('Primary phone', { exact: true }).fill(`+91 90071 ${n}`)
  await page.getByLabel('Secondary phone', { exact: true }).fill(`+91 90072 ${n}`)
  await page.locator('#email').fill(`portal.n1.${n}@example.test`)
  await page.getByRole('button', { name: 'Register student' }).click()
  await expect(page.getByText(/Student registered with ID/)).toBeVisible()
  const code = (await page.getByText(/Student registered with ID/).innerText()).match(/[A-Z]{3}-\d{2}-\d{6}/)![0]
  await page.getByRole('button', { name: 'Create account & issue set-up link' }).click()
  const linkBox = page.getByLabel('One-time link (shown only now)')
  await expect(linkBox).toBeVisible()
  const link = new URL(await linkBox.inputValue())

  const usual = await browser.newContext({ baseURL: 'http://localhost:3000' })
  const sp = await usual.newPage()
  await sp.goto(link.pathname + link.search)
  await sp.getByLabel('New password').fill(PW); await sp.getByLabel('Repeat the password').fill(PW)
  await sp.getByRole('button', { name: 'Save password' }).click()
  await expect(sp.getByText('Your password is saved. Sign in below.')).toBeVisible()
  expect((await usual.cookies()).some((c) => c.name === 'erp_portal_device' && c.httpOnly)).toBe(true)

  const other = await browser.newContext({ baseURL: 'http://localhost:3000' })
  const op = await other.newPage()
  await op.goto('/portal')
  for (let i = 0; i < 5; i++) {
    await op.getByLabel('Student ID or verified email').fill(code); await op.getByLabel('Password', { exact: true }).fill('Wrong-Password-1!')
    await op.getByRole('button', { name: 'Sign in with password' }).click()
    await expect(op.getByText(/is not correct/)).toBeVisible()
  }
  await op.getByLabel('Student ID or verified email').fill(code); await op.getByLabel('Password', { exact: true }).fill(PW)
  await op.getByRole('button', { name: 'Sign in with password' }).click()
  await expect(op.getByText(/is not correct, or the account is locked/)).toBeVisible()
  await other.close()

  await sp.getByLabel('Student ID or verified email').fill(code); await sp.getByLabel('Password', { exact: true }).fill(PW)
  await sp.getByRole('button', { name: 'Sign in with password' }).click()
  await expect(sp.getByRole('heading', { name: 'Application progress' })).toBeVisible()
  await usual.close()
})
