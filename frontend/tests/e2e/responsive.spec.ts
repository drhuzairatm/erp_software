import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test'
import sharp from 'sharp'
import { placeholderPdf } from '../../../backend/scripts/lib/seed-demo'
import { adminDb, login, PASSWORD } from './helpers'

/**
 * No page may be wider than the screen. Local scroll areas (tables, tab bars) are fine: only the page itself is measured.
 * Viewports are set before navigation, as on a phone. Fictional demo accounts only.
 */
const PHONE = 390
const SMALL_PHONE = 320
const TABLET = 768
const UUID = '[0-9a-f-]{36}'

async function fits(page: Page, width: number, url?: string) {
  await page.setViewportSize({ width, height: 844 })
  if (url) await page.goto(url)
  await page.waitForTimeout(100)
  const m = await page.evaluate(() => ({
    inner: window.innerWidth,
    scroll: document.documentElement.scrollWidth,
    widest: [...document.body.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 0.5).slice(0, 5)
      .map((e) => `${e.tagName.toLowerCase()}.${String(e.getAttribute('class') ?? '').split(/\s+/).slice(0, 3).join('.')}`),
  }))
  expect(m.scroll, `${page.url()} at ${width}px; beyond the edge: ${m.widest.join(', ')}`).toBeLessThanOrEqual(m.inner)
}

