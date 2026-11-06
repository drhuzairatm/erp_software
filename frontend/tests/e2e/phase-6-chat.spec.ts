import { type Browser, expect, type Page, type Route, test } from '@playwright/test'
import { adminDb, login } from './helpers'
import { Evidence } from './evidence'

/** Phase 6, real browsers: several signed-in employees at once, on the throwaway stack with fictional accounts. */
const admin = adminDb()
test.afterAll(async () => { await admin.end() })
test.describe.configure({ timeout: 180_000 })

const A = 'edx.counsellor@demo.test'; const B = 'edx.counsellor2@demo.test'; const MGR = 'edx.manager@demo.test'; const MD = 'md@demo.test'; const G = 'grd.counsellor@demo.test'
const stamp = () => Date.now().toString().slice(-7)
const ids = async () => {
  const rows = await admin`select email, id, full_name from user_profiles where email in (${A}, ${B}, ${MGR}, ${MD}, ${G})`
  const [org] = await admin`select id from organizations where code = 'EDX'`
  return { org: org.id as string, u: Object.fromEntries(rows.map((r) => [r.email, r])) as Record<string, { id: string; full_name: string }> }
}
async function person(browser: Browser, ev: Evidence, email: string, role: string) {
  const ctx = await browser.newContext()
  const page = ev.watch(await ctx.newPage(), role)
  await login(page, email)
  return page
}
async function openDm(page: Page, org: string, other: string) {
  await page.goto('/chat')
  await page.getByText('New chat', { exact: true }).click()
  await page.locator('#chat-person').selectOption(`${org}|${other}`)
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(page).toHaveURL(/\/chat\?c=[0-9a-f-]{36}/)
  return new URL(page.url()).searchParams.get('c')!
}
async function say(page: Page, text: string) {
  await page.locator('#chat-body').fill(text)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(msg(page, text)).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('#chat-body')).toHaveValue('')
}
const msg = (page: Page, text: string) => page.getByTestId('chat-message').filter({ hasText: text }).first() // first: later replies may quote it
const more = async (page: Page, text: string) => {
  const m = msg(page, text)
  if (!(await m.locator('details').evaluate((d) => (d as HTMLDetailsElement).open))) await m.locator('summary').click()
  return m
}
const membersPanel = (page: Page) => page.locator('summary', { hasText: 'Members' })

test('one-to-one: live delivery, typing, unread count, notification, read receipt', async ({ browser }) => {
  const ev = new Evidence('One-to-one chat'); const { org, u } = await ids(); const t = `Hello fictional ${stamp()}`
  const a = await person(browser, ev, A, 'counsellor A'); const b = await person(browser, ev, B, 'counsellor B')
  const c = await openDm(a, org, u[B].id)
  await say(a, t)
  await expect(msg(a, t).getByTestId('receipt')).toContainText(/Sent|Delivered/)

  // the other person, not on the conversation: unread count and a notification that does not contain the text
  await b.goto('/chat')
  const row = b.getByTestId('conversation-list').getByRole('link').filter({ hasText: u[A].full_name })
  await expect(row).toContainText('1')
  await b.goto('/my-notifications')
  await expect(b.getByRole('button', { name: /You have a new direct message/ })).toBeVisible()
  await expect(b.getByRole('main').getByText(t)).toHaveCount(0) // the stored notification; the live alert is outside the page content
  await expect(msg(a, t).getByTestId('receipt')).toContainText('Delivered', { timeout: 15_000 })

  // opening it marks it read, and the sender sees that without reloading
  await b.goto(`/chat?c=${c}`)
  await expect(msg(b, t)).toBeVisible()
  await expect(msg(a, t).getByTestId('receipt')).toContainText('Read', { timeout: 15_000 })
  await expect(a.getByTestId('chat-status')).toHaveText('Online', { timeout: 15_000 })

  // typing, then a reply arriving live
  await b.locator('#chat-body').pressSequentially('typing a')
  await expect(a.getByTestId('chat-status')).toContainText('typing', { timeout: 10_000 })
  const reply = `Reply fictional ${stamp()}`
  await say(b, reply)
  await expect(msg(a, reply)).toBeVisible({ timeout: 15_000 })
  await b.goto('/chat')
  await expect(b.getByTestId('conversation-list').getByRole('link').filter({ hasText: u[A].full_name }).getByText(/^\d+$/)).toHaveCount(0)
  await ev.finish('Delivered live both ways; typing, unread, notification and Delivered/Read receipts all seen by the other account')
})

