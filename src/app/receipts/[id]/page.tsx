import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { BrandMark } from '@/components/brand-mark'
import { fmtDate, fmtDateTime, fmtMoney, label } from '@/components/format'
import { brandOf } from '@/lib/brands'
import { requireUser } from '@/server/auth/session'
import { getReceipt } from '@/server/services/payments'
import { PrintButton } from './print-button'

export const metadata: Metadata = { title: 'Payment receipt' }

/** Printable receipt for a verified receipt entry (finance permission; company-restricted in the database). */
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireUser()
  const r = await getReceipt(ctx, id)
  if (!r) notFound()
  const rows: [string, React.ReactNode][] = [
    ['Receipt number', <span key="n" className="font-mono">{r.receipt_no}</span>],
    ['Date of payment', fmtDate(r.entry_date)],
    ['Student', <span key="s">{r.student_name} <span className="font-mono text-slate-600">({r.student_code})</span></span>],
    ['Company', r.org_name],
    ['For', r.fee_category],
    ['Amount received', <strong key="a">{fmtMoney(r.amount, r.currency)}</strong>],
    ...(r.currency !== 'INR' ? [['Exchange rate applied', `1 ${r.currency} = ${Number(r.exchange_rate)} INR`], ['INR equivalent', fmtMoney(r.inr_amount, 'INR')]] as [string, React.ReactNode][] : []),
    ['Payment method', r.method ? label(r.method) : '—'],
    ['Transaction / reference no.', r.reference_no ?? '—'],
    ['Verification', `Verified${r.verifier_name ? ` by ${r.verifier_name}` : ''}${r.verified_at ? ` on ${fmtDateTime(r.verified_at)}` : ''}`],
  ]
  return (
    <main className="mx-auto max-w-2xl bg-white p-6 print:p-0 sm:my-8 sm:rounded-2xl sm:shadow-sm">
      <div className="flex items-start justify-between gap-4 rounded-xl bg-navy-950 p-4 print:bg-white print:p-0">
        <BrandMark brand={brandOf(r.org_code)} />
        <div className="text-right text-white print:text-slate-900"><p className="text-lg font-bold">Payment receipt</p><p className="font-mono text-sm">{r.receipt_no}</p></div>
      </div>
      {r.reversed && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">This payment was later reversed. This receipt is no longer valid.</p>}
      <dl className="mt-6 divide-y divide-slate-100 text-sm">
        {rows.map(([k, v]) => <div key={k} className="grid grid-cols-5 gap-3 py-2.5"><dt className="col-span-2 text-slate-500">{k}</dt><dd className="col-span-3 text-slate-900">{v}</dd></div>)}
      </dl>
      <p className="mt-6 text-xs text-slate-500">Issued {fmtDateTime(r.receipt_issued_at)}. Computer-generated receipt from the {r.org_name} admissions system; amounts in the original currency of payment.
        {r.currency !== 'INR' && ' The INR equivalent uses the exchange rate applied to this payment.'}</p>
      <div className="mt-6 flex gap-2 print:hidden"><PrintButton /><a className="btn-secondary" href={`/students/${r.student_id}?tab=payments`}>Back to the student</a></div>
    </main>
  )
}
