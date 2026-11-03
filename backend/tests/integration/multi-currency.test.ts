/** Multi-currency payments: transaction rates, INR equivalents, per-currency balances, receipts, rate corrections, duplicates, permissions. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { ServiceError } from '@/lib/errors'
import * as payments from '@/services/payments'
import * as students from '@/services/students'
import { adminSql, as, ctxFor, expectDbError, orgId } from '../support/helpers'

let EDX: string; let SERVICE: string
const rand = () => String(Math.floor(Math.random() * 90000) + 10000)
beforeAll(async () => {
  EDX = await orgId('EDX')
  SERVICE = (await adminSql()`select id from fee_categories where org_id = ${EDX} and kind = 'service' order by name limit 1`)[0].id
})
afterAll(async () => { await adminSql().end(); await db().end() })

async function expectServiceError(p: Promise<unknown>, kind?: string) {
  try { await p } catch (e) { expect(e).toBeInstanceOf(ServiceError); if (kind) expect((e as ServiceError).kind).toBe(kind); return e as ServiceError }
  throw new Error('expected ServiceError')
}
async function setup() {
  const mgr = await ctxFor('edx.manager@demo.test')
  const r = await students.createStudent(mgr, { originatingOrgId: EDX, fullName: 'Currency Student', phone: `+91 90089 ${rand()}` })
  if (!r.ok) throw new Error()
  return { id: r.id, fin: await ctxFor('edx.finance@demo.test'), md: await ctxFor('md@demo.test') }
}
const entry = (id: string) => adminSql()`select amount, currency, exchange_rate, inr_amount, rate_source, verification_status from payment_entries where id = ${id}`.then((r) => r[0])
const base = (extra: Record<string, string>) => ({ orgId: EDX, feeCategoryId: SERVICE, entryDate: '2026-10-01', ...extra })

describe('multi-currency payments', () => {
  it('INR uses rate 1; USD and EUR store the applied rate and an INR equivalent calculated by the database', async () => {
    const s = await setup()
    const inr = await payments.recordEntry(s.fin, s.id, base({ entryType: 'charge', amount: '50000', currency: 'INR', exchangeRate: '5' }))
    expect(await entry(inr)).toMatchObject({ exchange_rate: '1.00000000', inr_amount: '50000.00', rate_source: 'fixed' })
    const usd = await payments.recordEntry(s.fin, s.id, base({ entryType: 'receipt', amount: '1000', currency: 'USD', exchangeRate: '90', method: 'bank_transfer', referenceNo: `U${rand()}` }))
    expect(await entry(usd)).toMatchObject({ currency: 'USD', exchange_rate: '90.00000000', inr_amount: '90000.00', rate_source: 'manual' })
    const eur = await payments.recordEntry(s.fin, s.id, base({ entryType: 'receipt', amount: '333.33', currency: 'EUR', exchangeRate: '97.123456', method: 'card', referenceNo: `E${rand()}` }))
    expect((await entry(eur)).inr_amount).toBe('32374.16') // 333.33 × 97.123456 = 32374.1616… → rounded to paise
    await expectServiceError(payments.recordEntry(s.fin, s.id, base({ entryType: 'charge', amount: '10', currency: 'USD' })), 'invalid') // rate required
    await expectServiceError(payments.recordEntry(s.fin, s.id, base({ entryType: 'charge', amount: '10', currency: 'XYZ', exchangeRate: '2' })))
    // a client cannot set the INR equivalent
    await expectDbError(as('edx.finance@demo.test', (tx) => tx`insert into payment_entries (org_id, student_id, entry_type, fee_category_id, amount, currency, exchange_rate, inr_amount)
      values (${EDX}, ${s.id}, 'charge', ${SERVICE}, 10, 'USD', 80, 999999)`), '42501')
  })

  it('different payments keep their own rates; later rates never change history; balances stay per currency', async () => {
    const s = await setup()
    await payments.recordEntry(s.fin, s.id, base({ entryType: 'charge', amount: '20000', currency: 'USD', exchangeRate: '88' }))
    const p1 = await payments.recordEntry(s.fin, s.id, base({ entryType: 'receipt', amount: '5000', currency: 'USD', exchangeRate: '89', method: 'bank_transfer', referenceNo: `A${rand()}` }))
    const p2 = await payments.recordEntry(s.fin, s.id, base({ entryType: 'receipt', amount: '7000', currency: 'USD', exchangeRate: '91.5', method: 'bank_transfer', referenceNo: `B${rand()}` }))
    const inrPay = await payments.recordEntry(s.fin, s.id, base({ entryType: 'receipt', amount: '100000', currency: 'INR', method: 'upi', referenceNo: `C${rand()}` }))
    for (const id of [p1, p2, inrPay]) await payments.verifyEntry(s.md, id, 'verified')
    expect((await entry(p1)).exchange_rate).toBe('89.00000000') // unchanged by p2's rate
    await adminSql()`update currencies set reference_rate = 70 where code = 'USD'`
    expect((await entry(p2)).inr_amount).toBe('640500.00') // reference rates never touch history
    const l = await payments.studentLedger(s.md, s.id)
    const usd = l.balances.find((b) => b.currency === 'USD')!
    expect(usd).toMatchObject({ amount_due: '20000.00', amount_received: '12000.00', outstanding: '8000.00' }) // INR payment does NOT offset USD
    const inr = l.balances.find((b) => b.currency === 'INR')!
    expect(Number(inr.amount_received)).toBe(100000)
    const usdInr = l.inr.find((x) => x.currency === 'USD')!
    expect(Number(usdInr.due_inr)).toBe(1760000)
    expect(Number(usdInr.received_inr)).toBe(5000 * 89 + 7000 * 91.5)
  })

  it('verified receipts get a numbered receipt; reversal copies the original rate; duplicates are refused', async () => {
    const s = await setup()
    const ref = `R${rand()}${rand()}`
    const p = await payments.recordEntry(s.fin, s.id, base({ entryType: 'receipt', amount: '250', currency: 'EUR', exchangeRate: '95', method: 'bank_transfer', referenceNo: ref }))
    await expectServiceError(payments.recordEntry(s.fin, s.id, base({ entryType: 'receipt', amount: '250', currency: 'EUR', exchangeRate: '95', method: 'bank_transfer', referenceNo: ref.toLowerCase() })), 'invalid')
    await payments.verifyEntry(s.md, p, 'verified')
    const rcpt = (await payments.getReceipt(s.md, p))!
    expect(rcpt.receipt_no).toMatch(/^EDX-RCP-\d{4}-\d{5}$/)
    expect(rcpt).toMatchObject({ currency: 'EUR', exchange_rate: '95.00000000', inr_amount: '23750.00', reversed: false })
    expect(await payments.getReceipt(await ctxFor('ceo@demo.test'), p)).toBeNull()
    expect(await payments.getReceipt(await ctxFor('grd.finance@demo.test'), p)).toBeNull()
    await payments.reverseEntry(s.fin, p, 'Bank returned the payment (test)')
    const [rev] = await adminSql()`select exchange_rate, inr_amount, currency from payment_entries where reverses_entry_id = ${p}`
    expect(rev).toMatchObject({ currency: 'EUR', exchange_rate: '95.00000000', inr_amount: '23750.00' })
  })

  it('rate corrections: only while pending (or on charges), with a reason and history; verified entries are protected', async () => {
    const s = await setup()
    const p = await payments.recordEntry(s.fin, s.id, base({ entryType: 'receipt', amount: '100', currency: 'USD', exchangeRate: '80', method: 'cash' }))
    await expectServiceError(payments.correctRate(s.fin, p, '85', ''), 'invalid')
    await payments.correctRate(s.fin, p, '85.5', 'Bank advice shows 85.50')
    expect(await entry(p)).toMatchObject({ exchange_rate: '85.50000000', inr_amount: '8550.00' })
    expect((await payments.rateHistory(s.fin, p))[0]).toMatchObject({ old_rate: '80.00000000', new_rate: '85.50000000', reason: 'Bank advice shows 85.50' })
    await payments.verifyEntry(s.md, p, 'verified')
    await expectServiceError(payments.correctRate(s.fin, p, '90', 'try after verification'))
    await expectDbError(adminSql()`update payment_entries set exchange_rate = 1 where id = ${p}`, '42501')
    await expectDbError(adminSql()`delete from payment_rate_changes where payment_entry_id = ${p}`, 'P0001')
  })

  it('existing INR entries keep their values; only the MD manages currencies; the CEO sees no amounts', async () => {
    const [{ bad }] = await adminSql()`select count(*)::int as bad from payment_entries where currency = 'INR' and (exchange_rate <> 1 or inr_amount <> amount)`
    expect(bad).toBe(0)
    await expectServiceError(payments.saveCurrency(await ctxFor('edx.finance@demo.test'), { code: 'GBP', name: 'Pound' }), 'forbidden')
    await payments.saveCurrency(await ctxFor('md@demo.test'), { code: 'GBP', name: 'Pound Sterling', symbol: '£', referenceRate: '110' })
    expect((await payments.listCurrencies(await ctxFor('md@demo.test'))).map((c) => c.code)).toContain('GBP')
    await expectServiceError(payments.listLedger(await ctxFor('ceo@demo.test'), [EDX], {}), 'forbidden')
  })
})
