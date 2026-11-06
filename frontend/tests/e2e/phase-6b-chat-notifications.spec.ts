import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test'
import { adminDb, login } from './helpers'
import { Evidence } from './evidence'

/**
 * Global chat notifications in real browsers, with fictional accounts on the throwaway stack. The browser's own notification
 * pop-up can't be seen by a test, so Notification is replaced by a recorder; hidden tabs are simulated the same way.
 */
const admin = adminDb()
// Later chat tests count from a clean state on this throwaway database, so nothing is left unread for them.
test.afterAll(async () => { await admin`update chat_members set last_read_at = now()`; await admin`delete from chat_conversation_mutes`; await admin.end() })
test.describe.configure({ timeout: 180_000 })
// A conversation left open in a page keeps marking messages read, so nothing stays open between tests.
const opened: BrowserContext[] = []
// The same goes for pages an earlier spec file left open in this browser.
test.beforeAll(async ({ browser }) => { await Promise.all(browser.contexts().map((c) => c.close())) })
test.afterEach(async () => { await Promise.all(opened.splice(0).map((c) => c.close())) })

const A = 'edx.counsellor@demo.test'; const B = 'edx.counsellor2@demo.test'; const MGR = 'edx.manager@demo.test'; const MD = 'md@demo.test'; const G = 'grd.counsellor@demo.test'
const POLL = { timeout: 25_000 }
const stamp = () => `${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 90 + 10)}`
const ids = async () => {
  const rows = await admin`select email, id, full_name from user_profiles where email in (${A}, ${B}, ${MGR}, ${MD}, ${G})`
  const [org] = await admin`select id from organizations where code = 'EDX'`
  return { org: org.id as string, u: Object.fromEntries(rows.map((r) => [r.email, r])) as Record<string, { id: string; full_name: string }> }
}
type Permission = 'default' | 'granted' | 'denied'
const recorder = (permission: Permission | null, hidden = false) => `(() => {
  ${hidden ? `Object.defineProperty(document, 'visibilityState', { get: () => 'hidden' }); Object.defineProperty(document, 'hidden', { get: () => true }); document.hasFocus = () => false;` : ''}
  ${permission === null ? 'return;' : ''}
  window.__notes = []; window.__prompts = 0; let p = sessionStorage.getItem('__permission') || ${JSON.stringify(permission)};
  class Fake { constructor(title, o) { this.title = title; this.body = o.body; this.tag = o.tag; window.__notes.push(this); } close() {}
    static get permission() { return p; }
    static requestPermission() { window.__prompts++; p = 'granted'; sessionStorage.setItem('__permission', p); return Promise.resolve(p); } }
  window.Notification = Fake;
})()`
async function person(browser: Browser, ev: Evidence, email: string, role: string, init?: string, viewport?: { width: number; height: number }) {
  const ctx = await browser.newContext(viewport ? { viewport } : {})
  opened.push(ctx)
  if (init) await ctx.addInitScript(init)
  const page = ev.watch(await ctx.newPage(), role)
  await login(page, email)
  await ready(page)
  return page
}
/** The shared poller has answered at least once, so anything from now on counts as new. */
const ready = (page: Page) => page.waitForFunction(() => Object.keys(localStorage).some((k) => k.startsWith('erp.chat.notify.')), undefined, POLL)
async function openDm(page: Page, org: string, other: string) {
  await page.goto('/chat')
  await page.locator('#chat-person').selectOption(`${org}|${other}`)
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(page).toHaveURL(/\/chat\?c=[0-9a-f-]{36}/)
  return new URL(page.url()).searchParams.get('c')!
}
async function say(page: Page, text: string) {
  await page.locator('#chat-body').fill(text)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByTestId('chat-message').filter({ hasText: text }).first()).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('#chat-body')).toHaveValue('')
}
const toast = (page: Page, text: string) => page.getByTestId('chat-toast').filter({ hasText: text })
const apiTotal = async (page: Page) => (await (await page.request.get('/api/chat/notifications')).json()).total as number
const expectBadgeMatchesApi = async (page: Page) => {
  const total = await apiTotal(page)
  await expect(page.getByTestId('chat-unread-badge')).toHaveText(total > 99 ? '99+' : String(total), POLL)
  return total
}

