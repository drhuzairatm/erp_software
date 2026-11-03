import { expect, test } from '@playwright/test'
import { currentStep, totp } from '../../../backend/src/lib/auth/mfa'
import { adminDb, login } from './helpers'

const admin = adminDb()
test.afterAll(async () => { await admin.end() })

test('strict browser policy: nonce-based scripts, no inline scripts; injected inline handlers do not run; the app still works', async ({ page }) => {
  const res = await page.goto('/login')
  const csp = res!.headers()['content-security-policy']
  const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src'))!
  expect(scriptSrc).toMatch(/'nonce-[A-Za-z0-9+/=]+'/)
  expect(scriptSrc).toContain("'strict-dynamic'")
  expect(scriptSrc).not.toContain("'unsafe-inline'")
  expect(csp).toContain("frame-ancestors 'none'")
  expect(csp).toContain("object-src 'none'")
  // a fresh nonce on every request
  const again = (await page.request.get('/login')).headers()['content-security-policy']
  expect(again).not.toBe(csp)
  // an injected inline event handler (classic XSS) is blocked
  await page.evaluate(() => { document.body.insertAdjacentHTML('beforeend', '<img src="/does-not-exist.png" onerror="window.__xss = 1">') })
  await page.waitForTimeout(500)
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined()
  // and the page is fully interactive (React hydrated with the nonce)
  await login(page, 'edx.manager@demo.test')
  await page.goto('/students')
  if (page.url().includes('/account/security')) {
    // production build: two-step login is compulsory for everyone – the client-side setup still works under the strict policy
    await expect(page.getByText('Two-factor login is required for every staff account.')).toBeVisible()
    await page.getByRole('button', { name: 'Set up two-factor login' }).click()
    await expect(page.getByRole('img', { name: 'QR code for your authenticator app' })).toBeVisible()
  } else {
    await expect(page.getByRole('heading', { name: 'Students' })).toBeVisible()
  }
})

test('two-step login: a new employee enrols an authenticator, signs in with a code, then with a single-use recovery code', async ({ page, browser }) => {
  const n = Date.now().toString().slice(-6)
  const email = `mfa.e2e.${n}@example.test`
  const PW = 'Fictional-Mfa-5163!'
  await login(page, 'md@demo.test')
  await page.goto('/admin/users')
  await page.getByLabel('Full name').fill(`Two Step ${n}`)
  await page.getByLabel('Work email').fill(email)
  await page.getByLabel('Company and role').selectOption({ label: 'Sales / Counsellor' })
  await page.getByRole('button', { name: 'Add staff' }).click()
  const link = await page.getByLabel('One-time link').inputValue()

  const ctx = await browser.newContext({ baseURL: 'http://localhost:3000' })
  const ep = await ctx.newPage()
  await ep.goto(new URL(link).pathname)
  await ep.getByLabel('New password').fill(PW); await ep.getByLabel('Confirm password').fill(PW)
  await ep.getByRole('button', { name: 'Activate my account' }).click()
  const signIn = async () => {
    await ep.goto('/login')
    await ep.getByLabel('Work email').fill(email); await ep.getByLabel('Password').fill(PW)
    await ep.getByRole('button', { name: 'Sign in' }).click()
  }
  await signIn()
  await expect(ep).not.toHaveURL(/\/login/)
  await ep.goto('/account/security')
  await ep.getByRole('button', { name: 'Set up two-factor login' }).click()
  const secret = (await ep.locator('p.font-mono').first().textContent())!.trim()
  await ep.getByLabel('6-digit code from the app').fill(totp(secret))
  await ep.getByRole('button', { name: 'Turn on two-factor login' }).click()
  await expect(ep.locator('ul.font-mono li')).toHaveCount(10)
  const codes = await ep.locator('ul.font-mono li').allTextContents()
  expect(codes.length).toBe(10)

  // sign out; a password alone no longer opens anything
  await ep.context().clearCookies()
  await signIn()
  await expect(ep).toHaveURL(/\/login\/verify/)
  await ep.goto('/students')
  await expect(ep).toHaveURL(/\/login/)
  // wrong code refused, the next authenticator code accepted
  await signIn()
  await ep.getByLabel('Code').fill('000000')
  await ep.getByRole('button', { name: 'Verify' }).click()
  await expect(ep.getByRole('alert').first()).toBeVisible()
  await ep.getByLabel('Code').fill(totp(secret, currentStep() + 1))
  await ep.getByRole('button', { name: 'Verify' }).click()
  await expect(ep).not.toHaveURL(/\/login/)
  // lost phone: a recovery code works once
  await ep.context().clearCookies()
  await signIn()
  await ep.getByLabel('Code').fill(codes[0])
  await ep.getByRole('button', { name: 'Verify' }).click()
  await expect(ep).not.toHaveURL(/\/login/)
  await ep.context().clearCookies()
  await signIn()
  await ep.getByLabel('Code').fill(codes[0])
  await ep.getByRole('button', { name: 'Verify' }).click()
  await expect(ep).toHaveURL(/\/login/)
  // the own security page shows sign-in activity
  await ep.context().clearCookies()
  await signIn()
  await ep.getByLabel('Code').fill(codes[1])
  await ep.getByRole('button', { name: 'Verify' }).click()
  await expect(ep).not.toHaveURL(/\/login/)
  await ep.goto('/account/security')
  await expect(ep.getByRole('heading', { name: 'Sign-in activity' })).toBeVisible()
  await expect(ep.getByRole('cell', { name: 'Recovery code used' }).first()).toBeVisible()
  await ctx.close()

  // the MD (users.mfa_reset) sees the reset option with a verification note; it is not offered without that permission
  await page.goto(`/admin/users?q=${n}`)
  await expect(page.getByPlaceholder('How was their identity verified?')).toBeVisible()
})

