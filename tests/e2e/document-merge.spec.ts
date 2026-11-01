import { expect, test } from '@playwright/test'
import { adminDb, login } from './helpers'

const admin = adminDb()
test.afterAll(async () => { await admin.end() })

test('select, order, check and download a combined PDF named after the student, passport and university', async ({ page }) => {
  // a fictional demo student with at least two uploaded documents
  const [s] = await admin`
    select s.id, s.full_name, s.passport_number, u.name as university from students s left join universities u on u.id = s.preferred_university_id
     where s.is_demo and s.status = 'active' and s.originating_org_id = (select id from organizations where code = 'EDX')
       and (select count(*) from student_documents d where d.student_id = s.id and d.current_file_id is not null) >= 2
     order by s.created_at limit 1`
  await login(page, 'md@demo.test')
  await page.goto(`/students/${s.id}?tab=documents`)
  const panel = page.locator('section', { has: page.getByRole('heading', { name: /Merge & Download PDF/ }) })
  const boxes = panel.getByRole('checkbox', { name: /^Include / })
  const first = (await boxes.nth(0).getAttribute('aria-label'))!.replace('Include ', '')
  const second = (await boxes.nth(1).getAttribute('aria-label'))!.replace('Include ', '')
  await boxes.nth(0).check(); await boxes.nth(1).check()
  // put the second document first
  await panel.getByRole('button', { name: `Move ${second} up` }).click()
  const ordered = panel.getByRole('list', { name: 'Order in the PDF' }).getByRole('listitem')
  await expect(ordered.nth(0)).toContainText(second)
  await expect(ordered.nth(1)).toContainText(first)
  const expected = [s.full_name, s.passport_number, s.university].filter(Boolean).join(' - ') + '.pdf'
  await expect(panel.getByText(expected).first()).toBeVisible() // also listed in the history after earlier runs
  await panel.getByRole('button', { name: '1. Check documents' }).click()
  await expect(panel.getByText(/Ready: 2 document\(s\)/).first()).toBeVisible()
  const unapproved = panel.getByRole('checkbox', { name: /may be included/ })
  if (await unapproved.count()) await unapproved.check()
  const [download] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: '2. Download Combined PDF' }).click()])
  expect(download.suggestedFilename()).toBe(expected)
  const buf = await download.createReadStream().then(async (st) => { const c: Buffer[] = []; for await (const x of st) c.push(x as Buffer); return Buffer.concat(c) })
  expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
})
