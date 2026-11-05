import { expect, test } from '@playwright/test'
import { adminDb, login } from './helpers'
import { Evidence } from './evidence'

/** Student merge in real browsers, on the throwaway stack with fictional data (audit findings BC-03 and BC-04). No real payment is made. */
const admin = adminDb()
test.afterAll(async () => { await admin.end() })
test.describe.configure({ timeout: 240_000 })
const stamp = () => Date.now().toString().slice(-5)
const day = (o: number) => new Date(Date.now() + o * 86400000).toISOString().slice(0, 10)

test('an MD merges a duplicate: the paid charge stays settled, and its preference, question and pre-admission link appear on the surviving record', async ({ browser }) => {
  const ev = new Evidence('student merge', [/status of 404/])
  const n = stamp()
  const ctx = await browser.newContext()
  const page = ev.watch(await ctx.newPage(), 'Manager')
  await login(page, 'edx.manager@demo.test')
  await page.getByLabel('Company').selectOption({ label: 'Dr.Expert Edulinks' })
  const register = async (name: string, phone: string) => {
    await page.goto('/students/new')
    await page.getByLabel('Full name (as on passport) *').fill(name)
    await page.getByLabel('Primary phone', { exact: true }).fill(phone)
    await page.getByRole('button', { name: 'Register student' }).click()
    await expect(page.getByText(/Student registered with ID/)).toBeVisible()
    return new URL(page.url()).pathname.split('/').pop()!
  }
  const keep = await register(`Fictional Survivor ${n}`, `+91 90061 ${n}`)
  const drop = await register(`Fictional Duplicate ${n}`, `+91 90062 ${n}`)
  const [{ student_code: dropCode }] = await admin`select student_code from students where id = ${drop}`

  // on the duplicate: a charge with a due date, fully paid, and verified by a second person
  const fin = ev.watch(await (await browser.newContext()).newPage(), 'Finance')
  await login(fin, 'edx.finance@demo.test')
  await fin.goto(`/students/${drop}?tab=payments`)
  const record = async (type: string, amount: string, date: string, extra?: () => Promise<void>) => {
    await fin.locator('#entryType').selectOption(type)
    await fin.locator('#feeCategoryId').selectOption({ index: 1 })
    await fin.locator('#amount').fill(amount)
    await fin.locator('#entryDate').fill(date)
    if (extra) await extra()
    await fin.getByRole('button', { name: 'Record entry' }).click()
  }
  await record('charge', '50000', day(-20))
  await expect.poll(async () => (await admin`select count(*)::int as n from payment_entries where student_id = ${drop} and entry_type = 'charge'`)[0].n, { timeout: 15_000 }).toBe(1)
  await fin.reload()
  const set = fin.locator('details', { hasText: 'Set due date' }).first()
  await set.locator('summary').click()
  await set.getByLabel('Due date').fill(day(-2))
  await set.getByRole('button', { name: 'Save due date' }).click()
  await expect(fin.getByTestId('due-row').getByText('Overdue')).toBeVisible()
  await record('receipt', '50000', day(-1), async () => {
    await fin.locator('select[name="method"]').selectOption('bank_transfer')
    await fin.locator('input[name="referenceNo"]').fill(`MERGE${n}`)
  })
  await expect.poll(async () => (await admin`select count(*)::int as n from payment_entries where student_id = ${drop} and entry_type = 'receipt'`)[0].n, { timeout: 15_000 }).toBe(1)

  const md = ev.watch(await (await browser.newContext()).newPage(), 'MD')
  await login(md, 'md@demo.test')
  await md.goto(`/students/${drop}?tab=payments`)
  await md.getByRole('button', { name: /Verify/ }).first().click()
  await expect.poll(async () => (await admin`select verification_status as v from payment_entries where student_id = ${drop} and entry_type = 'receipt'`)[0].v, { timeout: 15_000 }).toBe('verified')
  await md.reload()
  await expect(md.getByTestId('due-row').getByText('Settled')).toBeVisible()

  // on the duplicate, too: a preference, a question from the student, and a finished pre-admission request linked to it
  const [{ id: org }] = await admin`select id from organizations where code = 'EDX'`
  const [country] = await admin`select id, name from countries where code = 'BG'`
  const [mgrUser] = await admin`select id from user_profiles where email = 'edx.manager@demo.test'`
  const [counsellor] = await admin`select id from user_profiles where email = 'edx.counsellor@demo.test'`
  await admin`insert into student_preferences (student_id, rank, country_id, updated_by) values (${drop}, 2, ${country.id}, ${mgrUser.id})`
  const token = `merge-e2e-${n}-${Date.now()}`
  await admin`insert into auth_private.portal_sessions (token_hash, student_ids, active_student_id) values (${token}, ${[drop]}, ${drop})`
  const [{ ticket_id: ticket }] = await admin`select * from app.portal_ticket_create(${token}, 'documents', ${`Fictional merge question ${n}`}, 'Fictional question text')`
  const dvrNumber = `DVR-2026-${n}9`
  const [dvr] = await admin`insert into dvr_requests (org_id, dvr_number, prospect_name, prospect_phone, destination_country_id, counsellor_id, status, linked_student_id, linked_at, linked_by)
    values (${org}, ${dvrNumber}, 'Fictional Prospect', '+91 90000 00000', ${country.id}, ${counsellor.id}, 'closed', ${drop}, now(), ${counsellor.id}) returning id`

  // the merge, from the surviving record
  await md.goto(`/students/${keep}`)
  await md.locator('#mergedCode').fill(dropCode)
  await md.locator('#merge-reason').fill('Fictional duplicate registration')
  await md.getByRole('button', { name: 'Merge duplicate' }).click()
  await md.getByRole('button', { name: 'Yes, continue' }).click()
  await expect(md.getByText(/Records merged/)).toBeVisible()

  await md.goto(`/students/${keep}`)
  await expect(md.getByText(dvrNumber)).toBeVisible()
  await md.getByTestId('pref-history').locator('summary').click()
  await expect(md.getByTestId('pref-history').getByText(/moved here by a merge/)).toBeVisible()
  await md.goto(`/students/${keep}?tab=payments`)
  await expect(md.getByTestId('due-row').getByText('Settled')).toBeVisible()
  await expect(md.getByTestId('due-row').getByText('Overdue')).toHaveCount(0)
  await md.goto(`/students/${drop}?tab=payments`)
  await expect(md.getByTestId('due-row')).toHaveCount(0)
  await expect(md.getByText(/This record was merged into/)).toBeVisible()

  await md.goto(`/tickets/${ticket}`)
  await expect(md.getByText(`Fictional merge question ${n}`).first()).toBeVisible()
  await expect(md.getByText('Fictional question text')).toBeVisible()
  await md.goto(`/pre-admission/${dvr.id}`)
  await expect(md.getByText(/Moved from merged record/)).toBeVisible()

  // another company has no way in
  const other = ev.watch(await (await browser.newContext()).newPage(), 'Other company')
  await login(other, 'grd.finance@demo.test')
  expect((await other.goto(`/students/${keep}?tab=payments`))?.status()).toBe(404)

  await ev.finish('the paid charge stayed settled on the surviving record; preference, question and pre-admission link moved with history; the other company was refused')
  await ctx.close()
})