test('staff to MD and MD to staff: alert and badge anywhere in the ERP, the click opens the conversation, and only then is it read', async ({ browser }) => {
  const ev = new Evidence('Global chat alerts'); const { org, u } = await ids(); const t = `Fictional for MD ${stamp()}`
  const staff = await person(browser, ev, A, 'counsellor'); const md = await person(browser, ev, MD, 'MD')
  const c = await openDm(staff, org, u[MD].id)
  await md.goto('/'); await say(staff, t)

  await expect(toast(md, t)).toBeVisible(POLL)
  await expect(toast(md, t)).toContainText(u[A].full_name)
  await expectBadgeMatchesApi(md)
  // the message is still unread, and alerts keep working on another module's page
  const [{ read }] = await admin`select count(*)::int as read from chat_members m where m.conversation_id = ${c} and m.user_id = ${u[MD].id} and m.last_read_at >= (select max(created_at) from chat_messages where conversation_id = ${c})`
  expect(read).toBe(0)
  await md.goto('/tasks')
  const before = await apiTotal(md)
  const t2 = `Fictional second ${stamp()}`; await say(staff, t2)
  await expect(toast(md, t2)).toBeVisible(POLL)
  await expect.poll(() => apiTotal(md), POLL).toBe(before + 1)
  await expect(md.getByTestId('chat-unread-badge')).toHaveText(String(before + 1), POLL)

  // clicking opens exactly this conversation; opening marks it read and the badge falls without a reload
  await toast(md, t2).getByRole('link').click()
  await expect(md).toHaveURL(new RegExp(`/chat\\?c=${c}`))
  await expect(md.getByTestId('chat-message').filter({ hasText: t2 }).first()).toBeVisible()
  await expect.poll(() => apiTotal(md), POLL).toBe(before - 1)
  await expect(staff.getByTestId('chat-message').filter({ hasText: t2 }).getByTestId('receipt')).toContainText('Read', { timeout: 15_000 })

  // and the other way, with no alert for a conversation already open on screen
  const reply = `Fictional from MD ${stamp()}`; await staff.goto('/tasks')
  await say(md, reply)
  await expect(toast(staff, reply)).toBeVisible(POLL)
  const t3 = `Fictional while open ${stamp()}`
  await staff.goto(`/chat?c=${c}`); await say(md, t3)
  await expect(staff.getByTestId('chat-message').filter({ hasText: t3 }).first()).toBeVisible(POLL)
  await staff.waitForTimeout(6000)
  await expect(toast(staff, t3)).toHaveCount(0)
  await ev.finish('Staff and MD each alerted on other pages; badge matched the server; click opened the right conversation; read only after opening')
})

