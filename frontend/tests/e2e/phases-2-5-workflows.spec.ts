import { expect, type Browser, type BrowserContextOptions, test } from '@playwright/test'
import { adminDb, login } from './helpers'
import { Evidence } from './evidence'

/** Browser workflows for Phases 2 to 5: profile, attendance, task lifecycle, meetings. Throwaway stack, fictional accounts. */
const admin = adminDb()
test.afterAll(async () => { await admin.end() })
test.describe.configure({ timeout: 180_000 })
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } })

const stamp = () => Date.now().toString().slice(-7)
const india = (days = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() + days * 86_400_000))
const idOf = async (email: string) => (await admin`select id, full_name from user_profiles where email = ${email}`)[0] as { id: string; full_name: string }
async function person(browser: Browser, ev: Evidence, email: string, role: string, options: BrowserContextOptions = {}) {
  const page = ev.watch(await (await browser.newContext(options)).newPage(), role)
  await login(page, email)
  return page
}

test('employee profile: editing, display name across the ERP, no change to the MD role', async ({ browser }) => {
  const ev = new Evidence('Employee login and profile editing'); const s = stamp()
  const email = 'edx.counsellor2@demo.test'; const { full_name: original } = await idOf(email)
  const p = await person(browser, ev, email, 'counsellor')
  await p.goto('/account/profile')
  await p.getByLabel('Display name (shown across the ERP)').fill(`Fictional Name ${s}`)
  await p.getByLabel('Secondary phone').fill('+91 90000 11111')
  await p.getByRole('button', { name: 'Save my details' }).click()
  await expect(p.getByText(/saved|updated/i).first()).toBeVisible()
  await p.reload()
  await expect(p.getByLabel('Display name (shown across the ERP)')).toHaveValue(`Fictional Name ${s}`)
  await expect(p.getByLabel('Secondary phone')).toHaveValue('+91 90000 11111')
  await expect(p.getByText(`Fictional Name ${s}`).first()).toBeVisible()
  await p.getByLabel('Display name (shown across the ERP)').fill(original)
  await p.getByRole('button', { name: 'Save my details' }).click()
  await expect(p.getByText(/saved|updated/i).first()).toBeVisible()
  await p.goto('/admin/users')
  await expect(p.getByText('You do not have permission to manage staff.')).toBeVisible()
  await expect(p.getByRole('table')).toHaveCount(0)

  // Managing Director: a new display name removes nothing
  const mdEmail = 'md@demo.test'; const { full_name: mdName } = await idOf(mdEmail)
  const md = await person(browser, ev, mdEmail, 'MD')
  await md.goto('/account/profile')
  await md.getByLabel('Display name (shown across the ERP)').fill(`Fictional MD ${s}`)
  await md.getByRole('button', { name: 'Save my details' }).click()
  await expect(md.getByText(/saved|updated/i).first()).toBeVisible()
  await md.goto('/admin/users')
  await expect(md.getByText('You do not have permission to manage staff.')).toHaveCount(0)
  await expect(md.getByRole('table').first()).toBeVisible()
  await md.goto('/account/profile')
  await md.getByLabel('Display name (shown across the ERP)').fill(mdName)
  await md.getByRole('button', { name: 'Save my details' }).click()
  await expect(md.getByText(/saved|updated/i).first()).toBeVisible()
  await ev.finish('Details saved and reloaded; counsellor still refused /admin/users; MD keeps /admin/users after a display name change')
})

test('attendance: check in with location and camera, break, check out', async ({ browser }) => {
  const ev = new Evidence('Attendance check-in and check-out')
  const p = await person(browser, ev, 'edx.counsellor2@demo.test', 'counsellor', { permissions: ['geolocation', 'camera'], geolocation: { latitude: 12.9716, longitude: 77.5946, accuracy: 15 } })
  await p.goto('/attendance')
  await expect(p.getByRole('status').filter({ hasText: 'Location shared' })).toBeVisible()
  await p.getByRole('button', { name: 'Turn on camera' }).click()
  await p.getByRole('button', { name: 'Take photo' }).click()
  await expect(p.getByAltText('Your attendance capture')).toBeVisible()
  await p.getByRole('button', { name: 'Check in', exact: true }).click()
  await expect(p.getByRole('button', { name: 'Start break' })).toBeVisible({ timeout: 20_000 })
  await p.getByRole('button', { name: 'Start break' }).click()
  await expect(p.getByRole('button', { name: 'End break' })).toBeVisible({ timeout: 20_000 })
  await p.getByRole('button', { name: 'End break' }).click()
  await expect(p.getByRole('button', { name: 'Check out' })).toBeVisible({ timeout: 20_000 })
  await p.getByRole('button', { name: 'Check out' }).click()
  await expect(p.getByText('You have finished for today.')).toBeVisible({ timeout: 20_000 })
  const [r] = await admin`select r.check_in_at, r.check_out_at, (select count(*)::int from attendance_events e where e.record_id = r.id) as events,
    (select count(*)::int from secure_files f where f.context_type = 'attendance' and f.removed_at is null and f.uploaded_by = r.user_id) as photos
    from attendance_records r join user_profiles u on u.id = r.user_id where u.email = 'edx.counsellor2@demo.test' and r.work_date = ${india()}`
  expect(r.check_in_at).toBeTruthy(); expect(r.check_out_at).toBeTruthy(); expect(r.events).toBeGreaterThanOrEqual(4); expect(r.photos).toBeGreaterThanOrEqual(1)
  await ev.finish('Fake camera and fixed location used. Server recorded check-in, break, check-out and a photo')
})

