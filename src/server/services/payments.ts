import { randomUUID } from 'node:crypto'
import { can } from '../auth/context'
import type { Tx } from '../db'
import { forbidden, invalid } from '../errors'
import { fieldErrors, paymentSchema } from '../validation'
import { type Ctx, PAGE_SIZE, pageOf, run } from './base'

export interface LedgerRow {
  id: string; org_id: string; org_name: string; student_id: string; student_code: string | null; student_name: string | null
  entry_type: string; fee_category: string; ledger: string; amount: string; currency: string; entry_date: string; method: string | null
  reference_no: string | null; receipt_ref: string | null; payee: string | null; recipient_name: string | null; notes: string | null
  verification_status: string; verified_at: Date | null; verifier_name: string | null; recorded_by: string; recorder_name: string | null
  recorded_at: Date; reverses_entry_id: string | null; reversed_by_id: string | null; total?: string
  exchange_rate: string | null; inr_amount: string | null; receipt_no: string | null; rate_changes: number
}

export interface BalanceRow {
  student_id: string; org_id: string; org_name: string; ledger: string; currency: string; amount_due: string; amount_received: string
  outstanding: string; amount_disbursed: string; held_balance: string; pending_receipts: string
}

const LEDGER_SELECT = (tx: Tx) => tx`
  select e.id, e.org_id, o.name as org_name, e.student_id, s.student_code, s.full_name as student_name, e.entry_type,
         fc.name as fee_category, e.ledger, e.amount, e.currency, e.entry_date, e.method, e.reference_no, e.receipt_ref, e.payee,
         le.name as recipient_name, e.notes, e.verification_status, e.verified_at, vu.full_name as verifier_name, e.recorded_by,
         ru.full_name as recorder_name, e.recorded_at, e.reverses_entry_id, e.exchange_rate, e.inr_amount,
         (select rc.receipt_no from payment_receipts rc where rc.payment_entry_id = e.id) as receipt_no,
         (select count(*)::int from payment_rate_changes x where x.payment_entry_id = e.id) as rate_changes,
         (select r.id from payment_entries r where r.reverses_entry_id = e.id and r.verification_status <> 'rejected' limit 1) as reversed_by_id
    from payment_entries e
    join organizations o on o.id = e.org_id
    join fee_categories fc on fc.id = e.fee_category_id
    left join students s on s.id = e.student_id
    left join legal_entities le on le.id = e.recipient_entity_id
    left join user_profiles vu on vu.id = e.verified_by
    left join user_profiles ru on ru.id = e.recorded_by`

export async function studentLedger(ctx: Ctx, studentId: string) {
  return run(ctx, async (tx) => {
    const entries = await tx<LedgerRow[]>`${LEDGER_SELECT(tx)} where e.student_id = ${studentId} order by e.entry_date desc, e.recorded_at desc`
    const balances = await tx<BalanceRow[]>`
      select b.*, o.name as org_name from student_balances b join organizations o on o.id = b.org_id
       where b.student_id = ${studentId} order by o.name, b.ledger`
    const categories = await tx<{ id: string; org_id: string; name: string; kind: string }[]>`
      select fc.id, fc.org_id, fc.name, fc.kind from fee_categories fc
       where fc.is_active and app.student_has_org(${studentId}, fc.org_id) order by fc.kind, fc.name`
    const inr = await tx<{ org_id: string; ledger: string; currency: string; due_inr: string; received_inr: string; missing: number }[]>`
      select org_id, ledger, currency, coalesce(sum(due_inr), 0) as due_inr, coalesce(sum(received_inr), 0) as received_inr, count(*) filter (where inr_missing)::int as missing
        from payment_entry_effects where student_id = ${studentId} group by org_id, ledger, currency`
    return { entries, balances, inr, categories: categories.filter((c) => can(ctx, 'payments.record', c.org_id) || can(ctx, 'payments.disbursement', c.org_id) || can(ctx, 'payments.reverse', c.org_id)) }
  })
}

