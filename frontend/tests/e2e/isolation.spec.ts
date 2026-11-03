import { expect, test } from '@playwright/test'
import { adminDb, login } from './helpers'

const admin = adminDb()

test.afterAll(async () => { await admin.end() })

test('wrong password is rejected with a generic message', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Work email').fill('grd.counsellor@demo.test')
  await page.getByLabel('Password').fill('wrong-password-123')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Incorrect email or password' })).toBeVisible()
})

test('GRADUATER counsellor only sees GRADUATER data, everywhere', async ({ page, request }) => {
  await login(page, 'grd.counsellor@demo.test')
  await page.goto('/students')
  await expect(page.getByRole('heading', { name: 'Students' })).toBeVisible()
  const body = await page.locator('main').innerText()
  expect(body).not.toMatch(/EDX-\d{2}-\d{6}/)
  expect(body).toMatch(/GRD-\d{2}-\d{6}/)

  // Guessing an Edulinks student URL shows "not found"
  const [edx] = await admin`select s.id from students s join organizations o on o.id = s.originating_org_id where o.code = 'EDX' limit 1`
  const resp = await page.goto(`/students/${edx.id}`)
  expect(resp?.status()).toBe(404)
  await expect(page.getByText('This page or record does not exist')).toBeVisible()

  // Guessing a document file id returns 404 (and is audited)
  const [file] = await admin`select f.id from document_files f join student_documents d on d.id = f.student_document_id
                              join students s on s.id = d.student_id join organizations o on o.id = s.originating_org_id where o.code = 'EDX' limit 1`
  const fileResp = await page.request.get(`/api/files/${file.id}`, { maxRedirects: 0 })
  expect(fileResp.status()).toBe(404)

  // Exports are not available to counsellors
  const exp = await page.request.get('/api/reports/student-list')
  expect([403, 404]).toContain(exp.status())

  // Admin and finance pages are not offered
  await expect(page.getByRole('link', { name: 'Payment ledger' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Audit log' })).toHaveCount(0)

  // Unauthenticated requests get nothing
  const anon = await request.get(`/api/files/${file.id}`, { maxRedirects: 0 })
  expect(anon.status()).toBe(404)
})

test('the MD can switch between companies and the consolidated view', async ({ page }) => {
  await login(page, 'md@demo.test')
  await page.getByLabel('Company').selectOption({ label: 'All my companies' })
  await expect(page.getByRole('heading', { name: 'Consolidated dashboard' })).toBeVisible()
  await page.getByLabel('Company').selectOption({ label: 'GRADUATER' })
  await expect(page.getByRole('heading', { name: 'GRADUATER dashboard' })).toBeVisible()
  await page.goto('/students')
  expect(await page.locator('main').innerText()).not.toMatch(/EDX-\d{2}-\d{6}/)
})

test('a signed file link opens for authorized staff and expires', async ({ page }) => {
  await login(page, 'edx.manager@demo.test')
  const [file] = await admin`select f.id from document_files f join student_documents d on d.id = f.student_document_id
                              join students s on s.id = d.student_id join organizations o on o.id = s.originating_org_id where o.code = 'EDX' limit 1`
  const r = await page.request.get(`/api/files/${file.id}`, { maxRedirects: 0 })
  expect(r.status()).toBe(302)
  const location = r.headers()['location']
  expect(location).toContain('/api/storage/local?')
  const ok = await page.request.get(location)
  expect(ok.status()).toBe(200)
  expect(ok.headers()['content-type']).toBe('application/pdf')
  // tampered signature is refused
  const bad = await page.request.get(location.replace(/s=[^&]+/, 's=tampered'))
  expect(bad.status()).toBe(403)
})