test('reply, edit, delete, reactions, pin and forward', async ({ browser }) => {
  const ev = new Evidence('Replies, editing, deletion and reactions'); const { org, u } = await ids(); const s = stamp()
  const a = await person(browser, ev, A, 'counsellor A'); const b = await person(browser, ev, B, 'counsellor B')
  const c = await openDm(a, org, u[B].id)
  await b.goto(`/chat?c=${c}`)
  const first = `First ${s}`; await say(a, first)
  await expect(msg(b, first)).toBeVisible({ timeout: 15_000 })

  await (await more(b, first)).getByRole('button', { name: 'Reply' }).click()
  await expect(b.getByText(`Replying to ${u[A].full_name}`)).toBeVisible()
  const reply = `Answer ${s}`; await say(b, reply)
  await expect(msg(a, reply)).toContainText(first, { timeout: 15_000 })

  // only the sender is offered Edit; the edit reaches the other side
  const onB = await more(b, first)
  await expect(onB.getByRole('button', { name: 'Edit' })).toHaveCount(0)
  await expect(onB.getByRole('button', { name: 'Delete' })).toHaveCount(0)
  await (await more(a, first)).getByRole('button', { name: 'Edit' }).click()
  await a.getByLabel('Edit message').fill(`Corrected ${s}`)
  await a.getByRole('button', { name: 'Save' }).click()
  await expect(msg(b, `Corrected ${s}`)).toContainText('edited', { timeout: 15_000 })

  const r = msg(b, `Corrected ${s}`)
  await r.getByRole('button', { name: 'React 👍' }).click()
  await expect(msg(a, `Corrected ${s}`).getByRole('button', { name: /👍 1/ })).toBeVisible({ timeout: 15_000 })
  await r.getByRole('button', { name: /👍 1/ }).click()
  await expect(msg(a, `Corrected ${s}`).getByRole('button', { name: /👍 1/ })).toHaveCount(0, { timeout: 15_000 })

  await (await more(a, `Corrected ${s}`)).getByRole('button', { name: 'Pin', exact: true }).click()
  await expect(b.getByRole('list', { name: 'Pinned messages' })).toContainText(`Corrected ${s}`, { timeout: 15_000 })

  const fwd = `Forward ${s}`; await say(a, fwd)
  const other = await openDm(a, org, u[MGR].id); await a.goto(`/chat?c=${c}`)
  await (await more(a, fwd)).getByRole('button', { name: 'Forward' }).click()
  await msg(a, fwd).getByLabel('Forward to').selectOption(other)
  await expect.poll(async () => (await admin`select count(*)::int as n from chat_messages where conversation_id = ${other} and body = ${fwd} and forwarded`)[0].n).toBe(1)
  await a.goto(`/chat?c=${other}`)
  await expect(msg(a, fwd)).toContainText('Forwarded')

  // delete leaves a marker for both, and the text is gone
  await a.goto(`/chat?c=${c}`)
  a.once('dialog', (d) => d.accept())
  const gone = `Delete ${s}`; await say(a, gone)
  await (await more(a, gone)).getByRole('button', { name: 'Delete' }).click()
  await expect(a.getByTestId('chat-messages').getByText(gone)).toHaveCount(0, { timeout: 15_000 })
  await expect(b.getByTestId('chat-messages').getByText(gone)).toHaveCount(0, { timeout: 15_000 })
  await expect(b.getByText('Message deleted').first()).toBeVisible()
  await ev.finish('Reply quoted, edit marked and propagated, reaction added and removed, pin shown, forward labelled, delete leaves only a marker')
})