test('group messages reach members; outsiders, the MD and another company get nothing; a removed member stops', async ({ browser }) => {
  const ev = new Evidence('Group alerts and isolation'); const { org, u } = await ids(); const name = `Fictional alerts ${stamp()}`
  const mgr = await person(browser, ev, MGR, 'manager'); const a = await person(browser, ev, A, 'member A'); const b = await person(browser, ev, B, 'member B')
  const md = await person(browser, ev, MD, 'MD, not a member'); const other = await person(browser, ev, G, 'other company')
  await mgr.goto('/chat')
  await mgr.getByText('New group').click()
  await mgr.locator('#g-type').selectOption('sales')
  await mgr.locator('#g-name').fill(name)
  await mgr.locator(`input[name="members"][value="${u[A].id}"]`).check()
  await mgr.locator(`input[name="members"][value="${u[B].id}"]`).check()
  await mgr.getByRole('button', { name: 'Create group' }).click()
  await expect(mgr).toHaveURL(/\/chat\?c=/)
  const g = new URL(mgr.url()).searchParams.get('c')!

  const t = `Fictional group ${stamp()}`; await say(mgr, t)
  await expect(toast(a, t)).toBeVisible(POLL); await expect(toast(a, t)).toContainText(name)
  await expect(toast(b, t)).toBeVisible(POLL)
  for (const p of [md, other]) {
    await p.waitForTimeout(6000)
    await expect(toast(p, t)).toHaveCount(0)
    const body = await (await p.request.get('/api/chat/notifications')).text()
    expect(body).not.toContain(t); expect(body).not.toContain(g)
    expect(await p.evaluate(() => JSON.stringify(localStorage))).not.toContain(t) // browser storage never holds message text
  }

  // a private conversation between two others is never announced to the MD, and signed-out requests learn nothing
  const secret = `Fictional private ${stamp()}`; const dm = await openDm(a, org, u[B].id); await say(a, secret)
  await expect(toast(b, secret)).toBeVisible(POLL)
  expect(await (await md.request.get('/api/chat/notifications')).text()).not.toContain(dm)
  expect(await (await other.request.get('/api/chat/notifications')).text()).not.toContain(dm)
  const signedOut = await browser.newContext()
  expect(await (await signedOut.request.get(`${new URL(a.url()).origin}/api/chat/notifications`)).json()).toEqual({ signedIn: false })
  await signedOut.close()

  // removal ends alerts
  await mgr.goto(`/chat?c=${g}`)
  await mgr.locator('summary', { hasText: 'Members' }).click()
  const memberRows = mgr.locator('details', { has: mgr.locator('summary', { hasText: 'Members' }) }).getByRole('listitem') // the conversation list can name the same person
  await memberRows.filter({ hasText: u[B].full_name }).getByRole('button', { name: 'Remove' }).click()
  await expect(memberRows.filter({ hasText: u[B].full_name })).toHaveCount(0, { timeout: 15_000 })
  const after = `Fictional after removal ${stamp()}`; await say(mgr, after)
  await expect(toast(a, after)).toBeVisible(POLL)
  await b.waitForTimeout(6000)
  await expect(toast(b, after)).toHaveCount(0)
  expect(await (await b.request.get('/api/chat/notifications')).text()).not.toContain(g)
  await ev.finish('Members alerted; MD, other company and removed member received nothing; nothing stored in the browser')
})

test('no duplicates after navigation, refresh, a second tab or a lost connection; counts recover', async ({ browser }) => {
  const ev = new Evidence('Duplicates and recovery', [/ERR_INTERNET_DISCONNECTED|Failed to fetch/]); const { org, u } = await ids()
  const a = await person(browser, ev, A, 'sender'); const b = await person(browser, ev, B, 'recipient')
  const c = await openDm(a, org, u[B].id)
  await b.goto('/tasks'); const t = `Fictional once ${stamp()}`; await say(a, t)
  await expect(toast(b, t)).toBeVisible(POLL)
  await expect(toast(b, t)).toHaveCount(1)
  const total = await expectBadgeMatchesApi(b)

  await b.goto('/'); await ready(b); await b.waitForTimeout(6000)
  await expect(toast(b, t)).toHaveCount(0)
  await b.reload(); await b.waitForTimeout(6000)
  await expect(toast(b, t)).toHaveCount(0)
  await expect(b.getByTestId('chat-unread-badge')).toHaveText(String(total), POLL) // recovered from the server after refresh

  // two tabs share one poller, and the alert still appears just once in each
  const second = ev.watch(await b.context().newPage(), 'recipient, second tab'); await second.goto('/tasks')
  let polls = 0; const count = (r: { url(): string }) => { if (r.url().includes('/api/chat/notifications')) polls++ }
  b.on('request', count); second.on('request', count)
  await b.waitForTimeout(16_000)
  expect(polls).toBeLessThanOrEqual(5) // one poller at 5 or 15 seconds, not one per tab
  const shared = `Fictional two tabs ${stamp()}`; await say(a, shared)
  await expect(toast(second, shared)).toHaveCount(1, POLL)
  await expect(toast(b, shared)).toHaveCount(1, POLL)
  await expect(second.getByTestId('chat-unread-badge')).toHaveText(String(total + 1), POLL)
  await expect(b.getByTestId('chat-unread-badge')).toHaveText(String(total + 1), POLL)
  await second.close()

  // the connection drops and returns: the message that arrived meanwhile alerts once
  await b.context().setOffline(true); await b.waitForTimeout(6000)
  const offline = `Fictional while offline ${stamp()}`; await say(a, offline)
  await b.context().setOffline(false)
  await expect(toast(b, offline)).toBeVisible({ timeout: 70_000 })
  await expect(toast(b, offline)).toHaveCount(1)
  await expectBadgeMatchesApi(b)
  await b.goto(`/chat?c=${c}`); await expect(b.getByTestId('chat-message').filter({ hasText: offline }).first()).toBeVisible()
  await ev.finish('One alert per message through navigation, refresh, two tabs and a lost connection')
})

