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
}

export interface BalanceRow {
  student_id: string; org_id: string; org_name: string; ledger: string; currency: string; amount_due: string; amount_received: string
  outstanding: string; amount_disbursed: string; held_balance: string; pending_receipts: string
}

const LEDGER_SELECT = (tx: Tx) => tx`
  select e.id, e.org_id, o.name as org_name, e.student_id, s.student_code, s.full_name as student_name, e.entry_type,
         fc.name as fee_category, e.ledger, e.amount, e.currency, e.entry_date, e.method, e.reference_no, e.receipt_ref, e.payee,
         le.name as recipient_name, e.notes, e.verification_status, e.verified_at, vu.full_name as verifier_name, e.recorded_by,
         ru.full_name as recorder_name, e.recorded_at, e.reverses_entry_id,
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
    return { entries, balances, categories: categories.filter((c) => can(ctx, 'payments.record', c.org_id) || can(ctx, 'payments.disbursement', c.org_id) || can(ctx, 'payments.reverse', c.org_id)) }
  })
}

export interface LedgerFilters { status?: string; type?: string; ledger?: string; from?: string; to?: string; q?: string; page?: string | number }

export async function listLedger(ctx: Ctx, orgIds: string[], f: LedgerFilters) {
  const page = pageOf(f.page)
  const allowed = orgIds.filter((o) => can(ctx, 'payments.read', o))
  if (!allowed.length) throw forbidden('You do not have access to the payment ledger.')
  return run(ctx, async (tx) => {
    const conds = [tx`e.org_id = any(${tx.array(allowed)}::uuid[])`]
    if (f.status && /^[a-z_]+$/.test(f.status)) conds.push(tx`e.verification_status = ${f.status}`)
    if (f.type && /^[a-z_]+$/.test(f.type)) conds.push(tx`e.entry_type = ${f.type}`)
    if (f.ledger === 'service' || f.ledger === 'third_party') conds.push(tx`e.ledger = ${f.ledger}`)
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
    return { rows, total: Number(rows[0]?.total ?? 0), page, pageSize: PAGE_SIZE, summary, totals }
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
    const id = randomUUID()
    await tx`insert into payment_entries (id, org_id, student_id, entry_type, fee_category_id, amount, currency, entry_date, method,
                                          reference_no, receipt_ref, recipient_entity_id, payee, notes)
             values (${id}, ${v.orgId}, ${studentId}, ${v.entryType}, ${v.feeCategoryId}, ${v.amount}, ${org.currency}, ${v.entryDate},
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
