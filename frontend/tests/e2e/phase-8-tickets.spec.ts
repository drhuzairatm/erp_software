import { type Browser, expect, type Page, test } from '@playwright/test'
import { adminDb, login } from './helpers'
import { Evidence } from './evidence'

/** Phase 8, real browsers on the throwaway stack with fictional people: workflow 18 (portal ticket creation and reply). */
const admin = adminDb()
test.afterAll(async () => { await admin.end() })
test.describe.configure({ timeout: 240_000 })
const stamp = () => Date.now().toString().slice(-5)
const pdf = (name: string) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4\n% ${name} ${stamp()}\n%%EOF`) })
const FICTIONAL_PASSWORD = 'Fictional-Pass-2026!'

/** Registers a fictional student with a portal account through the real screens, and signs them in on a phone viewport. */
async function studentWithPortal(browser: Browser, staff: Page, ev: Evidence, role: string) {
  await staff.goto('/students/new')
  const n = `${stamp()}`
  await staff.getByLabel('Full name (as on passport) *').fill(`Fictional Asker ${n}`)
  await staff.getByLabel('Primary phone', { exact: true }).fill(`+91 90070 ${n}`)
  await staff.getByLabel('Secondary phone', { exact: true }).fill(`+91 90071 ${n}`)
  await staff.locator('#email').fill(`portal.ask.${n}@example.test`)
  await staff.getByRole('button', { name: 'Register student' }).click()
  await expect(staff.getByText(/Student registered with ID/)).toBeVisible()
  const code = (await staff.getByText(/Student registered with ID/).innerText()).match(/[A-Z]{3}-\d{2}-\d{6}/)![0]
  await staff.getByRole('button', { name: 'Create account & issue set-up link' }).click()
  const linkBox = staff.getByLabel('One-time link (shown only now)')
  await expect(linkBox).toBeVisible()
  const link = new URL(await linkBox.inputValue())
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = ev.watch(await ctx.newPage(), role)
  await page.goto(link.pathname + link.search)
  await page.getByLabel('New password').fill(FICTIONAL_PASSWORD)
  await page.getByLabel('Repeat the password').fill(FICTIONAL_PASSWORD)
  await page.getByRole('button', { name: 'Save password' }).click()
  await expect(page.getByText('Your password is saved. Sign in below.')).toBeVisible()
  await page.getByLabel('Student ID or verified email').fill(code)
  await page.getByLabel('Password', { exact: true }).fill(FICTIONAL_PASSWORD)
  await page.getByRole('button', { name: 'Sign in with password' }).click()
  await expect(page.getByRole('heading', { name: 'Application progress' })).toBeVisible()
  return { page, code, n }
}
async function person(browser: Browser, ev: Evidence, email: string, role: string) {
  const ctx = await browser.newContext()
  const page = ev.watch(await ctx.newPage(), role)
  await login(page, email)
  return page
}
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)

test('18: a student asks with an attachment, staff reply with one, the student replies; statuses, notices and history follow', async ({ browser }) => {
  const ev = new Evidence('18 portal ticket creation and reply', [/status of 404/])
  const mgr = await person(browser, ev, 'edx.manager@demo.test', 'Manager')
  await mgr.getByLabel('Company').selectOption({ label: 'Dr.Expert Edulinks' })
  const { page: s, n } = await studentWithPortal(browser, mgr, ev, 'Student on a phone')
  const subject = `Fictional question ${n}`

  await s.getByRole('link', { name: 'Open my questions' }).click()
  await s.waitForURL(/\/portal\/tickets$/)
  await s.locator('#q-cat').selectOption('documents')
  await s.locator('#q-subject').fill(subject)
  await s.locator('#q-body').fill('Fictional: which marksheet do you need?')
  await s.locator('#q-files').setInputFiles({ name: 'bad.pdf', mimeType: 'application/pdf', buffer: Buffer.from('MZ not a pdf') })
  await s.getByRole('button', { name: 'Send question' }).click()
  await expect(s.getByText('Only PDF, JPEG, PNG or WebP')).toBeVisible()
  expect((await admin`select count(*)::int as n from student_tickets where subject = ${subject}`)[0].n).toBe(0) // a refused file leaves nothing half-sent
  await s.locator('#q-files').setInputFiles(pdf('my-marksheet.pdf'))
  await s.getByRole('button', { name: 'Send question' }).click()
  await s.waitForURL(/\/portal\/tickets\/[0-9a-f-]{36}\?new=1/)
  const [{ id, ticket_number: number }] = await admin`select id, ticket_number from student_tickets where subject = ${subject}`
  await expect(s.getByText(number).first()).toBeVisible()
  await noOverflow(s)

  // staff are told and find it
  await mgr.goto('/my-notifications')
  await expect(mgr.getByRole('button', { name: /A student asked a new question/ }).first()).toBeVisible()
  await expect(mgr.getByText(subject)).toHaveCount(0) // notification text is generic
  await mgr.goto(`/tickets?q=${number}`)
  await mgr.getByRole('link', { name: new RegExp(number) }).click()
  await mgr.waitForURL(new RegExp(`/tickets/${id}$`))
  const href = (await mgr.getByRole('link', { name: 'my-marksheet.pdf' }).getAttribute('href'))!
  expect((await mgr.request.get(href, { maxRedirects: 0 })).status()).toBe(302)
  const [{ id: docs }] = await admin`select id from user_profiles where email = 'docs@demo.test'`
  await mgr.locator('#as-user').selectOption(docs)
  await mgr.getByRole('button', { name: 'Save assignment' }).click()
  await expect.poll(async () => (await admin`select assigned_to from student_tickets where id = ${id}`)[0].assigned_to).toBe(docs)
  await mgr.locator('#t-body').fill('Fictional: please send the Grade 12 marksheet.')
  await mgr.locator('#t-files').setInputFiles(pdf('checklist.pdf'))
  await mgr.getByRole('button', { name: 'Send reply' }).click()
  await expect.poll(async () => (await admin`select status from student_tickets where id = ${id}`)[0].status).toBe('waiting_for_student')

  // the student reads it, downloads the file, and replies
  await s.goto('/portal/home')
  await expect(s.getByText('We replied to your question').first()).toBeVisible()
  await s.goto(`/portal/tickets/${id}`)
  await expect(s.getByText('Fictional: please send the Grade 12 marksheet.')).toBeVisible()
  await expect(s.getByText('Our team').first()).toBeVisible()
  await expect(s.getByText('Joseph Mathew')).toHaveCount(0) // staff names stay internal
  const fileHref = (await s.getByRole('link', { name: 'checklist.pdf' }).getAttribute('href'))!
  const got = await s.request.get(fileHref)
  expect(got.status()).toBe(200)
  expect((await got.body()).subarray(0, 4).toString()).toBe('%PDF')
  await s.locator('#r-body').fill('Fictional: attached, thank you.')
  await s.getByRole('button', { name: 'Send reply' }).click()
  await expect.poll(async () => (await admin`select status from student_tickets where id = ${id}`)[0].status).toBe('in_progress')
  await s.reload()
  await expect(s.getByText('Fictional: attached, thank you.')).toBeVisible()
  await noOverflow(s)

  // closing is final for the student, with history kept
  await mgr.reload()
  await expect(mgr.getByText('Fictional: attached, thank you.')).toBeVisible()
  await mgr.locator('#st-status').selectOption('closed')
  await mgr.locator('#st-note').fill('Fictional internal note')
  await mgr.getByRole('button', { name: 'Save status' }).click()
  await expect.poll(async () => (await admin`select status from student_tickets where id = ${id}`)[0].status).toBe('closed')
  await s.reload()
  await expect(s.getByText('This question is closed.')).toBeVisible()
  await expect(s.getByRole('button', { name: 'Send reply' })).toHaveCount(0)
  await expect(s.getByText('Fictional internal note')).toHaveCount(0)
  await s.goto('/portal/tickets?status=closed')
  await expect(s.getByRole('link', { name: subject })).toBeVisible()
  await s.goto('/portal/tickets?status=open')
  await expect(s.getByRole('link', { name: subject })).toHaveCount(0)
  await ev.finish('Reference issued; a bad file left nothing behind; attachments went both ways; notifications generic; internal note and staff names hidden; closed question read-only.')
})

test('23: another student, another company, the wrong role and signed-out users are refused; the portal has no staff pages', async ({ browser, request }) => {
  const ev = new Evidence('Portal tickets unauthorized access', [/status of 404/, /status of 403/])
  const mgr = await person(browser, ev, 'edx.manager@demo.test', 'Manager')
  await mgr.getByLabel('Company').selectOption({ label: 'Dr.Expert Edulinks' })
  const a = await studentWithPortal(browser, mgr, ev, 'Student A')
  await a.page.goto('/portal/tickets')
  await a.page.locator('#q-cat').selectOption('visa')
  await a.page.locator('#q-subject').fill(`Fictional private ${a.n}`)
  await a.page.locator('#q-body').fill('Fictional private question')
  await a.page.locator('#q-files').setInputFiles(pdf('private.pdf'))
  await a.page.getByRole('button', { name: 'Send question' }).click()
  await a.page.waitForURL(/\/portal\/tickets\/[0-9a-f-]{36}/)
  const [{ id }] = await admin`select id from student_tickets where subject = ${`Fictional private ${a.n}`}`
  const [f] = await admin`select f.id from secure_files f join student_ticket_messages m on m.id = f.context_id where m.ticket_id = ${id}`

  await mgr.waitForTimeout(1100) // the student number uses the clock
  const b = await studentWithPortal(browser, mgr, ev, 'Student B')
  expect((await b.page.goto(`/portal/tickets/${id}`))?.status()).toBe(404)
  expect((await b.page.request.get(`/portal/tickets/files/${f.id}`)).status()).toBe(404)
  await b.page.goto('/portal/tickets')
  await expect(b.page.getByText('Fictional private')).toHaveCount(0)
  // a student session opens no staff pages and no staff file route
  for (const path of ['/tickets', `/tickets/${id}`, '/chat', '/meetings', '/tasks', '/payments', '/admin/users', '/students']) {
    const res = await b.page.goto(path)
    expect(new URL(b.page.url()).pathname === path && res?.status() === 200, `${path} must not open for a student`).toBe(false)
  }
  expect((await b.page.request.get(`/api/secure-files/${f.id}`, { maxRedirects: 0 })).status()).toBe(404)

  const g = await person(browser, ev, 'grd.manager@demo.test', 'Other company manager')
  expect((await g.goto(`/tickets/${id}`))?.status()).toBe(404)
  expect((await g.request.get(`/api/secure-files/${f.id}`, { maxRedirects: 0 })).status()).toBe(404)
  const sa = await person(browser, ev, 'admin@demo.test', 'System Admin')
  expect((await sa.goto('/tickets'))?.status()).toBe(404)
  await expect(sa.getByRole('link', { name: 'Student questions' })).toHaveCount(0)
  expect((await request.get(`/portal/tickets/files/${f.id}`)).status()).toBe(404)
  expect((await request.get(`/api/secure-files/${f.id}`, { maxRedirects: 0 })).status()).toBe(404)
  await ev.finish('Every attempt was refused; the other student, company and System Admin got 404; staff pages did not open from a student session.')
})