test('desktop notifications: asked only on a click, background only, no text by default, click opens the conversation', async ({ browser }) => {
  const ev = new Evidence('Desktop notifications'); const { org, u } = await ids()
  const a = await person(browser, ev, A, 'sender')
  const b = await person(browser, ev, B, 'recipient', recorder('default'))
  // never asks by itself
  await b.goto('/my-notifications/preferences')
  expect(await b.evaluate(() => (window as unknown as { __prompts: number }).__prompts)).toBe(0)
  await b.getByRole('button', { name: 'Turn on desktop notifications' }).click()
  await expect(b.getByTestId('desktop-alerts')).toContainText('On for this browser')
  expect(await b.evaluate(() => (window as unknown as { __prompts: number }).__prompts)).toBe(1)

  // the tab being used: the in-app alert only
  const c = await openDm(a, org, u[B].id)
  await b.bringToFront(); await b.evaluate(() => window.focus())
  await b.goto('/tasks'); const front = `Fictional in front ${stamp()}`; await say(a, front)
  await b.evaluate(() => { document.hasFocus = () => true })
  await expect(toast(b, front)).toBeVisible(POLL)

  // simulated background tab: a desktop notification that does not contain the message, and no in-app alert
  await b.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.hasFocus = () => false
    Object.keys(localStorage).filter((k) => k.startsWith('erp.chat.focus.')).forEach((k) => localStorage.removeItem(k))
    ;(window as unknown as { __notes: unknown[] }).__notes.length = 0
  })
  const back = `Fictional in background ${stamp()}`; await say(a, back)
  await expect.poll(() => b.evaluate(() => (window as unknown as { __notes: unknown[] }).__notes.length), { timeout: 40_000 }).toBe(1)
  const n = await b.evaluate(() => { const x = (window as unknown as { __notes: { title: string; body: string; tag: string }[] }).__notes[0]; return { title: x.title, body: x.body, tag: x.tag } })
  expect(n.title).toContain(u[A].full_name); expect(n.body).not.toContain(back); expect(n.tag).toBe(`erp-chat-${c}`)

  // no repeat, and the click goes to the conversation
  await b.waitForTimeout(16_000)
  expect(await b.evaluate(() => (window as unknown as { __notes: unknown[] }).__notes.length)).toBe(1)
  await b.evaluate(() => { const x = (window as unknown as { __notes: { onclick: () => void }[] }).__notes[0]; x.onclick() })
  await expect(b).toHaveURL(new RegExp(`/chat\\?c=${c}`))
  await ev.finish('Permission asked only on click; background alert without message text; no repeat; click opened the conversation')
})

test('desktop notifications refused or unavailable: no repeat prompt, in-app alerts continue', async ({ browser }) => {
  const ev = new Evidence('Desktop permission denied'); const { org, u } = await ids()
  const a = await person(browser, ev, A, 'sender'); const b = await person(browser, ev, B, 'recipient', recorder('denied'))
  await b.goto('/my-notifications/preferences')
  await expect(b.getByTestId('desktop-alerts')).toContainText('blocked for this site')
  await expect(b.getByRole('button', { name: 'Turn on desktop notifications' })).toHaveCount(0)
  await openDm(a, org, u[B].id); const t = `Fictional denied ${stamp()}`; await say(a, t)
  await expect(toast(b, t)).toBeVisible(POLL)
  expect(await b.evaluate(() => (window as unknown as { __prompts: number }).__prompts)).toBe(0)
  expect(await b.evaluate(() => (window as unknown as { __notes: unknown[] }).__notes.length)).toBe(0)

  const none = await person(browser, ev, MGR, 'browser without notifications', '(() => { delete window.Notification })()')
  await none.goto('/my-notifications/preferences')
  await expect(none.getByTestId('desktop-alerts')).toContainText('cannot show them')
  await ev.finish('Denied and unsupported browsers keep in-app alerts and are not prompted')
})