export interface LedgerFilters { status?: string; type?: string; ledger?: string; from?: string; to?: string; q?: string; currency?: string; page?: string | number }

export async function listLedger(ctx: Ctx, orgIds: string[], f: LedgerFilters) {
  const page = pageOf(f.page)
  const allowed = orgIds.filter((o) => can(ctx, 'payments.read', o))
  if (!allowed.length) throw forbidden('You do not have access to the payment ledger.')
  return run(ctx, async (tx) => {
    const conds = [tx`e.org_id = any(${tx.array(allowed)}::uuid[])`]
    if (f.status && /^[a-z_]+$/.test(f.status)) conds.push(tx`e.verification_status = ${f.status}`)
    if (f.type && /^[a-z_]+$/.test(f.type)) conds.push(tx`e.entry_type = ${f.type}`)
    if (f.ledger === 'service' || f.ledger === 'third_party') conds.push(tx`e.ledger = ${f.ledger}`)
    if (f.currency && /^[A-Z]{3}$/.test(f.currency)) conds.push(tx`e.currency = ${f.currency}`)
    if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) conds.push(tx`e.entry_date >= ${f.from}`)
    if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) conds.push(tx`e.entry_date <= ${f.to}`)
    if (f.q?.trim()) {
      const like = `%${f.q.trim().slice(0, 60).replace(/[\\%_]/g, (m) => '\\' + m)}%`
      conds.push(tx`(s.student_code ilike ${like} or s.full_name ilike ${like} or e.reference_no ilike ${like} or e.receipt_ref ilike ${like})`)
    }
    const where = conds.reduce((a, c) => tx`${a} and ${c}`)
    const rows = await tx<LedgerRow[]>`
      select * , count(*) over () as total from (${LEDGER_SELECT(tx)} where ${where}) x
       order by entry_date desc, recorded_at desc limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`
    const [summary] = await tx<{ pending: string; pending_count: number }[]>`
      select coalesce(sum(amount) filter (where entry_type = 'receipt'), 0) as pending, count(*)::int as pending_count
        from payment_entries where org_id = any(${tx.array(allowed)}::uuid[]) and verification_status = 'pending'`
    // Totals per currency (verified entries only; amounts are never mixed across currencies)
    const totals = await tx<{ currency: string; received_30: string; charged_30: string; refunded_30: string; months: number[] }[]>`
      select e.currency,
             coalesce(sum(e.amount) filter (where e.entry_type = 'receipt' and e.verification_status = 'verified' and e.entry_date > current_date - 30), 0) as received_30,
             coalesce(sum(e.amount) filter (where e.entry_type = 'charge' and e.entry_date > current_date - 30), 0) as charged_30,
             coalesce(sum(e.amount) filter (where e.entry_type in ('refund', 'disbursement') and e.verification_status = 'verified' and e.entry_date > current_date - 30), 0) as refunded_30,
             array(select coalesce(sum(x.amount), 0)::float8 from generate_series(5, 0, -1) g
                     left join payment_entries x on x.org_id = any(${tx.array(allowed)}::uuid[]) and x.currency = e.currency and x.entry_type = 'receipt'
                          and x.verification_status = 'verified' and date_trunc('month', x.entry_date) = date_trunc('month', current_date) - make_interval(months => g)
                    group by g order by g desc) as months
        from payment_entries e where e.org_id = any(${tx.array(allowed)}::uuid[])
       group by e.currency order by count(*) desc`
    // Consolidated INR equivalents (stored per transaction; never recalculated) – service ledger, verified entries
    const [inr] = await tx<{ received_30: string; outstanding: string; missing: number }[]>`
      select coalesce(sum(received_inr) filter (where entry_date > current_date - 30), 0) as received_30,
             coalesce(sum(due_inr) - sum(received_inr), 0) as outstanding, count(*) filter (where inr_missing)::int as missing
        from payment_entry_effects where org_id = any(${tx.array(allowed)}::uuid[]) and ledger = 'service'`
    return { rows, total: Number(rows[0]?.total ?? 0), page, pageSize: PAGE_SIZE, summary, totals, inr }
  })
}