test('unscanned file: shown as "Not virus-scanned"; MD gives MANUAL clearance with a reason; shown as manual, never as scanned', async ({ page }) => {
  const [d] = await admin`select d.id, d.student_id from student_documents d join document_files f on f.id = d.current_file_id
    join students s on s.id = d.student_id join user_profiles u on u.id = f.uploaded_by
    where f.scan_status = 'not_scanned' and s.is_demo and s.originating_org_id = (select id from organizations where code = 'EDX') and u.email <> 'md@demo.test'
    order by f.uploaded_at desc limit 1`
  await login(page, 'md@demo.test')
  await page.goto(`/students/${d.student_id}/documents/${d.id}`)
  const panel = page.getByRole('region', { name: 'Virus scan' })
  await expect(panel.getByText('Not virus-scanned')).toBeVisible()
  await expect(panel.getByText(/cannot be approved or released for courier/)).toBeVisible()
  await panel.getByLabel('Manual clearance reason *').fill('Original seen in person at the office (fictional e2e)')
  await panel.getByRole('button', { name: 'Give manual clearance' }).click()
  await panel.getByRole('button', { name: 'Yes, continue' }).click()
  await expect(panel.getByText('Manually cleared (not scanned)')).toBeVisible()
  await expect(panel.getByText(/This is not an automated virus scan/)).toBeVisible()
  // a manager has no clearance option
  await login(page, 'edx.manager@demo.test')
  const [d2] = await admin`select d.id, d.student_id from student_documents d join document_files f on f.id = d.current_file_id join students s on s.id = d.student_id
    where f.scan_status = 'not_scanned' and s.is_demo and s.originating_org_id = (select id from organizations where code = 'EDX') limit 1`
  await page.goto(`/students/${d2.student_id}/documents/${d2.id}`)
  await expect(page.getByRole('region', { name: 'Virus scan' }).getByText('Not virus-scanned')).toBeVisible()
  await expect(page.getByLabel('Manual clearance reason *')).toHaveCount(0)
})

test('security alerts: repeated failed sign-ins appear for the MD, who acknowledges them; others have no access', async ({ page }) => {
  const email = `nobody.${Date.now().toString().slice(-6)}@example.test`
  await page.goto('/login')
  for (let i = 0; i < 5; i++) {
    await page.getByLabel('Work email').fill(email)
    await page.getByLabel('Password').fill('wrong-password-123')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('alert').first()).toBeVisible()
  }
  await login(page, 'md@demo.test')
  await expect(page.getByRole('link', { name: /Security alerts/ })).toBeVisible()
  await page.goto('/admin/security')
  const item = page.locator('li', { hasText: `Repeated failed sign-ins for ${email}` })
  await expect(item).toBeVisible()
  await item.getByPlaceholder(/What was checked/).fill('Fictional e2e: test account')
  await item.getByRole('button', { name: 'Acknowledge' }).click()
  await expect(item).toHaveCount(0) // moved out of the open list
  await page.goto('/admin/security?all=1')
  await expect(page.locator('li', { hasText: `Repeated failed sign-ins for ${email}` }).getByText('Acknowledged by Meera Menon (Demo MD)')).toBeVisible()
  for (const who of ['edx.manager@demo.test', 'admin@demo.test']) {
    await login(page, who)
    await expect(page.getByRole('link', { name: /Security alerts/ })).toHaveCount(0)
    await page.goto('/admin/security')
    await expect(page.getByText('You do not have permission to view security alerts.')).toBeVisible()
  }
})
