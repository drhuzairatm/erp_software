/** Phase 10: due dates, reminders and finance reports. The ledger itself is reused and must stay untouched. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { anonymous, db } from '@/lib/db'
import { ServiceError } from '@/lib/errors'
import * as payments from '@/services/payments'
import * as reports from '@/services/reports'
import * as students from '@/services/students'
import { adminSql, as, ctxFor, expectDbError, orgId } from '../support/helpers'

let EDX: string; let SERVICE: string
const rand = () => String(Math.floor(Math.random() * 90000) + 10000)
const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10)
beforeAll(async () => {
  EDX = await orgId('EDX')
  SERVICE = (await adminSql()`select id from fee_categories where org_id = ${EDX} and kind = 'service' order by name limit 1`)[0].id
})
afterAll(async () => { await adminSql().end(); await db().end() })

async function kindOf(p: Promise<unknown>) {
  try { await p } catch (e) { expect(e).toBeInstanceOf(ServiceError); return (e as ServiceError).kind }
  throw new Error('expected ServiceError')
}
async function setup() {
  const mgr = await ctxFor('edx.manager@demo.test')
  const r = await students.createStudent(mgr, { originatingOrgId: EDX, fullName: 'Finance Fictional', phone: `+91 90091 ${rand()}` })
  if (!r.ok) throw new Error('student not created')
  return { id: r.id, fin: await ctxFor('edx.finance@demo.test'), md: await ctxFor('md@demo.test') }
}
type S = Awaited<ReturnType<typeof setup>>
const charge = (s: S, amount: string, extra: Record<string, string> = {}) =>
  payments.recordEntry(s.fin, s.id, { orgId: EDX, feeCategoryId: SERVICE, entryDate: day(-30), entryType: 'charge', amount, currency: 'INR', ...extra })
async function receipt(s: S, amount: string, extra: Record<string, string> = {}) {
  const id = await payments.recordEntry(s.fin, s.id, { orgId: EDX, feeCategoryId: SERVICE, entryDate: day(-1), entryType: 'receipt', amount, currency: 'INR', method: 'bank_transfer', referenceNo: `F${rand()}${rand()}`, ...extra })
  await payments.verifyEntry(s.md, id, 'verified')
  return id
}
const dueOf = async (s: S, entry: string) => (await payments.studentDueDates(s.fin, s.id)).find((d) => d.entry_id === entry)

describe('Phase 10 due dates', () => {
  it('finance sets a due date on a charge; changing it needs a reason and is audited; the charge itself never changes', async () => {
    const s = await setup()
    const c = await charge(s, '50000')
    const [before] = await adminSql()`select * from payment_entries where id = ${c}`
    await payments.setDueDate(s.fin, c, { dueDate: day(5), note: 'Fictional instalment' })
    expect(await dueOf(s, c)).toMatchObject({ due_date: day(5), note: 'Fictional instalment', unpaid: '50000.00' })
    expect(await kindOf(payments.setDueDate(s.fin, c, { dueDate: day(9) }))).toBe('invalid')
    await payments.setDueDate(s.fin, c, { dueDate: day(9), note: 'Fictional instalment', reason: 'Student asked for time' })
    expect((await dueOf(s, c))!.due_date).toBe(day(9))
    const logs = await adminSql()`select action, metadata, before_data, after_data from audit_logs where entity_id = ${c} and action like 'payment_due_date%' order by occurred_at`
    expect(logs.map((l) => l.action)).toEqual(['payment_due_date_set', 'payment_due_date_changed'])
    expect(logs[1].metadata).toMatchObject({ reason: 'Student asked for time' })
    const [after] = await adminSql()`select * from payment_entries where id = ${c}`
    expect(after).toEqual(before)
  })

  it('refuses receipts, reversed charges and a date before the charge', async () => {
    const s = await setup()
    const c = await charge(s, '1000')
    expect(await kindOf(payments.setDueDate(s.fin, c, { dueDate: day(-31) }))).toBe('invalid')
    expect(await kindOf(payments.setDueDate(s.fin, c, { dueDate: 'soon' }))).toBe('invalid')
    const r = await receipt(s, '10')
    expect(await kindOf(payments.setDueDate(s.fin, r, { dueDate: day(2) }))).toBe('invalid')
    const c2 = await charge(s, '700')
    await payments.setDueDate(s.fin, c2, { dueDate: day(2) })
    await payments.reverseEntry(s.fin, c2, 'Fictional mistake')
    const [rev] = await adminSql()`select id, verification_status from payment_entries where reverses_entry_id = ${c2}`
    expect(rev.verification_status).toBe('pending')
    await payments.setDueDate(s.fin, c2, { dueDate: day(3), reason: 'A pending reversal keeps the charge active' })
    await payments.verifyEntry(s.md, rev.id, 'verified')
    expect(await kindOf(payments.setDueDate(s.fin, c2, { dueDate: day(4), reason: 'Too late' }))).toBe('invalid')
    expect(await dueOf(s, c2)).toBeUndefined() // a reversed charge has no unpaid amount and no longer appears
  })

  it('permissions: no direct writes, other company and non-finance staff are refused', async () => {
    const s = await setup()
    const c = await charge(s, '1000')
    await expectDbError(as('edx.finance@demo.test', (tx) => tx`insert into payment_due_dates (entry_id, org_id, student_id, due_date, set_by) values (${c}, ${EDX}, ${s.id}, ${day(1)}, ${s.fin.userId})`), '42501')
    await expectDbError(as('edx.finance@demo.test', (tx) => tx`update payment_due_status set due_date = ${day(1)}`), '55000')
    expect(await kindOf(payments.setDueDate(await ctxFor('edx.counsellor@demo.test'), c, { dueDate: day(1) }))).toMatch(/forbidden|not_found/)
    expect(await kindOf(payments.setDueDate(await ctxFor('grd.finance@demo.test'), c, { dueDate: day(1) }))).toBe('not_found')
    await payments.setDueDate(s.fin, c, { dueDate: day(1) })
    expect(await as('edx.counsellor@demo.test', (tx) => tx`select * from payment_due_dates where entry_id = ${c}`)).toHaveLength(0)
    expect(await as('edx.counsellor@demo.test', (tx) => tx`select * from payment_due_status where entry_id = ${c}`)).toHaveLength(0)
    expect(await as('grd.finance@demo.test', (tx) => tx`select * from payment_due_status where entry_id = ${c}`)).toHaveLength(0)
    expect(await kindOf(payments.studentDueDates(await ctxFor('grd.finance@demo.test'), s.id).then((r) => { if (!r.length) throw new ServiceError('not_found', 'none'); return r }))).toBe('not_found')
  })

  it('unpaid: credits settle the earliest due date first, per currency, and verified reversals remove a charge', async () => {
    const s = await setup()
    const a = await charge(s, '1000'); const b = await charge(s, '2000')
    const usd = await charge(s, '500', { currency: 'USD', exchangeRate: '85' })
    await payments.setDueDate(s.fin, a, { dueDate: day(-5) })
    await payments.setDueDate(s.fin, b, { dueDate: day(5) })
    await payments.setDueDate(s.fin, usd, { dueDate: day(-5) })
    await receipt(s, '1500') // INR money does not touch the USD charge
    expect((await dueOf(s, a))!.unpaid).toBe('0.00')
    expect((await dueOf(s, b))!.unpaid).toBe('1500.00')
    expect((await dueOf(s, usd))!.unpaid).toBe('500.00')
    const waiver = await payments.recordEntry(s.fin, s.id, { orgId: EDX, feeCategoryId: SERVICE, entryDate: day(-1), entryType: 'waiver', amount: '500', currency: 'INR', notes: 'Fictional waiver' })
    expect((await dueOf(s, b))!.unpaid).toBe('1500.00') // not counted until verified
    await payments.verifyEntry(s.md, waiver, 'verified')
    expect((await dueOf(s, b))!.unpaid).toBe('1000.00')
    const summary = await payments.dueSummary(s.fin, [EDX])
    expect(summary.overdue).toBeGreaterThanOrEqual(1)
    expect(await payments.dueSummary(await ctxFor('edx.counsellor@demo.test'), [EDX])).toEqual({ overdue: 0, dueSoon: 0 })
  })
})

describe('Phase 10 reminders', () => {
  it('system job only, once per person and date, no amount or name, only people who record payments, nothing once settled', async () => {
    const s = await setup()
    const over = await charge(s, '4321'); const soon = await charge(s, '1234'); const far = await charge(s, '99')
    await payments.setDueDate(s.fin, over, { dueDate: day(-2) })
    await payments.setDueDate(s.fin, soon, { dueDate: day(2) })
    await payments.setDueDate(s.fin, far, { dueDate: day(20) })
    await expectDbError(as('edx.finance@demo.test', (tx) => tx`select app.payment_due_reminders()`), '42501')
    const run = () => anonymous((tx) => tx<{ n: number }[]>`select app.payment_due_reminders() as n`).then(([r]) => r.n)
    expect(await run()).toBeGreaterThan(0)
    expect(await run()).toBe(0)
    const rows = await adminSql()`select n.title, n.href, n.event_key, n.email_status, n.dedupe_key, u.email from staff_notifications n join user_profiles u on u.id = n.user_id
      where n.dedupe_key like ${`payment_%:${over}:%`} or n.dedupe_key like ${`payment_%:${soon}:%`} or n.dedupe_key like ${`payment_%:${far}:%`}`
    expect(rows.some((r) => r.email === 'edx.finance@demo.test' && r.event_key === 'payment_overdue' && r.email_status === 'pending')).toBe(true)
    expect(rows.some((r) => r.email === 'edx.finance@demo.test' && r.event_key === 'payment_due_soon' && r.email_status === 'none')).toBe(true)
    expect(rows.some((r) => String(r.dedupe_key).includes(far))).toBe(false)
    expect(rows.some((r) => r.email === 'edx.counsellor@demo.test' || r.email === 'grd.finance@demo.test')).toBe(false)
    for (const r of rows) { expect(r.title).not.toMatch(/\d|Fictional/); expect(r.href).toBe(`/students/${s.id}`) }

    const s2 = await setup()
    const paid = await charge(s2, '800')
    await payments.setDueDate(s2.fin, paid, { dueDate: day(-1) })
    await receipt(s2, '800')
    await run()
    expect(await adminSql()`select 1 from staff_notifications where dedupe_key like ${`payment_%:${paid}:%`}`).toHaveLength(0)
  })
})

describe('Phase 10 reports', () => {
  const find = (rows: Record<string, unknown>[], k: Record<string, unknown>) => rows.find((r) => Object.entries(k).every(([a, b]) => r[a] === b))

  it('monthly, yearly and revenue stay per currency, keep totals exact, and a later reversal does not rewrite the earlier period', async () => {
    const s = await setup()
    const ref = '2026-03-15'
    const usdR = await payments.recordEntry(s.fin, s.id, { orgId: EDX, feeCategoryId: SERVICE, entryDate: ref, entryType: 'receipt', amount: '100', currency: 'USD', exchangeRate: '90', method: 'bank_transfer', referenceNo: `U${rand()}${rand()}` })
    await payments.verifyEntry(s.md, usdR, 'verified')
    await receipt(s, '700', { entryDate: ref })
    const filter = { from: '2026-03-01', to: '2026-03-31' }
    const monthly = (await reports.runReport(s.md, 'finance-monthly', [EDX], filter)).rows
    expect(find(monthly, { period: '2026-03', currency: 'USD', ledger: 'Service' })).toMatchObject({ received: '100.00', received_inr: '9000.00' })
    expect(Number(find(monthly, { period: '2026-03', currency: 'INR', ledger: 'Service' })!.received)).toBeGreaterThanOrEqual(700)
    const yearly = (await reports.runReport(s.md, 'finance-yearly', [EDX], { from: '2026-01-01', to: '2026-12-31' })).rows
    expect(Number(find(yearly, { period: '2026', currency: 'USD' })!.received)).toBeGreaterThanOrEqual(100)
    const revenue = (await reports.runReport(s.md, 'finance-revenue', [EDX], filter)).rows
    expect(revenue.filter((r) => r.currency === 'USD').reduce((t, r) => t + Number(r.revenue), 0)).toBe(100)
    // outside the range there is nothing
    expect((await reports.runReport(s.md, 'finance-monthly', [EDX], { from: '2031-04-01', to: '2031-04-30' })).rows).toHaveLength(0)
    // a reversal counts in the period of its own entry date; March keeps its entries
    const [before] = await adminSql()`select * from payment_entries where id = ${usdR}`
    await payments.reverseEntry(s.fin, usdR, 'Fictional bank return')
    const [rev] = await adminSql()`select id, entry_date from payment_entries where reverses_entry_id = ${usdR}`
    await payments.verifyEntry(s.md, rev.id, 'verified')
    const [after] = await adminSql()`select * from payment_entries where id = ${usdR}`
    expect(after).toEqual(before)
    const again = (await reports.runReport(s.md, 'finance-monthly', [EDX], filter)).rows
    expect(find(again, { period: '2026-03', currency: 'USD', ledger: 'Service' })).toMatchObject({ received: '100.00' })
    const period = new Date(rev.entry_date).toISOString().slice(0, 7)
    const later = (await reports.runReport(s.md, 'finance-monthly', [EDX], { from: `${period}-01`, to: `${period}-28` })).rows
    expect(Number(find(later, { period, currency: 'USD', ledger: 'Service' })!.received)).toBeLessThanOrEqual(-100)
  })

  it('balances report shows due dates and the overdue filter; access and export follow finance permissions', async () => {
    const s = await setup()
    const c = await charge(s, '6000')
    await payments.setDueDate(s.fin, c, { dueDate: day(-3) })
    const [st] = await adminSql()`select student_code from students where id = ${s.id}`
    const rows = (await reports.runReport(s.md, 'balances', [EDX], { status: 'overdue' })).rows
    expect(find(rows, { student_code: st.student_code })).toMatchObject({ overdue: '6000.00' })
    const c2s = await setup()
    await charge(c2s, '10')
    const [st2] = await adminSql()`select student_code from students where id = ${c2s.id}`
    expect(find((await reports.runReport(s.md, 'balances', [EDX], { status: 'overdue' })).rows, { student_code: st2.student_code })).toBeUndefined()
    expect(find((await reports.runReport(s.md, 'balances', [EDX], {})).rows, { student_code: st2.student_code })).toBeTruthy()

    const counsellor = await ctxFor('edx.counsellor@demo.test')
    expect(await kindOf(reports.runReport(counsellor, 'finance-monthly', [EDX], {}))).toBe('not_found')
    expect(await kindOf(reports.exportReport(counsellor, 'finance-revenue', [EDX], {}))).toBe('not_found')
    const exported = await reports.exportReport(s.md, 'finance-monthly', [EDX], { from: day(-40), to: day(1) })
    expect(exported.csv).toContain('Charged less waivers')
    expect(await adminSql()`select 1 from audit_logs where action = 'export' and entity_id = 'finance-monthly' and occurred_at > now() - interval '1 minute'`).not.toHaveLength(0)
  })
})