export async function recordEntry(ctx: Ctx, studentId: string, raw: Record<string, unknown>) {
  const parsed = paymentSchema.safeParse(raw)
  if (!parsed.success) throw invalid('Please correct the highlighted fields.', fieldErrors(parsed.error))
  const v = parsed.data
  const needed = v.entryType === 'refund' ? 'payments.reverse' : v.entryType === 'disbursement' ? 'payments.disbursement' : 'payments.record'
  if (!can(ctx, needed, v.orgId)) throw forbidden('You do not have permission to record this type of entry.')
  return run(ctx, async (tx) => {
    const [cat] = await tx<{ kind: string }[]>`select kind from fee_categories where id = ${v.feeCategoryId} and org_id = ${v.orgId}`
    if (!cat) throw invalid('Choose a fee category of this company.', { feeCategoryId: ['Choose a category.'] })
    if (v.entryType === 'disbursement' && cat.kind !== 'third_party') {
      throw invalid('Disbursements can only be recorded against third-party categories (e.g. university fees).', { feeCategoryId: ['Choose a third-party category.'] })
    }
    const [org] = await tx<{ currency: string }[]>`select coalesce(settings->>'currency', 'INR') as currency from organizations where id = ${v.orgId}`
    const currency = v.currency ?? org.currency
    if (v.referenceNo && ['receipt', 'refund'].includes(v.entryType)) {
      const [dup] = await tx`select 1 from payment_entries where org_id = ${v.orgId} and entry_type = ${v.entryType} and lower(btrim(reference_no)) = lower(btrim(${v.referenceNo}))
                               and verification_status <> 'rejected'`
      if (dup) throw invalid('This transaction reference was already recorded for this company. Check for a duplicate payment.', { referenceNo: ['Already recorded.'] })
    }
    const id = randomUUID()
    await tx`insert into payment_entries (id, org_id, student_id, entry_type, fee_category_id, amount, currency, exchange_rate, entry_date, method,
                                          reference_no, receipt_ref, recipient_entity_id, payee, notes)
             values (${id}, ${v.orgId}, ${studentId}, ${v.entryType}, ${v.feeCategoryId}, ${v.amount}, ${currency}, ${currency === 'INR' ? null : v.exchangeRate ?? null}, ${v.entryDate},
                     ${v.method ?? null}, ${v.referenceNo ?? null}, ${v.receiptRef ?? null}, ${v.recipientEntityId ?? null},
                     ${v.payee ?? null}, ${v.notes ?? null})`
    return id
  })
}

export async function verifyEntry(ctx: Ctx, entryId: string, decision: string, note?: string) {
  if (decision !== 'verified' && decision !== 'rejected') throw invalid('Choose verify or reject.')
  return run(ctx, (tx) => tx`select app.verify_payment(${entryId}, ${decision}, ${note ?? null})`)
}

export async function reverseEntry(ctx: Ctx, entryId: string, reason: string) {
  if (!reason?.trim()) throw invalid('Give a reason for the reversal.', { reason: ['Required.'] })
  return run(ctx, async (tx) => {
    const [e] = await tx<{ org_id: string; student_id: string; fee_category_id: string; amount: string }[]>`
      select org_id, student_id, fee_category_id, amount from payment_entries where id = ${entryId}`
    if (!e) throw invalid('Entry not found.')
    if (!can(ctx, 'payments.reverse', e.org_id)) throw forbidden('You do not have permission to reverse entries.')
    await tx`insert into payment_entries (id, org_id, student_id, entry_type, fee_category_id, amount, reverses_entry_id, notes)
             values (${randomUUID()}, ${e.org_id}, ${e.student_id}, 'reversal', ${e.fee_category_id}, ${e.amount}, ${entryId}, ${reason.trim().slice(0, 2000)})`
  })
}

