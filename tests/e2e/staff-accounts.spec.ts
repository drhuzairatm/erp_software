import { expect, test } from '@playwright/test'
import { adminDb, login } from './helpers'

const admin = adminDb()
test.afterAll(async () => { await admin.end() })
const PW = 'Fictional-Invite-7390!'

test('MD invites a new employee; the employee activates the account and signs in; suspension ends the session at once; reactivation; tasks handed over', async ({ page, browser }) => {
  const n = Date.now().toString().slice(-6)
  const email = `invite.e2e.${n}@example.test`
  await login(page, 'md@demo.test')
  await page.goto('/admin/users')
  await page.getByLabel('Full name').fill(`Invited Employee ${n}`)
  await page.getByLabel('Work email').fill(email)
  await page.getByLabel('Company and role').selectOption({ label: 'Sales / Counsellor' })
  await page.locator('#staff-dept').selectOption({ label: 'Admissions' })
  await page.locator('#staff-phone').fill('+91 98450 12345')
  await page.locator('#staff-joining').fill('2026-11-03')
  await page.getByRole('button', { name: 'Add staff' }).click()
  await expect(page.getByText(/Account created/)).toBeVisible()
  const link = await page.getByLabel('One-time link').inputValue()
  expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]{30,60}$/)

  // listed as invitation pending; cannot sign in yet
  await page.goto(`/admin/users?q=${n}`)
  await expect(page.locator('tr', { hasText: `Invited Employee ${n}` }).getByText('Invitation pending')).toBeVisible()

  // the employee opens the invitation in their own browser
  const emp = await browser.newContext({ baseURL: 'http://localhost:3000' })
  const ep = await emp.newPage()
  await ep.goto('/login')
  await ep.getByLabel('Work email').fill(email); await ep.getByLabel('Password').fill(PW)
  await ep.getByRole('button', { name: 'Sign in' }).click()
  await expect(ep).toHaveURL(/\/login/)
  await ep.goto(new URL(link).pathname)
  await expect(ep.getByRole('heading', { name: `Welcome, Invited Employee ${n}` })).toBeVisible()
  await ep.getByLabel('New password').fill(PW); await ep.getByLabel('Confirm password').fill(PW)
  await ep.getByRole('button', { name: 'Activate my account' }).click()
  await expect(ep.getByText('Your account is active and your email address is confirmed.')).toBeVisible()
  await ep.getByLabel('Work email').fill(email); await ep.getByLabel('Password').fill(PW)
  await ep.getByRole('button', { name: 'Sign in' }).click()
  await expect(ep).not.toHaveURL(/\/login/)
  // the invitation link cannot be used again
  const again = await browser.newContext({ baseURL: 'http://localhost:3000' })
  const ap = await again.newPage()
  await ap.goto(new URL(link).pathname)
  await expect(ap.getByRole('heading', { name: 'Invitation not valid' })).toBeVisible()
  await again.close()

  // MD: profile shows the new details; give the employee a task, then suspend
  const [u] = await admin`select id from user_profiles where email = ${email}`
  const [md] = await admin`select id from user_profiles where email = 'md@demo.test'`
  const [edx] = await admin`select id from organizations where code = 'EDX'`
  await admin`insert into tasks (org_id, title, assigned_to, created_by) values (${edx.id}, ${'Hand-over task ' + n}, ${u.id}, ${md.id})`
  await page.goto(`/admin/users/${u.id}`)
  await expect(page.getByText('+91 98450 12345')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Open tasks (1)' })).toBeVisible()
  await page.getByLabel('Change account status').selectOption('suspended')
  await page.getByLabel('Reason *').fill('Fictional e2e suspension')
  await page.getByRole('button', { name: 'Suspend', exact: true }).click()
  await page.getByRole('button', { name: 'Yes, continue' }).click()
  await expect(page.getByText('Account suspended and signed out everywhere.')).toBeVisible()

  // the employee's open session no longer works, and sign-in is refused
  await ep.goto('/tasks')
  await expect(ep).toHaveURL(/\/login/)
  await ep.getByLabel('Work email').fill(email); await ep.getByLabel('Password').fill(PW)
  await ep.getByRole('button', { name: 'Sign in' }).click()
  await expect(ep).toHaveURL(/\/login/)

  // hand the open task to a colleague, then reactivate
  await page.reload()
  await page.getByLabel(/Reassign all 1 open task to/).selectOption({ index: 1 })
  await page.getByRole('button', { name: 'Reassign tasks' }).click()
  await page.getByRole('button', { name: 'Yes, continue' }).click()
  await expect(page.getByRole('heading', { name: 'Open tasks (0)' })).toBeVisible()
  const [t] = await admin`select assigned_to from tasks where title = ${'Hand-over task ' + n}`
  expect(t.assigned_to).not.toBe(u.id)
  await page.getByLabel('Change account status').selectOption('active')
  await page.getByRole('button', { name: 'Reactivate' }).click()
  await expect(page.getByText('Account reactivated.')).toBeVisible()
  await ep.goto('/login')
  await ep.getByLabel('Work email').fill(email); await ep.getByLabel('Password').fill(PW)
  await ep.getByRole('button', { name: 'Sign in' }).click()
  await expect(ep).not.toHaveURL(/\/login/)

  // the employee signs out everywhere from their own security page
  await ep.goto('/account/security')
  await ep.getByRole('button', { name: 'Sign out everywhere' }).click()
  await ep.getByRole('button', { name: 'Yes, continue' }).click()
  await expect(ep.getByText('You have been signed out on every device.')).toBeVisible()
  await emp.close()
})