test('preferences that cannot all fit stop the merge, with the reason shown, and nothing changes', async ({ browser }) => {
  const ev = new Evidence('student merge stopped')
  const [a, b] = await admin`select s.id, s.student_code from students s join organizations o on o.id = s.originating_org_id where o.code = 'EDX' and s.status = 'active' and s.archived_at is null and s.is_demo
    and not exists (select 1 from student_preferences p where p.student_id = s.id) order by s.created_at desc limit 2`
  const countries = await admin`select id from countries where is_active order by code limit 3`
  const [u] = await admin`select id from user_profiles where email = 'md@demo.test'`
  await admin`insert into student_preferences (student_id, rank, country_id, updated_by) values (${a.id}, 2, ${countries[0].id}, ${u.id}), (${a.id}, 3, ${countries[1].id}, ${u.id}), (${b.id}, 2, ${countries[2].id}, ${u.id})`
  const md = ev.watch(await (await browser.newContext()).newPage(), 'MD')
  await login(md, 'md@demo.test')
  await md.goto(`/students/${a.id}`)
  await md.locator('#mergedCode').fill(b.student_code)
  await md.locator('#merge-reason').fill('Fictional duplicate')
  await md.getByRole('button', { name: 'Merge duplicate' }).click()
  await md.getByRole('button', { name: 'Yes, continue' }).click()
  await expect(md.getByText(/Cannot merge: both records have different secondary and tertiary preferences/)).toBeVisible()
  expect((await admin`select status from students where id = ${b.id}`)[0].status).toBe('active')
  await admin`delete from student_preferences where student_id in (${a.id}, ${b.id})`
  await ev.finish('the merge stopped, the reason was shown, and nothing changed')
})
