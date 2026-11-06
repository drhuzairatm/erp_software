import { type Browser, expect, type Page, test } from '@playwright/test'
import { adminDb, login } from './helpers'
import { Evidence } from './evidence'

/** The redesigned Chat screen, real browsers, on the throwaway stack with fictional accounts and messages. */
const admin = adminDb()
test.afterAll(async () => { await admin.end() })
test.describe.configure({ timeout: 180_000 })

const A = 'edx.counsellor@demo.test'; const B = 'edx.counsellor2@demo.test'
const stamp = () => Date.now().toString().slice(-7)
const shot = async (page: Page, name: string) => { if (process.env.CHAT_SHOTS) await page.screenshot({ path: `${process.env.CHAT_SHOTS}/${name}.png` }) }
const ids = async () => {
  const rows = await admin`select email, id, full_name from user_profiles where email in (${A}, ${B})`
  const [org] = await admin`select id from organizations where code = 'EDX'`
  return { org: org.id as string, u: Object.fromEntries(rows.map((r) => [r.email, r])) as Record<string, { id: string; full_name: string }> }
}
async function person(browser: Browser, ev: Evidence, email: string, role: string, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport })
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
const bubbles = (p: Page) => p.getByTestId('chat-message')
/** Old messages put straight into the throwaway database, so paging can be tested without sending 120 messages. */
async function seed(c: string, org: string, sender: string, s: string) {
  for (let i = 0; i < 120; i++) await admin`insert into chat_messages (conversation_id, org_id, sender_id, body, created_at) values (${c}, ${org}, ${sender}, ${`History ${s} #${i}`}, now() - interval '3 days' + ${`${i} minutes`}::interval)`
}

test('history: day separators, unread marker, older pages keep position and leave no gaps', async ({ browser }) => {
  const ev = new Evidence('Chat history'); const { org, u } = await ids(); const s = stamp()
  const a = await person(browser, ev, A, 'counsellor A')
  const c = await openDm(a, org, u[B].id)
  await seed(c, org, u[B].id, s)
  for (const n of [1, 2, 3]) await admin`insert into chat_messages (conversation_id, org_id, sender_id, body, created_at) values (${c}, ${org}, ${u[B].id}, ${`Fresh ${s} ${n}`}, now() - make_interval(secs => ${10 - n}))`
  await admin`update chat_members set last_read_at = now() - interval '1 minute' where conversation_id = ${c} and user_id = ${u[A].id}`
  await a.goto(`/chat?c=${c}`)
  await expect(a.getByText(`Fresh ${s} 3`)).toBeVisible({ timeout: 15_000 })
  await expect(a.getByTestId('chat-messages').getByText('Unread messages')).toBeVisible()
  await expect(a.getByTestId('chat-messages').getByText('Today')).toBeVisible()
  await shot(a, 'desktop-conversation')
  const first = await bubbles(a).count()
  expect(first).toBe(50)
  // Older pages: repeated loading reaches the very first message, in order, with no duplicate.
  const pane = a.getByTestId('chat-messages')
  const anchorText = (await pane.locator('p.whitespace-pre-wrap').first().textContent())!
  const anchor = pane.getByText(anchorText, { exact: true })
  await pane.evaluate((el) => { el.scrollTop = 100 }) // the first message is on screen, and just short of the point that loads more by itself
  const before = await anchor.boundingBox()
  await a.getByRole('button', { name: 'Load earlier messages' }).evaluate((el) => (el as HTMLButtonElement).click()) // a real click would scroll to the button first
  await expect.poll(() => bubbles(a).count()).toBeGreaterThan(first)
  const after = await anchor.boundingBox()
  expect(Math.abs(after!.y - before!.y)).toBeLessThan(5) // the message the reader was looking at stays where it was
  for (let i = 0; i < 6 && await a.getByRole('button', { name: 'Load earlier messages' }).isVisible().catch(() => false); i++) { await a.getByRole('button', { name: 'Load earlier messages' }).click(); await a.waitForTimeout(600) }
  await expect(a.getByText(`History ${s} #0`, { exact: true })).toBeAttached()
  const texts = await pane.locator('p.whitespace-pre-wrap').allTextContents()
  const hist = texts.filter((t) => t.startsWith(`History ${s} `)).map((t) => Number(t.split('#')[1]))
  expect(hist).toEqual(Array.from({ length: 120 }, (_, i) => i))
  // Reading older messages is not interrupted by a new one, and the latest-messages button returns to the end.
  await pane.evaluate((el) => { el.scrollTop = 0 })
  await admin`insert into chat_messages (conversation_id, org_id, sender_id, body) values (${c}, ${org}, ${u[B].id}, ${`Newest ${s}`})`
  await expect(a.getByText(`Newest ${s}`)).toBeAttached({ timeout: 15_000 })
  expect(await pane.evaluate((el) => el.scrollTop)).toBeLessThan(200)
  await a.getByRole('button', { name: 'Go to latest messages' }).click()
  await expect(a.getByText(`Newest ${s}`)).toBeInViewport()
  await ev.finish('Day separators, unread marker, full history in order, reading position kept')
})