async function hrefMatching(page: Page, from: string, pattern: RegExp) {
  await page.goto(from)
  const all = await page.locator('a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''))
  return all.find((h) => pattern.test(h) && !/\/(new|import)$/.test(h))
}

const PUBLIC = ['/login', '/login/verify', '/forgot-password', '/reset-password/not-a-real-token', '/invite/not-a-real-token', '/verify-email', '/refer/NOCODE', '/portal', '/portal/verify', '/portal/forgot', '/portal/password']
const STAFF = ['/', '/students', '/students/new', '/students/import', '/leads', '/leads/new', '/leads/import', '/tasks', '/tasks/new', '/universities', '/payments', '/reports', '/notifications', '/audit', '/account/password', '/account/security',
  '/admin/users', '/admin/roles', '/admin/settings', '/admin/security', '/admin/notifications', '/admin/courier', '/admin/currencies', '/admin/academic-rules', '/admin/passport-rules', '/admin/rule-tester',
  '/admin/master-data', '/admin/master-data/countries', '/admin/master-data/courses', '/admin/master-data/history', '/admin/master-data/permissions', '/admin/master-data/requests',
  '/admin/requirements', '/admin/requirements/new', '/admin/verification-rules', '/admin/verification-rules/new', '/admin/attestation-routes', '/admin/attestation-routes/new']
const DYNAMIC: [string, string, RegExp][] = [
  ['/tasks/[id]', '/tasks', new RegExp(`^/tasks/${UUID}`)], ['/universities/[id]', '/universities', new RegExp(`^/universities/${UUID}`)],
  ['/reports/[key]', '/reports', /^\/reports\/[a-z0-9_-]+/i], ['/admin/users/[id]', '/admin/users', new RegExp(`^/admin/users/${UUID}`)],
  ['/admin/requirements/[id]', '/admin/requirements', new RegExp(`^/admin/requirements/${UUID}`)],
  ['/admin/verification-rules/[id]', '/admin/verification-rules', new RegExp(`^/admin/verification-rules/${UUID}`)],
  ['/admin/attestation-routes/[id]', '/admin/attestation-routes', new RegExp(`^/admin/attestation-routes/${UUID}`)],
]

test.describe('public pages', () => {
  for (const url of PUBLIC) test(`${url} fits at ${PHONE}px`, async ({ page }) => { await fits(page, PHONE, url) })
  test(`/login fits at ${SMALL_PHONE}px`, async ({ page }) => { await fits(page, SMALL_PHONE, '/login') })
})

test.describe('staff pages', () => {
  let context: BrowserContext
  let page: Page
  async function signedIn(browser: Browser) {
    context = await browser.newContext()
    page = await context.newPage()
    await login(page, 'md@demo.test')
  }
  test.beforeAll(async ({ browser }) => { await signedIn(browser) })
  test.afterAll(async () => { await context.close() })

  for (const url of STAFF) test(`${url} fits at ${PHONE}px`, async () => { await fits(page, PHONE, url) })
  for (const [label, from, pattern] of DYNAMIC) {
    test(`${label} fits at ${PHONE}px`, async () => {
      await page.setViewportSize({ width: PHONE, height: 844 })
      const href = await hrefMatching(page, from, pattern)
      expect(href, `a link on ${from}`).toBeTruthy()
      await fits(page, PHONE, href!)
    })
  }

  test(`/leads/[id] fits at ${PHONE}px`, async () => {
    await page.setViewportSize({ width: PHONE, height: 844 })
    let lead = await hrefMatching(page, '/leads', new RegExp(`^/leads/${UUID}`))
    if (!lead) { // a fresh demo database has no leads: add a fictional one
      await page.goto('/leads/new')
      await page.locator('#l-org').selectOption({ index: 1 })
      await page.locator('[name=fullName]').fill('Responsive Check Lead')
      await page.locator('[name=phone]').fill(`+91 90072 ${Date.now().toString().slice(-5)}`)
      await page.locator('[name=consent]').check()
      await page.getByRole('button', { name: 'Add lead' }).click()
      await expect(page).toHaveURL(new RegExp(`/leads/${UUID}`))
      lead = new URL(page.url()).pathname
    }
    await fits(page, PHONE, lead)
  })

  test(`/students/[id], its edit page and every tab fit at ${PHONE}px`, async () => {
    await page.setViewportSize({ width: PHONE, height: 844 })
    const student = await hrefMatching(page, '/students', new RegExp(`^/students/${UUID}$`))
    expect(student).toBeTruthy()
    await fits(page, PHONE, student!)
    const tabs = await page.getByRole('navigation', { name: 'Student sections' }).getByRole('link').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''))
    expect(tabs.length).toBeGreaterThan(1)
    for (const tab of tabs) await fits(page, PHONE, tab)
    await fits(page, SMALL_PHONE, `${student}?tab=messages`)
    await fits(page, PHONE, `${student}/edit`)
  })

  test(`/receipts/[id] fits at ${PHONE}px`, async () => {
    await page.setViewportSize({ width: PHONE, height: 844 })
    const receipt = await hrefMatching(page, '/payments', /^\/receipts\//)
    test.skip(!receipt, 'no receipt in this data set')
    await fits(page, PHONE, receipt!)
  })

  test(`the pages from the original report fit at ${SMALL_PHONE}px`, async () => {
    await fits(page, SMALL_PHONE, '/students')
    await fits(page, SMALL_PHONE, '/students/import')
    await page.setViewportSize({ width: SMALL_PHONE, height: 844 })
    const user = await hrefMatching(page, '/admin/users', new RegExp(`^/admin/users/${UUID}`))
    expect(user).toBeTruthy()
    await fits(page, SMALL_PHONE, user!)
  })

  test(`the shell fits at ${TABLET}px and keeps the drawer below lg`, async () => {
    for (const url of ['/', '/students', '/admin/users', '/admin/roles', '/admin/notifications', '/admin/academic-rules']) await fits(page, TABLET, url)
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible()
    await expect(page.locator('aside')).toBeHidden()
  })

  test('the desktop shell keeps its fixed sidebar and has no menu button', async () => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/admin/users')
    await expect(page.locator('aside')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeHidden()
    await fits(page, 1440)
    await fits(page, 1024)
  })

  for (const width of [SMALL_PHONE, 360, PHONE, TABLET]) {
    test(`header menus stay on screen at ${width}px and close on an outside tap`, async () => {
      await page.setViewportSize({ width, height: 844 })
      await page.goto('/students')
      const menus = page.locator('header details')
      await expect(menus).toHaveCount(2)
      for (const i of [0, 1]) {
        const menu = menus.nth(i)
        await menu.locator('summary').click()
        const box = (await menu.locator('> div').boundingBox())!
        expect(box.x, `menu ${i} left edge`).toBeGreaterThanOrEqual(0)
        expect(box.x + box.width, `menu ${i} right edge`).toBeLessThanOrEqual(width)
        await fits(page, width)
        await page.mouse.click(5, 800)
        await expect(menu).not.toHaveAttribute('open')
      }
    })
  }

  test('a header menu closes with Escape and after navigating from it', async () => {
    await page.setViewportSize({ width: PHONE, height: 844 })
    await page.goto('/students')
    const profile = page.locator('header details').nth(1)
    await profile.locator('summary').click()
    await page.keyboard.press('Escape')
    await expect(profile).not.toHaveAttribute('open')
    await profile.locator('summary').click()
    await profile.getByRole('link', { name: 'Change password' }).click()
    await expect(page).toHaveURL(/\/account\/password/)
    await expect(profile).not.toHaveAttribute('open')
  })

  test('the drawer fits, stops the page scrolling behind it, and closes', async () => {
    await page.setViewportSize({ width: SMALL_PHONE, height: 844 })
    await page.goto('/students')
    await page.getByRole('button', { name: 'Open menu' }).click()
    const drawer = page.getByRole('dialog', { name: 'Menu' })
    await expect(drawer).toBeVisible()
    const box = (await drawer.locator('> div').boundingBox())!
    expect(box.x + box.width).toBeLessThanOrEqual(SMALL_PHONE)
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden')
    await page.keyboard.press('Escape')
    await expect(drawer).toBeHidden()
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('')
  })

  test('key lists become labelled cards on a phone and stay tables at sm and above', async () => {
    await page.setViewportSize({ width: PHONE, height: 844 })
    await page.goto('/students')
    const list = page.locator('.table-stack')
    await expect(list.locator('thead')).toBeHidden()
    expect(await list.locator('tbody td[data-label="Stage"]').first().evaluate((td) => getComputedStyle(td).display)).toBe('block')
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(list.locator('thead')).toBeVisible()
    expect(await list.locator('tbody td[data-label="Stage"]').first().evaluate((td) => getComputedStyle(td).display)).toBe('table-cell')
  })

  test('form fields do not trigger iOS zoom and controls are large enough to tap on a phone', async () => {
    await page.setViewportSize({ width: PHONE, height: 844 })
    await page.goto('/students')
    const sizes = await page.locator('main form input:not([type=checkbox]):not([type=radio]):not([type=hidden]), main form select').evaluateAll((fields) => fields.map((f) => {
      const box = f.getBoundingClientRect()
      return { font: parseFloat(getComputedStyle(f).fontSize), height: box.height }
    }))
    expect(sizes.length).toBeGreaterThan(0)
    for (const s of sizes) { expect(s.font).toBeGreaterThanOrEqual(16); expect(s.height).toBeGreaterThanOrEqual(40) }
    for (const name of ['Open menu']) {
      const box = (await page.getByRole('button', { name }).boundingBox())!
      expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(40)
    }
    const pager = await page.getByRole('navigation', { name: 'Pagination' }).locator('.btn-secondary').first().boundingBox()
    expect(pager!.height).toBeGreaterThanOrEqual(40)
  })
})

