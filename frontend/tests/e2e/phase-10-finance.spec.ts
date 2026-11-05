import { expect, test } from '@playwright/test'
import { adminDb, login } from './helpers'
import { Evidence } from './evidence'

/** Phase 10, real browsers on the throwaway stack with fictional data: workflow 21 (finance entry and payment history). No real payment is made. */
const admin = adminDb()
test.afterAll(async () => { await admin.end() })
test.describe.configure({ timeout: 240_000 })
const stamp = () => Date.now().toString().slice(-5)
const day = (o: number) => new Date(Date.now() + o * 86400000).toISOString().slice(0, 10)

test('21: finance records a USD charge with a due date and a receipt; another person verifies; history, overdue view and reports are right; others are refused', async ({ browser }) => {
  const ev = new Evidence('21 finance entry and payment history', [/status of 404/]) // the refusals below are asserted to be 404
  const ctx = await browser.newContext()
  const page = ev.watch(await ctx.newPage(), 'Finance')
  const n = stamp()
  await login(page, 'edx.manager@demo.test')
  await page.getByLabel('Company').selectOption({ label: 'Dr.Expert Edulinks' })
  await page.goto('/students/new')
  await page.getByLabel('Full name (as on passport) *').fill(`Fictional Finance ${n}`)
  await page.getByLabel('Primary phone', { exact: true }).fill(`+91 90060 ${n}`)
  await page.getByRole('button', { name: 'Register student' }).click()
  await expect(page.getByText(/Student registered with ID/)).toBeVisible()
  const id = new URL(page.url()).pathname.split('/').pop()!

  await login(page, 'edx.finance@demo.test')
  await page.goto(`/students/${id}?tab=payments`)
  const record = async (type: string, amount: string, date: string, extra?: () => Promise<void>) => {
    await page.locator('#entryType').selectOption(type)
    await page.locator('#feeCategoryId').selectOption({ index: 1 })
    await page.locator('#currency').selectOption('USD')
    await page.locator('#amount').fill(amount)
    await page.locator('#exchangeRate').fill('88.5')
    await page.locator('#entryDate').fill(date)
    if (extra) await extra()
    await page.getByRole('button', { name: 'Record entry' }).click()
  }
  await record('charge', '1200', day(-20))
  await expect.poll(async () => (await admin`select count(*)::int as n from payment_entries where student_id = ${id} and entry_type = 'charge'`)[0].n, { timeout: 15_000 }).toBe(1)
  await page.reload()
  await expect(page.getByText('$1,200.00').first()).toBeVisible()
  const [charge] = await admin`select id, exchange_rate, inr_amount from payment_entries where student_id = ${id} and entry_type = 'charge'`
  expect(charge.inr_amount).toBe('106200.00') // original currency and rate kept, INR calculated by the database

  // due date: a date before the charge is refused, a past date after it shows as overdue
  const set = page.locator('details', { hasText: 'Set due date' }).first()
  await set.locator('summary').click()
  await set.getByLabel('Due date').fill(day(-25))
  await set.getByRole('button', { name: 'Save due date' }).click()
  await expect(page.getByText('The due date cannot be before the charge date.')).toBeVisible()
  await set.getByLabel('Due date').fill(day(-2))
  await set.getByLabel('Note (optional)').fill('Fictional first instalment')
  await set.getByRole('button', { name: 'Save due date' }).click()
  await expect(page.getByTestId('due-row').getByText('Overdue')).toBeVisible()
  await expect(page.getByTestId('due-row').getByText('Fictional first instalment')).toBeVisible()

  await page.goto('/payments')
  await expect(page.getByRole('link', { name: 'See the outstanding balances report' })).toBeVisible()
  await page.getByRole('link', { name: 'See the outstanding balances report' }).click()
  await expect(page).toHaveURL(/status=overdue/)
  await expect(page.getByRole('cell', { name: `Fictional Finance ${n}` })).toBeVisible()

  // a receipt starts unverified and needs a different person
  await page.goto(`/students/${id}?tab=payments`)
  await record('receipt', '1200', day(-1), async () => {
    await page.locator('select[name="method"]').selectOption('bank_transfer')
    await page.locator('input[name="referenceNo"]').fill(`FICT${n}`)
  })
  await expect.poll(async () => (await admin`select count(*)::int as n from payment_entries where student_id = ${id} and entry_type = 'receipt'`)[0].n, { timeout: 15_000 }).toBe(1)
  await page.reload()
  await expect(page.getByText('Needs another verifier')).toBeVisible()

  const mdPage = await (await browser.newContext()).newPage()
  ev.watch(mdPage, 'MD')
  await login(mdPage, 'md@demo.test')
  await mdPage.goto(`/students/${id}?tab=payments`)
  await mdPage.getByRole('button', { name: /Verify/ }).first().click()
  await expect.poll(async () => (await admin`select verification_status as v from payment_entries where student_id = ${id} and entry_type = 'receipt'`)[0].v, { timeout: 15_000 }).toBe('verified')
  await mdPage.reload()
  await expect(mdPage.getByTestId('due-row').getByText('Settled')).toBeVisible()
  await expect(mdPage.getByRole('link', { name: /^Receipt / })).toBeVisible()

  // reports: monthly summary filters by entry date and exports only for finance holders
  const month = day(-1).slice(0, 7)
  await mdPage.goto(`/reports/finance-monthly?from=${day(-20)}&to=${day(0)}`)
  await expect(mdPage.getByRole('heading', { name: 'Monthly financial summary' })).toBeVisible()
  await expect(mdPage.getByRole('cell', { name: month }).first()).toBeVisible()
  await expect(mdPage.getByRole('link', { name: 'Export CSV' })).toBeVisible()

  // a counsellor sees no finance report; the other company sees no ledger for this student
  const other = await (await browser.newContext()).newPage()
  ev.watch(other, 'Counsellor')
  await login(other, 'edx.counsellor@demo.test')
  expect((await other.goto('/reports/finance-monthly'))?.status()).toBe(404)
  expect((await other.request.get('/api/reports/finance-revenue', { maxRedirects: 0 })).status()).toBeGreaterThanOrEqual(400)
  await login(other, 'grd.finance@demo.test')
  expect((await other.goto(`/students/${id}?tab=payments`))?.status()).toBe(404)

  await ev.finish('USD charge kept its rate, due date overdue then settled after a verified receipt, receipt link shown, reports filtered, counsellor and other company refused')
  await ctx.close()
})