test('attendance manual review: a missing signal goes to a manager and never marks absent', async ({ browser }) => {
  const ev = new Evidence('Attendance manual review'); const email = 'grd.counsellor@demo.test'; const { full_name } = await idOf(email)
  const p = await person(browser, ev, email, 'other-company counsellor') // no location or camera permission given
  await p.goto('/attendance')
  await expect(p.getByRole('status').filter({ hasText: 'Location not shared' })).toBeVisible({ timeout: 20_000 })
  await p.getByRole('button', { name: 'Check in', exact: true }).click()
  await expect(p.getByRole('button', { name: 'Check out' })).toBeVisible({ timeout: 20_000 })

  const [rec] = await admin`select r.status, r.review_status from attendance_records r join user_profiles u on u.id = r.user_id where u.email = ${email} and r.work_date = ${india()}`
  expect(rec.status).not.toBe('absent')

  const other = await person(browser, ev, 'edx.manager@demo.test', 'manager, other company')
  await other.goto('/attendance/manage')
  await expect(other.getByTestId('review-row').filter({ hasText: full_name })).toHaveCount(0)

  const m = await person(browser, ev, 'grd.manager@demo.test', 'manager')
  await m.goto('/attendance/manage')
  const row = m.getByTestId('review-row').filter({ hasText: full_name })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Accept', exact: true }).click()
  await expect(m.getByTestId('review-row').filter({ hasText: full_name })).toHaveCount(0, { timeout: 20_000 })
  const [after] = await admin`select r.status, r.review_status from attendance_records r join user_profiles u on u.id = r.user_id where u.email = ${email} and r.work_date = ${india()}`
  expect(after.status).not.toBe('absent'); expect(after.review_status).toBe('accepted')
  await p.goto('/attendance/manage')
  await expect(p.getByText('You do not have access to this page.')).toBeVisible()
  await expect(p.getByTestId('review-row')).toHaveCount(0)
  await ev.finish('Check-in without location accepted and sent to review; same-company manager accepted it; other company saw nothing; employee refused the page; never absent')
})

test('tasks: assign, progress, evidence, corrections, approval, extension keeps the original deadline', async ({ browser }) => {
  const ev = new Evidence('Task assignment, employee submission, manager approval', [/status of 404/]); const s = stamp(); const title = `Fictional task ${s}`
  const { id: emp } = await idOf('edx.counsellor@demo.test')
  const m = await person(browser, ev, 'edx.manager@demo.test', 'manager'); const e = await person(browser, ev, 'edx.counsellor@demo.test', 'counsellor')
  const status = async () => (await admin`select status from tasks where title = ${title}`)[0]?.status // a saved decision, not a button that changed its label

  await m.goto('/tasks/new')
  await m.getByLabel('Company').last().selectOption({ label: 'Dr.Expert Edulinks' })
  await m.locator('#title').fill(title)
  await m.locator('#assignedTo').selectOption(emp)
  await m.locator('#dueDate').fill(india(2))
  await m.locator('#dueTime').fill('17:00')
  await m.locator('#completionInstructions').fill('Attach the fictional evidence.')
  await m.getByLabel('Evidence is required').check()
  await m.getByRole('button', { name: 'Create task' }).click()
  await expect(m).toHaveURL(/\/tasks\/[0-9a-f-]{36}/)
  const url = new URL(m.url()).pathname

  await e.goto(url)
  await e.locator('#progressPercent').fill('60')
  await e.getByRole('button', { name: 'Save progress' }).click()
  await expect(e.locator('#progressPercent')).toHaveValue('60')
  await e.getByRole('button', { name: 'Submit for review' }).click()
  await expect(e.getByRole('alert').filter({ hasText: /evidence/i })).toBeVisible() // evidence is required and none is attached
  await e.locator('#task-file').setInputFiles({ name: `evidence-${s}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4\n% ${s}\n%%EOF`) })
  await e.getByRole('button', { name: 'Upload' }).click()
  await expect(e.getByRole('link', { name: `evidence-${s}.pdf` })).toBeVisible()
  await e.locator('#submit-note').fill('First fictional submission')
  await e.getByRole('button', { name: 'Submit for review' }).click()
  await expect.poll(status).toBe('submitted')

  await m.goto(url)
  await m.locator('#review-note').fill('Please correct the fictional figure')
  await m.getByRole('button', { name: 'Request corrections' }).click()
  await expect.poll(status).toBe('in_progress')

  await e.goto(url)
  await expect(e.getByText('Please correct the fictional figure').first()).toBeVisible()
  await e.locator('#submit-note').fill('Second fictional submission')
  await e.getByRole('button', { name: 'Submit for review' }).click()
  await expect.poll(status).toBe('submitted')

  await m.goto(url)
  await m.locator('#ext-date').fill(india(5))
  await m.locator('#ext-time').fill('12:00')
  await m.locator('#ext-reason').fill('Fictional extension reason')
  await m.getByRole('button', { name: 'Extend deadline' }).click()
  await expect(m.getByText('Fictional extension reason').first()).toBeVisible({ timeout: 20_000 })
  const [t] = await admin`select id, status, to_char(original_due_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') as original, to_char(due_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') as current from tasks where title = ${title}`
  expect(t.original).toBe(`${india(2)} 17:00`)
  expect(t.current).toBe(`${india(5)} 12:00`)
  expect(t.status).toBe('submitted')

  await m.getByRole('button', { name: 'Approve' }).click()
  await expect.poll(async () => (await admin`select status from tasks where id = ${t.id}`)[0].status).toBe('completed')
  const reviews = await admin`select decision from task_reviews where task_id = ${t.id} order by created_at`
  expect(reviews.map((r) => r.decision)).toEqual(['submitted', 'corrections', 'submitted', 'approved'])

  const g = await person(browser, ev, 'grd.manager@demo.test', 'manager, other company')
  expect((await g.goto(url))?.status()).toBe(404)
  await ev.finish('Evidence rule enforced; correction round; approval completed it; original deadline preserved after extension; other company 404')
})