// ---------------------------------------------------------------- currencies, rates, receipts (multi-currency, Nov 2026)
export interface CurrencyRow { code: string; name: string; symbol: string; is_active: boolean; sort_order: number; reference_rate: string | null; reference_rate_date: string | null }

export async function listCurrencies(ctx: Ctx, activeOnly = true) {
  return run(ctx, (tx) => tx<CurrencyRow[]>`select code, name, symbol, is_active, sort_order, reference_rate, reference_rate_date::text from currencies
    ${activeOnly ? tx`where is_active` : tx``} order by sort_order, code`)
}

export async function saveCurrency(ctx: Ctx, v: Record<string, string | undefined>) {
  if (!can(ctx, 'currencies.manage')) throw forbidden()
  const code = (v.code ?? '').trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(code)) throw invalid('Use the 3-letter ISO code, e.g. GBP.', { code: ['3 letters.'] })
  const rate = v.referenceRate?.trim() ? Number(v.referenceRate) : null
  if (rate !== null && !(rate > 0 && rate < 100000)) throw invalid('Enter a valid reference rate (INR for 1 unit) or leave it empty.', { referenceRate: ['Invalid.'] })
  if (code === 'INR' && rate !== null && rate !== 1) throw invalid('INR is always 1.')
  return run(ctx, async (tx) => {
    const vals = { name: v.name?.trim() || code, symbol: v.symbol?.trim() || code, is_active: v.isActive !== 'false' || code === 'INR',
      reference_rate: rate, reference_rate_date: rate ? (v.referenceRateDate || new Date().toISOString().slice(0, 10)) : null, updated_by: ctx.userId, updated_at: new Date() }
    const r = await tx`update currencies set ${tx(vals as never)} where code = ${code}`
    if (!r.count) await tx`insert into currencies ${tx({ code, ...vals, sort_order: 100 } as never)}`
  })
}

export async function correctRate(ctx: Ctx, entryId: string, rate: string, reason: string) {
  if (!/^\d{1,6}(\.\d{1,8})?$/.test(rate) || Number(rate) <= 0) throw invalid('Enter a valid rate.', { rate: ['Invalid.'] })
  if (!reason.trim()) throw invalid('Give the reason.', { reason: ['Required.'] })
  return run(ctx, (tx) => tx`select app.correct_exchange_rate(${entryId}, ${rate}::numeric, ${reason.trim()})`)
}

export async function getReceipt(ctx: Ctx, entryId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(entryId)) return null
  return run(ctx, async (tx) => {
    const [r] = await tx<(LedgerRow & { receipt_issued_at: Date; org_code: string; legal_entity: string | null; verifier: string | null })[]>`
      select x.*, rc.issued_at as receipt_issued_at, o.code as org_code, x.recipient_name as legal_entity, x.verifier_name as verifier
        from (${LEDGER_SELECT(tx)} where e.id = ${entryId}) x join payment_receipts rc on rc.payment_entry_id = x.id join organizations o on o.id = x.org_id`
    if (!r) return null
    const [rev] = await tx<{ id: string }[]>`select id from payment_entries where reverses_entry_id = ${entryId} and verification_status = 'verified'`
    return { ...r, reversed: !!rev }
  })
}

export async function rateHistory(ctx: Ctx, entryId: string) {
  return run(ctx, (tx) => tx<{ old_rate: string | null; new_rate: string; old_inr: string | null; new_inr: string; reason: string; by: string; changed_at: Date }[]>`
    select c.old_rate, c.new_rate, c.old_inr, c.new_inr, c.reason, u.full_name as by, c.changed_at
      from payment_rate_changes c join user_profiles u on u.id = c.changed_by where c.payment_entry_id = ${entryId} order by c.id`)
}
