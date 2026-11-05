import { expect, test } from '@playwright/test'
import { adminDb, login } from './helpers'
import { Evidence } from './evidence'

/** Phase 9, real browsers on the throwaway stack with fictional data: workflows 19 (preference selection) and 20 (university-specific requirement display). */
const admin = adminDb()
test.afterAll(async () => { await admin.end() })
test.describe.configure({ timeout: 180_000 })
const stamp = () => Date.now().toString().slice(-5)

test('19, 20: staff choose a secondary preference and see subject-wise, Bulgaria and university requirements; registration stays open', async ({ browser }) => {
  const ev = new Evidence('19-20 preference selection and university requirement display', [])
  const ctx = await browser.newContext()
  const page = ev.watch(await ctx.newPage(), 'Manager')
  await login(page, 'edx.manager@demo.test')
  await page.getByLabel('Company').selectOption({ label: 'Dr.Expert Edulinks' })
  const n = stamp()
  await page.goto('/students/new')
  await page.getByLabel('Full name (as on passport) *').fill(`Fictional Preference ${n}`)
  await page.getByLabel('Primary phone', { exact: true }).fill(`+91 90050 ${n}`)
  await page.getByRole('button', { name: 'Register student' }).click()
  await expect(page.getByText(/Student registered with ID/)).toBeVisible()
  const id = new URL(page.url()).pathname.split('/').pop()!

  const [bg] = await admin`select id from countries where code = 'BG'`
  const [uni] = await admin`select id, name from universities where country_id = ${bg.id} and is_active limit 1`
  const [doc] = await admin`select id, name from document_types where key = 'birth_certificate'`
  const note = `Fictional university note ${n}`
  await admin`delete from university_document_requirements where university_id = ${uni.id} and document_type_id = ${doc.id}`
  await admin`insert into university_document_requirements (university_id, document_type_id, is_required, notes) values (${uni.id}, ${doc.id}, true, ${note})`

  const box = page.getByRole('region', { name: 'Secondary preference' })
  await box.getByText('Add').click()
  await box.getByLabel('Country *').selectOption(bg.id)
  await box.getByLabel('University').selectOption(uni.id)
  await box.getByRole('button', { name: 'Save secondary preference' }).click()
  await expect(box.getByText(uni.name).first()).toBeVisible()

  // 20: what applies to this choice
  await expect(box.getByText('BULGARIA – IMPORTANT ACADEMIC REQUIREMENTS')).toBeVisible()
  await expect(box.getByText('Chemistry: 60% or above')).toBeVisible()
  await expect(box.getByText('English: 60% or above')).toBeVisible()
  await expect(box.getByTestId('pref-country-doc').filter({ hasText: 'Bonafide Certificate' })).toBeVisible()
  await expect(box.getByTestId('pref-country-doc').filter({ hasText: 'Police Clearance' }).getByText('Must match the visa application country')).toBeVisible()
  await expect(box.getByTestId('pref-university-doc').filter({ hasText: note })).toBeVisible()
  await expect(page.getByText('They do not stop registration')).toBeVisible()
  expect((await admin`select status from students where id = ${id}`)[0].status).toBe('active')

  // a change is recorded, and removal keeps the history
  await page.reload()
  await page.getByTestId('pref-history').getByText('Change history').click()
  await expect(page.getByText(/Secondary saved: Bulgaria/)).toBeVisible()
  await page.getByRole('region', { name: 'Secondary preference' }).getByRole('button', { name: 'Remove' }).click()
  await page.getByRole('button', { name: 'Yes, continue' }).click()
  await expect.poll(async () => (await admin`select count(*)::int as n from student_preferences where student_id = ${id}`)[0].n).toBe(0)
  await admin`delete from university_document_requirements where university_id = ${uni.id} and document_type_id = ${doc.id} and notes = ${note}`
  await ev.finish('Secondary preference saved; Bulgaria subject-wise marks, Bonafide, PCC check and a university document all displayed; removal kept the history; registration stayed open.')
})

test('rules: the MD adds an academic year and verifies a rule; an unverified rule shows nowhere; others cannot open these pages', async ({ browser }) => {
  const ev = new Evidence('Phase 9 master data and rule verification', [/status of 404/])
  const ctx = await browser.newContext()
  const md = ev.watch(await ctx.newPage(), 'MD')
  await login(md, 'md@demo.test')
  const code = `20${stamp().slice(-2)}-${stamp().slice(0, 2)}`
  await admin`delete from academic_years where code = ${code}`
  await md.goto('/admin/master-data/academic-years')
  await md.locator('#y-code').fill(code)
  await md.getByRole('button', { name: 'Add academic year' }).click()
  await expect(md.getByRole('button', { name: `Deactivate ${code}` })).toBeVisible()
  await md.getByRole('button', { name: `Deactivate ${code}` }).click()
  await expect(md.getByRole('button', { name: `Activate ${code}` })).toBeVisible()

  const [c] = await admin`select c.id from countries c where c.is_active and c.is_destination and c.code <> 'BG' and not exists (select 1 from country_document_rules r where r.country_id = c.id) limit 1`
  const [d] = await admin`select id from document_types where key = 'birth_certificate'`
  await md.goto('/admin/master-data/country-documents')
  await expect(md.getByTestId('country-rule').filter({ hasText: 'Bulgaria · Police Clearance' }).getByText('Verified', { exact: true })).toBeVisible()
  await md.getByText('New rule').click()
  await md.locator('#new-c').selectOption(c.id)
  await md.locator('#new-d').selectOption(d.id)
  await md.locator('#new-n').fill('Fictional source')
  await md.getByRole('button', { name: 'Save rule' }).first().click()
  await expect.poll(async () => (await admin`select verification_status as v, is_active as a from country_document_rules where country_id = ${c.id} and document_type_id = ${d.id}`)[0]).toEqual({ v: 'unverified', a: false })
  await md.reload()
  const [{ id: ruleId }] = await admin`select id from country_document_rules where country_id = ${c.id} and document_type_id = ${d.id}`
  const row = md.locator(`[data-rule="${ruleId}"]`)
  await expect(row.getByRole('button', { name: 'Activate' })).toHaveCount(0)
  await row.getByLabel('Based on').fill('Fictional decision')
  await row.getByRole('button', { name: 'Mark verified' }).click()
  await expect.poll(async () => (await admin`select verification_status as v from country_document_rules where country_id = ${c.id} and document_type_id = ${d.id}`)[0].v).toBe('verified')
  await admin`delete from country_document_rules where country_id = ${c.id} and document_type_id = ${d.id}`

  const counsellor = ev.watch(await (await browser.newContext()).newPage(), 'Counsellor')
  await login(counsellor, 'edx.counsellor@demo.test')
  expect((await counsellor.goto('/admin/master-data/country-documents'))?.status()).toBe(404)
  expect((await counsellor.goto('/admin/master-data/academic-years'))?.status()).toBe(404)
  await ev.finish('Academic year added and deactivated; rule stayed inactive and unverified until the MD marked it; counsellor refused.')
})