test.describe('student portal', () => {
  test(`/portal/home and a real referral page fit at ${PHONE}px`, async ({ page, browser }) => {
    await login(page, 'edx.manager@demo.test', PASSWORD)
    await page.getByLabel('Company').selectOption({ label: 'Dr.Expert Edulinks' })
    await page.goto('/students/new')
    const n = Date.now().toString().slice(-5)
    await page.getByLabel('Full name (as on passport) *').fill(`Responsive Check ${n}`)
    await page.getByLabel('Primary phone', { exact: true }).fill(`+91 90070 ${n}`)
    await page.getByLabel('Secondary phone', { exact: true }).fill(`+91 90071 ${n}`)
    await page.locator('#email').fill(`responsive.${n}@example.test`)
    await page.getByRole('button', { name: 'Register student' }).click()
    await expect(page.getByText(/Student registered with ID/)).toBeVisible()
    const code = (await page.getByText(/Student registered with ID/).innerText()).match(/[A-Z]{3}-\d{2}-\d{6}/)![0]
    await page.getByRole('button', { name: 'Create account & issue set-up link' }).click()
    const link = new URL(await page.getByLabel('One-time link (shown only now)').inputValue())

    const student = await browser.newPage({ viewport: { width: PHONE, height: 844 } })
    await student.goto(link.pathname + link.search)
    await student.getByLabel('New password').fill('Fictional-Pass-2026!')
    await student.getByLabel('Repeat the password').fill('Fictional-Pass-2026!')
    await student.getByRole('button', { name: 'Save password' }).click()
    await expect(student.getByText('Your password is saved. Sign in below.')).toBeVisible()
    await student.getByLabel('Student ID or verified email').fill(code)
    await student.getByLabel('Password', { exact: true }).fill('Fictional-Pass-2026!')
    await student.getByRole('button', { name: 'Sign in with password' }).click()
    await expect(student.getByRole('heading', { name: 'Application progress' })).toBeVisible()
    await fits(student, PHONE)
    await fits(student, SMALL_PHONE)
    const referral = student.getByLabel('Your referral link')
    if (await referral.count()) await fits(student, PHONE, new URL(await referral.first().inputValue()).pathname)
    await student.close()
  })
})