test('task discussion: a message links to a task the sender can read', async ({ browser }) => {
  const ev = new Evidence('Chat task reference'); const { org, u } = await ids(); const s = stamp(); const title = `Fictional discussion task ${s}`
  const [task] = await admin`insert into tasks (org_id, title, assigned_to, created_by) values (${org}, ${title}, ${u[A].id}, ${u[MGR].id}) returning id`
  const a = await person(browser, ev, A, 'counsellor A'); const c = await openDm(a, org, u[B].id)
  await a.locator('#chat-task').selectOption(task.id)
  await say(a, `About this task ${s}`)
  const b = await person(browser, ev, B, 'counsellor B'); await b.goto(`/chat?c=${c}`)
  await expect(msg(b, `About this task ${s}`).getByRole('link', { name: new RegExp('Task:') })).toHaveAttribute('href', `/tasks/${task.id}`)
  await ev.finish('Message carries the task link; the task page keeps its own access rules')
})

test('attachments: secure download for members, refused for everyone else', async ({ browser, request }) => {
  const ev = new Evidence('File sharing in chat'); const { org, u } = await ids(); const s = stamp()
  const a = await person(browser, ev, A, 'counsellor A'); const b = await person(browser, ev, B, 'counsellor B')
  const c = await openDm(a, org, u[B].id)
  await b.goto(`/chat?c=${c}`)

  await a.locator('#chat-file').setInputFiles({ name: 'not-really.pdf', mimeType: 'application/pdf', buffer: Buffer.from('MZ this is not a pdf') })
  await a.locator('#chat-body').fill(`Bad file ${s}`)
  await a.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(a.getByText('Only PDF, JPEG, PNG or WebP files are accepted.')).toBeVisible()
  await expect(msg(a, `Bad file ${s}`)).toHaveCount(0)

  const marker = `fictional-${s}`
  await a.locator('#chat-file').setInputFiles({ name: `shared-${s}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4\n% ${marker}\n%%EOF`) })
  await a.locator('#chat-body').fill(`With file ${s}`)
  await a.getByRole('button', { name: 'Send', exact: true }).click()
  const link = msg(b, `With file ${s}`).getByRole('link', { name: new RegExp(`shared-${s}.pdf`) })
  await expect(link).toBeVisible({ timeout: 20_000 })
  await expect(link).toContainText('not virus-scanned')
  const href = (await link.getAttribute('href'))!

  expect((await b.request.get(href, { maxRedirects: 0 })).status()).toBe(302)
  const body = await b.request.get(href)
  expect(body.status()).toBe(200)
  expect(await body.text()).toContain(marker)

  for (const [who, email] of [['MD, not in this conversation', MD], ['manager', MGR], ['other company', G]] as const) {
    const p = await person(browser, ev, email, who)
    expect((await p.request.get(href, { maxRedirects: 0 })).status(), who).toBe(404)
  }
  expect((await request.get(href, { maxRedirects: 0 })).status()).toBe(404)
  await ev.finish('Disguised file refused with no message left; real PDF downloaded by the member; 404 for MD, manager, other company and signed out')
})