test('search: filters the list, highlights a match and opens the original message', async ({ browser }) => {
  const ev = new Evidence('Chat search'); const { org, u } = await ids(); const s = stamp()
  const a = await person(browser, ev, A, 'counsellor A')
  const c = await openDm(a, org, u[B].id)
  await seed(c, org, u[B].id, s)
  await a.goto('/chat')
  await a.locator('#chat-q').fill(`History ${s} #5`)
  await expect(a.getByTestId('conversation-list').getByRole('link')).toHaveCount(0)
  await expect(a.getByText('No conversations match.')).toBeVisible()
  await a.locator('#chat-q').press('Enter')
  const results = a.getByTestId('chat-search-results')
  await expect(results.locator('mark').first()).toHaveText(`History ${s} #5`)
  await results.getByRole('link', { name: new RegExp(`History ${s} #5\\b.*`) }).first().click()
  await expect(a.locator('[data-testid=chat-message] .ring-amber-400').first()).toBeInViewport({ timeout: 20_000 })
  await a.goto('/chat?q=nothing-should-match-this-text')
  await expect(a.getByText('No messages found.')).toBeVisible()
  await ev.finish('Name filter, highlighted message results and jump to the original message')
})

test('filters: unread, personal, groups and muted show the right conversations', async ({ browser }) => {
  const ev = new Evidence('Chat filters'); const { org, u } = await ids(); const s = stamp()
  const a = await person(browser, ev, A, 'counsellor A')
  const c = await openDm(a, org, u[B].id)
  await admin`insert into chat_messages (conversation_id, org_id, sender_id, body) values (${c}, ${org}, ${u[B].id}, ${`Filter me ${s}`})`
  await a.goto('/chat')
  const list = a.getByTestId('conversation-list'); const row = list.locator(`a[href="/chat?c=${c}"]`)
  await a.getByRole('button', { name: 'Unread', exact: true }).click()
  await expect(row).toBeVisible()
  await a.getByRole('button', { name: 'Groups', exact: true }).click()
  await expect(row).toHaveCount(0)
  await a.getByRole('button', { name: 'Personal', exact: true }).click()
  await expect(row).toBeVisible()
  await a.getByRole('button', { name: 'Muted', exact: true }).click()
  await expect(row).toHaveCount(0)
  await a.getByRole('button', { name: 'All', exact: true }).click()
  await expect(row).toBeVisible()
  await shot(a, 'desktop-list')
  await ev.finish('Each filter shows only its own conversations')
})

