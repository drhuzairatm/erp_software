import { type Browser, expect, type Page, test } from '@playwright/test'
import { adminDb, login } from './helpers'
import { Evidence } from './evidence'

/** Phase 7, real browsers on the throwaway stack with fictional people: workflows 15 (submission), 16 (Documentation review), 17 (return and resubmission). */
const admin = adminDb()
test.afterAll(async () => { await admin.end() })
test.describe.configure({ timeout: 240_000 })

const C = 'edx.counsellor@demo.test'; const C2 = 'edx.counsellor2@demo.test'; const D = 'docs@demo.test'; const G = 'grd.manager@demo.test'; const MGR = 'edx.manager@demo.test'
const stamp = () => Date.now().toString().slice(-7)
const pdf = (name: string) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4\n% ${name} ${stamp()}\n%%EOF`) })
async function person(browser: Browser, ev: Evidence, email: string, role: string, viewport?: { width: number; height: number }) {
  const ctx = await browser.newContext(viewport ? { viewport } : {})
  const page = ev.watch(await ctx.newPage(), role)
  await login(page, email)
  return page
}
const status = async (id: string) => (await admin`select status from dvr_requests where id = ${id}`)[0].status as string
const until = (id: string, want: string) => expect.poll(() => status(id), { timeout: 20_000 }).toBe(want)
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
const doc = (page: Page, text: string) => page.getByTestId('dvr-document').filter({ hasText: text })

async function create(page: Page, name: string) {
  const [c] = await admin`select c.id, c.name, u.id as uni from countries c join universities u on u.country_id = c.id and u.is_active where c.is_active and c.is_destination limit 1`
  await page.goto('/pre-admission/new')
  await page.getByLabel('Company').last().selectOption({ label: 'Dr.Expert Edulinks' })
  await page.locator('#d-name').fill(name)
  await page.locator('#d-phone').fill('+91 90000 11111')
  await page.locator('#d-country').selectOption(c.id)
  await page.locator('#d-uni').selectOption(c.uni)
  await page.locator('#d-intake').fill('Fictional 2027')
  await page.locator('#d-remarks').fill('Fictional remark for Documentation')
  await page.locator('#d-special').fill('Fictional special instruction')
  await page.getByRole('button', { name: 'Save and add documents' }).click()
  await page.waitForURL(/\/pre-admission\/[0-9a-f-]{36}$/)
  return new URL(page.url()).pathname.split('/').pop()!
}
async function addDocs(page: Page, category: string, files: ReturnType<typeof pdf>[]) {
  const before = await page.getByTestId('dvr-document').count()
  await page.locator('#doc-cat').fill(category)
  await page.locator('#doc-files').setInputFiles(files)
  await page.getByRole('button', { name: 'Add documents' }).click()
  await expect(page.getByTestId('dvr-document')).toHaveCount(before + files.length)
}
async function review(page: Page, text: string, result: string, notes = '') {
  const box = doc(page, text)
  await box.getByLabel(/^Result for/).selectOption({ label: result })
  await box.getByLabel('Notes for the counsellor').fill(notes)
  await box.getByRole('button', { name: 'Save result' }).click()
  await expect(box.getByText(result, { exact: true }).first()).toBeVisible()
}

test('15, 16, 17: counsellor submits, Documentation reviews and sends back, counsellor corrects and resubmits, Documentation returns the assessment', async ({ browser }) => {
  const ev = new Evidence('15-17 pre-admission request, review, return and resubmission', [/status of 404/])
  const name = `Fictional Prospect ${stamp()}`
  const students = async () => (await admin`select count(*)::int as n from students`)[0].n as number
  const studentsBefore = await students()

  // 15: counsellor
  const c = await person(browser, ev, C, 'Counsellor')
  const id = await create(c, name)
  const url = `/pre-admission/${id}`
  const [{ dvr_number: number }] = await admin`select dvr_number from dvr_requests where id = ${id}`
  expect(number).toMatch(/^DVR-\d{4}-\d{6}$/)
  await expect(c.getByRole('heading', { name: number })).toBeVisible()
  await expect(c.getByText('not a guarantee of admission or a visa').first()).toBeVisible()
  await c.getByRole('button', { name: 'Submit to Documentation' }).click()
  await expect(c.getByText('Attach at least one document')).toBeVisible()
  await c.locator('#doc-cat').fill('Photo')
  await c.locator('#doc-files').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]) })
  await c.getByRole('button', { name: 'Add documents' }).click()
  await expect(c.getByText('Only PDF files are accepted')).toBeVisible()
  await expect(c.getByTestId('dvr-document')).toHaveCount(0)
  await addDocs(c, 'Marksheet', [pdf('grade-12.pdf'), pdf('grade-10.pdf')])
  await c.locator('#s-note').fill('Fictional note on submission')
  await c.getByRole('button', { name: 'Submit to Documentation' }).click()
  await until(id, 'new_request')

  // others in the company do not see it; Documentation does
  const other = await person(browser, ev, C2, 'Other counsellor')
  expect((await other.goto(url))?.status()).toBe(404)
  await other.close()

  // 16: Documentation
  const d = await person(browser, ev, D, 'Documentation')
  await d.goto('/pre-admission?view=unassigned')
  await d.getByRole('link', { name: new RegExp(number) }).click()
  await d.waitForURL(new RegExp(`${id}$`))
  await expect(d.getByText('Fictional special instruction')).toBeVisible()
  const [{ id: docsId }] = await admin`select id from user_profiles where email = ${D}`
  await d.locator('#a-rev').selectOption(docsId)
  await d.getByRole('button', { name: 'Save reviewer' }).click()
  await until(id, 'assigned')
  await d.reload()
  await d.getByRole('button', { name: 'Start verification' }).click()
  await until(id, 'under_verification')
  await d.reload()
  const fileHref = (await doc(d, 'grade-12.pdf').getByRole('link', { name: 'grade-12.pdf' }).getAttribute('href'))!
  expect((await d.request.get(fileHref, { maxRedirects: 0 })).status()).toBe(302)
  await review(d, 'grade-10.pdf', 'Verified')
  await review(d, 'grade-12.pdf', 'Correction required', 'Fictional: page two is cut off')
  await d.locator('#q-cat').fill('Passport copy')
  await d.locator('#q-notes').fill('Fictional: first page needed')
  await d.getByRole('button', { name: 'Record as missing' }).click()
  await expect(doc(d, 'Passport copy')).toBeVisible()
  await d.locator('#b-status').selectOption('correction_required')
  await d.locator('#b-note').fill('Fictional: see the document notes')
  await d.getByRole('button', { name: 'Save next step' }).click()
  await until(id, 'correction_required')

  // 17: back with the counsellor, who is told and sees feedback per document
  await c.goto('/my-notifications')
  await expect(c.getByRole('button', { name: /needs your action/ }).first()).toBeVisible()
  await expect(c.getByText(name)).toHaveCount(0) // generic text
  await c.goto(url)
  await expect(doc(c, 'grade-12.pdf').getByText('Fictional: page two is cut off').first()).toBeVisible()
  await c.locator('#s-note').fill('Fictional resubmission')
  await c.getByRole('button', { name: 'Resubmit to Documentation' }).click()
  await expect(c.getByText('Upload the missing or corrected documents')).toBeVisible()
  const upload = async (text: string, file: ReturnType<typeof pdf>) => {
    const box = doc(c, text)
    await box.locator('input[type=file]').setInputFiles(file)
    await box.getByRole('button', { name: 'Upload version' }).click()
    await expect(c.getByRole('link', { name: file.name })).toBeVisible()
  }
  await upload('grade-12.pdf', pdf('grade-12-corrected.pdf'))
  await upload('Passport copy', pdf('passport.pdf'))
  await expect(doc(c, 'grade-12-corrected.pdf').getByRole('link', { name: 'grade-12.pdf' })).toBeVisible() // the old version stays
  await expect(doc(c, 'grade-12-corrected.pdf').getByText('Version 2')).toBeVisible()
  await c.getByRole('button', { name: 'Resubmit to Documentation' }).click()
  await until(id, 'resubmitted')

  await d.reload()
  await d.getByRole('button', { name: 'Start verification' }).click()
  await until(id, 'under_verification')
  await d.reload()
  await doc(d, 'grade-12-corrected.pdf').getByText('Review history').click()
  await expect(doc(d, 'grade-12-corrected.pdf').getByText(/page two is cut off/).last()).toBeVisible()
  await review(d, 'grade-12-corrected.pdf', 'Verified')
  await review(d, 'passport.pdf', 'Verified')
  await d.locator('#c-overall').selectOption('possible_with_conditions')
  await d.locator('#c-notes').fill('Fictional: subject to a bridging course')
  await d.getByRole('button', { name: 'Record assessment' }).click()
  await until(id, 'verification_completed')
  await d.reload()
  await d.getByRole('button', { name: 'Return to counsellor' }).click()
  await until(id, 'returned_to_counselor')

  await c.goto(url)
  await expect(c.getByText('Possible With Conditions').or(c.getByText('Possible with conditions')).first()).toBeVisible()
  await expect(c.getByText('Fictional: subject to a bridging course')).toBeVisible()
  await expect(c.getByText('Registration is a separate step')).toBeVisible()
  expect(await students()).toBe(studentsBefore) // no student was created

  await ev.finish('Submitted, reviewed per document, sent back, corrected with versions kept, resubmitted, assessed and returned. No student was created.')
})

test('a change after start is logged and flagged; linking a student is explicit and keeps the DVR number', async ({ browser }) => {
  const ev = new Evidence('Pre-admission re-verification and explicit student link', [])
  const c = await person(browser, ev, MGR, 'Manager as counsellor')
  const id = await create(c, `Fictional Link ${stamp()}`)
  await addDocs(c, 'Marksheet', [pdf('a.pdf')])
  await c.getByRole('button', { name: 'Submit to Documentation' }).click()
  await until(id, 'new_request')
  const d = await person(browser, ev, D, 'Documentation')
  const [{ id: docsId }] = await admin`select id from user_profiles where email = ${D}`
  await d.goto(`/pre-admission/${id}`)
  await d.locator('#a-rev').selectOption(docsId)
  await d.getByRole('button', { name: 'Save reviewer' }).click()
  await until(id, 'assigned')
  await d.reload()
  await d.getByRole('button', { name: 'Start verification' }).click()
  await until(id, 'under_verification')
  await d.reload()
  await review(d, 'a.pdf', 'Verified')
  await d.locator('#c-overall').selectOption('possible')
  await d.getByRole('button', { name: 'Record assessment' }).click()
  await until(id, 'verification_completed')

  await c.reload()
  await c.getByText('Edit details').click()
  await c.locator('#d-intake').fill('Fictional 2028')
  await c.getByRole('button', { name: 'Save details' }).click()
  await until(id, 'pending_further_review')
  await c.reload()
  await expect(c.getByText('needs re-verification')).toBeVisible()
  await expect(c.getByText('Intake: Fictional 2027 → Fictional 2028')).toBeVisible()

  await d.reload()
  await d.getByRole('button', { name: 'Start verification' }).click()
  await until(id, 'under_verification')
  await d.reload()
  await d.getByRole('button', { name: 'Record assessment' }).click()
  await until(id, 'verification_completed')

  await c.reload()
  await expect(c.getByText('needs re-verification')).toHaveCount(0)
  const [st] = await admin`select s.id, s.student_code from students s join student_org_access a on a.student_id = s.id join organizations o on o.id = a.org_id and o.code = 'EDX' where s.archived_at is null and s.status = 'active' limit 1`
  const [before] = await admin`select updated_at from students where id = ${st.id}`
  await c.locator('#l-code').fill(st.student_code)
  await c.getByRole('button', { name: 'Link student' }).click()
  await expect(c.getByRole('link', { name: st.student_code })).toBeVisible()
  expect((await admin`select updated_at from students where id = ${st.id}`)[0].updated_at).toEqual(before.updated_at)
  await c.goto(`/students/${st.id}`)
  const [{ dvr_number: number }] = await admin`select dvr_number from dvr_requests where id = ${id}`
  await expect(c.getByRole('link', { name: number })).toBeVisible()
  await ev.finish('Change logged and flagged, re-verified, then linked to an existing student without changing the student.')
})

test('phone: counsellor and Documentation can do the work with no sideways scrolling', async ({ browser }) => {
  const ev = new Evidence('Pre-admission on a phone viewport', [])
  const phone = { width: 390, height: 844 }
  const c = await person(browser, ev, C, 'Counsellor, phone', phone)
  const id = await create(c, `Fictional Phone ${stamp()}`)
  await noOverflow(c)
  await addDocs(c, 'Marksheet', [pdf('a-long-file-name-that-should-wrap-on-a-small-screen-without-trouble.pdf')])
  await noOverflow(c)
  await c.getByRole('button', { name: 'Submit to Documentation' }).click()
  await until(id, 'new_request')
  const d = await person(browser, ev, D, 'Documentation, phone', phone)
  const [{ id: docsId }] = await admin`select id from user_profiles where email = ${D}`
  await d.goto('/pre-admission')
  await noOverflow(d)
  await d.goto(`/pre-admission/${id}`)
  await d.locator('#a-rev').selectOption(docsId)
  await d.getByRole('button', { name: 'Save reviewer' }).click()
  await until(id, 'assigned')
  await d.reload()
  await d.getByRole('button', { name: 'Start verification' }).click()
  await until(id, 'under_verification')
  await d.reload()
  await noOverflow(d)
  await review(d, 'a-long-file-name', 'Verified')
  await noOverflow(d)
  await ev.finish('Create, upload, submit, assign, start and review all worked at 390 px with no sideways scrolling.')
})

test('23: other company, wrong role and signed-out users are refused pages and files', async ({ browser, request }) => {
  const ev = new Evidence('Pre-admission unauthorized access', [/status of 404/])
  const c = await person(browser, ev, C, 'Counsellor')
  const id = await create(c, `Fictional Refuse ${stamp()}`)
  await addDocs(c, 'Marksheet', [pdf('secret.pdf')])
  await c.getByRole('button', { name: 'Submit to Documentation' }).click()
  await until(id, 'new_request')
  const [f] = await admin`select f.id from secure_files f join dvr_documents d on d.id = f.context_id where f.context_type = 'dvr' and d.request_id = ${id}`
  const g = await person(browser, ev, G, 'Other company manager')
  expect((await g.goto(`/pre-admission/${id}`))?.status()).toBe(404)
  expect((await g.request.get(`/api/secure-files/${f.id}`, { maxRedirects: 0 })).status()).toBe(404)
  await g.goto('/pre-admission')
  await expect(g.getByText('Fictional Refuse')).toHaveCount(0)
  const fin = await person(browser, ev, 'grd.finance@demo.test', 'Finance')
  expect((await fin.goto('/pre-admission'))?.status()).toBe(404)
  expect((await fin.goto('/pre-admission/new'))?.status()).toBe(404)
  await expect(fin.getByRole('link', { name: 'Pre-admission' })).toHaveCount(0)
  expect((await request.get(`/api/secure-files/${f.id}`, { maxRedirects: 0 })).status()).toBe(404)
  await ev.finish('Refused with 404 in every case; the file stayed closed.')
})