test('groups: permission, live messages, mention, member removal ends access', async ({ browser }) => {
  const ev = new Evidence('Group chat', [/status of 404/]); const { u } = await ids(); const s = stamp(); const name = `Fictional sales ${s}`
  const mgr = await person(browser, ev, MGR, 'manager'); const a = await person(browser, ev, A, 'counsellor A'); const b = await person(browser, ev, B, 'counsellor B')

  await a.goto('/chat')
  await expect(a.getByText('New group')).toHaveCount(0)

  await mgr.goto('/chat')
  await mgr.getByText('New group').click()
  await mgr.locator('#g-type').selectOption('sales')
  await mgr.locator('#g-name').fill(name)
  await mgr.locator(`input[name="members"][value="${u[A].id}"]`).check()
  await mgr.locator(`input[name="members"][value="${u[B].id}"]`).check()
  await mgr.getByRole('button', { name: 'Create group' }).click()
  await expect(mgr).toHaveURL(/\/chat\?c=/)
  const c = new URL(mgr.url()).searchParams.get('c')!
  await expect(mgr.getByRole('heading', { name })).toBeVisible()

  await a.goto(`/chat?c=${c}`); await b.goto(`/chat?c=${c}`)
  const hello = `Group hello ${s}`; await say(mgr, hello)
  await expect(msg(a, hello)).toBeVisible({ timeout: 15_000 })
  await expect(msg(b, hello)).toBeVisible({ timeout: 15_000 })
  await expect(mgr.getByTestId('chat-status')).toHaveText('3 members')
  const fromA = `Member reply ${s}`; await say(a, fromA)
  await expect(msg(mgr, fromA)).toContainText(u[A].full_name, { timeout: 15_000 })

  await say(a, `Please see @${u[B].full_name} ${s}`)
  const bellPage = await b.context().newPage(); ev.watch(bellPage, 'counsellor B bell')
  await bellPage.goto('/my-notifications')
  await expect(bellPage.getByRole('button', { name: /You were mentioned in a chat/ })).toBeVisible()
  await bellPage.close()

  // an ordinary member does not manage membership; the admin removes one person, whose access ends at once
  await membersPanel(a).click()
  await expect(a.getByRole('button', { name: 'Remove' })).toHaveCount(0)
  await membersPanel(mgr).click()
  await mgr.getByRole('listitem').filter({ hasText: u[B].full_name }).getByRole('button', { name: 'Remove' }).click()
  await expect(mgr.getByTestId('chat-status')).toHaveText('2 members', { timeout: 15_000 })
  await b.goto(`/chat?c=${c}`)
  await expect(b.getByText('Choose a conversation.')).toBeVisible()
  expect((await b.request.get(`/api/chat/sync?c=${c}`)).status()).toBe(404)

  a.once('dialog', (d) => d.accept()) // leaving now asks for confirmation
  await a.getByRole('button', { name: 'Leave group' }).click()
  await expect(a.getByText(/no longer part of this conversation|Choose a conversation/)).toBeVisible({ timeout: 15_000 })
  expect((await a.request.get(`/api/chat/sync?c=${c}`)).status()).toBe(404)
  await ev.finish('Counsellor offered no group creation; manager-created group delivered live to members; mention notified; removed and departed members refused')
})

test('unauthorized access and company isolation', async ({ browser, request }) => {
  const ev = new Evidence('Chat unauthorized access', [/status of 404/]); const { org, u } = await ids(); const s = stamp(); const secret = `Private fictional ${s}`
  const a = await person(browser, ev, A, 'counsellor A')
  const c = await openDm(a, org, u[B].id)
  await say(a, secret)

  // signed in member: the proxied route works
  const own = await a.request.get(`/api/chat/sync?c=${c}`)
  expect(own.status()).toBe(200)
  expect(await own.text()).toContain(secret)

  for (const [who, email] of [['MD, not in this conversation', MD], ['manager', MGR], ['other company', G]] as const) {
    const p = await person(browser, ev, email, who)
    await p.goto(`/chat?c=${c}`)
    await expect(p.getByText('Choose a conversation.')).toBeVisible()
    await expect(p.getByText(secret)).toHaveCount(0)
    const res = await p.request.get(`/api/chat/sync?c=${c}`)
    expect(res.status(), who).toBe(404)
    expect(await res.text()).not.toContain(secret)
    await p.goto(`/chat?q=${encodeURIComponent(secret)}`)
    await expect(p.getByText('No messages found.')).toBeVisible()
  }

  // the other company is not offered as a person to message
  await a.goto('/chat')
  await expect(a.locator(`#chat-person option[value$="${u[G].id}"]`)).toHaveCount(0)
  await a.goto(`/chat?q=${encodeURIComponent(secret)}`)
  await expect(a.getByRole('link', { name: new RegExp(secret) }).first()).toBeVisible()

  expect((await request.get(`/api/chat/sync?c=${c}`)).status()).toBe(404)
  const signedOut = await browser.newContext(); const so = await signedOut.newPage()
  await so.goto(`/chat?c=${c}`)
  await expect(so).toHaveURL(/\/login/)
  await ev.finish('MD, manager and other-company accounts get no content by page, API or search; other company not selectable; signed out sent to login')
})