/** Uploads fictional files, so it only runs against the disposable test database (port 54339), never a development one. */
const disposable = /:54339\//.test(process.env.DATABASE_ADMIN_URL ?? '')

test.describe('document viewers', () => {
  test.skip(!disposable, 'uploads files: runs only against the disposable test database (DATABASE_ADMIN_URL on port 54339)')
  test('the PDF and image viewers stay inside the screen', async ({ page }) => {
    test.setTimeout(120_000)
    const admin = adminDb()
    try {
      const docs = await admin`
        select d.id, d.student_id, t.name from student_documents d
          join document_types t on t.id = d.document_type_id
         where d.current_file_id is null and d.student_id = (
           select s.id from students s
             join student_assignments a on a.student_id = s.id and a.is_active and a.assignment_type = 'documentation'
             join user_profiles u on u.id = a.user_id and u.email = 'docs@demo.test'
            where s.status = 'active' and s.is_demo
              and (select count(*) from student_documents x where x.student_id = s.id and x.current_file_id is null) >= 2
            limit 1)
         order by t.name limit 2`
      expect(docs).toHaveLength(2)
      await login(page, 'docs@demo.test')
      const png = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: '#dde5ee' } }).png().toBuffer()
      const files = [
        { name: 'fictional.pdf', mimeType: 'application/pdf', buffer: placeholderPdf('Fictional responsive check', ['Fictional text for a layout check only.']) },
        { name: 'fictional.png', mimeType: 'image/png', buffer: png },
      ]
      for (const [i, file] of files.entries()) {
        await page.setViewportSize({ width: 1280, height: 800 })
        await page.goto(`/students/${docs[i].student_id}?tab=documents`)
        const item = page.locator('li', { hasText: docs[i].name as string }).first()
        await item.locator('input[type=file]').setInputFiles(file)
        await item.getByRole('button', { name: 'Upload' }).click()
        await expect(item.getByText('Uploaded – pending review')).toBeVisible()
        const review = `/students/${docs[i].student_id}/documents/${docs[i].id}`
        for (const width of [SMALL_PHONE, PHONE, TABLET]) {
          await fits(page, width, review)
          if (i === 0) {
            const canvas = page.locator('main canvas').first()
            await expect(canvas).toBeVisible()
            await page.waitForTimeout(500)
            if (width < 1024) expect((await canvas.boundingBox())!.width, `PDF opens at the screen width at ${width}px`).toBeLessThanOrEqual(width)
          } else {
            await expect(page.getByAltText('Uploaded document')).toBeVisible()
          }
          await fits(page, width)
        }
      }
    } finally { await admin.end() }
  })
})