test('composer: emoji, mention suggestions, attachment preview and removal, size limit', async ({ browser }) => {
  const ev = new Evidence('Chat composer'); const { org, u } = await ids(); const s = stamp()
  const a = await person(browser, ev, A, 'counsellor A')
  await openDm(a, org, u[B].id)
  const box = a.locator('#chat-body')
  await expect(a.getByLabel('Loading messages')).toHaveCount(0)
  const already = await bubbles(a).count()
  await box.fill(`Hello ${s} `)
  await a.locator('summary', { hasText: 'Add an emoji' }).click()
  await a.getByRole('button', { name: 'Insert 🎓' }).click()
  await expect(box).toHaveValue(`Hello ${s} 🎓`)
  // Mention list: typed letters narrow it; Enter chooses a person and does not send.
  const firstName = u[B].full_name.split(/\s+/)[0]
  await box.fill(''); await box.pressSequentially(`@${firstName.slice(0, 3)}`)
  const list = a.getByRole('list', { name: 'People to mention' })
  await expect(list.getByRole('button', { name: u[B].full_name })).toBeVisible()
  await box.press('Enter')
  await expect(box).toHaveValue(`@${u[B].full_name} `)
  await expect(bubbles(a)).toHaveCount(already)
  await shot(a, 'desktop-composer')
  // A file can be seen and removed before sending.
  const pdf = { name: `preview-${s}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4\n% fictional ${s}\n%%EOF`) }
  await a.locator('#chat-file').setInputFiles(pdf)
  const preview = a.getByTestId('chat-file-preview')
  await expect(preview).toContainText(pdf.name)
  await preview.getByRole('button', { name: 'Remove' }).click()
  await expect(preview).toHaveCount(0)
  expect(await a.locator('#chat-file').evaluate((el) => (el as HTMLInputElement).files?.length)).toBe(0)
  // 10 MB or more is stopped here with a clear message, before it can fail on the way to the server.
  await a.locator('#chat-file').setInputFiles({ name: 'big.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(10 * 1024 * 1024, 32) })
  await expect(a.getByText('The file must be smaller than 10 MB.')).toBeVisible()
  await expect(preview).toHaveCount(0)
  // Sends with the attachment and clears the preview.
  await a.locator('#chat-file').setInputFiles(pdf)
  await box.fill(`With a file ${s}`); await box.press('Enter')
  await expect(bubbles(a).filter({ hasText: `With a file ${s}` }).getByRole('link', { name: new RegExp(pdf.name) })).toBeVisible({ timeout: 20_000 })
  await expect(preview).toHaveCount(0)
  await ev.finish('Emoji, mention list, attachment preview, removal, size limit and sending all worked')
})

for (const width of [360, 390, 768]) {
  test(`phone and tablet at ${width} px: list first, full-screen conversation, no sideways scrolling`, async ({ browser }) => {
    const ev = new Evidence(`Chat at ${width}`); const { org, u } = await ids(); const s = stamp()
    const a = await person(browser, ev, A, 'counsellor A', { width, height: 720 })
    const c = await openDm(a, org, u[B].id)
    const fits = async () => { const m = await a.evaluate(() => ({ w: window.innerWidth, s: document.documentElement.scrollWidth })); expect(m.s).toBeLessThanOrEqual(m.w) }
    await a.locator('#chat-body').fill(`On a small screen ${s} ${'long-unbroken-text-'.repeat(12)}`); await a.locator('#chat-body').press('Enter')
    await expect(bubbles(a).filter({ hasText: `On a small screen ${s}` })).toBeVisible({ timeout: 15_000 })
    await fits()
    await expect(a.getByRole('button', { name: 'Send', exact: true })).toBeInViewport()
    await expect(a.getByTestId('conversation-list')).toBeHidden()
    await shot(a, `mobile-${width}-conversation`)
    // The message menu stays on screen.
    const b = bubbles(a).filter({ hasText: `On a small screen ${s}` })
    await b.locator('summary').click()
    await expect(b.getByRole('button', { name: 'Delete' })).toBeInViewport()
    await shot(a, `mobile-${width}-menu`)
    await fits()
    await b.locator('summary').click()
    // The information panel opens and closes without leaving the conversation.
    await a.locator('summary', { hasText: 'Contact info' }).click()
    await expect(a.getByRole('heading', { level: 3 })).toBeVisible()
    await fits()
    await a.locator('summary', { hasText: 'Contact info' }).click()
    await a.getByRole('link', { name: 'Back to conversations' }).click()
    await expect(a.getByTestId('conversation-list')).toBeVisible()
    await shot(a, `mobile-${width}-list`)
    await fits()
    expect(c).toBeTruthy()
    await ev.finish('List first, full-screen conversation, composer reachable, no sideways scrolling')
  })
}