test('governance: an approved, logged read of deleted text; nobody else gets in', async ({ browser }) => {
  const ev = new Evidence('Chat governance and investigation access', [/status of 404/]); const { org, u } = await ids(); const s = stamp(); const original = `Deleted evidence ${s}`
  const HR = 'docs@demo.test'; const READER = 'ceo@demo.test'
  const people = await admin`select email, id, full_name from user_profiles where email in (${HR}, ${READER})`
  const of = (e: string) => people.find((p) => p.email === e)!
  const a = await person(browser, ev, A, 'counsellor A'); await openDm(a, org, u[B].id)
  a.once('dialog', (d) => d.accept())
  await say(a, original)
  await (await more(a, original)).getByRole('button', { name: 'Delete' }).click()
  await expect(a.getByTestId('chat-messages').getByText(original)).toHaveCount(0, { timeout: 15_000 })

  // the MD sees no retention running, names the authorities, and places a hold
  const md = await person(browser, ev, MD, 'MD'); const url = `/chat/governance?org=${org}`
  await md.goto(url)
  await expect(md.getByText('No retention policy is being applied.')).toBeVisible()
  for (const [email, cap] of [[HR, 'requester'], [READER, 'reader']] as const) {
    await md.locator('#del-user').selectOption(of(email).id)
    await md.locator('#del-cap').selectOption(cap)
    await md.locator('#del-reason').fill('Fictional Legal and HR responsibility')
    await md.getByRole('button', { name: 'Name this authority' }).click()
    await expect(md.getByTestId('delegates').getByText(of(email).full_name)).toBeVisible({ timeout: 15_000 })
  }
  await md.locator('#hold-ref').fill(`HOLD-${s}`)
  await md.locator('#hold-user').selectOption(u[A].id)
  await md.locator('#hold-reason').fill('A fictional formal investigation')
  await md.getByRole('button', { name: 'Place legal hold' }).click()
  await expect(md.getByTestId('holds').getByText(`HOLD-${s}`)).toBeVisible({ timeout: 15_000 })

  // HR requests; it does not open anything yet
  const hr = await person(browser, ev, HR, 'named requester')
  await hr.goto(url)
  await hr.getByText('New request').click()
  await hr.locator('#rq-ref').fill(`CASE-${s}`)
  await hr.locator('#rq-reader').selectOption(of(READER).id)
  await hr.locator('#rq-user').selectOption(u[A].id)
  await hr.locator('#rq-user2').selectOption(u[B].id)
  await hr.locator('#rq-reason').fill('A fictional formal complaint under review')
  await hr.getByRole('button', { name: 'Submit request' }).click()
  await expect(hr).toHaveURL(/\/chat\/governance\/[0-9a-f-]{36}/)
  const caseUrl = new URL(hr.url()).pathname
  await expect(hr.getByText(original)).toHaveCount(0)
  await expect(hr.getByRole('button', { name: 'Approve' })).toHaveCount(0)

  // ordinary staff, a manager, System Admin and the other company get nothing
  for (const [who, email] of [['manager', MGR], ['System Admin', 'admin@demo.test'], ['other company', G], ['counsellor', B]] as const) {
    const p = await person(browser, ev, email, who)
    await p.goto('/chat/governance')
    await expect(p.getByText('You do not have access to this page.'), who).toBeVisible()
    expect((await p.goto(caseUrl))?.status(), who).toBe(404)
  }

  // before approval the reader cannot open it, even with the address
  const r = await person(browser, ev, READER, 'named reader')
  await r.goto(`${caseUrl}?read=1`)
  await expect(r.getByText(original)).toHaveCount(0)

  await md.goto(caseUrl)
  await md.locator('#dc-note').fill('Fictional authorisation by the MD')
  await md.locator('#dc-days').fill('2')
  await md.getByRole('button', { name: 'Approve' }).click()
  await expect(md.getByText('Fictional authorisation by the MD')).toBeVisible({ timeout: 15_000 })
  await expect(md.getByRole('button', { name: 'Open the messages' })).toHaveCount(0) // the approver does not read

  await r.goto(caseUrl)
  await expect(r.getByText(original)).toHaveCount(0)
  await expect(r.getByText('Nobody has read these messages under this request.')).toBeVisible()
  await r.getByRole('button', { name: 'Open the messages' }).click()
  await expect(r.getByTestId('archive-messages').getByText(original)).toBeVisible({ timeout: 15_000 })
  await expect(r.getByTestId('access-log')).toContainText(/\d+ messages?/)

  // the MD can see who read and what, without the text
  await md.goto(caseUrl)
  await expect(md.getByTestId('access-log')).toContainText(of(READER).full_name)
  await expect(md.getByText(original)).toHaveCount(0)
  const [row] = await admin`select cardinality(l.message_ids)::int as n from chatgov_access_log l join chatgov_requests q on q.id = l.request_id where q.reference = ${`CASE-${s}`}`
  expect(row.n).toBeGreaterThan(0)
  await ev.finish('MD named authorities and placed a hold; HR requested; MD approved; only the named reader saw the deleted text; the read was logged; manager, System Admin, other company and staff were refused')
})

