import { expect, test } from '@playwright/test'
import { adminDb, codeFrom, fromTestMailbox, login } from './helpers'

const admin = adminDb()
test.afterAll(async () => { await admin.end() })

test('student signs in with a code, sees progress, uploads a requested document', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  // repeated local runs reuse the same fictional student: age out earlier attempts so the hourly rate limit does not apply
  await admin`update auth_private.portal_challenges set created_at = created_at - interval '2 hours' where created_at > now() - interval '1 hour'`
  // a demo student with an email and a document they still need to send
  const [s] = await admin`
    select s.id, s.email from students s
     where s.is_demo and s.status = 'active' and s.email is not null and s.originating_org_id = (select id from organizations where code = 'GRD')
       and exists (select 1 from student_documents d where d.student_id = s.id and d.status = 'missing' and d.is_required)
     limit 1`
  await page.goto('/portal')
  await page.getByLabel('Email or mobile number you registered with').fill(s.email)
  const since = Date.now()
  await page.getByRole('button', { name: 'Send me a code' }).click()
  await expect(page).toHaveURL(/\/portal\/verify\?c=/)
  // test mode: the code is never stored; the dev server's local test mailbox has it (fictional student)
  const m = { code: codeFrom(await fromTestMailbox(s.email, 'portal_login_code', since)) }
  await page.getByLabel('6-digit code').fill(m.code === '000000' ? '111111' : '000000')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('That code is not correct')).toBeVisible()
  await page.getByLabel('6-digit code').fill(m.code)
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page.getByRole('heading', { name: 'Application progress' })).toBeVisible()
  await expect(page.getByText('GRADUATER').first()).toBeVisible()
  await expect(page.getByText(/Student ID GRD-/)).toBeVisible()
  const item = page.locator('li', { has: page.getByText('Please upload', { exact: true }) }).first()
  const docName = (await item.locator('span.font-semibold').first().innerText()).trim()
  await item.locator('input[type=file]').setInputFiles({ name: 'scan.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% fictional portal upload\n') })
  await item.getByRole('button', { name: 'Upload' }).click()
  await expect(page.getByText('Thank you – we received your document')).toBeVisible()
  await expect(page.locator('li', { hasText: docName }).getByText('Received – being checked')).toBeVisible()

  // a disguised file is refused
  const another = page.locator('li', { has: page.getByText('Please upload', { exact: true }) }).first()
  if (await another.count()) {
    await another.locator('input[type=file]').setInputFiles({ name: 'x.pdf', mimeType: 'application/pdf', buffer: Buffer.from('MZ not a pdf') })
    await another.getByRole('button', { name: 'Upload' }).click()
    await expect(page.getByText('Please upload a PDF, JPEG, PNG or WebP file.')).toBeVisible()
  }

  // the student cannot reach staff pages or APIs with their portal session
  expect((await page.request.get('/api/students/import-template')).status()).toBe(404)
  await page.goto('/students')
  await expect(page).toHaveURL(/\/login/)

  await page.goto('/portal/home')
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByText('You have signed out.')).toBeVisible()
  await page.goto('/portal/home')
  await expect(page).toHaveURL(/\/portal$/)

  // staff see the upload as coming from the portal
  await page.setViewportSize({ width: 1280, height: 900 })
  await login(page, 'grd.manager@demo.test')
  await page.goto(`/students/${s.id}?tab=documents`)
  await expect(page.getByText(/uploaded .* by Student \(portal\)/).first()).toBeVisible()
})

test('unknown identifiers get the same response', async ({ page }) => {
  await page.goto('/portal')
  await page.getByLabel('Email or mobile number you registered with').fill('nobody.at.all@example.test')
  await page.getByRole('button', { name: 'Send me a code' }).click()
  await expect(page).toHaveURL(/\/portal\/verify\?c=/)
  await expect(page.getByText('If we found your details')).toBeVisible()
})