test('meetings: create, minutes, decision, action point to task, restricted to attendees', async ({ browser }) => {
  const ev = new Evidence('Meeting creation, minutes, decision to task', [/status of 404/]); const s = stamp(); const title = `Fictional core meeting ${s}`
  const a = await idOf('edx.counsellor@demo.test')
  const md = await person(browser, ev, 'md@demo.test', 'MD')
  await md.goto('/meetings')
  await md.getByText('New meeting', { exact: true }).click()
  await md.locator('#m-org').selectOption({ label: 'Dr.Expert Edulinks' })
  await md.locator('#m-title').fill(title)
  await md.locator('#m-date').fill(india())
  await md.locator('#m-time').fill('10:00')
  await md.locator('#m-agenda').fill('Fictional agenda')
  await md.locator(`input[name="attendees"][value="${a.id}"]`).check()
  await md.getByRole('button', { name: 'Create meeting' }).click()
  await expect(md).toHaveURL(/\/meetings\/[0-9a-f-]{36}/)
  const url = new URL(md.url()).pathname

  await md.locator('#min-notes').fill('Fictional discussion notes')
  await md.getByRole('button', { name: 'Save minutes' }).click()
  await expect(md.getByRole('heading', { name: /Minutes \(version 1\)/ })).toBeVisible({ timeout: 20_000 })
  await md.locator('#min-notes').fill('Fictional discussion notes, corrected')
  await md.locator('#min-reason').fill('Fictional correction')
  await md.getByRole('button', { name: 'Save minutes' }).click()
  await expect(md.getByRole('heading', { name: /Minutes \(version 2\)/ })).toBeVisible({ timeout: 20_000 })

  await md.locator('#dec-body').fill(`Fictional decision ${s}`)
  await md.getByRole('button', { name: 'Add decision' }).click()
  await expect(md.getByText(`Fictional decision ${s}`).first()).toBeVisible({ timeout: 20_000 })

  await md.locator('#act-desc').fill(`Fictional action ${s}`)
  await md.locator('#act-resp').selectOption(a.id)
  await md.locator('#act-date').fill(india(3))
  await md.getByRole('button', { name: 'Add action point' }).click()
  await expect(md.getByText(`Fictional action ${s}`).first()).toBeVisible({ timeout: 20_000 })
  await md.getByRole('button', { name: 'Create task', exact: true }).click()
  const open = md.getByRole('link', { name: /Open task/ })
  await expect(open).toBeVisible({ timeout: 20_000 })
  const taskHref = (await open.getAttribute('href'))!

  // the same task system: the assignee sees it, with its link to the meeting
  const e = await person(browser, ev, 'edx.counsellor@demo.test', 'attendee and assignee')
  await e.goto(taskHref)
  await expect(e.getByRole('heading', { name: `Fictional action ${s}` })).toBeVisible()
  await e.goto(url)
  await expect(e.getByTestId('minutes-text')).toHaveText('Fictional discussion notes, corrected')
  await expect(e.locator('#min-notes')).toHaveCount(0) // an attendee reads and does not edit

  for (const [who, email] of [['colleague not invited', 'edx.counsellor2@demo.test'], ['manager not invited', 'edx.manager@demo.test'], ['System Admin', 'admin@demo.test'], ['other company', 'grd.manager@demo.test']] as const) {
    const p = await person(browser, ev, email, who)
    expect((await p.goto(url))?.status(), who).toBe(404)
  }
  await ev.finish('Minutes versioned with a reason; decision and action point recorded; converted to a task in the existing system; uninvited staff, System Admin and other company 404')
})