test('phone: list and conversation fit, and messages can be sent', async ({ browser }) => {
  const ev = new Evidence('Chat mobile'); const { org, u } = await ids(); const s = stamp()
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const a = ev.watch(await ctx.newPage(), 'counsellor A phone')
  await login(a, A)
  const c = await openDm(a, org, u[B].id)
  const fits = async () => { const m = await a.evaluate(() => ({ w: window.innerWidth, s: document.documentElement.scrollWidth })); expect(m.s).toBeLessThanOrEqual(m.w) }
  await say(a, `On a phone ${s} ${'long-unbroken-text-'.repeat(12)}`)
  await fits()
  await expect(a.getByRole('button', { name: 'Send', exact: true })).toBeInViewport()
  await expect(a.getByTestId('conversation-list')).toBeHidden() // one pane at a time
  await a.getByRole('link', { name: 'Back to conversations' }).click()
  await expect(a.getByTestId('conversation-list')).toBeVisible()
  await fits()
  await a.setViewportSize({ width: 320, height: 640 })
  await a.goto(`/chat?c=${c}`)
  await expect(msg(a, `On a phone ${s}`)).toBeVisible()
  await fits()
  // the message box stays usable on the smallest phone, with Send on screen
  expect((await a.locator('#chat-body').boundingBox())!.width).toBeGreaterThan(160) // beside the emoji, attach and Send buttons
  await expect(a.getByRole('button', { name: 'Send', exact: true })).toBeInViewport()
  await say(a, `Small phone ${s}`)
  await ev.finish('List and conversation one at a time; no sideways page scroll at 390px or 320px with a long unbroken message; send works')
})