test('settings: in-app alerts off, mute one conversation; existing chat still works', async ({ browser }) => {
  const ev = new Evidence('Chat alert settings'); const { org, u } = await ids()
  const a = await person(browser, ev, A, 'sender'); const b = await person(browser, ev, MD, 'recipient')
  const c = await openDm(a, org, u[MD].id)
  await b.goto(`/chat?c=${c}`)
  await b.getByRole('button', { name: 'Mute alerts' }).click()
  await expect(b.getByRole('button', { name: 'Unmute alerts' })).toBeVisible()
  await b.goto('/tasks')
  const before = await apiTotal(b); const muted = `Fictional muted ${stamp()}`; await say(a, muted)
  await b.waitForTimeout(7000)
  await expect(toast(b, muted)).toHaveCount(0)
  expect(await apiTotal(b)).toBe(before) // not in the badge either
  await b.goto('/my-notifications/preferences')
  await b.getByTestId('muted-conversations').getByRole('button', { name: 'Unmute' }).click()
  await expect(b.getByTestId('muted-conversations')).toHaveCount(0, { timeout: 10_000 })
  await expect.poll(() => apiTotal(b), POLL).toBe(before + 1) // still unread: muting never marks anything read
  await b.getByLabel(/Show alerts inside the ERP/).uncheck()
  await b.getByRole('button', { name: 'Save', exact: true }).last().click()
  await expect(b.getByText('Chat alerts saved.')).toBeVisible()
  await b.reload()
  await expect(b.getByLabel(/Show alerts inside the ERP/)).not.toBeChecked()
  const off = `Fictional alerts off ${stamp()}`; await say(a, off)
  await expect.poll(() => apiTotal(b), POLL).toBe(before + 2)
  await b.waitForTimeout(6000)
  await expect(toast(b, off)).toHaveCount(0)
  await b.getByLabel(/Show alerts inside the ERP/).check()
  await b.getByRole('button', { name: 'Save', exact: true }).last().click()
  await expect(b.getByText('Chat alerts saved.')).toBeVisible()
  await b.goto(`/chat?c=${c}`)
  await expect(b.getByTestId('chat-message').filter({ hasText: off }).first()).toBeVisible()
  await ev.finish('Mute and in-app setting respected; unread preserved; opening the chat still works')
})

for (const [label, viewport] of [['Android size', { width: 360, height: 740 }], ['iPhone size', { width: 390, height: 844 }]] as const) {
  test(`mobile, ${label}: alert fits the screen, the badge shows, and the click works`, async ({ browser }) => {
    const ev = new Evidence(`Mobile alerts ${label}`); const { org, u } = await ids()
    const a = await person(browser, ev, A, 'sender')
    const b = await person(browser, ev, B, 'phone', undefined, viewport)
    const c = await openDm(a, org, u[B].id); await b.goto('/tasks')
    const t = `Fictional phone ${stamp()}`; await say(a, `${t} with a long line of text that cannot fit on one row of a small phone screen`) // a long preview must not widen the alert
    const card = toast(b, t); await expect(card).toBeVisible(POLL)
    const box = (await card.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
    await expect(b.getByTestId('chat-unread-badge')).toBeVisible()
    expect(await b.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await card.getByRole('link').click()
    await expect(b).toHaveURL(new RegExp(`/chat\\?c=${c}`))
    await ev.finish(`Alert inside the ${viewport.width} px screen, no sideways scrolling, click opened the conversation`)
  })
}
