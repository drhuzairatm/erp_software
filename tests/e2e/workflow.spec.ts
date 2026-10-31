import { expect, test } from '@playwright/test'
import { adminDb, login } from './helpers'

const admin = adminDb()

test.afterAll(async () => { await admin.end() })

test('register a student, change stage, upload and review a document, add a task', async ({ page }) => {
  await login(page, 'edx.manager@demo.test')
  await page.getByLabel('Company').selectOption({ label: 'Dr.Expert Edulinks' })
  await page.goto('/students/new')
  const unique = Date.now().toString().slice(-5)
  await page.getByLabel('Full name (as on passport) *').fill(`E2E Test Student ${unique}`)
  await page.getByLabel('Primary phone', { exact: true }).fill(`+91 90000 9${unique.slice(-4)}`)
  await page.getByLabel('Secondary phone', { exact: true }).fill(`+91 90021 9${unique.slice(-4)}`)
  await page.locator('#email').fill(`e2e.${unique}@example.test`)
  await page.getByLabel('Destination country').selectOption({ label: 'Russia' })
  await page.getByLabel('Course').selectOption({ label: 'MBBS' })
  await page.getByRole('button', { name: 'Register student' }).click()
  await expect(page.getByText(/Student registered with ID EDX-\d{2}-\d{6}/)).toBeVisible()

  // Stage change with warnings
  await page.getByLabel('Move to').selectOption({ label: 'Registration' })
  await page.getByRole('button', { name: 'Update stage' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Stage updated' })).toBeVisible()
  await page.getByLabel('Move to').selectOption({ label: 'University Application' })
  await page.getByRole('button', { name: 'Update stage' }).click()
  await expect(page.getByText(/required document\(s\) are not yet approved/)).toBeVisible()
  await page.getByLabel('I understand and want to continue').check()
  await page.getByRole('button', { name: 'Update stage' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Stage updated' })).toBeVisible()

  // Documents
  await page.getByRole('link', { name: 'Documents' }).click()
  const passport = page.locator('li', { hasText: 'Passport' }).first()
  await passport.locator('input[type=file]').setInputFiles({ name: 'passport.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% fictional e2e\n') })
  await passport.getByRole('button', { name: 'Upload' }).click()
  await expect(passport.getByText('Uploaded – pending review').first()).toBeVisible()
  const profileUrl = page.url()
  await passport.getByRole('link', { name: 'Open review' }).click()
  const rejectForm = page.locator('form', { has: page.getByRole('button', { name: 'Reject' }) })
  await rejectForm.getByPlaceholder('Reason (required)').fill('Blurred (e2e)')
  await rejectForm.getByRole('button', { name: 'Reject' }).click()
  await expect(page.getByText('Reason: Blurred (e2e)')).toBeVisible()
  await page.goto(profileUrl)
  await expect(page.locator('li', { hasText: 'Passport' }).first().getByText('Rejected: Blurred (e2e)')).toBeVisible()

  // Task
  await page.goto(page.url().replace(/\?.*$/, '') + '?tab=tasks')
  await page.getByLabel('Task').fill('Call student about passport')
  await page.getByRole('button', { name: 'Create task' }).click()
  await expect(page.getByRole('link', { name: 'Call student about passport' })).toBeVisible()

  // Timeline shows the events
  await page.goto(page.url().replace(/\?.*$/, '') + '?tab=timeline')
  await expect(page.getByText('Student registered')).toBeVisible()
  await expect(page.getByText(/Registration → University Application/)).toBeVisible()
  await expect(page.getByText(/Passport: uploaded → rejected/)).toBeVisible()
})

test('a duplicate phone number triggers a warning', async ({ page }) => {
  await login(page, 'grd.counsellor@demo.test')
  const [{ phone }] = await admin`select s.phone from students s join organizations o on o.id = s.originating_org_id where o.code = 'EDX' and s.is_demo order by s.student_code limit 1`
  await page.goto('/students/new')
  await page.getByLabel('Full name (as on passport) *').fill('Duplicate Check Person')
  await page.getByLabel('Primary phone', { exact: true }).fill(phone)
  await page.getByRole('button', { name: 'Register student' }).click()
  await expect(page.getByText('Possible duplicate records')).toBeVisible()
  await expect(page.getByText(/A record in Dr.Expert Edulinks matches on phone. You cannot view it/)).toBeVisible()
})

test('finance verification requires a second person and CSV export works', async ({ page }) => {
  // a fresh fictional receipt recorded by the FIRST finance user (the dev database is not reset between runs)
  const db = adminDb()
  await db.begin(async (tx) => {
    const [u] = await tx`select id from user_profiles where email = 'edx.finance@demo.test'`
    await tx`select set_config('app.user_id', ${u.id}, true)`
    await tx`insert into payment_entries (org_id, student_id, entry_type, fee_category_id, amount, currency, entry_date, method, reference_no)
             select o.id, s.id, 'receipt', f.id, 1000, 'INR', current_date, 'upi', 'E2E-' || floor(random() * 1e6)::text
               from organizations o join students s on s.originating_org_id = o.id and s.is_demo and s.status = 'active'
               join fee_categories f on f.org_id = o.id and f.key = 'service_fee'
              where o.code = 'EDX' limit 1`
  })
  await db.end()
  await login(page, 'edx.finance2@demo.test')
  await page.goto('/payments?status=pending')
  const verifyButtons = page.getByRole('button', { name: 'Verify' })
  const before = await verifyButtons.count()
  expect(before).toBeGreaterThan(0)
  await verifyButtons.first().click()
  await expect(verifyButtons).toHaveCount(before - 1)
  const csv = await page.request.get('/api/reports/balances')
  expect(csv.status()).toBe(200)
  expect(await csv.text()).toContain('Outstanding')
  const pii = await page.request.get('/api/reports/student-list')
  expect(pii.status()).toBe(403)
})