test('keyboard: Enter sends, Shift+Enter makes a new line, nothing blank or doubled is sent, and a failure keeps the text', async ({ browser }) => {
  const ev = new Evidence('Chat keyboard sending', [/ERR_FAILED/, /Failed to load resource/, /Failed to fetch/]); const { org, u } = await ids(); const s = stamp()
  const a = await person(browser, ev, A, 'counsellor A'); const b = await person(browser, ev, B, 'counsellor B')
  const c = await openDm(a, org, u[B].id)
  await b.goto(`/chat?c=${c}`)
  const box = a.locator('#chat-body')
  const count = async () => (await admin`select count(*)::int as n from chat_messages where conversation_id = ${c}`)[0].n as number
  const bodies = async (t: string) => (await admin`select body from chat_messages where conversation_id = ${c} and body like ${`%${t}%`}`).map((r) => r.body as string)
  await expect(box).toHaveAttribute('enterkeyhint', 'send')

  // Enter sends, the box clears and keeps the cursor, and the other person receives it
  await box.click(); await box.pressSequentially(`By Enter ${s}`); await box.press('Enter')
  await expect(msg(a, `By Enter ${s}`)).toBeVisible({ timeout: 15_000 })
  await expect(box).toHaveValue(''); await expect(box).toBeFocused()
  await expect(msg(b, `By Enter ${s}`)).toBeVisible({ timeout: 15_000 })

  // Shift+Enter only makes a new line; the long message keeps its lines
  await box.pressSequentially(`Line one ${s}`); const sent = await count()
  await box.press('Shift+Enter'); await box.pressSequentially('Line two'); await box.press('Shift+Enter'); await box.press('Shift+Enter'); await box.pressSequentially('Line four')
  await expect(box).toHaveValue(`Line one ${s}\nLine two\n\nLine four`)
  expect(await count()).toBe(sent)
  await box.press('Enter')
  await expect(msg(a, `Line one ${s}`)).toBeVisible({ timeout: 15_000 })
  expect((await bodies(`Line one ${s}`)).map((x) => x.replace(/\r\n/g, '\n'))).toEqual([`Line one ${s}\nLine two\n\nLine four`]) // browsers submit form line breaks as CRLF
  // shown as four rows, including the blank one, without doubled line breaks
  expect(await msg(a, `Line one ${s}`).locator('p.whitespace-pre-wrap').evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)))).toBe(4)

  // an input method's Enter chooses a word and does not send
  await box.fill(`Composing ${s}`)
  await box.evaluate((el) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true })))
  await a.waitForTimeout(1000); expect(await bodies(`Composing ${s}`)).toEqual([])

  // empty and spaces-only: nothing is sent
  const quiet = await count()
  await box.fill(''); await box.press('Enter'); await box.fill('     '); await box.press('Enter'); await box.fill(' \n \n '); await box.press('Enter')
  await a.waitForTimeout(1500); expect(await count()).toBe(quiet)
  await expect(a.getByRole('main').getByRole('alert')).toHaveCount(0) // not even a validation error
  await box.fill('')

  // rapid presses on a slow connection, and a held key: one message
  const slow = async (route: Route) => { if (route.request().method() === 'POST') await new Promise((r) => setTimeout(r, 800)); await route.fallback() }
  await a.route('**/chat?c=*', slow)
  await box.fill(`Rapid ${s}`)
  await Promise.all([1, 2, 3, 4, 5].map(() => box.press('Enter')))
  await expect(a.getByRole('button', { name: 'Sending…' })).toBeVisible()
  await expect(box).toHaveJSProperty('readOnly', true)
  await expect(msg(a, `Rapid ${s}`)).toBeVisible({ timeout: 15_000 })
  await a.waitForTimeout(1500); expect(await bodies(`Rapid ${s}`)).toHaveLength(1)
  await box.fill(`Held ${s}`); await a.keyboard.down('Enter'); await a.keyboard.down('Enter'); await a.keyboard.down('Enter'); await a.keyboard.up('Enter')
  await expect(msg(a, `Held ${s}`)).toBeVisible({ timeout: 15_000 })
  await a.waitForTimeout(1500); expect(await bodies(`Held ${s}`)).toHaveLength(1)
  await a.unroute('**/chat?c=*', slow)
  await expect(box).toHaveValue('')

  // the Send button still works
  await say(a, `By button ${s}`)
  expect(await bodies(`By button ${s}`)).toHaveLength(1)

  // a refused submission keeps the text and the file
  await box.fill(`Refused ${s}`)
  await a.locator('#chat-file').setInputFiles({ name: 'not-really.pdf', mimeType: 'application/pdf', buffer: Buffer.from('MZ this is not a pdf') })
  await box.press('Enter')
  await expect(a.getByText('Only PDF, JPEG, PNG or WebP files are accepted.')).toBeVisible()
  await expect(box).toHaveValue(`Refused ${s}`); expect(await bodies(`Refused ${s}`)).toEqual([])
  await a.locator('#chat-file').setInputFiles([])

  // a lost connection keeps the text; pressing Enter again sends it once
  const down = async (route: Route) => { if (route.request().method() === 'POST') await route.abort('failed'); else await route.fallback() }
  await a.route('**/chat?c=*', down)
  await box.fill(`Retry ${s}`); await box.press('Enter')
  await expect(a.getByText('The message was not sent. Check your connection and try again.')).toBeVisible({ timeout: 15_000 })
  await expect(box).toHaveValue(`Retry ${s}`); expect(await bodies(`Retry ${s}`)).toEqual([])
  await a.unroute('**/chat?c=*', down)
  await box.press('Enter')
  await expect(msg(a, `Retry ${s}`)).toBeVisible({ timeout: 15_000 })
  await expect(box).toHaveValue(''); expect(await bodies(`Retry ${s}`)).toHaveLength(1)

  // attachments: with text, and on their own
  await a.locator('#chat-file').setInputFiles({ name: `keyed-${s}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4\n% fictional-${s}\n%%EOF`) })
  await box.fill(`With attachment ${s}`); await box.press('Enter')
  await expect(msg(b, `With attachment ${s}`).getByRole('link', { name: new RegExp(`keyed-${s}.pdf`) })).toBeVisible({ timeout: 20_000 })
  await a.locator('#chat-file').setInputFiles({ name: `alone-${s}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4\n% fictional-${s}\n%%EOF`) })
  await box.click(); await box.press('Enter')
  await expect(b.getByRole('link', { name: new RegExp(`alone-${s}.pdf`) })).toBeVisible({ timeout: 20_000 })

  // a reply, a mention and a notification all behave as they do from the button
  await (await more(a, `By Enter ${s}`)).getByRole('button', { name: 'Reply' }).click()
  await expect(a.getByText(`Replying to ${u[A].full_name}`)).toBeVisible()
  await box.fill(`Reply by Enter ${s}`); await box.press('Enter')
  await expect(msg(b, `Reply by Enter ${s}`)).toContainText(`By Enter ${s}`, { timeout: 15_000 })
  await expect(a.getByText(`Replying to ${u[A].full_name}`)).toHaveCount(0)
  const [r] = await admin`select r.body from chat_messages m join chat_messages r on r.id = m.reply_to_id where m.conversation_id = ${c} and m.body = ${`Reply by Enter ${s}`}`
  expect(r.body).toBe(`By Enter ${s}`)

  await ev.finish('Enter sends once through the normal form; new lines, blanks, failures, attachments and replies all behave')
})

test('keyboard on a phone-sized touch screen: Enter sends and the Send button still works', async ({ browser }) => {
  const ev = new Evidence('Chat keyboard sending, phone size'); const { org, u } = await ids(); const s = stamp()
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const a = ev.watch(await ctx.newPage(), 'counsellor A phone')
  await login(a, A)
  await openDm(a, org, u[B].id)
  const box = a.locator('#chat-body')
  await box.tap(); await box.pressSequentially(`Phone Enter ${s}`); await box.press('Enter')
  await expect(msg(a, `Phone Enter ${s}`)).toBeVisible({ timeout: 15_000 })
  await expect(box).toHaveValue('')
  await box.fill(`Phone button ${s}`); await a.getByRole('button', { name: 'Send', exact: true }).tap()
  await expect(msg(a, `Phone button ${s}`)).toBeVisible({ timeout: 15_000 })
  await ev.finish('Enter and the Send button both send at phone size. This is Chromium with a simulated keyboard, not a real phone keyboard')
})
