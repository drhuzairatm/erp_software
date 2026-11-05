import { expect, test } from '@playwright/test'
import { adminDb, login } from './helpers'
import { Evidence } from './evidence'

/** Phase 11, real browsers on the throwaway stack with fictional data: workflow 22 (dashboard filtering and reporting). */
const admin = adminDb()
test.afterAll(async () => { await admin.end() })
test.describe.configure({ timeout: 240_000 })

test('22: management dashboard and reports filter on real data, export is permission-checked, a counsellor gets neither', async ({ browser }) => {
  const ev = new Evidence('22 dashboard filtering and reporting', [/status of 404/]) // the refusals below are asserted to be 404
  const ctx = await browser.newContext({ acceptDownloads: true })
  const page = ev.watch(await ctx.newPage(), 'MD')
  await login(page, 'md@demo.test')
  await page.goto('/?view=analytics')
  await expect(page.getByRole('region', { name: 'Operations' }).getByText('Pending documents')).toBeVisible()
  await expect(page.getByText('University-wise admissions')).toBeVisible()
  await expect(page.getByText('Intake-wise admissions')).toBeVisible()
  await expect(page.getByTestId('attendance-today')).toBeVisible()
  await expect(page.getByTestId('task-summary')).toBeVisible()

  // the dashboard filter changes the headline, and each figure equals a direct count for that company
  const [edx] = await admin`select id from organizations where code = 'EDX'`
  await page.getByLabel('Company').selectOption({ label: 'Dr.Expert Edulinks' })
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
  const total = async () => Number((await page.getByText('Total students', { exact: true }).locator('xpath=../..').locator('p.tabular-nums').first().textContent())!.replace(/\D/g, ''))
  const counts = () => admin`select s.destination_country_id as id, count(*)::int as n from students s join student_org_access a on a.student_id = s.id and a.org_id = ${edx.id}
    where s.archived_at is null and s.status <> 'merged' group by 1 order by 2 desc`
  await page.goto('/?view=analytics')
  const all = await counts()
  const everyone = all.reduce((t, r) => t + r.n, 0)
  expect(await total()).toBe(everyone)
  const c = all.find((r) => r.id && r.n < everyone) ?? all.find((r) => r.id)!
  await page.locator('#a-country').selectOption(c.id)
  await page.getByRole('button', { name: 'Apply' }).first().click()
  await expect(page).toHaveURL(new RegExp(`country=${c.id}`))
  await expect.poll(total).toBe(c.n)

  // reports: department filter on employee tasks
  const [u] = await admin`select id, full_name from user_profiles where email = 'edx.counsellor2@demo.test'`
  const name = `Fictional Dept ${Date.now().toString().slice(-6)}`
  const [dept] = await admin`insert into departments (org_id, name) values (${edx.id}, ${name}) returning id`
  await admin`update organization_memberships set department_id = ${dept.id} where org_id = ${edx.id} and user_id = ${u.id}`
  await page.goto('/reports/employee-tasks')
  await page.getByLabel('Department').selectOption(dept.id)
  await page.getByRole('button', { name: 'Apply' }).click()
  await expect(page).toHaveURL(new RegExp(`department=${dept.id}`))
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await expect(page.getByRole('cell', { name: u.full_name })).toBeVisible()

  // the export carries the same filter and is audited
  const download = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Export CSV' }).click()
  const csv = await (await download).createReadStream().then(async (s) => { const b: Buffer[] = []; for await (const x of s) b.push(x as Buffer); return Buffer.concat(b).toString() })
  expect(csv.trim().split('\n')).toHaveLength(2)
  expect(csv).toContain(u.full_name)
  await expect.poll(async () => (await admin`select count(*)::int as n from audit_logs where action = 'export' and entity_id = 'employee-tasks' and occurred_at > now() - interval '2 minutes'`)[0].n).toBeGreaterThan(0)
  await admin`update organization_memberships set department_id = null where org_id = ${edx.id} and user_id = ${u.id}`

  await page.goto('/reports/attendance-summary')
  await expect(page.getByRole('columnheader', { name: 'No record' })).toBeVisible()
  await page.goto('/reports/by-intake')
  await expect(page.getByRole('columnheader', { name: 'Intake' })).toBeVisible()
  await page.goto('/reports')
  await expect(page.getByRole('link', { name: /Attendance summary/ })).toBeVisible()

  const other = await (await browser.newContext()).newPage()
  ev.watch(other, 'Counsellor')
  await login(other, 'edx.counsellor@demo.test')
  expect((await other.goto('/reports/attendance-summary'))?.status()).toBe(404)
  expect((await other.goto('/reports/employee-tasks'))?.status()).toBe(404)
  expect((await other.request.get('/api/reports/attendance-summary', { maxRedirects: 0 })).status()).toBeGreaterThanOrEqual(400)
  await other.goto('/')
  await expect(other.getByTestId('attendance-today')).toHaveCount(0)
  await ev.finish('Dashboard sections shown to the MD, department filter narrowed the report to one person, CSV matched and the export was audited, counsellor refused')
  await ctx.close()
})
